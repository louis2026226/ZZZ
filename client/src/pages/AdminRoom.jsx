import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket } from '../socket.js'
import LogoutButton from '../components/LogoutButton.jsx'
import MessageBoard from '../components/MessageBoard.jsx'
import TimerBar from '../components/TimerBar.jsx'

function pickRandomAmounts() {
  const pool = []
  for (let i = 5; i <= 200; i += 5) pool.push(i)
  const shuffled = pool.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 10)
}

export default function AdminRoom() {
  const nav = useNavigate()
  const socketRef = useRef(null)
  const [creating, setCreating] = useState(() => !sessionStorage.getItem('bRoomId'))
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
  const [selectedNums, setSelectedNums] = useState([])
  const [pickedAmount, setPickedAmount] = useState(null)
  const [amounts, setAmounts] = useState(() => pickRandomAmounts())
  const [betAlert, setBetAlert] = useState('')

  const bUsername = sessionStorage.getItem('bUser') || ''

  const refreshAmounts = useCallback(() => {
    setAmounts(pickRandomAmounts())
  }, [])

  useEffect(() => {
    const bUser = sessionStorage.getItem('bUser')
    if (!bUser) {
      nav('/login/b')
      return
    }
    const s = createSocket()
    socketRef.current = s
    const rid = sessionStorage.getItem('bRoomId')

    function applyRoom(r) {
      if (!r) return
      setRoomId(r.id)
      sessionStorage.setItem('bRoomId', r.id)
      setMessages(r.messages || [])
      setTotalRoundsState(r.totalRounds)
      setMaxBetState(r.maxBet)
      setCurrentRound(r.currentRound ?? 0)
      if (r.phase) setPhase(r.phase)
      if (r.gameEnded) setGameEnded(true)
    }

    if (rid) {
      s.emit('b_join_existing', { username: bUser, roomId: rid }, (res) => {
        if (!res?.ok) {
          sessionStorage.removeItem('bRoomId')
          setRoomId('')
          setCreating(true)
          setErr(res?.error || '无法进入房间')
          return
        }
        applyRoom(res.room)
      })
    } else {
      setCreating(true)
    }

    s.on('messages', ({ list }) => setMessages(list || []))
    s.on('roomStats', (st) => {
      setPlayerCount(st.playerCount ?? 0)
      setCurrentRound(st.currentRound ?? 0)
      setTotalRoundsState(st.totalRounds ?? 0)
      if (st.phase) setPhase(st.phase)
      if (st.gameEnded) setGameEnded(true)
    })
    s.on('timer', ({ left, total }) => {
      setTimerLeft(left)
      if (total != null) setTimerTotal(total)
    })
    s.on('gameStart', () => {
      setPhase('betting')
      setSettleOpen(false)
      setSelectedNums([])
      setPickedAmount(null)
      refreshAmounts()
    })
    s.on('roundClosed', () => {
      setPhase('closed')
      setTimerLeft(0)
      setSettleOpen(true)
    })
    s.on('newRoundWait', (p) => {
      setPhase('idle')
      if (p?.currentRound != null) setCurrentRound(p.currentRound)
      if (p?.totalRounds != null) setTotalRoundsState(p.totalRounds)
      setSelectedNums([])
      setPickedAmount(null)
    })
    s.on('gameOver', () => {
      setGameEnded(true)
      setPhase('ended')
      setSettleOpen(false)
    })

    return () => {
      s.removeAllListeners()
      s.disconnect()
      socketRef.current = null
    }
  }, [nav, refreshAmounts])

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
        setCreating(false)
        setRoomId(res.room.id)
        sessionStorage.setItem('bRoomId', res.room.id)
        setMessages(res.room.messages || [])
        setTotalRoundsState(res.room.totalRounds)
        setMaxBetState(res.room.maxBet)
        setCurrentRound(res.room.currentRound ?? 0)
        setPlayerCount(0)
      }
    )
  }

  function onStart() {
    socketRef.current?.emit('b_start_round')
  }

  function onChooseDraw(n) {
    setErr('')
    socketRef.current?.emit('b_settle', { drawNumber: n })
    setSettleOpen(false)
  }

  const showTimer = phase === 'betting' && timerLeft > 0
  const betting = phase === 'betting' && timerLeft > 0
  const nums = useMemo(() => [1, 2, 3, 4], [])

  function toggleNum(n) {
    if (!betting) return
    setSelectedNums((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n)
      if (prev.length >= 2) return prev
      return [...prev, n]
    })
  }

  function onBetConfirm() {
    setBetAlert('')
    if (!betting) return
    if (selectedNums.length === 0) {
      setBetAlert('请至少选择 1 个数字')
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
      numbers: selectedNums,
      amount: pickedAmount,
    })
    setSelectedNums([])
    setPickedAmount(null)
  }

  if (creating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-white">
        <LogoutButton socketRef={socketRef} />
        <form
          onSubmit={onCreate}
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
            <button
              type="button"
              onClick={() => setMaxBet((v) => v + 200)}
              className="mt-2 w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-3 text-left hover:bg-zinc-700"
            >
              <span className="text-zinc-400">当前：</span>
              <span className="text-lg font-semibold text-white">{maxBet}</span>
              <span className="mt-1 block text-xs text-zinc-500">点击 +200</span>
            </button>
          </div>
          {err ? <p className="text-sm text-red-400">{err}</p> : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-amber-600 py-2 font-medium hover:bg-amber-500"
          >
            创建并进入
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 p-4 pt-14 text-white">
      <TimerBar visible={showTimer} left={timerLeft} total={timerTotal} />
      <LogoutButton socketRef={socketRef} />

      <div className="mb-4 shrink-0">
        <p className="mb-2 text-sm text-zinc-400">信息展示</p>
        <MessageBoard messages={messages} />
      </div>

      {!gameEnded ? (
        <div className="mb-4 space-y-4 border-b border-zinc-800 pb-4">
          <p className="text-sm text-zinc-400">参与下注（与玩家相同规则）</p>
          <div>
            <p className="mb-2 text-xs text-zinc-500">选号（最多 2 个）</p>
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
                    className={`h-12 w-12 rounded-lg text-lg font-bold ${
                      disabled
                        ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                        : on
                          ? 'bg-amber-500 text-white'
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
            <p className="mb-2 text-xs text-zinc-500">随机金额（点选其一）</p>
            <div className="flex flex-wrap gap-2">
              {amounts.map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={!betting}
                  onClick={() => setPickedAmount(a)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    !betting
                      ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                      : pickedAmount === a
                        ? 'bg-amber-500 text-white'
                        : 'bg-zinc-700 hover:bg-zinc-600'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          {betAlert ? <p className="text-sm text-red-400">{betAlert}</p> : null}
          <button
            type="button"
            disabled={!betting}
            onClick={onBetConfirm}
            className="w-full rounded-lg bg-amber-700 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-amber-600"
          >
            确定下注
          </button>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div
          className="flex flex-col items-center justify-center border-2 border-amber-500/60 bg-zinc-900 p-3 text-center"
          style={{ width: 100, height: 120 }}
        >
          <div className="text-xs text-zinc-400">房号</div>
          <div className="text-lg font-bold text-amber-400">{roomId || '-'}</div>
          <div className="mt-2 text-xs text-zinc-400">当前人数</div>
          <div className="text-sm">{playerCount}</div>
          <div className="mt-2 text-xs text-zinc-400">局数</div>
          <div className="text-sm">
            {currentRound}/{totalRoundsState || '-'}
          </div>
        </div>

        {gameEnded ? (
          <p className="text-lg text-amber-300">游戏结束</p>
        ) : (
          <button
            type="button"
            disabled={phase === 'betting' || phase === 'closed'}
            onClick={onStart}
            className="rounded-lg bg-amber-600 px-8 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-amber-500"
          >
            开始
          </button>
        )}

        {maxBetState ? (
          <p className="text-xs text-zinc-500">单注上限：{maxBetState}</p>
        ) : null}
      </div>

      {settleOpen ? (
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
            <button
              type="button"
              className="w-full rounded-lg border border-zinc-600 py-2"
              onClick={() => {
                setSettleOpen(false)
                setErr('')
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
