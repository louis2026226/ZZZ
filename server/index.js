import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = Number(process.env.PORT) || 3000
const _sap = process.env.SUPER_ADMIN_PORT
let SUPER_ADMIN_PORT
if (_sap === '0' || _sap === 'false') {
  SUPER_ADMIN_PORT = null
} else if (_sap != null && _sap !== '') {
  const n = Number(_sap)
  SUPER_ADMIN_PORT = Number.isFinite(n) && n > 0 ? n : 3390
} else {
  SUPER_ADMIN_PORT = 3390
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin888'
const SUPER_ADMIN_USER = process.env.SUPER_ADMIN_USER || 'admin'
const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS || '123456'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*'

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = stored.split(':')
    return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 64), Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

async function initDb() {
  if (!pool) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS b_accounts (
      username      TEXT        PRIMARY KEY,
      password_hash TEXT        NOT NULL,
      status        TEXT        NOT NULL DEFAULT 'active',
      authorized    BOOLEAN     NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id             SERIAL      PRIMARY KEY,
      room_code      TEXT        NOT NULL,
      b_username     TEXT        NOT NULL,
      total_rounds   INT         NOT NULL DEFAULT 0,
      max_bet        INT         NOT NULL DEFAULT 0,
      total_pnl      INT         NOT NULL DEFAULT 0,
      settled_rounds INT         NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bets (
      id           SERIAL      PRIMARY KEY,
      room_id      INT         NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      round_number INT         NOT NULL,
      c_username   TEXT        NOT NULL,
      numbers      TEXT        NOT NULL,
      amount       INT         NOT NULL,
      delta        INT         NOT NULL,
      settled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  console.log('[db] Tables ready')
}

// ─── Express + Socket.IO ──────────────────────────────────────────────────────
const app = express()
app.use(cors({ origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(','), credentials: true }))
app.use(express.json())

const httpServer = createServer(app)
const httpServerAdmin = SUPER_ADMIN_PORT ? createServer(app) : null
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN === '*' ? '*' : CLIENT_ORIGIN.split(','),
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

// ─── In-memory state ──────────────────────────────────────────────────────────
const rooms = new Map()
const bStats = new Map()

// ─── Room helpers ─────────────────────────────────────────────────────────────
function roomKey(id) {
  return `room:${id}`
}

function makeRoom(adminUsername) {
  let id
  do {
    id = String(Math.floor(100 + Math.random() * 900))
  } while (rooms.has(id))
  const room = {
    id,
    adminUsername,
    totalRounds: 0,
    maxBet: 0,
    betSeconds: 30,
    baolu: '',
    currentRound: 0,
    gameEnded: false,
    phase: 'idle',
    timerLeft: 0,
    timerInterval: null,
    nextRoundTimeout: null,
    countdownIv: null,
    sockets: new Map(),
    playerBets: new Map(),
    messages: [],
    emptyPlayerTimeout: null,
    roomTotalPnL: 0,
    dbRoomId: null,
  }
  rooms.set(id, room)
  return room
}

function getRoom(id) {
  return rooms.get(String(id))
}

function addMessage(room, text) {
  room.messages.push({ t: Date.now(), text })
  if (room.messages.length > 200) room.messages.shift()
}

function addMessageImage(room, image) {
  room.messages.push({ t: Date.now(), image })
  if (room.messages.length > 200) room.messages.shift()
}

function addMessageDivider(room) {
  room.messages.push({ t: Date.now(), divider: true })
  if (room.messages.length > 200) room.messages.shift()
}

function broadcastRoom(room, event, payload) {
  io.to(roomKey(room.id)).emit(event, payload)
}

function clearRoomTimers(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval)
    room.timerInterval = null
  }
  if (room.nextRoundTimeout) {
    clearTimeout(room.nextRoundTimeout)
    room.nextRoundTimeout = null
  }
  if (room.countdownIv) {
    clearInterval(room.countdownIv)
    room.countdownIv = null
  }
}

function playerCount(room) {
  let n = 0
  for (const [, p] of room.sockets) {
    if (p.role === 'C') n++
  }
  return n
}

