export default function RoomCornerInfo({ roomId, playerCount, currentRound, totalRounds, onDismiss }) {
  return (
    <div className="fixed right-3 top-3 z-50 flex items-start gap-2">
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg bg-red-800 px-3 py-1.5 text-xs text-white shadow hover:bg-red-700"
        >
          解散房间
        </button>
      ) : null}
      <div className="text-right text-[10px] leading-snug text-zinc-500">
        <div>
          房号 <span className="text-zinc-300">{roomId || '—'}</span>
        </div>
        <div>
          人数 <span className="text-zinc-300">{playerCount ?? '—'}</span>
        </div>
        <div className="mt-0.5">
          局数{' '}
          <span className="font-semibold text-amber-400">
            {currentRound ?? 0}/{totalRounds != null && totalRounds !== '' ? totalRounds : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
