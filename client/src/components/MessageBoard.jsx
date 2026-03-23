import { useEffect, useRef } from 'react'

export default function MessageBoard({ messages }) {
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
      className="h-[40vh] w-full overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-900/80 p-3 text-sm text-zinc-100"
    >
      <ul className="space-y-1">
        {(messages || []).map((m, i) => (
          <li key={`${m.t}-${i}`} className="break-words">
            {m.text}
          </li>
        ))}
      </ul>
      <div ref={bottomRef} />
    </div>
  )
}
