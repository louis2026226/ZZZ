import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import path from 'path'
import fs from 'fs'

let __dirname
try {
  const { fileURLToPath } = await import('url')
  __dirname = path.dirname(fileURLToPath(import.meta.url))
} catch {
  __dirname = path.dirname('')
}
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

/** 房间仅在房主主动解散时销毁，断开连接不影响房间状态 */
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

function startBettingTimer(room) {
  clearRoomTimers(room)
  room.phase = 'betting'
  const total = room.betSeconds || 30
  room.timerLeft = total
  broadcastRoom(room, 'timer', { left: room.timerLeft, total })
  const total = room.betSeconds || 0
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
    room.phase = 'closed'
    broadcastRoom(room, 'roundClosed', {})
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
  addMessage(room, `【系统】游戏开始，请玩家等待管理员公布幸运号。`)
  broadcastRoom(room, 'messages', { list: room.messages })
  startBettingTimer(room)
  broadcastRoom(room, 'gameStart', {})
  broadcastRoom(room, 'roomStats', roomStatsPayload(room))
  return true
}

function settleRound(room, drawNumber) {
  const num = normalizeLuckyNumber(drawNumber)
  if (num == null) return
  addMessage(room, `【系统】房主公布幸运号：${num}`)
  const owner = room.adminUsername
  ensureBStats(owner)
  const st = bStats.get(owner)
  st.totalRoundsSettled += 1
  const lines = []
  for (const [, betOrBets] of room.playerBets) {
    const bets = Array.isArray(betOrBets) ? betOrBets : [betOrBets]
    for (const bet of bets) {
      const win = bet.numbers.includes(num)
      const label = win ? '+' : '-'
      const amt = bet.amount
      lines.push(`${bet.username} | ${label} | ${amt}`)
      addMessage(room, `【结算】${bet.username} | ${label} | ${amt}`)
      const delta = win ? amt : -amt
      const prevPnl = st.cPnL.get(bet.username) || 0
      st.cPnL.set(bet.username, prevPnl + delta)
      if (bet.username === owner) st.selfPnL += delta
    }
  }
  if (lines.length === 0) {
    addMessage(room, '【结算】本局无人下注。')
  } else {
    addMessage(room, `【本局统计】${lines.join('；')}`)
  }
  addMessageDivider(room)
  broadcastRoom(room, 'messages', { list: room.messages })
  broadcastRoom(room, 'roundResult', { drawNumber: num, lines })

  if (room.currentRound >= room.totalRounds) {
    room.gameEnded = true
    room.phase = 'ended'
    addMessage(room, '【系统】已达总局数，游戏结束。')
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'gameOver', { summary: true })
    return
  }

  clearRoomTimers(room)
  room.phase = 'countdown'
  broadcastRoom(room, 'roomStats', roomStatsPayload(room))
  let t = 3
  broadcastRoom(room, 'nextRoundCountdown', { left: 3 })
  room.countdownIv = setInterval(() => {
    t -= 1
    if (t <= 0) {
      clearInterval(room.countdownIv)
      room.countdownIv = null
      broadcastRoom(room, 'nextRoundCountdown', { left: 0 })
      beginBettingRound(room, { afterCountdown: true })
      return
    }
    broadcastRoom(room, 'nextRoundCountdown', { left: t })
  }, 1000)
}

const rooms = new Map()
const bAccounts = new Map()
const bStats = new Map()
const MAX_ROOMS_PER_ADMIN = 10

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

function serializeBStats(username) {
  const st = bStats.get(username)
  if (!st) return { totalRoundsSettled: 0, selfPnL: 0, distinctCCount: 0, cRows: [] }
  const cRows = []
  for (const cname of st.cUsers) {
    cRows.push({ username: cname, pnl: st.cPnL.get(cname) || 0 })
  }
  return {
    totalRoundsSettled: st.totalRoundsSettled,
    selfPnL: st.selfPnL,
    distinctCCount: st.cUsers.size,
    cRows,
  }
}

function countAdminRooms(adminUsername) {
  let n = 0
  for (const r of rooms.values()) {
    if (r.adminUsername === adminUsername) n += 1
  }
  return n
}

