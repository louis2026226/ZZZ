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

function buildPersonalRecords(messages, uname) {
  if (!uname) return []
  const records = []
  let round = 0
  for (const m of messages || []) {
    if (!m?.text || m.divider) continue
    const t = m.text
    if (!t.startsWith(STATS_PREFIX)) continue
    round += 1
    const rest = t.slice(STATS_PREFIX.length)
    if (!rest.trim()) continue
    for (const piece of rest.split('；')) {
      const segs = piece.trim().split(' | ')
      if (segs.length < 3 || segs[0] !== uname) continue
      const label = segs[1]
      const amt = Number(segs[2])
      if (label !== '赢' && label !== '输') continue
      const delta = label === '赢' ? amt : -amt
      records.push({ round, label, amt, delta })
    }
  }
  return records
}

export default function PlayerRoom() {
  const nav = useNavigate()
  const socketRef = useRef(null)
  const [messages, setMessages] = useState([])
  const [roomId, setRoomId] = useState('')
  const [maxBet, setMaxBet] = useState(0)
  const [phase, setPhase] = useState('idle')
  const [gameEnded, setGameEnded] = useState(false)
  const [timerLeft, setTimerLeft] = useState(0)
  const [timerTotal, setTimerTotal] = useState(30)
  const [selectedNums, setSelectedNums] = useState([])
  const [pickedAmount, setPickedAmount] = useState(null)
  const [amounts, setAmounts] = useState(() => pickRandomAmounts(200))
  const [alertText, setAlertText] = useState('')
  const [joinErr, setJoinErr] = useState('')
  const [playerCount, setPlayerCount] = useState(0)
  const [currentRound, setCurrentRound] = useState(0)
  const [totalRoundsState, setTotalRoundsState] = useState(0)
  const [statsOpen, setStatsOpen] = useState(false)
  const [nextRoundLeft, setNextRoundLeft] = useState(0)

  const username = sessionStorage.getItem('cUser') || ''

  const personalRecords = useMemo(() => buildPersonalRecords(messages, username), [messages, username])
  const personalTotal = useMemo(
    () => personalRecords.reduce((s, r) => s + r.delta, 0),
    [personalRecords]
  )

  const refreshAmounts = useCallback(() => {
    setAmounts(pickRandomAmounts(maxBet))
  }, [maxBet])

  useEffect(() => {
    const cUser = sessionStorage.getItem('cUser')
    const rid = sessionStorage.getItem('cRoomId')
    if (!cUser || !rid) {
      nav('/login/c')
      return
    }
    const s = createSocket()
    socketRef.current = s

    s.emit('c_join_room', { username: cUser, roomId: rid }, (res) => {
      if (!res?.ok) {
        setJoinErr(res?.error || '进入房间失败')
        s.removeAllListeners()
        s.disconnect()
        socketRef.current = null
        setTimeout(() => nav('/login/c'), 2000)
        return
      }
      setRoomId(res.room.id)
      setMessages(res.room.messages || [])
      setMaxBet(res.room.maxBet || 0)
      setAmounts(pickRandomAmounts(res.room.maxBet || 0))
      if (res.room.currentRound != null) setCurrentRound(res.room.currentRound)
      if (res.room.totalRounds != null) setTotalRoundsState(res.room.totalRounds)
      if (res.room.phase) setPhase(res.room.phase)
      if (res.room.gameEnded) setGameEnded(true)
    })

    s.on('messages', ({ list }) => setMessages(list || []))
    s.on('roomStats', (st) => {
      if (st?.playerCount != null) setPlayerCount(st.playerCount)
      if (st?.currentRound != null) setCurrentRound(st.currentRound)
      if (st?.totalRounds != null) setTotalRoundsState(st.totalRounds)
    })
    s.on('gameStart', () => {
      setNextRoundLeft(0)
      setPhase('betting')
      setSelectedNums([])
      setPickedAmount(null)
      refreshAmounts()
    })
    s.on('timer', ({ left, total }) => {
      setTimerLeft(left)
      if (total != null) setTimerTotal(total)
    })
    s.on('roundClosed', () => {
      setPhase('closed')
      setTimerLeft(0)
    })
    s.on('newRoundWait', (p) => {
      setPhase('idle')
      setSelectedNums([])
      setPickedAmount(null)
      if (p?.currentRound != null) setCurrentRound(p.currentRound)
      if (p?.totalRounds != null) setTotalRoundsState(p.totalRounds)
    })
    s.on('gameOver', () => {
      setGameEnded(true)
      setPhase('ended')
    })
    s.on('nextRoundCountdown', ({ left }) => setNextRoundLeft(Number(left) || 0))

    return () => {
      s.removeAllListeners()
      s.disconnect()
      socketRef.current = null
    }
  }, [nav, refreshAmounts])

  const betting = phase === 'betting' && timerLeft > 0
  const showTimer = phase === 'betting' && timerLeft > 0

  function toggleNum(n) {
    if (!betting) return
    setSelectedNums((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n)
      if (prev.length >= 2) return prev
      return [...prev, n]
    })
  }

  function onConfirm() {
    setAlertText('')
    if (!betting) return
    if (selectedNums.length === 0) {
      setAlertText('请至少选择 1 个数字')
      return
    }
    if (pickedAmount == null) {
      setAlertText('请选择下注金额')
      return
    }
    if (pickedAmount > maxBet) {
      setAlertText(`金额超过管理员设定的下注上限（${maxBet}）`)
      return
    }
    socketRef.current?.emit('c_submit_bet', {
      username,
      numbers: selectedNums,
      amount: pickedAmount,
    })
    setSelectedNums([])
    setPickedAmount(null)
  }

  const nums = useMemo(() => [1, 2, 3, 4], [])
  const boardClass =
    'min-h-[180px] h-[min(42dvh,26rem)] max-h-[50dvh] sm:min-h-[200px]'

  return (
    <div className="flex min-h-screen min-h-[100dvh] w-full max-w-lg flex-col bg-zinc-950 px-3 pb-6 pt-14 text-white sm:mx-auto sm:px-4">
      <NextRoundCountdown value={nextRoundLeft} />
      <TimerBar visible={showTimer} left={timerLeft} total={timerTotal} />
      <LogoutButton socketRef={socketRef} onStatsClick={() => setStatsOpen(true)} />
      <RoomCornerInfo
        roomId={roomId}
        playerCount={playerCount}
        currentRound={currentRound}
        totalRounds={totalRoundsState}
      />

      {joinErr ? <p className="mb-2 text-center text-sm text-red-400">{joinErr}</p> : null}

      <div className="mb-4 shrink-0">
        <MessageBoard messages={messages} className={boardClass} />
      </div>

      <div className="flex flex-1 flex-col gap-6">
        <div>
          <p className="mb-2 text-sm text-zinc-400">选号（最多 2 个）</p>
          <div className="flex flex-wrap gap-3">
            {nums.map((n) => {
              const on = selectedNums.includes(n)
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
                      : on
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
          </div>
        </div>

        {alertText ? <p className="text-sm text-red-400">{alertText}</p> : null}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!betting}
            onClick={onConfirm}
            className="min-w-0 flex-1 rounded-lg bg-emerald-600 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-emerald-500"
          >
            确定
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
          单注上限 {maxBet || '-'}
          {gameEnded ? ' · 游戏已结束' : ''}
        </p>
      </div>

      {statsOpen ? (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setStatsOpen(false)}
        >
          <div
            className="max-h-[75dvh] w-full max-w-sm overflow-y-auto rounded-xl border border-zinc-600 bg-zinc-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold">我的战绩</h3>
            {personalRecords.length === 0 ? (
              <p className="text-sm text-zinc-400">暂无下注结算记录</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {personalRecords.map((r, i) => (
                  <li key={`${r.round}-${i}`} className="rounded-lg bg-zinc-800/80 px-3 py-2">
                    <div className="flex justify-between gap-2">
                      <span className="text-zinc-400">第 {r.round} 局</span>
                      <span>{r.label}</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-zinc-300">
                      <span>下注 {r.amt}</span>
                      <span className={r.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        本局 {r.delta >= 0 ? '+' : ''}
                        {r.delta}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-base font-semibold">
              总输赢 {personalTotal >= 0 ? '+' : ''}
              {personalTotal}
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
