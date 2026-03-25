import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket } from '../socket.js'
import LogoutButton from '../components/LogoutButton.jsx'
import RoomCornerInfo from '../components/RoomCornerInfo.jsx'
import MessageBoard from '../components/MessageBoard.jsx'
import TimerBar from '../components/TimerBar.jsx'
import NextRoundCountdown from '../components/NextRoundCountdown.jsx'
import { playSound as sound } from '../utils/sound.js'

function pickRandomAmounts(maxBet) {
  const n = Number(maxBet)
  if (!Number.isFinite(n) || n < 10) return []
  const cap = Math.floor(n / 5) * 5
  if (cap < 10) return []
  if (cap === 10) return [10]
  const pool = []
  for (let i = 15; i <= cap - 5; i += 5) pool.push(i)
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  const rand = shuffled.slice(0, Math.min(10, pool.length)).sort((a, b) => a - b)
  return [10, ...rand, cap]
}

function randomMiLabel(amount, index, list) {
  if (list.length === 1) return String(amount)
  const hi = list[list.length - 1]
  if (index === 0 && amount === 10) return `最小${amount}`
  if (index === list.length - 1 && amount === hi && hi > 10) return `最大${amount}`
  return String(amount)
}

const STATS_PREFIX = '【本局统计】'

function emptyNumPick() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, smile: 0 }
}

function buildDigitsFromPick(pick) {
  const out = []
  for (const d of [1, 2, 3, 4]) {
    const c = pick[d] ?? 0
    for (let i = 0; i < c; i++) out.push(d)
  }
  return out
}

function digitSum14(pick) {
  return [1, 2, 3, 4].reduce((s, d) => s + (pick[d] ?? 0), 0)
}

function unionKindsSize(usedDigitKinds, pick) {
  const u = new Set(usedDigitKinds)
  for (const d of [1, 2, 3, 4]) {
    if ((pick[d] ?? 0) > 0) u.add(d)
  }
  return u.size
}

function validDigitPick(digits) {
  const len = digits.length
  return len >= 1 && len <= 3
}

function buildRoundRecords(messages, myName) {
  const rounds = []
  const pendingQueues = new Map()
  let round = 0
  for (const m of messages || []) {
    if (!m?.text || m.divider) continue
    const t = m.text
    if (t.startsWith('【答题】')) {
      const segs = t.replace('【答题】', '').split(' | ')
      if (segs.length >= 3) {
        const uname = segs[0]?.trim()
        const numTxt = segs[1]?.replace('选号', '').trim()
        if (uname && numTxt) {
          if (!pendingQueues.has(uname)) pendingQueues.set(uname, [])
          pendingQueues.get(uname).push(numTxt)
        }
      }
      continue
    }
    if (!t.startsWith(STATS_PREFIX)) continue
    round += 1
    const rest = t.slice(STATS_PREFIX.length)
    if (!rest.trim()) continue
    const entries = []
    let myDelta = 0
    for (const piece of rest.split('；')) {
      const m = piece.trim().match(/^(.+?) ([+-])(\d+)$/)
      if (!m) continue
      const uname = m[1]
      const label = m[2]
      const amt = Number(m[3])
      const delta = label === '+' ? amt : -amt
      if (uname === myName) myDelta += delta
      const q = pendingQueues.get(uname)
      const numLabel = q && q.length > 0 ? q.shift() : '-'
      entries.push({
        username: uname,
        numbers: numLabel,
        label,
        amt,
        delta,
      })
    }
    rounds.push({ round, entries, myDelta })
    pendingQueues.clear()
  }
  return rounds
}

function phaseLabel(phase) {
  const m = {
    idle: '待开始',
    betting: '下注中',
    closed: '待开奖',
    countdown: '倒计时',
    ended: '已结束',
  }
  return m[phase] || phase || '-'
}

