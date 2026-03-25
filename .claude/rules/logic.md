# 游戏逻辑模块记忆

## 核心规则
- 下注阶段流转：`idle` → `betting` → `closed` → `countdown` → `betting`（下一局）
- 玩家每局最多选 2 个不同数字（1-4），可多次下注但不超过 2 种号码
- 下注金额必须是 5 的倍数，不能超过房间 MaxBetAmount
- 每局随机展示 10 个金额按钮，从预设池中抽取

## Socket 事件
- `b_start_round`：房主开始答题
- `b_end_round`：房主结束答题（关闭下注）
- `c_submit_bet`：玩家提交下注
- `b_settle`：房主选择开奖数字，触发结算
- `b_dismiss_room`：解散房间，广播 `roomDismissed` 踢出所有人
- `b_ring_bell`：房主提醒还有人未答题（🔔）

## 特殊决策
- 解散房间：房主点解散后立即退出，不等服务端回调（v1.0.97）
- 解散流程：先广播 roomDismissed 踢出所有人，再断开连接（v1.0.96）
- roundUsedDigits：记录本局玩家已用过的号码，防止超过2种
