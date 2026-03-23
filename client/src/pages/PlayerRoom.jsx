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
  const [numPick, setNumPick] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 })
  const [pickedAmount, setPickedAmount] = useState(null)
  const [customAmount, setCustomAmount] = useState('')
  const [amounts, setAmounts] = useState(() => pickRandomAmounts(200))
  const [alertText, setAlertText] = useState('')
  const [joinErr, setJoinErr] = useState('')
  const [playerCount, setPlayerCount] = useState(0)
  const [currentRound, setCurrentRound] = useState(0)
  const [totalRoundsState, setTotalRoundsState] = useState(0)
  const [statsOpen, setStatsOpen] = useState(false)
  const [nextRoundLeft, setNextRoundLeft] = useState(0)
  const [copiedTip, setCopiedTip] = useState('')

  const username = sessionStorage.getItem('cUser') || ''

  const roundRecords = useMemo(() => buildRoundRecords(messages, username), [messages, username])
  const myTotal = useMemo(() => roundRecords.reduce((s, r) => s + r.myDelta, 0), [roundRecords])

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
      setNumPick(emptyNumPick())
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
      setNumPick(emptyNumPick())
      setPickedAmount(null)
      if (p?.currentRound != null) setCurrentRound(p.currentRound)
      if (p?.totalRounds != null) setTotalRoundsState(p.totalRounds)
    })
    s.on('gameOver', () => {
      setGameEnded(true)
      setPhase('ended')
    })
    s.on('nextRoundCountdown', ({ left }) => setNextRoundLeft(Number(left) || 0))
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
  }, [nav, refreshAmounts])

  const betting = phase === 'betting' && timerLeft > 0
  const showTimer = phase === 'betting' && timerLeft > 0

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

  function onConfirm() {
    setAlertText('')
    if (!betting) return
    const nums = buildNumbersFromPick(numPick)
    if (nums.length === 0) {
      setAlertText('请至少选择 1 个数字')
      return
    }
    if (!validPickNums(nums)) {
      setAlertText('选号不符合规则')
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
      numbers: nums,
      amount: pickedAmount,
    })
    setNumPick(emptyNumPick())
    setPickedAmount(null)
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
      setAlertText(`金额超过管理员设定的下注上限（${maxBet}）`)
      return
    }
    if (v % 5 !== 0) {
      setAlertText('自选金额必须是 5 的倍数')
      return
    }
    setPickedAmount(v)
  }

  const nums = useMemo(() => [1, 2, 3, 4], [])
  const boardClass =
    'min-h-[180px] h-[min(42dvh,26rem)] max-h-[50dvh] sm:min-h-[200px]'
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

        {alertText ? <p className="text-sm text-red-400">{alertText}</p> : null}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!betting}
            onClick={onConfirm}
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
