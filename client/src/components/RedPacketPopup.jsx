export default function RedPacketPopup({ rp, myUsername, onGrab, onClose }) {
  const total = (rp.totalFen / 100).toFixed(2)
  const grabbed = rp.grabbers.length
  const myGrab = rp.grabbers.find(g => g.username === myUsername)
  const canGrab = !rp.finished && !myGrab

  function formatTime(ts) {
    const d = new Date(ts)
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-red-800 px-4 py-3">
          <button type="button" onClick={onClose} className="text-white/70 text-xl leading-none">×</button>
          <span className="font-medium text-white">{rp.sender} 的红包</span>
          <span className="w-5" />
        </div>

        {/* Red envelope */}
        <div className="flex flex-col items-center bg-red-700 py-5">
          <img src="/hb1.png" alt="红包" className="max-h-20 w-auto" />
          <p className="mt-2 text-sm text-red-100">
            已抢 {grabbed}/{rp.maxGrabbers} 个，共 {total} 元
          </p>
        </div>

        {/* Grab button */}
        {canGrab && (
          <div className="flex justify-center bg-red-700 pb-4">
            <button
              type="button"
              onClick={() => onGrab(rp.id)}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-yellow-400 text-base font-bold text-zinc-900 shadow-lg active:scale-95"
            >
              开抢
            </button>
          </div>
        )}

        {/* Grab list */}
        <div className="bg-zinc-900 px-4 py-3">
          <p className="mb-2 text-xs text-zinc-400">
            {rp.finished ? '红包已被抢完' : '抢红包记录'}
          </p>
          {grabbed === 0 ? (
            <p className="text-sm text-zinc-500">暂无人抢</p>
          ) : (
            <ul className="space-y-2">
              {rp.grabbers.map((g, i) => (
                <li key={i} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-white">{g.username}</span>
                    <span className="ml-2 text-xs text-zinc-400">{formatTime(g.time)}</span>
                  </div>
                  <span className="text-sm font-semibold text-yellow-400">
                    {(g.amount / 100).toFixed(2)} 元
                  </span>
                </li>
              ))}
            </ul>
          )}
          {myGrab && (
            <p className="mt-3 text-center text-xs text-emerald-400">
              你抢到了 {(myGrab.amount / 100).toFixed(2)} 元
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
