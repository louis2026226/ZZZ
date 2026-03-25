# BACKEND.md — 后台逻辑文档

## 技术栈

- **运行时**: Node.js (ESM, `"type": "module"`)
- **HTTP/WS**: Express + Socket.IO
- **数据库**: PostgreSQL（Railway 托管），通过 `pg` 包连接
- **密码哈希**: Node.js 内置 `crypto.scryptSync`（无额外依赖）
- **部署**: Railway（Docker）/ 自托管（PM2）

---

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | 3000 | 主服务端口（Socket.IO + 静态资源） |
| `SUPER_ADMIN_PORT` | 3390 | 超管独立端口（设 `0` 禁用） |
| `DATABASE_URL` | 无 | PostgreSQL 连接字符串（Railway 自动注入） |
| `ADMIN_PASSWORD` | `admin888` | 无 DB 时 B 端登录回退密码 |
| `CLIENT_ORIGIN` | `*` | Socket.IO CORS 来源 |
| `SUPER_ADMIN_USER` | `admin` | 超管用户名 |
| `SUPER_ADMIN_PASS` | `123456` | 超管密码 |

---

## 数据库表结构

### b_accounts — B端账号表

```sql
CREATE TABLE IF NOT EXISTS b_accounts (
  username     TEXT        PRIMARY KEY,
  password_hash TEXT       NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active',  -- active / disabled / banned
  authorized   BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- 由超管创建，B端用户不能自行注册
- `status` 控制登录权限：非 `active` 或 `authorized=false` 时拒绝登录

### rooms — 房间记录表

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id              SERIAL      PRIMARY KEY,
  room_code       TEXT        NOT NULL,          -- 3位房号（内存中的 room.id）
  b_username      TEXT        NOT NULL,          -- 创建该房间的B端账号
  total_rounds    INT         NOT NULL DEFAULT 0,
  max_bet         INT         NOT NULL DEFAULT 0,
  total_pnl       INT         NOT NULL DEFAULT 0, -- 所有玩家净收益之和（房主视角：负=赔）
  settled_rounds  INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- 每次 `b_create_room` 时 INSERT 一条
- 每局 `settleRound` 后 UPDATE `total_pnl` / `settled_rounds`

### bets — 投注记录表

```sql
CREATE TABLE IF NOT EXISTS bets (
  id            SERIAL      PRIMARY KEY,
  room_id       INT         NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number  INT         NOT NULL,
  c_username    TEXT        NOT NULL,
  numbers       TEXT        NOT NULL,  -- 如 "221" 或 "12"
  amount        INT         NOT NULL,
  delta         INT         NOT NULL,  -- 正=赢，负=输
  settled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- 每局结算时，对每笔 bet 写入一条记录

---

## 账号生命周期

### B端账号（由超管管理）

1. **创建**：超管调用 `super_admin_create_b`，传入 `username` + `password`
   - 密码用 `scryptSync` + 随机 salt 哈希存储
   - INSERT INTO b_accounts
2. **登录**：B端调用 `b_login`，传入 `username` + `password`
   - 有 DB：查 b_accounts，`verifyPassword()` 校验，检查 status/authorized
   - 无 DB（本地开发）：对比环境变量 `ADMIN_PASSWORD`
3. **状态变更**：超管调用 `super_admin_update_b`，修改 `status` 或 `authorized`
   - `status`: `active` / `disabled` / `banned`
   - `authorized`: true / false
4. **删除**：超管调用 `super_admin_delete_b`
   - DELETE FROM b_accounts（rooms/bets 级联删除）

### 密码哈希算法

```js
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':')
  return crypto.timingSafeEqual(
    crypto.scryptSync(pw, salt, 64),
    Buffer.from(hash, 'hex')
  )
}
```

---

## Socket.IO 事件清单

### 认证类

| 事件 | 方向 | 说明 |
|------|------|------|
| `b_login` | C→S | B端登录，校验密码（DB 或 env fallback） |
| `c_login` | C→S | C端进房（= c_join_room，共用同一处理函数） |
| `c_join_room` | C→S | C端进房（与 c_login 共用 handleCJoin） |
| `super_admin_login` | C→S | 超管登录，对比 SUPER_ADMIN_USER/PASS |

### 房间管理类（B端）

| 事件 | 说明 |
|------|------|
| `b_create_room` | 创建房间，写入 DB rooms 表 |
| `b_list_my_rooms` | 列出当前 B 账号的所有房间（内存） |
| `b_join_existing` | 重新进入已有房间（断线重连） |
| `b_dismiss_room` | 解散房间，广播 roomDismissed |

### 游戏流程类

| 事件 | 说明 |
|------|------|
| `b_start_round` | 房主开始本局答题（beginBettingRound） |
| `b_end_round` | 房主手动截止答题（phase→closed） |
| `b_settle` | 房主公布幸运号，触发 settleRound |
| `c_submit_bet` | 玩家提交投注 |
| `b_ring_bell` | 房主催答题（广播 bellRing） |

### 超管类

| 事件 | 说明 |
|------|------|
| `super_admin_list_b` | 查询所有 B 账号及统计数据 |
| `super_admin_update_b` | 修改 B 账号 status/authorized |
| `super_admin_create_b` | 新建 B 账号（username + password） |
| `super_admin_delete_b` | 删除 B 账号（DB 级联删除） |

### 服务端广播（S→C）

| 事件 | 说明 |
|------|------|
| `messages` | 房间消息列表更新 |
| `roomStats` | 房间状态（人数、局数、phase 等） |
| `gameStart` | 新一局开始 |
| `roundClosed` | 答题截止（等待开奖） |
| `newRoundWait` | 结算完毕，等待房主开始下一局 |
| `gameOver` | 所有局数打完，游戏结束 |
| `timer` | 倒计时心跳（每秒） |
| `nextRoundCountdown` | 自动开始下一局的倒计时 |
| `bellRing` | 催答题铃声 |
| `roomDismissed` | 房间已解散，客户端跳转大厅 |
| `roundResult` | 本局幸运号（drawNumber） |

---

## 游戏状态机

```
idle → betting → closed → (settled)
                              ├── 未达总局数 + 无计时器 → idle（手动开始）
                              ├── 未达总局数 + 有计时器 → betting（自动开始）
                              └── 达到总局数 → ended
```

- `idle`：等待房主点"开始答题"
- `betting`：答题进行中（可提交投注）
- `closed`：答题截止，等待房主公布幸运号
- `ended`：游戏结束

---

## 投注规则与赔率

- 选号：从 {1, 2, 3, 4} 选 1-3 个（可重复同一数字），最多使用 2 种不同数字
- 金额：5 的倍数，最低 10，最高不超过房间 `maxBet`
- 每局每个 socket 可多次提交（累计最多 2 种不同数字）

### 赔率计算（`calcWinMultiplier`）

| 选号类型 | 命中条件 | 倍数 |
|---------|---------|------|
| 单号 / 11 / 22 | 幸运号=该数字 | ×3 |
| 双号等权 (12) | 幸运号=任一数字 | ×1 |
| 双号偏权 (112) | 幸运号=重号 | ×1.5 |
| 双号偏权 (112) | 幸运号=轻号 | ×0.5 |
| 未命中 | — | -1（全扣） |

---

## 数据持久化时机

| 操作 | 写 DB |
|------|-------|
| b_create_room | INSERT rooms |
| settleRound（每局） | INSERT bets（当局所有投注）+ UPDATE rooms |
| b_dismiss_room | 不写（内存直接删） |
| 服务器重启 | 内存房间丢失，DB 历史保留 |

---

## 超管统计数据

`super_admin_list_b` 返回每个 B 账号的聚合数据：

- `totalRoundsSettled`：累计结算局数
- `selfPnL`（= `total_pnl`）：玩家净收益之和（正=玩家赢，负=玩家输）
- `distinctCCount`：参与过的不同 C 端用户数
- `cRows[]`：每个 C 端用户的用户名 + 累计收益

数据来源：DB 聚合查询（非内存），因此跨重启持久。

---

## 内存数据结构

### room 对象

```js
{
  id: '328',            // 3位房号
  adminUsername: 'xxx', // B端账号
  totalRounds: 10,
  maxBet: 200,
  betSeconds: 30,       // 0=无计时器
  baolu: '1234',        // 宝路（开奖历史）
  roomName: '周五场',
  currentRound: 0,
  gameEnded: false,
  phase: 'idle',        // idle/betting/closed/ended
  timerLeft: 0,
  timerInterval: null,
  nextRoundTimeout: null,
  countdownIv: null,
  sockets: Map<socketId, { role: 'B'|'C', username }>,
  playerBets: Map<socketId, Bet[]>,
  messages: [],         // 最多200条
  roomTotalPnL: 0,      // 本房间所有玩家净收益之和
  dbRoomId: null,       // DB rooms.id（b_create_room 后赋值）
}
```

### bStats（内存统计，辅助用）

```js
Map<b_username, {
  totalRoundsSettled: number,
  selfPnL: number,
  cUsers: Set<string>,
  cPnL: Map<c_username, number>,
}>
```

> 注：bStats 为内存辅助缓存，重启后归零。权威数据来自 PostgreSQL。