function listRoomsPayloadForAdmin(adminUsername) {
  const out = []
  for (const r of rooms.values()) {
    if (r.adminUsername !== adminUsername) continue
    out.push({
      id: r.id,
      totalRounds: r.totalRounds,
      maxBet: r.maxBet,
      currentRound: r.currentRound,
      phase: r.phase,
      gameEnded: r.gameEnded,
      playerCount: playerCount(r),
    })
  }
  return out
}

function dismissRoom(room) {
  if (!room) return
  clearEmptyPlayerTimeout(room)
  clearRoomTimers(room)
  const rid = room.id
  const key = roomKey(rid)
  broadcastRoom(room, 'roomDismissed', { roomId: rid })
  const socketIds = [...room.sockets.keys()]
  rooms.delete(String(rid))
  for (const sid of socketIds) {
    const sock = io.sockets.sockets.get(sid)
    if (sock) {
      sock.leave(key)
      delete sock.data.roomId
      delete sock.data.role
    }
  }
}

function normalizeLuckyNumber(v) {
  const n = Number(v)
  if (Number.isInteger(n) && n >= 1 && n <= 4) return n
  return null
}

function normalizeBetDigit(v) {
  const n = Number(v)
  if (Number.isInteger(n) && n >= 1 && n <= 4) return n
  return null
}

app.get('/health', (_, res) => res.json({ ok: true }))

app.get('/api/server-ports', (_, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ mainPort: PORT, adminPort: SUPER_ADMIN_PORT })
})

const distPath = path.join(__dirname, '..', 'client', 'dist')
if (fs.existsSync(distPath)) {
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
          res.setHeader('Pragma', 'no-cache')
          return
        }
        const ext = path.extname(filePath)
        if (ext === '.js' || ext === '.css' || ext === '.woff2' || ext === '.woff' || ext === '.ttf') {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    })
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    const clean = req.path.split('?')[0]
    if (clean.startsWith('/assets/') && path.extname(clean)) {
      res.status(404).type('text/plain').send('asset not found')
      return
    }
    next()
  })
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/socket.io')) return next()
    const clean = req.path.split('?')[0]
    const ext = path.extname(clean)
    if (ext) return next()
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.sendFile(path.join(distPath, 'index.html'), (err) => next(err))
  })
} else {
  console.warn('[room-game] missing client/dist at', distPath, '- run: cd client && npm run build')
}

