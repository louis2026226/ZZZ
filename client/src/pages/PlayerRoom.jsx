import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket } from '../socket.js'
import LogoutButton from '../components/LogoutButton.jsx'
import RoomCornerInfo from '../components/RoomCornerInfo.jsx'
import MessageBoard from '../components/MessageBoard.jsx'
import TimerBar from '../components/TimerBar.jsx'

function pickRandomAmounts() {
  const pool = []
  for (let i = 5; i <= 200; i += 5) pool.push(i)
  const shuffled = pool.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 10).sort((a, b) => a - b)
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
  const [amounts, setAmounts] = useState(() => pickRandomAmounts())
  const [alertText, setAlertText] = useState('')
  const [joinErr, setJoinErr] = useState('')
  const [playerCount, setPlayerCount] = useState(0)

  const username = sessionStorage.getItem('cUser') || ''

  const refreshAmounts = useCallback(() => {
    setAmounts(pickRandomAmounts())
  }, [])

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
      if (res.room.phase) setPhase(res.room.phase)
      if (res.room.gameEnded) setGameEnded(true)
    })

    s.on('messages', ({ list }) => setMessages(list || []))
    s.on('roomStats', (st) => {
      if (st?.playerCount != null) setPlayerCount(st.playerCount)
    })
    s.on('gameStart', () => {
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
    s.on('newRoundWait', () => {
      setPhase('idle')
      setSelectedNums([])
      setPickedAmount(null)
    })
    s.on('gameOver', () => {
      setGameEnded(true)
      setPhase('ended')
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

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 p-4 pt-14 text-white">
      <TimerBar visible={showTimer} left={timerLeft} total={timerTotal} />
      <LogoutButton socketRef={socketRef} />
      <RoomCornerInfo roomId={roomId} playerCount={playerCount} />

      {joinErr ? <p className="mb-2 text-center text-sm text-red-400">{joinErr}</p> : null}

      <div className="mb-4 shrink-0">
        <p className="mb-2 text-sm text-zinc-400">信息展示</p>
        <MessageBoard messages={messages} />
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
          <p className="mb-2 text-sm text-zinc-400">随机米（点选其一，从小到大）</p>
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
                      ? 'bg-emerald-500 text-white'
                      : 'bg-zinc-700 hover:bg-zinc-600'
                }`}
              >
                {a}
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
    </div>
  )
}