function clearEmptyPlayerTimeout(room) {
  if (room.emptyPlayerTimeout) {
    clearTimeout(room.emptyPlayerTimeout)
    room.emptyPlayerTimeout = null
  }
}

function syncEmptyPlayerDestroyTimer(room) {
  if (!room) return
  clearEmptyPlayerTimeout(room)
}

function roomStatsPayload(room) {
  return {
    roomId: room.id,
    playerCount: playerCount(room),
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    phase: room.phase,
    gameEnded: room.gameEnded,
    adminUsername: room.adminUsername,
    roomName: room.roomName || '',
    roomTotalPnL: room.roomTotalPnL ?? 0,
  }
}

// ─── Game logic ───────────────────────────────────────────────────────────────
function beginBettingRound(room, opts = {}) {
  if (room.gameEnded) return false
  if (room.phase === 'betting') return false
  if (room.currentRound >= room.totalRounds) return false
  if (room.phase === 'countdown' && !opts.afterCountdown) return false
  room.currentRound += 1
  clearRoomTimers(room)
  resetRoundBets(room)
  addMessageImage(room, 'be.jpg')
  addMessage(room, `【系统】游戏开始（${room.baolu || '???'}）`)
  broadcastRoom(room, 'messages', { list: room.messages })
  startBettingTimer(room)
  broadcastRoom(room, 'gameStart', {})
  broadcastRoom(room, 'roomStats', roomStatsPayload(room))
  return true
}

function startBettingTimer(room) {
  clearRoomTimers(room)
  room.phase = 'betting'
  const total = room.betSeconds || 0
  room.timerLeft = total
  broadcastRoom(room, 'timer', { left: room.timerLeft, total })
  if (total > 0) {
    room.timerInterval = setInterval(() => {
      room.timerLeft -= 1
      broadcastRoom(room, 'timer', { left: room.timerLeft, total })
      if (room.timerLeft <= 0) {
        clearInterval(room.timerInterval)
        room.timerInterval = null
        room.phase = 'closed'
        broadcastRoom(room, 'roundClosed', {})
        addMessage(
          room,
          `【系统】第 ${room.currentRound} / ${room.totalRounds} 局准备中，等待管理员公布幸运号。`
        )
        broadcastRoom(room, 'messages', { list: room.messages })
      }
    }, 1000)
  } else {
    room.timerLeft = 0
    broadcastRoom(room, 'timer', { left: 0, total: 0 })
  }
}

function normalizeBetDigit(x) {
  const d = Number(x)
  if (d === 1 || d === 2 || d === 3 || d === 4) return d
  return null
}

function normalizeLuckyNumber(x) {
  const d = Number(x)
  if (d === 1 || d === 2 || d === 3 || d === 4) return d
  return null
}

function calcWinMultiplier(numbers, luckyNum) {
  const counts = {}
  for (const n of numbers) counts[n] = (counts[n] || 0) + 1
  if (!counts[luckyNum]) return null
  const distinct = Object.keys(counts).length
  if (distinct === 1) return 3
  const vals = Object.values(counts)
  if (vals[0] === vals[1]) return 1
  const heavyNum = Number(Object.keys(counts).find((k) => counts[k] > 1))
  return luckyNum === heavyNum ? 1.5 : 0.5
}

function resetRoundBets(room) {
  room.playerBets.clear()
}

function getSocketBetList(room, sid) {
  const v = room.playerBets.get(sid)
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function digitKindsUsedBySocket(room, sid) {
  const s = new Set()
  for (const b of getSocketBetList(room, sid)) {
    for (const d of b.numbers) s.add(d)
  }
  return s
}

async function flushRoundToDb(room, roundNumber, playerNetDelta) {
  if (!pool || !room.dbRoomId) return
  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const [, betOrBets] of room.playerBets) {
        const bets = Array.isArray(betOrBets) ? betOrBets : [betOrBets]
        for (const bet of bets) {
          const numStr = bet.numbers.join('')
          const delta = playerNetDelta.get(bet.username) ?? 0
          await client.query(
            'INSERT INTO bets (room_id, round_number, c_username, numbers, amount, delta) VALUES ($1,$2,$3,$4,$5,$6)',
            [room.dbRoomId, roundNumber, bet.username, numStr, bet.amount, delta]
          )
        }
      }
      await client.query(
        'UPDATE rooms SET total_pnl=$1, settled_rounds=$2 WHERE id=$3',
        [room.roomTotalPnL, room.currentRound, room.dbRoomId]
      )
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      console.error('[db] flushRoundToDb error', e.message)
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[db] flushRoundToDb connect error', e.message)
  }
}

