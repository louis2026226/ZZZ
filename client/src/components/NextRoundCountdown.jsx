export default function NextRoundCountdown({ value }) {
  if (!value || value <= 0) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <span className="select-none text-[min(40vw,8rem)] font-black tabular-nums text-white drop-shadow-2xl">
        {value}
      </span>
    </div>
  )
}
