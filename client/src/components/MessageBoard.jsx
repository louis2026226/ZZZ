import { useEffect, useRef } from 'react'

function displayMessage(text) {
  if (!text) return text
  return text.replace(
    /【系统】第 (\d+) \/ (\d+) 局准备中，管理员可点击「开始」。/g,
    '【系统】第 $1 / $2 局准备中，等待管理员公布幸运号。'
  )
}

function renderText(text) {
  if (!text) return text
  const displayed = displayMessage(text)
  if (text.startsWith('【答题】')) {
    const parts = displayed.split(' | ')
    if (parts.length >= 3) {
      const prefix = parts.slice(0, -1).join(' | ')
      const amt = parts[parts.length - 1]
      return <>{prefix} | <span className="text-yellow-400">{amt}</span></>
    }
  }
  if (text.startsWith('【结算】')) {
    const m = displayed.match(/^(.*?)（(.+)）(.*)$/)
    if (m) {
      return <>{m[1]}<span className="text-white">（{m[2]}）</span>{m[3]}</>
    }
  }
  return displayed
}

function lineClass(text) {
  if (!text) return 'text-zinc-100'
  if (text.includes('游戏开始')) return 'text-emerald-400'
  if (text.includes('房主公布幸运号')) return 'text-sky-400'
  if (text.includes('还有人答题吗')) return 'text-red-400'
  if (text.startsWith('【结算】')) {
    return /\+\d+（/.test(text) ? 'text-orange-400' : 'text-zinc-400'
  }
  if (text.startsWith('【本局统计】')) return 'text-amber-400'
  if (text.includes('【系统】玩家') && (text.includes('进入房间') || text.includes('离开房间')))
    return 'text-zinc-500'
  if (text.includes('房主已离开房间')) return 'text-zinc-500'
  return 'text-zinc-100'
}

export default function MessageBoard({ messages, className = 'h-[40vh]', onRedPacketClick }) {
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
      <div className="relative">
        <ul className="space-y-1">
          {(messages || []).map((m, i) =>
            m.divider ? (
              <li key={`d-${m.t}-${i}`} className="list-none py-1">
                <hr className="border-zinc-600" />
              </li>
            ) : m.redpacket ? (
              <li key={`${m.t}-${i}`} className="list-none">
                <button
                  type="button"
                  onClick={() => onRedPacketClick?.(m.redpacket.id)}
                  className="flex items-center gap-2 rounded-lg bg-zinc-700/80 px-3 py-2 text-left hover:bg-zinc-600/80"
                >
                  <img src="/hb1.png" alt="红包" className="max-h-10 w-auto shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white">{m.redpacket.sender} 发了一个红包</p>
                    <p className="text-xs text-red-200">点击领取</p>
                  </div>
                </button>
              </li>
            ) : m.image ? (
              <li key={`${m.t}-${i}`} className="list-none">
                <img src={`/${m.image}`} alt="" className="max-w-[120px] max-h-[120px]" />
              </li>
            ) : m.text?.includes('离开房间') ? null : (
              <li key={`${m.t}-${i}`} className={`break-words ${lineClass(m.text)}`}>
                {renderText(m.text)}
              </li>
            )
          )}
        </ul>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
