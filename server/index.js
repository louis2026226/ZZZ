import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

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
const SUPER_ADMIN_USER = 'admin'
const SUPER_ADMIN_PASS = '123456'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*'

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

function socketCount(room) {
  return room?.sockets?.size || 0
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
  }
}

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
    // 无计时器时保持 betting 阶段，等待管理员手动点下课
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

// 返回赢倍数（null表示未中，负数不存在）
// 单号（含11/22）: ×3；双号同权(12): ×1；双号偏权(112): 重号×1.5 轻号×0.5
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
      const distinctNums = [...new Set(bet.numbers)]
      const numDisplay = distinctNums.length === 1 ? String(distinctNums[0]) : bet.numbers.join('')
      addMessage(room, `【结算】${bet.username} ${label}${absAmt}（${numDisplay}+${bet.amount}）`)
      playerNetDelta.set(bet.username, (playerNetDelta.get(bet.username) || 0) + delta)
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

  if (room.currentRound >= room.totalRounds) {
    room.gameEnded = true
    room.phase = 'ended'
    addMessage(room, '【系统】已达总局数，游戏结束。')
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'gameOver', { summary: true })
    return
  }

  // 无计时器：回 idle，等房主手动点上课
  if (!room.betSeconds) {
    room.phase = 'idle'
    broadcastRoom(room, 'newRoundWait', { currentRound: room.currentRound, totalRounds: room.totalRounds })
    return
  }

  // 有计时器：选完幸运号后自动开始下一局
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

const rooms = new Map()
const bStats = new Map()

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

io.on('connection', (socket) => {
  socket.on('b_login', ({ username, password }, cb) => {
    if (typeof cb !== 'function') return
    if (!username || !password) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    if (password !== ADMIN_PASSWORD) {
      cb({ ok: false, error: '密码错误' })
      return
    }
    cb({ ok: true, username })
  })

  socket.on('c_login', ({ username, roomId }, cb) => {
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
    const cu = String(username || '').trim()
    if (!cu) {
      cb({ ok: false, error: '用户名不能为空' })
      return
    }
    for (const info of room.sockets.values()) {
      if (info.username === cu) {
        cb({ ok: false, error: '用户名已存在' })
        return
      }
    }
    bStats.get(room.adminUsername).cUsers.add(cu)
    socket.join(roomKey(room.id))
    room.sockets.set(socket.id, { role: 'C', username: cu })
    socket.data.roomId = room.id
    socket.data.role = 'C'
    addMessage(room, `【系统】玩家 ${cu} 进入房间。`)
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
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
      },
    })
  })

  socket.on('b_create_room', ({ username, totalRounds, maxBet, betSeconds, baolu }, cb) => {
    if (typeof cb !== 'function') return
    const tr = Number(totalRounds || 10)
    const mb = Number(maxBet || 200)
    const bs = betSeconds != null ? Number(betSeconds) : 30
    const bl = /^\d{3}$/.test(String(baolu || '')) ? String(baolu) : ''
    if (!username || !tr || !mb) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    const room = makeRoom(username)
    room.totalRounds = tr
    room.maxBet = mb
    room.betSeconds = bs
    room.baolu = bl
    room.currentRound = 0
    room.gameEnded = false
    addMessage(room, `【系统】管理员 ${username} 创建房间 ${room.id}，总局数 ${tr}，单注上限 ${mb}。`)
    socket.join(roomKey(room.id))
    room.sockets.set(socket.id, { role: 'B', username })
    socket.data.roomId = room.id
    socket.data.role = 'B'
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
      },
    })
  })

  socket.on('b_list_my_rooms', ({ username }, cb) => {
    if (typeof cb !== 'function') return
    if (!username) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    const out = []
    for (const [id, room] of rooms) {
      if (room.adminUsername === username) {
        out.push({
          id: room.id,
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
      },
    })
  })

  socket.on('b_start_round', () => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') return
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) return
    if (room.countdownIv) return
    beginBettingRound(room)
  })

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
    // 1-3个号码，最多2个不同数字
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
    list.push({
      username,
      numbers: digits,
      amount: amt,
      showSmile: smile,
    })
    room.playerBets.set(socket.id, list)
    const displayStr = distinctSet.size === 1 ? String([...distinctSet][0]) : digits.join('')
    const msg = `【答题】${username} | 选号 ${displayStr}${smile ? '🙂' : ''} | ${amt}`
    addMessage(room, msg)
    broadcastRoom(room, 'messages', { list: room.messages })
    reply({ ok: true })
  })

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
    dismissRoom(room)
    cb({ ok: true })
  })

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
  rooms.delete(String(room.id))
  const sockets = room.sockets
  room.sockets = new Map()
  for (const socket of sockets.keys()) {
    socket.disconnect()
  }
}

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