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
  const [numPick, setNumPick] = useState(() => emptyNumPick())
  const [pickedAmount, setPickedAmount] = useState(null)
  const [customAmount, setCustomAmount] = useState('')
  const [customButtonAmount, setCustomButtonAmount] = useState(null)
  const [amounts, setAmounts] = useState(() => pickRandomAmounts(200))
  const [alertText, setAlertText] = useState('')
  const [joinErr, setJoinErr] = useState('')
  const [playerCount, setPlayerCount] = useState(0)
  const [currentRound, setCurrentRound] = useState(0)
  const [totalRoundsState, setTotalRoundsState] = useState(0)
  const [roomName, setRoomName] = useState('')
  const [statsOpen, setStatsOpen] = useState(false)
  const [nextRoundLeft, setNextRoundLeft] = useState(0)
  const [copiedTip, setCopiedTip] = useState('')
  const confirmLockRef = useRef(false)
  const [roundUsedDigits, setRoundUsedDigits] = useState([])

  const username = sessionStorage.getItem('cUser') || ''

  const roundRecords = useMemo(() => buildRoundRecords(messages, username), [messages, username])
  const myTotal = useMemo(() => roundRecords.reduce((s, r) => s + r.myDelta, 0), [roundRecords])
  const pickedNums = useMemo(() => buildDigitsFromPick(numPick), [numPick])
  const pickedCount = pickedNums.length
  const maxNumsReached = pickedCount >= 3

  const refreshAmounts = useCallback(() => {
    setAmounts(pickRandomAmounts(maxBet))
  }, [maxBet])

  const maxBetRef = useRef(0)
  useEffect(() => {
    maxBetRef.current = maxBet
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

    s.once('connect', () => {
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
        if (res.room.roomName != null) setRoomName(res.room.roomName)
      })
    })

    s.on('messages', ({ list }) => setMessages(list || []))
    s.on('roomStats', (st) => {
      if (st?.playerCount != null) setPlayerCount(st.playerCount)
      if (st?.currentRound != null) setCurrentRound(st.currentRound)
      if (st?.totalRounds != null) setTotalRoundsState(st.totalRounds)
      if (st?.roomName != null) setRoomName(st.roomName)
    })
    s.on('gameStart', () => {
      setNextRoundLeft(0)
      setPhase('betting')
      setNumPick(emptyNumPick())
      setPickedAmount(null)
      setCustomButtonAmount(null)
      setAmounts(pickRandomAmounts(maxBetRef.current))
      setRoundUsedDigits([])
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
      setNumPick(emptyNumPick())
      setPickedAmount(null)
      setCustomButtonAmount(null)
      if (p?.currentRound != null) setCurrentRound(p.currentRound)
      if (p?.totalRounds != null) setTotalRoundsState(p.totalRounds)
    })
    s.on('gameOver', () => {
      setGameEnded(true)
      setPhase('ended')
    })
    s.on('nextRoundCountdown', ({ left }) => setNextRoundLeft(Number(left) || 0))
    s.on('bellRing', () => sound('pass'))
    s.on('roomDismissed', ({ roomId }) => {
      const rid = sessionStorage.getItem('cRoomId')
      if (!rid || String(roomId) !== String(rid)) return
      sessionStorage.removeItem('cRoomId')
      s.removeAllListeners()
      s.disconnect()
      socketRef.current = null
      nav('/login/c')
    })

    return () => {
      s.removeAllListeners()
      s.disconnect()
      socketRef.current = null
    }
  }, [nav])

  const betting = phase === 'betting'
  const showTimer = phase === 'betting' && timerLeft > 0

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

  function onConfirm() {
    setAlertText('')
    if (!betting) return
    if (confirmLockRef.current) return
    const digits = buildDigitsFromPick(numPick)
    if (digits.length === 0) {
      setAlertText('请至少选择 1 个数字')
      return
    }
    if (digits.length > 2) {
      setAlertText('最多 2 个数字位（连点同一数字为两位）')
      return
    }
    if (!validDigitPick(digits)) {
      setAlertText('选号不符合规则')
      return
    }
    if (pickedAmount == null) {
      setAlertText('请选择下注金额')
      return
    }
    if (pickedAmount > maxBet) {
      setAlertText(`金额超过成绩上限（${maxBet}）`)
      return
    }
    confirmLockRef.current = true
    const smileOn = (numPick.smile ?? 0) > 0
    socketRef.current?.emit(
      'c_submit_bet',
      {
        username,
        numbers: digits,
        amount: pickedAmount,
        showSmile: smileOn,
      },
      (res) => {
        confirmLockRef.current = false
        if (!res?.ok) {
          setAlertText(res?.error || '下注失败')
          return
        }
        setRoundUsedDigits((prev) => [...new Set([...prev, ...digits])])
        setNumPick(emptyNumPick())
        setPickedAmount(null)
      }
    )
  }

  function onCustomAmountConfirm() {
    setAlertText('')
    if (!betting) return
    const v = Number(customAmount)
    if (!Number.isFinite(v) || v < 10) {
      setAlertText('自选金额需不小于 10')
      return
    }
    if (v > maxBet) {
      setAlertText(`金额超过成绩上限（${maxBet}）`)
      return
    }
    if (v % 5 !== 0) {
      setAlertText('自选金额必须是 5 的倍数')
      return
    }
    setCustomButtonAmount(v)
    setPickedAmount(v)
    setCustomAmount('')
  }

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
  const boardClass =
    'min-h-[180px] h-[50dvh] max-h-[50dvh] sm:min-h-[200px]'
  const latestRound = roundRecords.length > 0 ? roundRecords[roundRecords.length - 1].round : 0
  const digitStr = pickedNums.join('')
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
        onStatsClick={() => setStatsOpen(true)}
        onBack={() => {
          socketRef.current?.disconnect()
          socketRef.current = null
          sessionStorage.removeItem('cRoomId')
          nav('/login/c')
        }}
      />
      <RoomCornerInfo
        roomId={roomId}
        playerCount={playerCount}
        currentRound={currentRound}
        totalRounds={totalRoundsState}
        roomName={roomName}
      />

      {joinErr ? <p className="mb-2 text-center text-sm text-red-400">{joinErr}</p> : null}

      <div className="mb-4 shrink-0">
        <MessageBoard messages={messages} className={boardClass} />
      </div>

      <div className="flex flex-1 flex-col gap-6">
        <div>
          <p className="mb-2 text-sm text-zinc-400">
            当前选号：<span className="text-amber-400">{selectedNumText}</span>
          </p>
          <div className="flex flex-wrap gap-3">
            {nums.map((item) => {
              const c = numPick[item.value] ?? 0
              const d = item.value
              let kindBlocked = false
              if (d !== 'smile' && betting && c === 0 && !maxNumsReached) {
                const u = new Set(roundUsedDigits)
                for (const k of [1, 2, 3, 4]) {
                  if (k !== d && (numPick[k] ?? 0) > 0) u.add(k)
                }
                u.add(d)
                kindBlocked = u.size > 2
              }
              const numDisabled =
                d === 'smile'
                  ? !betting
                  : !betting || (maxNumsReached && c === 0) || kindBlocked
              return (
                <button
                  key={String(item.value)}
                  type="button"
                  disabled={numDisabled}
                  onClick={() => { sound('button'); toggleNum(item.value) }}
                  className={`h-14 w-14 rounded-lg text-lg font-bold ${
                    numDisabled
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
        </div>

        <div>
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
                onClick={() => { sound('button'); onCustomAmountConfirm() }}
                className="rounded-lg border border-zinc-500 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                设定
              </button>
            </div>
          </div>
        </div>

        {alertText ? <p className="text-sm text-red-400">{alertText}</p> : null}

        <TimerBar visible={showTimer} left={timerLeft} total={timerTotal} inline />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!betting}
            onClick={() => { sound('button'); onConfirm() }}
            className="min-w-0 flex-1 rounded-lg bg-emerald-600 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-emerald-500"
          >
            确定
          </button>
          <button
            type="button"
            disabled={!betting}
            onClick={() => {
              sound('button')
              setPickedAmount(null)
              refreshAmounts()
            }}
            className="shrink-0 rounded-lg border border-zinc-500 px-3 py-3 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            刷新
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          {gameEnded ? '游戏已结束' : ''}
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
