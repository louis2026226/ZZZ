export default function TimerBar({ visible, left, total }) {
  if (!visible || left == null || total == null) return null
  const pct = Math.max(0, Math.min(100, (left / total) * 100))

  return (
    <div className="fixed left-0 right-0 top-0 z-40 h-2 bg-zinc-800">
      <div
        className="h-full bg-yellow-400 transition-[width] duration-200 ease-linear"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
