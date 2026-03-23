import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket } from '../socket.js'
import LogoutButton from '../components/LogoutButton.jsx'
import RoomCornerInfo from '../components/RoomCornerInfo.jsx'
import MessageBoard from '../components/MessageBoard.jsx'
import TimerBar from '../components/TimerBar.jsx'
import NextRoundCountdown from '../components/NextRoundCountdown.jsx'

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
  return { 1: 0, 2: 0, 3: 0, 4: 0 }
}

function buildNumbersFromPick(pick) {
  const out = []
  for (const d of [1, 2, 3, 4]) {
    const c = pick[d] ?? 0
    for (let i = 0; i < c; i++) out.push(d)
  }
  return out
}

function validPickNums(nums) {
  const len = nums.length
  if (len < 1 || len > 3) return false
  const u = new Set(nums)
  if (u.size > 2) return false
  if (len === 3 && u.size === 1) return false
  return true
}

function buildRoundRecords(messages, myName) {
  const rounds = []
  const pendingBetNums = new Map()
  let round = 0
  for (const m of messages || []) {
    if (!m?.text || m.divider) continue
    const t = m.text
    if (t.startsWith('【下注】')) {
      const segs = t.replace('【下注】', '').split(' | ')
      if (segs.length >= 3) {
        const uname = segs[0]?.trim()
        const numTxt = segs[1]?.replace('选号', '').trim()
        if (uname && numTxt) pendingBetNums.set(uname, numTxt)
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
      const segs = piece.trim().split(' | ')
      if (segs.length < 3) continue
      const uname = segs[0]
      const label = segs[1]
      const amt = Number(segs[2])
      if (label !== '赢' && label !== '输') continue
      const delta = label === '赢' ? amt : -amt
      if (uname === myName) myDelta += delta
      entries.push({
        username: uname,
        numbers: pendingBetNums.get(uname) || '-',
        label,
        amt,
        delta,
      })
    }
    rounds.push({ round, entries, myDelta })
    pendingBetNums.clear()
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
  const [createOpen, setCreateOpen] = useState(false)
  const [totalRounds, setTotalRounds] = useState(10)
  const [maxBet, setMaxBet] = useState(200)
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
  const [numPick, setNumPick] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 })
  const [pickedAmount, setPickedAmount] = useState(null)
  const [customAmount, setCustomAmount] = useState('')
  const [amounts, setAmounts] = useState(() => pickRandomAmounts(200))
  const [betAlert, setBetAlert] = useState('')
  const [hostUsername, setHostUsername] = useState('')
  const hostUsernameRef = useRef('')
  const [statsOpen, setStatsOpen] = useState(false)
  const [nextRoundLeft, setNextRoundLeft] = useState(0)
  const [copiedTip, setCopiedTip] = useState('')

  const bUsername = sessionStorage.getItem('bUser') || ''
  const isHost = Boolean(bUsername && hostUsername && bUsername === hostUsername)
  const roundRecords = useMemo(() => buildRoundRecords(messages, bUsername), [messages, bUsername])
  const myTotal = useMemo(() => roundRecords.reduce((s, r) => s + r.myDelta, 0), [roundRecords])

  const refreshAmounts = useCallback(() => {
    const cap = maxBetState > 0 ? maxBetState : maxBet
    setAmounts(pickRandomAmounts(cap))
  }, [maxBetState, maxBet])

  useEffect(() => {
    hostUsernameRef.current = hostUsername
  }, [hostUsername])

  useEffect(() => {
    if (!inRoomId || !isHost || gameEnded || phase !== 'closed') return
    setSettleOpen(true)
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
        refreshAmounts()
      })
      s.on('roundClosed', () => {
        setPhase('closed')
        setTimerLeft(0)
        const bu = sessionStorage.getItem('bUser') || ''
        const host = hostUsernameRef.current
        if (bu && host && bu === host) setSettleOpen(true)
      })
      s.on('newRoundWait', (p) => {
        setPhase('idle')
        if (p?.currentRound != null) setCurrentRound(p.currentRound)
        if (p?.totalRounds != null) setTotalRoundsState(p.totalRounds)
        setNumPick(emptyNumPick())
        setPickedAmount(null)
      })
      s.on('gameOver', () => {
        setGameEnded(true)
        setPhase('ended')
        setSettleOpen(false)
      })
      s.on('nextRoundCountdown', ({ left }) => setNextRoundLeft(Number(left) || 0))
      s.on('roomDismissed', ({ roomId }) => {
        const sr = sessionStorage.getItem('bRoomId')
        if (!sr || String(roomId) !== String(sr)) return
        sessionStorage.removeItem('bRoomId')
        setInRoomId('')
        setSettleOpen(false)
        setErr('房间已关闭')
      })
    } else {
      setListErr('')
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
  }, [inRoomId, nav, refreshAmounts])

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
    const bUser = sessionStorage.getItem('bUser')
    const s = socketRef.current
    if (!s) return
    s.emit(
      'b_create_room',
      { username: bUser, totalRounds: Number(totalRounds), maxBet: Number(maxBet) },
      (res) => {
        if (!res?.ok) {
          setErr(res?.error || '创建失败')
          return
        }
        setCreateOpen(false)
        setErr('')
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
  }

  function onStart() {
    socketRef.current?.emit('b_start_round')
  }

  function onChooseDraw(n) {
    setErr('')
    socketRef.current?.emit('b_settle', { drawNumber: n })
    setSettleOpen(false)
  }

  function onDismiss() {
    setErr('')
    const s = socketRef.current
    if (!s) return
    s.emit('b_dismiss_room', (res) => {
      if (!res?.ok) {
        setErr(res?.error || '解散失败')
        return
      }
      backToLobby()
    })
  }

  const showTimer = phase === 'betting' && timerLeft > 0
  const betting = phase === 'betting' && timerLeft > 0
  const nums = useMemo(() => [1, 2, 3, 4], [])

  function toggleNum(n) {
    if (!betting) return
    setNumPick((prev) => {
      const cur = prev[n] ?? 0
      const next = (cur + 1) % 3
      const p = { ...prev, [n]: next }
      const nums = buildNumbersFromPick(p)
      if (next > cur && !validPickNums(nums)) return prev
      return p
    })
  }

  function onBetConfirm() {
    setBetAlert('')
    if (!betting) return
    const nums = buildNumbersFromPick(numPick)
    if (nums.length === 0) {
      setBetAlert('请至少选择 1 个数字')
      return
    }
    if (!validPickNums(nums)) {
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
    socketRef.current?.emit('c_submit_bet', {
      username: bUsername,
      numbers: nums,
      amount: pickedAmount,
    })
    setNumPick(emptyNumPick())
    setPickedAmount(null)
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
    setPickedAmount(v)
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
              <div className="grid grid-cols-2 gap-3">
                {myRooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => enterRoom(r.id)}
                    className={lobbyRoomCardClass()}
                  >
                    <span
                      className={`absolute right-3 top-3 h-2.5 w-2.5 shrink-0 rounded-full ${lobbyRoomDotClass(r)}`}
                      aria-hidden
                    />
                    <span className="text-lg font-bold text-amber-400">房号 {r.id}</span>
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
              <h2 className="text-lg font-semibold">创建房间</h2>
              <div>
                <label className="block text-sm text-zinc-400">总局数</label>
                <div className="mt-2 flex gap-2">
                  {[10, 20, 30].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setTotalRounds(n)}
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
                <label className="block text-sm text-zinc-400">单注下注上限金额</label>
                <div className="mt-2 flex items-stretch overflow-hidden rounded-lg border border-zinc-600 bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => setMaxBet((v) => Math.max(200, v - 200))}
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
                    onClick={() => setMaxBet((v) => v + 200)}
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
                    setCreateOpen(false)
                    setErr('')
                  }}
                  className="flex-1 rounded-lg border border-zinc-600 py-2"
                >
                  取消
                </button>
                <button
                  type="submit"
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
    'min-h-[180px] h-[min(42dvh,26rem)] max-h-[50dvh] sm:min-h-[200px]'
  const canStart =
    isHost && !gameEnded && phase !== 'betting' && phase !== 'closed' && phase !== 'countdown'
  const latestRound = roundRecords.length > 0 ? roundRecords[roundRecords.length - 1].round : 0
  const selectedNumText = buildNumbersFromPick(numPick).join('')

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
        socketRef={socketRef}
        onStatsClick={() => setStatsOpen(true)}
        onBackToLobby={backToLobby}
      />
      <RoomCornerInfo
        roomId={roomId}
        playerCount={playerCount}
        currentRound={currentRound}
        totalRounds={totalRoundsState}
      />

      <div className="mb-4 shrink-0">
        <MessageBoard messages={messages} className={boardClass} />
      </div>

      <div className="flex flex-1 flex-col gap-6">
        <div>
          <p className="mb-2 text-sm text-zinc-400">当前选号：{selectedNumText || '-'}</p>
          <div className="flex flex-wrap gap-3">
            {nums.map((n) => {
              const c = numPick[n] ?? 0
              const disabled = !betting
              return (
                <button
                  key={n}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleNum(n)}
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
                  {n}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm text-zinc-400">随机米</p>
          <div className="flex flex-wrap gap-2">
            {amounts.map((a, idx) => (
              <button
                key={`${idx}-${a}`}
                type="button"
                disabled={!betting}
                onClick={() => setPickedAmount(a)}
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
            </div>
          </div>
        </div>

        {betAlert ? <p className="text-sm text-red-400">{betAlert}</p> : null}

        <TimerBar visible={showTimer} left={timerLeft} total={timerTotal} inline />
        <div className="flex gap-2">
          <div className="flex shrink-0 gap-2">
            {isHost && !gameEnded && canStart ? (
              <button
                type="button"
                onClick={onStart}
                className="rounded-lg bg-amber-600 px-4 py-3 text-sm font-medium hover:bg-amber-500"
              >
                开始
              </button>
            ) : null}
            {isHost && gameEnded ? (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg bg-red-700 px-4 py-3 text-sm font-medium hover:bg-red-600"
              >
                解散
              </button>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!betting}
            onClick={onBetConfirm}
            className="min-w-0 flex-1 rounded-lg bg-emerald-600 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-emerald-500"
          >
            {selectedNumText ? `确定（${selectedNumText}）` : '确定'}
          </button>
          <button
            type="button"
            disabled={!betting}
            onClick={() => {
              setPickedAmount(null)
              refreshAmounts()
            }}
            className="shrink-0 rounded-lg border border-zinc-500 px-3 py-3 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            刷新
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          单注上限 {maxBetState || '-'}
          {gameEnded ? ' · 游戏已结束' : ''}
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
              我的输赢 {myTotal >= 0 ? '+' : ''}
              {myTotal}
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-zinc-600 py-2 text-sm"
              onClick={() => setStatsOpen(false)}
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
