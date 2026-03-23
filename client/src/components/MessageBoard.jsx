import { useEffect, useRef } from 'react'

function displayMessage(text) {
  if (!text) return text
  return text.replace(
    /【系统】第 (\d+) \/ (\d+) 局准备中，管理员可点击「开始」。/g,
    '【系统】第 $1 / $2 局准备中，等待管理员公布幸运号。'
  )
}

function lineClass(text) {
  if (!text) return 'text-zinc-100'
  if (text.includes('游戏开始')) return 'text-emerald-400'
  if (text.includes('房主公布幸运号')) return 'text-sky-400'
  if (text.includes('【结算】') || text.includes('【本局统计】')) return 'text-amber-400'
  if (text.includes('【系统】玩家') && (text.includes('进入房间') || text.includes('离开房间')))
    return 'text-zinc-500'
  if (text.includes('房主已离开房间')) return 'text-zinc-500'
  return 'text-zinc-100'
}

export default function MessageBoard({ messages, className = 'h-[40vh]' }) {
  const bottomRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div
      ref={scrollRef}
      className={`w-full overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-900/80 p-3 text-sm text-zinc-100 ${className}`}
    >
      <ul className="space-y-1">
        {(messages || []).map((m, i) =>
          m.divider ? (
            <li key={`d-${m.t}-${i}`} className="list-none py-1">
              <hr className="border-zinc-600" />
            </li>
          ) : (
            <li key={`${m.t}-${i}`} className={`break-words ${lineClass(m.text)}`}>
              {displayMessage(m.text)}
            </li>
          )
        )}
      </ul>
      <div ref={bottomRef} />
    </div>
  )
}
