import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin888'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*'

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(','), credentials: true }))
app.use(express.json())

const httpServer = createServer(app)
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
    currentRound: 0,
    gameEnded: false,
    phase: 'idle',
    timerLeft: 0,
    timerInterval: null,
    nextRoundTimeout: null,
    sockets: new Map(),
    playerBets: new Map(),
    messages: [],
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
}

function playerCount(room) {
  let n = 0
  for (const [, p] of room.sockets) {
    if (p.role === 'C') n++
  }
  return n
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

function startBettingTimer(room) {
  clearRoomTimers(room)
  room.phase = 'betting'
  room.timerLeft = 30
  broadcastRoom(room, 'timer', { left: room.timerLeft, total: 30 })
  room.timerInterval = setInterval(() => {
    room.timerLeft -= 1
    broadcastRoom(room, 'timer', { left: room.timerLeft, total: 30 })
    if (room.timerLeft <= 0) {
      clearInterval(room.timerInterval)
      room.timerInterval = null
      room.phase = 'closed'
      broadcastRoom(room, 'roundClosed', {})
      addMessage(room, '【系统】本局已封盘，等待管理员开奖。')
      broadcastRoom(room, 'messages', { list: room.messages })
    }
  }, 1000)
}

function settleRound(room, drawNumber) {
  const num = Number(drawNumber)
  const lines = []
  for (const [sid, bet] of room.playerBets) {
    const win = bet.numbers.includes(num)
    const label = win ? '赢' : '输'
    const amt = bet.amount
    lines.push(`${bet.username} | ${label} | ${amt}`)
    addMessage(room, `【结算】${bet.username} | ${label} | 金额 ${amt}`)
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

  room.nextRoundTimeout = setTimeout(() => {
    room.nextRoundTimeout = null
    resetRoundBets(room)
    room.phase = 'idle'
    addMessage(room, `【系统】第 ${room.currentRound + 1} / ${room.totalRounds} 局准备中，管理员可点击「开始」。`)
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'newRoundWait', { currentRound: room.currentRound, totalRounds: room.totalRounds })
  }, 5000)
}

const rooms = new Map()

app.get('/health', (_, res) => res.json({ ok: true }))

const distPath = path.join(__dirname, '..', 'client', 'dist')
if (fs.existsSync(distPath)) {
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
        }
      },
    })
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/socket.io')) return next()
    const clean = req.path.split('?')[0]
    const ext = path.extname(clean)
    if (ext) return next()
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.sendFile(path.join(distPath, 'index.html'), (err) => next(err))
  })
} else {
  console.warn('[room-game] missing client/dist at', distPath, '- run: cd client && npm run build')
}

io.on('connection', (socket) => {
  socket.on('b_login', ({ username, password }, cb) => {
    if (typeof cb !== 'function') return
    if (!username || password !== ADMIN_PASSWORD) {
      cb({ ok: false, error: '用户名或密码错误' })
      return
    }
    cb({ ok: true, username })
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

  socket.on('b_create_room', ({ username, totalRounds, maxBet }, cb) => {
    if (typeof cb !== 'function') return
    if (!username || !totalRounds || !maxBet) {
      cb({ ok: false, error: '参数不完整' })
      return
    }
    const tr = Number(totalRounds)
    const mb = Number(maxBet)
    if (tr < 1 || mb < 1) {
      cb({ ok: false, error: '参数无效' })
      return
    }
    const room = makeRoom(username)
    room.totalRounds = tr
    room.maxBet = mb
    room.currentRound = 0
    room.gameEnded = false
    socket.join(roomKey(room.id))
    room.sockets.set(socket.id, { role: 'B', username })
    socket.data.roomId = room.id
    socket.data.role = 'B'
    addMessage(room, `【系统】管理员 ${username} 创建房间 ${room.id}，总局数 ${tr}，单注上限 ${mb}。`)
    cb({
      ok: true,
      room: {
        id: room.id,
        adminUsername: room.adminUsername,
        totalRounds: room.totalRounds,
        maxBet: room.maxBet,
        currentRound: room.currentRound,
        messages: room.messages,
      },
    })
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
    cb({
      ok: true,
      room: {
        id: room.id,
        adminUsername: room.adminUsername,
        totalRounds: room.totalRounds,
        maxBet: room.maxBet,
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
    socket.join(roomKey(room.id))
    room.sockets.set(socket.id, { role: 'C', username })
    socket.data.roomId = room.id
    socket.data.role = 'C'
    addMessage(room, `【系统】玩家 ${username} 进入房间。`)
    broadcastRoom(room, 'messages', { list: room.messages })
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
    cb({
      ok: true,
      room: {
        id: room.id,
        adminUsername: room.adminUsername,
        totalRounds: room.totalRounds,
        maxBet: room.maxBet,
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
    if (room.gameEnded) return
    if (room.phase === 'betting') return
    if (room.currentRound >= room.totalRounds) return
    room.currentRound += 1
    clearRoomTimers(room)
    resetRoundBets(room)
    addMessage(room, '【系统】游戏开始，请玩家在 30 秒内完成下注。')
    broadcastRoom(room, 'messages', { list: room.messages })
    startBettingTimer(room)
    broadcastRoom(room, 'gameStart', {})
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
  })

  socket.on('c_submit_bet', ({ username, numbers, amount }) => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || (socket.data.role !== 'C' && socket.data.role !== 'B')) return
    if (room.phase !== 'betting') return
    const nums = Array.isArray(numbers) ? numbers.map(Number).filter((n) => n >= 1 && n <= 4) : []
    const uniq = [...new Set(nums)]
    if (uniq.length === 0 || uniq.length > 2) return
    const amt = Number(amount)
    if (!amt || amt > room.maxBet) return
    room.playerBets.set(socket.id, { username, numbers: uniq, amount: amt })
    const msg = `【下注】${username} | 选号 ${uniq.join(',')} | 金额 ${amt}`
    addMessage(room, msg)
    broadcastRoom(room, 'messages', { list: room.messages })
  })

  socket.on('b_settle', ({ drawNumber }) => {
    const roomId = socket.data.roomId
    const room = roomId ? getRoom(roomId) : null
    if (!room || socket.data.role !== 'B') return
    const info = room.sockets.get(socket.id)
    if (!info || info.username !== room.adminUsername) return
    if (room.phase !== 'closed') return
    const n = Number(drawNumber)
    if (n < 1 || n > 4) return
    clearRoomTimers(room)
    settleRound(room, n)
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
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
    broadcastRoom(room, 'roomStats', roomStatsPayload(room))
  })
})

httpServer.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`)
})