io.on('connection', (socket) => {
  socket.on('b_login', ({ username, password }, cb) => {
    if (typeof cb !== 'function') return
    const u = typeof username === 'string' ? username.trim() : ''
    if (!u || password !== ADMIN_PASSWORD) {
      cb({ ok: false, error: '用户名或密码错误' })
      return
    }
    let acc = bAccounts.get(u)
    if (!acc) {
      acc = { createdAt: Date.now(), authorized: true, state: 'active' }
      bAccounts.set(u, acc)
      ensureBStats(u)
    } else {
      if (!acc.authorized) {
        cb({ ok: false, error: '账号未授权' })
        return
      }
      if (acc.state === 'banned') {
        cb({ ok: false, error: '账号已封禁' })
        return
      }
      if (acc.state === 'disabled') {
        cb({ ok: false, error: '账号已停用' })
        return
      }
    }
    cb({ ok: true, username: u })
  })

  socket.on('super_admin_login', ({ username, password }, cb) => {
    if (typeof cb !== 'function') return
    const u = typeof username === 'string' ? username.trim() : ''
    if (u === SUPER_ADMIN_USER && password === SUPER_ADMIN_PASS) {
      cb({ ok: true })
      return
    }
    cb({ ok: false, error: '账号或密码错误' })
  })

  socket.on('super_admin_list_b', ({ suUser, suPass }, cb) => {
    if (typeof cb !== 'function') return
    if (suUser !== SUPER_ADMIN_USER || suPass !== SUPER_ADMIN_PASS) {
      cb({ ok: false, error: '未授权' })
      return
    }
    const list = []
    for (const [name, acc] of bAccounts) {
      list.push({
        username: name,
        createdAt: acc.createdAt,
        authorized: acc.authorized,
        state: acc.state,
        ...serializeBStats(name),
      })
    }
    list.sort((a, b) => a.username.localeCompare(b.username))
    cb({ ok: true, list })
  })

  socket.on('super_admin_update_b', ({ suUser, suPass, targetUsername, authorized, state }, cb) => {
    if (typeof cb !== 'function') return
    if (suUser !== SUPER_ADMIN_USER || suPass !== SUPER_ADMIN_PASS) {
      cb({ ok: false, error: '未授权' })
      return
    }
    const t = typeof targetUsername === 'string' ? targetUsername.trim() : ''
    if (!t) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    if (!bAccounts.has(t)) {
      bAccounts.set(t, { createdAt: Date.now(), authorized: true, state: 'active' })
      ensureBStats(t)
    }
    const acc = bAccounts.get(t)
    if (typeof authorized === 'boolean') acc.authorized = authorized
    if (state === 'active' || state === 'disabled' || state === 'banned') acc.state = state
    cb({ ok: true })
  })

  socket.on('c_login', ({ username, roomId }, cb) => {
    if (typeof cb !== 'function') return
    const room = getRoom(roomId)
    if (!room) {
      cb({ ok: false, error: '房间不存在' })
      return
    }
    cb({ ok: true, username, roomId: room.id })
  })

  socket.on('b_create_room', ({ username, totalRounds, maxBet, betSeconds }, cb) => {
    if (typeof cb !== 'function') return
    if (!username || !totalRounds || !maxBet) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    const tr = Number(totalRounds)
    const mb = Number(maxBet)
    const bs = Number(betSeconds || 30)
    if (tr < 1 || mb < 1 || ![30, 60].includes(bs)) {
      cb({ ok: false, error: '参数无效' })
      return
    }
    if (countAdminRooms(username) >= MAX_ROOMS_PER_ADMIN) {
      cb({ ok: false, error: '最多只能创建 10 个房间' })
      return
    }
    const room = makeRoom(username)
    room.totalRounds = tr
    room.maxBet = mb
    room.betSeconds = bs
    room.currentRound = 0
    room.gameEnded = false
    addMessage(room, `【系统】管理员 ${username} 创建房间 ${room.id}，总局数 ${tr}，单注上限 ${mb}。`)
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
    cb({ ok: true, rooms: listRoomsPayloadForAdmin(username) })
  })

  socket.on('b_join_existing', ({ username, roomId }, cb) => {
    if (typeof cb !== 'function') return
    const room = getRoom(roomId)
    if (!room || room.adminUsername !== username) {
      cb({ ok: false, error: '房间不存在或无权限' })
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

  socket.on('c_join_room', ({ username, roomId }, cb) => {
    if (typeof cb !== 'function') return
    const room = getRoom(roomId)
    if (!room) {
      cb({ ok: false, error: '房间不存在' })
      return
    }
    const cu = typeof username === 'string' ? username.trim() : ''
    if (!cu) {
      cb({ ok: false, error: '参数不完整' })
      return
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
    for (const x of raw) {
      const d = normalizeBetDigit(x)
      if (d != null) digits.push(d)
    }
    const smile =
      Boolean(showSmile) || raw.some((x) => x === 'smile' || x === '🙂')
    if (digits.length < 1 || digits.length > 3) {
      reply({ ok: false, error: '选号无效' })
      return
    }
    const used = digitKindsUsedBySocket(room, socket.id)
    for (const d of digits) used.add(d)
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
    const msg = `【下注】${username} | 选号 ${digits.join('')}${smile ? '🙂' : ''} | ${amt}`
    addMessage(room, msg)
    broadcastRoom(room, 'messages', { list: room.messages })
    reply({ ok: true })
  })

  socket.on('b_settle', ({ drawNumber }) => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') return
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) return
    if (room.phase !== 'closed') return
    const n = normalizeLuckyNumber(drawNumber)
    if (n == null) return
    clearRoomTimers(room)
    settleRound(room, n)
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
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
    addMessageImage(room, drawNumber + '.jpg')
    addMessage(room, `【系统】房主公布幸运号：${drawNumber}`)
    addMessageImage(room, 'ov.jpg')
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
    broadcastRoom(room, 'roundClosed')
    cb?.({ ok: true })
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
    if (!room.gameEnded) {
      cb({ ok: false, error: '须打完总局数后才可解散' })
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