function settleRound(room, drawNumber) {
  const num = normalizeLuckyNumber(drawNumber)
  if (num == null) return
  addMessageImage(room, `${num}.svg`)
  addMessage(room, `【系统】房主公布幸运号：${num}`)
  const owner = room.adminUsername
  ensureBStats(owner)
  const st = bStats.get(owner)
  st.totalRoundsSettled += 1
  const playerNetDelta = new Map()
  for (const [, betOrBets] of room.playerBets) {
    const bets = Array.isArray(betOrBets) ? betOrBets : [betOrBets]
    for (const bet of bets) {
      const mult = calcWinMultiplier(bet.numbers, num)
      const delta = mult != null ? Math.round(mult * bet.amount) : -bet.amount
      const label = delta >= 0 ? '+' : '-'
      const absAmt = Math.abs(delta)
      const numDisplay = bet.numbers.join('')
      addMessage(room, `【结算】${bet.username} ${label}${absAmt}（${numDisplay}+${bet.amount}）`)
      playerNetDelta.set(bet.username, (playerNetDelta.get(bet.username) || 0) + delta)
      room.roomTotalPnL = (room.roomTotalPnL || 0) + delta
      const prevPnl = st.cPnL.get(bet.username) || 0
      st.cPnL.set(bet.username, prevPnl + delta)
      if (bet.username === owner) st.selfPnL += delta
    }
  }
  if (playerNetDelta.size === 0) {
    addMessage(room, '【结算】本局无人下注。')
  } else {
    const statLines = []
    for (const [uname, netDelta] of playerNetDelta) {
      const label = netDelta >= 0 ? '+' : '-'
      statLines.push(`${uname} ${label}${Math.abs(netDelta)}`)
    }
    addMessage(room, `【本局统计】${statLines.join('；')}`)
  }
  addMessageDivider(room)
  room.baolu = (room.baolu || '') + String(num)
  broadcastRoom(room, 'messages', { list: room.messages })
  broadcastRoom(room, 'roundResult', { drawNumber: num })

  // Fire-and-forget DB write
  flushRoundToDb(room, room.currentRound, playerNetDelta)

  if (room.currentRound >= room.totalRounds) {
    room.gameEnded = true
    room.phase = 'ended'
    addMessage(room, '【系统】已达总局数，游戏结束。')
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'gameOver', { summary: true })
    return
  }

  if (!room.betSeconds) {
    room.phase = 'idle'
    broadcastRoom(room, 'newRoundWait', { currentRound: room.currentRound, totalRounds: room.totalRounds })
    return
  }

  beginBettingRound(room, { afterCountdown: true })
}

function ensureBStats(username) {
  if (!bStats.has(username)) {
    bStats.set(username, {
      totalRoundsSettled: 0,
      selfPnL: 0,
      cUsers: new Set(),
      cPnL: new Map(),
    })
  }
}

// ─── HTTP routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size })
})