function lobbyRoomCardClass() {
  return 'relative flex w-full flex-col items-start rounded-xl border border-zinc-600 bg-zinc-900 p-4 text-left shadow transition-colors hover:border-amber-600/60 hover:bg-zinc-800'
}

/** 灰未开局 · 绿进行中 · 橙待公布 · 红待解散 */
function lobbyRoomDotClass(r) {
  if (r.gameEnded || r.phase === 'ended') {
    return 'bg-red-500 shadow-[0_0_6px_rgb(239,68,68)]'
  }
  if (r.phase === 'closed') {
    return 'bg-amber-500 shadow-[0_0_6px_rgb(245,158,11)]'
  }
  if ((r.currentRound ?? 0) === 0 && r.phase === 'idle') {
    return 'bg-zinc-500'
  }
  return 'bg-emerald-500 shadow-[0_0_6px_rgb(52,211,153)]'
}

export default function AdminRoom() {
  const nav = useNavigate()
  const socketRef = useRef(null)
  const [inRoomId, setInRoomId] = useState(() => sessionStorage.getItem('bRoomId') || '')
  const [myRooms, setMyRooms] = useState([])
  const [listErr, setListErr] = useState('')
  const [dismissTip, setDismissTip] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [totalRounds, setTotalRounds] = useState(10)
  const [maxBet, setMaxBet] = useState(200)
  const [betSeconds, setBetSeconds] = useState(30)
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [baoluInput, setBaoluInput] = useState('')
  const [roomNameInput, setRoomNameInput] = useState('')
  const [roomName, setRoomName] = useState('')
  const [roomId, setRoomId] = useState(() => sessionStorage.getItem('bRoomId') || '')
  const [messages, setMessages] = useState([])
  const [playerCount, setPlayerCount] = useState(0)
  const [currentRound, setCurrentRound] = useState(0)
  const [totalRoundsState, setTotalRoundsState] = useState(0)
  const [maxBetState, setMaxBetState] = useState(0)
  const [phase, setPhase] = useState('idle')
  const [gameEnded, setGameEnded] = useState(false)
  const [timerLeft, setTimerLeft] = useState(0)
  const [timerTotal, setTimerTotal] = useState(30)
  const [settleOpen, setSettleOpen] = useState(false)
  const [err, setErr] = useState('')
  const [numPick, setNumPick] = useState(() => emptyNumPick())
  const [pickedAmount, setPickedAmount] = useState(null)
  const [customAmount, setCustomAmount] = useState('')
  const [customButtonAmount, setCustomButtonAmount] = useState(null)
  const [amounts, setAmounts] = useState(() => pickRandomAmounts(200))
  const [betAlert, setBetAlert] = useState('')
  const [hostUsername, setHostUsername] = useState(() => sessionStorage.getItem('bUser') || '')
  const hostUsernameRef = useRef('')
  const [statsOpen, setStatsOpen] = useState(false)
  const [nextRoundLeft, setNextRoundLeft] = useState(0)
  const [copiedTip, setCopiedTip] = useState('')
  const [roundUsedDigits, setRoundUsedDigits] = useState([])

  const bUsername = sessionStorage.getItem('bUser') || ''
  const isHost = Boolean(bUsername && hostUsername && bUsername === hostUsername)
  const roundRecords = useMemo(() => buildRoundRecords(messages, bUsername), [messages, bUsername])
  const myTotal = useMemo(() => roundRecords.reduce((s, r) => s + r.myDelta, 0), [roundRecords])

  const refreshAmounts = useCallback(() => {
    const cap = maxBetState > 0 ? maxBetState : maxBet
    setAmounts(pickRandomAmounts(cap))
  }, [maxBetState, maxBet])

  const betCapRef = useRef(0)
  useEffect(() => {
    betCapRef.current = maxBetState > 0 ? maxBetState : maxBet
  }, [maxBetState, maxBet])

  useEffect(() => {
    hostUsernameRef.current = hostUsername
  }, [hostUsername])

  useEffect(() => {
    if (!inRoomId || !isHost || gameEnded || phase !== 'closed') return
    // settleOpen 由 roundClosed 事件触发（含延迟），此处不重复打开
  }, [inRoomId, isHost, gameEnded, phase, currentRound])

  useEffect(() => {
    if (!inRoomId) {
      setMessages([])
      setRoomId('')
      setPlayerCount(0)
      setCurrentRound(0)
      setTotalRoundsState(0)
      setMaxBetState(0)
      setPhase('idle')
      setGameEnded(false)
      setTimerLeft(0)
      setSettleOpen(false)
      setNumPick(emptyNumPick())
      setPickedAmount(null)
      setCustomButtonAmount(null)
      setHostUsername('')
      setNextRoundLeft(0)
      setBetAlert('')
    }
  }, [inRoomId])

  useEffect(() => {
    const bUser = sessionStorage.getItem('bUser')
    if (!bUser) {
      nav('/login/b')
      return
    }
    const s = createSocket()
    socketRef.current = s
    const rid = inRoomId

    function applyRoom(r) {
      if (!r) return
      setRoomId(r.id)
      sessionStorage.setItem('bRoomId', r.id)
      setMessages(r.messages || [])
      setTotalRoundsState(r.totalRounds)
      setMaxBetState(r.maxBet)
      setCurrentRound(r.currentRound ?? 0)
      if (r.adminUsername) setHostUsername(r.adminUsername)
      if (r.phase) setPhase(r.phase)
      setGameEnded(Boolean(r.gameEnded))
      if (r.roomName != null) setRoomName(r.roomName)
    }

    if (rid) {
      s.emit('b_join_existing', { username: bUser, roomId: rid }, (res) => {
        if (!res?.ok) {
          sessionStorage.removeItem('bRoomId')
          setInRoomId('')
          setErr(res?.error || '无法进入房间')
          return
        }
        applyRoom(res.room)
        setAmounts(pickRandomAmounts(res.room.maxBet))
      })
      s.on('messages', ({ list }) => setMessages(list || []))
      s.on('roomStats', (st) => {
        setPlayerCount(st.playerCount ?? 0)
        setCurrentRound(st.currentRound ?? 0)
        setTotalRoundsState(st.totalRounds ?? 0)
        if (st.adminUsername) setHostUsername(st.adminUsername)
        if (st.phase) setPhase(st.phase)
        if (st.gameEnded) setGameEnded(true)
        if (st.roomName != null) setRoomName(st.roomName)
      })
      s.on('timer', ({ left, total }) => {
        setTimerLeft(left)
        if (total != null) setTimerTotal(total)
      })
      s.on('gameStart', () => {
        setNextRoundLeft(0)
        setPhase('betting')
        setSettleOpen(false)
        setNumPick(emptyNumPick())
        setPickedAmount(null)
        setCustomButtonAmount(null)
        setAmounts(pickRandomAmounts(betCapRef.current))
        setRoundUsedDigits([])
      })
      s.on('roundClosed', () => {
        setPhase('closed')
        setTimerLeft(0)
        const bu = sessionStorage.getItem('bUser') || ''
        const host = hostUsernameRef.current
        if (bu && host && bu === host) {
          setTimeout(() => setSettleOpen(true), 500)
        }
      })
      s.on('newRoundWait', (p) => {
        setPhase('idle')
        if (p?.currentRound != null) setCurrentRound(p.currentRound)
        if (p?.totalRounds != null) setTotalRoundsState(p.totalRounds)
        setNumPick(emptyNumPick())
        setPickedAmount(null)
        setCustomButtonAmount(null)
      })
      s.on('gameOver', () => {
        setGameEnded(true)
        setPhase('ended')
        setSettleOpen(false)
      })
      s.on('nextRoundCountdown', ({ left }) => setNextRoundLeft(Number(left) || 0))
      s.on('bellRing', () => sound('pass'))
      s.on('roomDismissed', () => {
        sessionStorage.removeItem('bRoomId')
        setInRoomId('')
        setSettleOpen(false)
        setDismissTip('房间已解散')
      })
    } else {
      setListErr('')
      setDismissTip('')
      s.emit('b_list_my_rooms', { username: bUser }, (res) => {
        if (!res?.ok) {
          setListErr(res?.error || '加载房间列表失败')
          setMyRooms([])
          return
        }
        setMyRooms(res.rooms || [])
      })
    }

    return () => {
      s.removeAllListeners()
      s.disconnect()
      socketRef.current = null
    }
  }, [inRoomId, nav])

  function fetchMyRooms() {
    const bUser = sessionStorage.getItem('bUser')
    const s = socketRef.current
    if (!bUser || !s) return
    s.emit('b_list_my_rooms', { username: bUser }, (res) => {
      if (res?.ok) setMyRooms(res.rooms || [])
    })
  }

  function onCreate(e) {
    e.preventDefault()
    setErr('')
    if (!/^\d{3}$/.test(baoluInput.trim())) {
      setErr('请输入宝路')
      return
    }
    const bUser = sessionStorage.getItem('bUser')
    const s = socketRef.current
    if (!s) return
    s.emit(
      'b_create_room',
      {
        username: bUser,
        totalRounds: Number(totalRounds),
        maxBet: Number(maxBet),
        betSeconds: Number(timerEnabled ? betSeconds : 0),
        baolu: baoluInput.trim(),
        roomName: roomNameInput.trim().slice(0, 12),
      },
      (res) => {
        if (!res?.ok) {
          setErr(res?.error || '创建失败')
          return
        }
        setCreateOpen(false)
        setErr('')
        setBaoluInput('')
        fetchMyRooms()
      }
    )
  }

  function enterRoom(id) {
    sessionStorage.setItem('bRoomId', id)
    setInRoomId(id)
  }

  function backToLobby() {
    sessionStorage.removeItem('bRoomId')
    setInRoomId('')
    setRoomName('')
  }

  function onStart() {
    socketRef.current?.emit('b_start_round')
  }

  function onChooseDraw(n) {
    sound('button')
    setErr('')
    socketRef.current?.emit('b_settle', { drawNumber: n })
    setSettleOpen(false)
  }

  function onDismiss() {
    setErr('')
    const s = socketRef.current
    if (!s) return
    backToLobby()
    setDismissTip('房间已解散')
    s.emit('b_dismiss_room', (res) => {
      if (!res?.ok) {
        // 解散失败不做任何操作，已经返回大厅
      }
    })
  }

  function onEndGame() {
    setErr('')
    const s = socketRef.current
    if (!s) return
    s.emit('b_end_round', (res) => {
      if (!res?.ok) {
        setErr(res?.error || '结束失败')
        return
      }
      // 可能不需要额外处理，服务器会发送状态更新
    })
  }

  const showTimer = phase === 'betting' && timerLeft > 0
  const betting = phase === 'betting'
  const nums = useMemo(
    () => [
      { value: 1, label: '1' },
      { value: 2, label: '2' },
      { value: 3, label: '3' },
      { value: 4, label: '4' },
      { value: 'smile', label: '🙂' },
    ],
    []
  )

  function toggleNum(n) {
    if (!betting) return
    if (n === 'smile') {
      setNumPick((prev) => ({ ...prev, smile: prev.smile > 0 ? 0 : 1 }))
      return
    }
    setNumPick((prev) => {
      const cur = prev[n] ?? 0
      const next = cur >= 2 ? 0 : cur + 1
      const p = { ...prev, [n]: next }
      if (next > cur) {
        if (digitSum14(p) > 3) return prev
        if (unionKindsSize(roundUsedDigits, p) > 2) return prev
      }
      return p
    })
  }

  function onBetConfirm() {
    setBetAlert('')
    if (!betting) return
    const digits = buildDigitsFromPick(numPick)
    if (digits.length === 0) {
      setBetAlert('请至少选择 1 个数字')
      return
    }
    if (!validDigitPick(digits)) {
      setBetAlert('选号不符合规则')
      return
    }
    if (pickedAmount == null) {
      setBetAlert('请选择下注金额')
      return
    }
    if (pickedAmount > maxBetState) {
      setBetAlert(`金额超过单注上限（${maxBetState}）`)
      return
    }
    const smileOn = (numPick.smile ?? 0) > 0
    socketRef.current?.emit(
      'c_submit_bet',
      {
        username: bUsername,
        numbers: digits,
        amount: pickedAmount,
        showSmile: smileOn,
      },
      (res) => {
        if (!res?.ok) {
          setBetAlert(res?.error || '下注失败')
          return
        }
        setRoundUsedDigits((prev) => [...new Set([...prev, ...digits])])
        setNumPick(emptyNumPick())
        setPickedAmount(null)
        setCustomAmount('')
      }
    )
  }

  function onCustomAmountConfirm() {
    setBetAlert('')
    if (!betting) return
    const v = Number(customAmount)
    if (!Number.isFinite(v) || v < 10) {
      setBetAlert('自选金额需不小于 10')
      return
    }
    if (v > maxBetState) {
      setBetAlert(`金额超过单注上限（${maxBetState}）`)
      return
    }
    if (v % 5 !== 0) {
      setBetAlert('自选金额必须是 5 的倍数')
      return
    }
    setCustomButtonAmount(v)
    setPickedAmount(v)
    setCustomAmount('')
  }

  if (!inRoomId) {
    const canCreateMore = myRooms.length < 10
    const emptyLobby = myRooms.length === 0
    return (
      <div className="relative flex min-h-[100dvh] flex-col bg-zinc-950 text-white sm:mx-auto sm:max-w-lg">
        <LogoutButton socketRef={socketRef} />
        <div className="flex-1 overflow-y-auto px-3 pb-28 pt-14 sm:px-4">
          {emptyLobby ? (
            <div className="flex flex-col items-center px-2 pt-6">
              <h1 className="mb-1 text-center text-xl font-semibold">
                {bUsername || '房主'}的房间
              </h1>
              <p className="mb-2 text-center text-sm text-zinc-400">
                已创建 {myRooms.length} / 10 个
                {!canCreateMore ? '（已达上限）' : ''}
              </p>
              {listErr ? <p className="mb-4 max-w-sm text-center text-sm text-red-400">{listErr}</p> : null}
              {dismissTip ? <p className="mb-4 max-w-sm text-center text-sm text-emerald-400">{dismissTip}</p> : null}
              {!listErr ? (
                <p className="mt-2 text-center text-sm text-zinc-500">暂无房间，请先点击下方创建</p>
              ) : null}
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="mb-1 text-xl font-semibold">{bUsername || '房主'}的房间</h1>
                  <p className="text-sm text-zinc-400">
                    已创建 {myRooms.length} / 10 个
                    {!canCreateMore ? '（已达上限）' : ''}
                  </p>
                </div>
                <div
                  className="flex shrink-0 flex-col items-end gap-1 text-[10px] leading-tight text-zinc-400"
                  aria-label="房间状态说明"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-500" />
                    未开局
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    进行中
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    待公布
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                    待解散
                  </span>
                </div>
              </div>
              {listErr ? <p className="mb-2 text-sm text-red-400">{listErr}</p> : null}
              {dismissTip ? <p className="mb-2 text-sm text-emerald-400">{dismissTip}</p> : null}
              <div className="grid grid-cols-2 gap-3">
                {myRooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { sound('button'); enterRoom(r.id) }}
                    className={lobbyRoomCardClass()}
                  >
                    <span
                      className={`absolute right-3 top-3 h-2.5 w-2.5 shrink-0 rounded-full ${lobbyRoomDotClass(r)}`}
                      aria-hidden
                    />
                    <span className="text-lg font-bold text-amber-400">房号 {r.id}</span>
                    {r.roomName ? <span className="mt-0.5 text-xs text-sky-400">{r.roomName}</span> : null}
                    <span className="mt-2 text-xs text-zinc-400">
                      {r.currentRound}/{r.totalRounds} 局 · {r.playerCount} 人在线
                    </span>
                    <span className="mt-1 text-xs text-zinc-500">
                      {r.gameEnded ? '已结束' : phaseLabel(r.phase)} · 上限 {r.maxBet}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/95 px-4 pt-3 backdrop-blur-sm sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!canCreateMore}
            onClick={() => {
              sound('button')
              setErr('')
              setCreateOpen(true)
            }}
            className="w-full rounded-lg bg-amber-600 py-3.5 text-base font-medium hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            创建房间
          </button>
        </div>

        {createOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => {
              setCreateOpen(false)
              setErr('')
            }}
          >
            <form
              onSubmit={onCreate}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6"
            >
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                创建房间
                <input
                  type="text"
                  value={roomNameInput}
                  onChange={(e) => setRoomNameInput(e.target.value.slice(0, 12))}
                  placeholder="输入房间名"
                  className="flex-1 rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm font-normal text-white placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
                />
              </h2>
              <div>
                <label className="block text-sm text-zinc-400">总局数</label>
                <div className="mt-2 flex gap-2">
                  {[10, 20, 30].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { sound('button'); setTotalRounds(n) }}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                        totalRounds === n
                          ? 'border-amber-500 bg-amber-600 text-white'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
                <div>
                  <label className="block text-sm text-zinc-400">下注倒计时</label>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { sound('button'); setTimerEnabled(false) }}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                        !timerEnabled
                          ? 'border-amber-500 bg-amber-600 text-white'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      OFF
                    </button>
                    <button
                      type="button"
                      onClick={() => { sound('button'); setTimerEnabled(true) }}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                        timerEnabled
                          ? 'border-amber-500 bg-amber-600 text-white'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      ON
                    </button>
                  </div>
                </div>
                {timerEnabled && (
                  <div>
                    <label className="block text-sm text-zinc-400">倒计时（秒）</label>
                    <div className="mt-2 flex gap-2">
                      {[30, 60].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => { sound('button'); setBetSeconds(n) }}
                          className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                            betSeconds === n
                              ? 'border-amber-500 bg-amber-600 text-white'
                              : 'border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              <div>
                <label className="block text-sm text-zinc-400">请输入宝路</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  value={baoluInput}
                  onChange={(e) => setBaoluInput(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  placeholder="3位数字"
                  className="mt-2 w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 tracking-widest"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400">单注下注上限金额</label>
                <div className="mt-2 flex items-stretch overflow-hidden rounded-lg border border-zinc-600 bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => { sound('button'); setMaxBet((v) => Math.max(200, v - 200)) }}
                    disabled={maxBet <= 200}
                    className="min-w-[3rem] bg-zinc-500 text-xl font-medium text-zinc-100 hover:bg-zinc-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <div className="flex flex-1 flex-col items-center justify-center py-2">
                    <span className="text-xs text-zinc-400">当前</span>
                    <span className="text-lg font-semibold text-white">{maxBet}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { sound('button'); setMaxBet((v) => v + 200) }}
                    className="min-w-[3rem] bg-zinc-500 text-xl font-medium text-zinc-100 hover:bg-zinc-400"
                  >
                    +
                  </button>
                </div>
              </div>
              {err ? <p className="text-sm text-red-400">{err}</p> : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    sound('button')
                    setCreateOpen(false)
                    setErr('')
                  }}
                  className="flex-1 rounded-lg border border-zinc-600 py-2"
                >
                  取消
                </button>
                <button
                  type="submit"
                  onClick={() => sound('button')}
                  className="flex-1 rounded-lg bg-amber-600 py-2 font-medium hover:bg-amber-500"
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    )
  }

  const boardClass =
    'min-h-[180px] h-[50dvh] max-h-[50dvh] sm:min-h-[200px]'
  const canStart =
    isHost && !gameEnded && phase !== 'betting' && phase !== 'closed' && phase !== 'countdown'
  const latestRound = roundRecords.length > 0 ? roundRecords[roundRecords.length - 1].round : 0
  const digitPick = buildDigitsFromPick(numPick)
  const digitStr = digitPick.join('')
  const selectedNumText =
    digitStr === '' ? '-' : `${digitStr}${numPick.smile > 0 ? '🙂' : ''}`

  function onCopyRound(r) {
    const lines = [`第${r.round}局战绩`]
    for (const e of r.entries) {
      lines.push(`${e.username} ${e.numbers} ${e.label}${e.amt}`)
    }
    const txt = lines.join('\n')
    setCopiedTip(`第${r.round}局战绩已复制，可以粘贴到其他聊天文本上。`)
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(txt).catch(() => {})
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh] w-full max-w-lg flex-col bg-zinc-950 px-3 pb-6 pt-14 text-white sm:mx-auto sm:px-4">
      <NextRoundCountdown value={nextRoundLeft} />
      <LogoutButton
        onDismiss={isHost ? onDismiss : undefined}
        onStatsClick={() => setStatsOpen(true)}
        onBack={backToLobby}
      />
      <RoomCornerInfo
        roomId={roomId}
        playerCount={playerCount}
        currentRound={currentRound}
        totalRounds={totalRoundsState}
        roomName={roomName}
      />

      <div className="relative mb-4 shrink-0">
        <MessageBoard messages={messages} className={boardClass} />
        {isHost && phase === 'betting' ? (
          <button
            type="button"
            onClick={() => { sound('button'); socketRef.current?.emit('b_ring_bell') }}
            className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800/90 text-lg shadow hover:bg-zinc-700"
            title="还有人答题吗？"
          >
            🔔
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-6">
        {!isHost && <div>
          <p className="mb-2 text-sm text-zinc-400">
            当前选号：<span className="text-amber-400">{selectedNumText}</span>
          </p>
          <div className="flex flex-wrap gap-3">
            {nums.map((item) => {
              const c = numPick[item.value] ?? 0
              const d = item.value
              const maxDigitsReached = digitPick.length >= 3
              let kindBlocked = false
              if (d !== 'smile' && betting && c === 0 && !maxDigitsReached) {
                const u = new Set(roundUsedDigits)
                for (const k of [1, 2, 3, 4]) {
                  if (k !== d && (numPick[k] ?? 0) > 0) u.add(k)
                }
                u.add(d)
                kindBlocked = u.size > 2
              }
              const disabled =
                d === 'smile'
                  ? !betting
                  : !betting || (maxDigitsReached && c === 0) || kindBlocked
              return (
                <button
                  key={String(item.value)}
                  type="button"
                  disabled={disabled}
                  onClick={() => { sound('button'); toggleNum(item.value) }}
                  className={`h-14 w-14 rounded-lg text-lg font-bold ${
                    disabled
                      ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                      : c === 2
                        ? 'bg-amber-400 text-zinc-900'
                        : c === 1
                          ? 'bg-emerald-500 text-white'
                          : 'bg-zinc-700 text-white hover:bg-zinc-600'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>}

        {!isHost && <div>
          <p className="mb-2 text-sm text-zinc-400">
            选择积分：<span className="text-amber-400">{pickedAmount ?? '-'}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {amounts.map((a, idx) => (
              <button
                key={`${idx}-${a}`}
                type="button"
                disabled={!betting}
                onClick={() => { sound('button'); setPickedAmount(a) }}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  !betting
                    ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                    : pickedAmount === a
                      ? 'bg-emerald-500 text-white'
                      : 'bg-zinc-700 hover:bg-zinc-600'
                }`}
              >
                {randomMiLabel(a, idx, amounts)}
              </button>
            ))}
            {customButtonAmount != null ? (
              <button
                type="button"
                disabled={!betting}
                onClick={() => { sound('button'); setPickedAmount(customButtonAmount) }}
                className={`rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium ${
                  !betting
                    ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                    : pickedAmount === customButtonAmount
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-amber-500 text-zinc-900 hover:bg-amber-400'
                }`}
              >
                {customButtonAmount}
              </button>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={!betting}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="自选"
                className="w-20 rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-2 text-sm text-white outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <button
                type="button"
                disabled={!betting}
                onClick={onCustomAmountConfirm}
                className="rounded-lg border border-zinc-500 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                设定
              </button>
              <button
                type="button"
                disabled={!betting}
                onClick={() => {
                  setPickedAmount(null)
                  refreshAmounts()
                }}
                className="rounded-lg border border-zinc-500 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                刷新
              </button>
            </div>
          </div>
        </div>}

        {betAlert ? <p className="text-sm text-red-400">{betAlert}</p> : null}

        <TimerBar visible={showTimer} left={timerLeft} total={timerTotal} inline />
        <div className="flex gap-2">
          {isHost && !gameEnded ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={() => { sound('me'); onStart() }}
              className="flex-1 rounded-lg py-3 text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              开始答题
            </button>
          ) : null}
          {isHost && !gameEnded ? (
            <button
              type="button"
              onClick={phase === 'betting' ? () => { sound('button'); onEndGame() } : undefined}
              disabled={phase !== 'betting'}
              className="flex-1 rounded-lg py-3 text-sm font-medium bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-800"
            >
              结束答题
            </button>
          ) : null}
          {!isHost ? (
            <button
              type="button"
              disabled={!betting}
              onClick={() => { sound('button'); onBetConfirm() }}
              className="flex-1 rounded-lg bg-emerald-600 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-emerald-500"
            >
              确定
            </button>
          ) : null}
        </div>

        <p className="text-xs text-zinc-500">
          {gameEnded ? '游戏已结束' : ''}
        </p>
      </div>

      {settleOpen && isHost ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-600 bg-zinc-900 p-6">
            <h3 className="text-lg font-semibold">选择开奖数字</h3>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChooseDraw(n)}
                  className="rounded-lg bg-amber-600 py-4 text-xl font-bold hover:bg-amber-500"
                >
                  {n}
                </button>
              ))}
            </div>
            {err ? <p className="text-sm text-red-400">{err}</p> : null}
          </div>
        </div>
      ) : null}

      {statsOpen ? (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setStatsOpen(false)}
        >
          <div
            className="max-h-[75dvh] w-full max-w-sm overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold">战绩</h3>
            {roundRecords.length === 0 ? (
              <p className="text-sm text-zinc-400">暂无下注结算记录</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {roundRecords.map((r) => (
                  <li
                    key={r.round}
                    onClick={() => onCopyRound(r)}
                    className={`rounded-lg px-3 py-2 ${
                      r.round === latestRound
                        ? 'border border-emerald-500 bg-zinc-800/80'
                        : 'border border-zinc-700 bg-zinc-800/80'
                    }`}
                  >
                    <div className="mb-1 text-zinc-300">第 {r.round} 局</div>
                    <div className="space-y-1">
                      {r.entries.map((e, idx) => (
                        <div key={`${r.round}-${idx}`} className="flex items-center justify-between gap-2">
                          <span className="text-zinc-300">
                            {e.username} · {e.numbers}
                          </span>
                          <span className={e.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {e.label}
                            {e.amt}
                          </span>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {copiedTip ? <p className="mt-3 text-sm text-emerald-400">{copiedTip}</p> : null}
            <p className="mt-4 text-base font-semibold">
              累计 {myTotal >= 0 ? '+' : ''}
              {myTotal}
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-zinc-600 py-2 text-sm"
              onClick={() => { sound('button'); setStatsOpen(false) }}
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