const distPath = path.join(__dirname, '..', 'client', 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// ─── Socket.IO handlers ───────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── B login ──────────────────────────────────────────────────────────────
  socket.on('b_login', async ({ username, password }, cb) => {
    if (typeof cb !== 'function') return
    if (!username || !password) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    if (pool) {
      try {
        const { rows } = await pool.query('SELECT * FROM b_accounts WHERE username=$1', [username])
        if (rows.length === 0) {
          cb({ ok: false, error: '账号不存在' })
          return
        }
        const acc = rows[0]
        if (!verifyPassword(password, acc.password_hash)) {
          cb({ ok: false, error: '密码错误' })
          return
        }
        if (acc.status !== 'active') {
          cb({ ok: false, error: '账号已停用' })
          return
        }
        if (!acc.authorized) {
          cb({ ok: false, error: '账号未授权' })
          return
        }
        cb({ ok: true, username })
      } catch (e) {
        console.error('[db] b_login error', e.message)
        cb({ ok: false, error: '服务器错误' })
      }
    } else {
      // Fallback: env password
      if (password !== ADMIN_PASSWORD) {
        cb({ ok: false, error: '密码错误' })
        return
      }
      cb({ ok: true, username })
    }
  })

  // ── C join room ───────────────────────────────────────────────────────────
  function handleCJoin({ username, roomId }, cb) {
    if (typeof cb !== 'function') return
    const rid = String(roomId || '').trim()
    if (!/^\d{3}$/.test(rid)) { cb({ ok: false, error: '房号须为 3 位数字' }); return }
    const room = getRoom(rid)
    if (!room) { cb({ ok: false, error: '房间不存在' }); return }
    const cu = String(username || '').trim()
    if (!cu) { cb({ ok: false, error: '用户名不能为空' }); return }
    for (const info of room.sockets.values()) {
      if (info.username === cu) { cb({ ok: false, error: '用户名已存在' }); return }
    }
    ensureBStats(room.adminUsername)
    bStats.get(room.adminUsername).cUsers.add(cu)
    socket.join(roomKey(room.id))
    room.sockets.set(socket.id, { role: 'C', username: cu })
    socket.data.roomId = room.id
    socket.data.role = 'C'
    addMessage(room, `【系统】玩家 ${cu} 进入房间。`)
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
    syncEmptyPlayerDestroyTimer(room)
    cb({ ok: true, room: { id: room.id, adminUsername: room.adminUsername, totalRounds: room.totalRounds, maxBet: room.maxBet, betSeconds: room.betSeconds, currentRound: room.currentRound, messages: room.messages, phase: room.phase, gameEnded: room.gameEnded, roomName: room.roomName || '' } })
  }

  socket.on('c_login', handleCJoin)
  socket.on('c_join_room', handleCJoin)

  // ── Create room ───────────────────────────────────────────────────────────
  socket.on('b_create_room', async ({ username, totalRounds, maxBet, betSeconds, baolu, roomName }, cb) => {
    if (typeof cb !== 'function') return
    const tr = Number(totalRounds || 10)
    const mb = Number(maxBet || 200)
    const bs = betSeconds != null ? Number(betSeconds) : 30
    const bl = /^\d{3}$/.test(String(baolu || '')) ? String(baolu) : ''
    const rn = String(roomName || '').slice(0, 12)
    if (!username || !tr || !mb) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    const room = makeRoom(username)
    room.totalRounds = tr
    room.maxBet = mb
    room.betSeconds = bs
    room.baolu = bl
    room.roomName = rn
    room.currentRound = 0
    room.gameEnded = false
    addMessage(room, `【系统】管理员 ${username} 创建房间 ${room.id}，总局数 ${tr}，单注上限 ${mb}。`)
    socket.join(roomKey(room.id))
    room.sockets.set(socket.id, { role: 'B', username })
    socket.data.roomId = room.id
    socket.data.role = 'B'
    syncEmptyPlayerDestroyTimer(room)

    // Write to DB (fire-and-forget, store dbRoomId)
    if (pool) {
      try {
        const { rows } = await pool.query(
          'INSERT INTO rooms (room_code, b_username, total_rounds, max_bet) VALUES ($1,$2,$3,$4) RETURNING id',
          [room.id, username, tr, mb]
        )
        room.dbRoomId = rows[0].id
      } catch (e) {
        console.error('[db] b_create_room insert error', e.message)
      }
    }

    cb({
      ok: true,
      room: {
        id: room.id,
        adminUsername: room.adminUsername,
        totalRounds: room.totalRounds,
        maxBet: room.maxBet,
        betSeconds: room.betSeconds,
        currentRound: room.currentRound,
        messages: room.messages,
        roomName: room.roomName || '',
      },
    })
  })

  // ── List my rooms ─────────────────────────────────────────────────────────
  socket.on('b_list_my_rooms', ({ username }, cb) => {
    if (typeof cb !== 'function') return
    if (!username) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    const out = []
    for (const [, room] of rooms) {
      if (room.adminUsername === username) {
        out.push({
          id: room.id,
          roomName: room.roomName || '',
          totalRounds: room.totalRounds,
          maxBet: room.maxBet,
          betSeconds: room.betSeconds,
          currentRound: room.currentRound,
          phase: room.phase,
          gameEnded: room.gameEnded,
          playerCount: playerCount(room),
        })
      }
    }
    cb({ ok: true, rooms: out })
  })

  // ── Join existing room ────────────────────────────────────────────────────
  socket.on('b_join_existing', ({ username, roomId }, cb) => {
    if (typeof cb !== 'function') return
    const rid = String(roomId || '').trim()
    if (!/^\d{3}$/.test(rid)) {
      cb({ ok: false, error: '房号须为 3 位数字' })
      return
    }
    const room = getRoom(rid)
    if (!room) {
      cb({ ok: false, error: '房间不存在' })
      return
    }
    if (room.adminUsername !== username) {
      cb({ ok: false, error: '只能进入自己创建的房间' })
      return
    }
    socket.join(roomKey(room.id))
    room.sockets.set(socket.id, { role: 'B', username })
    socket.data.roomId = room.id
    socket.data.role = 'B'
    socket.emit('roomStats', roomStatsPayload(room))
    syncEmptyPlayerDestroyTimer(room)
    cb({
      ok: true,
      room: {
        id: room.id,
        adminUsername: room.adminUsername,
        totalRounds: room.totalRounds,
        maxBet: room.maxBet,
        betSeconds: room.betSeconds,
        currentRound: room.currentRound,
        messages: room.messages,
        phase: room.phase,
        gameEnded: room.gameEnded,
        roomName: room.roomName || '',
      },
    })
  })

  // ── Start round ───────────────────────────────────────────────────────────
  socket.on('b_start_round', () => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') return
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) return
    if (room.countdownIv) return
    beginBettingRound(room)
  })

  // ── Submit bet ────────────────────────────────────────────────────────────
  socket.on('c_submit_bet', ({ username, numbers, amount, showSmile }, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {}
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || (socket.data.role !== 'C' && socket.data.role !== 'B')) {
      reply({ ok: false, error: '无权限' })
      return
    }
    if (room.phase !== 'betting') {
      reply({ ok: false, error: '当前不能下注' })
      return
    }
    const raw = Array.isArray(numbers) ? numbers : []
    const digits = []
    const distinctSet = new Set()
    for (const x of raw) {
      const d = normalizeBetDigit(x)
      if (d != null) {
        digits.push(d)
        distinctSet.add(d)
      }
    }
    const smile = Boolean(showSmile) || raw.some((x) => x === 'smile' || x === '🙂')
    if (digits.length < 1 || digits.length > 3 || distinctSet.size < 1 || distinctSet.size > 2) {
      reply({ ok: false, error: '选号无效' })
      return
    }
    const used = digitKindsUsedBySocket(room, socket.id)
    for (const d of distinctSet) used.add(d)
    if (used.size > 2) {
      reply({ ok: false, error: '本局累计只能用两个不同数字' })
      return
    }
    const amt = Number(amount)
    if (!amt || amt < 10 || amt > room.maxBet || amt % 5 !== 0) {
      reply({ ok: false, error: '金额无效' })
      return
    }
    const list = [...getSocketBetList(room, socket.id)]
    list.push({ username, numbers: digits, amount: amt, showSmile: smile })
    room.playerBets.set(socket.id, list)
    const displayStr = distinctSet.size === 1 ? String([...distinctSet][0]) : digits.join('')
    const msg = `【答题】${username} | 选号 ${displayStr}${smile ? '🙂' : ''} | ${amt}`
    addMessage(room, msg)
    broadcastRoom(room, 'messages', { list: room.messages })
    reply({ ok: true })
  })

  // ── Settle ────────────────────────────────────────────────────────────────
  socket.on('b_settle', ({ drawNumber }, cb) => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') {
      cb?.({ ok: false, error: '无权限' })
      return
    }
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) {
      cb?.({ ok: false, error: '无权限' })
      return
    }
    if (room.phase !== 'closed') {
      cb?.({ ok: false, error: '当前未到开奖阶段' })
      return
    }
    const n = normalizeLuckyNumber(drawNumber)
    if (n == null) {
      cb?.({ ok: false, error: '幸运号必须是 1-4 的数字' })
      return
    }
    clearRoomTimers(room)
    settleRound(room, n)
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
    cb?.({ ok: true })
  })

  // ── End round ─────────────────────────────────────────────────────────────
  socket.on('b_end_round', (cb) => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') {
      cb?.({ ok: false, error: '无权限' })
      return
    }
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) {
      cb?.({ ok: false, error: '无权限' })
      return
    }
    if (room.phase !== 'betting') {
      cb?.({ ok: false, error: '当前不是下注阶段' })
      return
    }
    clearRoomTimers(room)
    room.phase = 'closed'
    room.timerLeft = 0
    addMessageImage(room, 'ov.jpg')
    addMessage(room, `【系统】第 ${room.currentRound} / ${room.totalRounds} 局下注截止，等待管理员公布幸运号。`)
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
    broadcastRoom(room, 'roundClosed')
    cb?.({ ok: true })
  })

  // ── Ring bell ─────────────────────────────────────────────────────────────
  socket.on('b_ring_bell', () => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') return
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) return
    addMessage(room, '【系统】还有人答题吗？')
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'bellRing', {})
  })

  // ── Dismiss room ──────────────────────────────────────────────────────────
  socket.on('b_dismiss_room', (cb) => {
    if (typeof cb !== 'function') return
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') {
      cb({ ok: false, error: '无权限' })
      return
    }
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) {
      cb({ ok: false, error: '无权限' })
      return
    }
    cb({ ok: true })
    dismissRoom(room)
  })

  // ── Super admin login ─────────────────────────────────────────────────────
  socket.on('super_admin_login', ({ username, password }, cb) => {
    if (typeof cb !== 'function') return
    if (username === SUPER_ADMIN_USER && password === SUPER_ADMIN_PASS) {
      cb({ ok: true })
    } else {
      cb({ ok: false, error: '用户名或密码错误' })
    }
  })

  // ── Super admin list B accounts ───────────────────────────────────────────
  socket.on('super_admin_list_b', async (_, cb) => {
    if (typeof cb !== 'function') return
    if (!pool) {
      cb({ ok: false, error: '数据库未连接' })
      return
    }
    try {
      const { rows: bRows } = await pool.query(`
        SELECT
          a.username,
          a.status,
          a.authorized,
          a.created_at AS "createdAt",
          COALESCE(SUM(r.settled_rounds), 0)::int AS "totalRoundsSettled",
          COALESCE(SUM(r.total_pnl), 0)::int      AS "selfPnL",
          COUNT(DISTINCT b.c_username)::int        AS "distinctCCount"
        FROM b_accounts a
        LEFT JOIN rooms r ON r.b_username = a.username
        LEFT JOIN bets  b ON b.room_id    = r.id
        GROUP BY a.username, a.status, a.authorized, a.created_at
        ORDER BY a.created_at DESC
      `)
      // per-C rows for each B
      const { rows: cRows } = await pool.query(`
        SELECT r.b_username, b.c_username, SUM(b.delta)::int AS total
        FROM bets b
        JOIN rooms r ON b.room_id = r.id
        GROUP BY r.b_username, b.c_username
      `)
      const cMap = {}
      for (const cr of cRows) {
        if (!cMap[cr.b_username]) cMap[cr.b_username] = []
        cMap[cr.b_username].push({ username: cr.c_username, total: cr.total })
      }
      const list = bRows.map((r) => ({ ...r, cRows: cMap[r.username] || [] }))
      cb({ ok: true, list })
    } catch (e) {
      console.error('[db] super_admin_list_b error', e.message)
      cb({ ok: false, error: `查询失败: ${e.message}` })
    }
  })

  // ── Super admin update B account ──────────────────────────────────────────
  socket.on('super_admin_update_b', async ({ username, status, authorized }, cb) => {
    if (typeof cb !== 'function') return
    if (!pool) {
      cb({ ok: false, error: '数据库未连接' })
      return
    }
    if (!username) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    try {
      const sets = []
      const vals = []
      if (status !== undefined) {
        vals.push(status)
        sets.push(`status=$${vals.length}`)
      }
      if (authorized !== undefined) {
        vals.push(authorized)
        sets.push(`authorized=$${vals.length}`)
      }
      if (sets.length === 0) {
        cb({ ok: false, error: '无更新字段' })
        return
      }
      vals.push(username)
      await pool.query(`UPDATE b_accounts SET ${sets.join(',')} WHERE username=$${vals.length}`, vals)
      cb({ ok: true })
    } catch (e) {
      console.error('[db] super_admin_update_b error', e.message)
      cb({ ok: false, error: '更新失败' })
    }
  })

  // ── Super admin create B account ──────────────────────────────────────────
  socket.on('super_admin_create_b', async ({ username, password }, cb) => {
    if (typeof cb !== 'function') return
    if (!pool) {
      cb({ ok: false, error: '数据库未连接' })
      return
    }
    const u = String(username || '').trim()
    const p = String(password || '').trim()
    if (!u || u.length > 20) {
      cb({ ok: false, error: '用户名须 1-20 个字符' })
      return
    }
    if (p.length < 4) {
      cb({ ok: false, error: '密码至少 4 个字符' })
      return
    }
    try {
      const hash = hashPassword(p)
      await pool.query(
        'INSERT INTO b_accounts (username, password_hash) VALUES ($1,$2)',
        [u, hash]
      )
      cb({ ok: true })
    } catch (e) {
      if (e.code === '23505') {
        cb({ ok: false, error: '用户名已存在' })
      } else {
        console.error('[db] super_admin_create_b error', e.message)
        cb({ ok: false, error: '创建失败' })
      }
    }
  })

  // ── Super admin delete B account ──────────────────────────────────────────
  socket.on('super_admin_delete_b', async ({ username }, cb) => {
    if (typeof cb !== 'function') return
    if (!pool) {
      cb({ ok: false, error: '数据库未连接' })
      return
    }
    if (!username) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    try {
      // bets cascade delete via rooms FK
      await pool.query('DELETE FROM rooms WHERE b_username=$1', [username])
      await pool.query('DELETE FROM b_accounts WHERE username=$1', [username])
      cb({ ok: true })
    } catch (e) {
      console.error('[db] super_admin_delete_b error', e.message)
      cb({ ok: false, error: '删除失败' })
    }
  })

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room) return
    const info = room.sockets.get(socket.id)
    room.sockets.delete(socket.id)
    room.playerBets.delete(socket.id)
    if (info?.role === 'C') {
      addMessage(room, `【系统】玩家 ${info.username} 离开房间。`)
      broadcastRoom(room, 'messages', { list: room.messages })
    }
    if (info?.role === 'B') {
      addMessage(room, '【系统】房主已离开房间，房间内玩法继续进行。')
      broadcastRoom(room, 'messages', { list: room.messages })
    }
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
    syncEmptyPlayerDestroyTimer(room)
  })
})

function dismissRoom(room) {
  clearRoomTimers(room)
  addMessage(room, `【系统】房间 ${room.id} 已解散。`)
  broadcastRoom(room, 'messages', { list: room.messages })
  broadcastRoom(room, 'roomDismissed', { roomId: room.id })
  rooms.delete(String(room.id))
  const socketIds = Array.from(room.sockets.keys())
  room.sockets = new Map()
  for (const sid of socketIds) {
    const s = io.sockets.sockets.get(sid)
    if (s) {
      s.data.roomId = null
      s.leave(String(room.id))
    }
  }
}

// ─── Start servers ────────────────────────────────────────────────────────────
function startServers() {
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on ${PORT}`)
  })
  if (httpServerAdmin && SUPER_ADMIN_PORT) {
    httpServerAdmin.listen(SUPER_ADMIN_PORT, '0.0.0.0', () => {
      console.log(`Super admin UI on ${SUPER_ADMIN_PORT} (Socket.IO → ${PORT})`)
    })
    httpServerAdmin.on('error', (err) => {
      console.error('[room-game] Super admin port listen failed:', err.message)
    })
  }
}

initDb()
  .catch((e) => console.error('[db] initDb failed:', e.message))
  .finally(() => startServers())
