import { playSound } from '../utils/sound.js'

export default function LogoutButton({ onDismiss, onStatsClick, onBack }) {
  return (
    <div className="fixed left-3 top-3 z-50 flex gap-2">
      {onDismiss ? (
        <button
          type="button"
          onClick={() => { playSound('button'); onDismiss() }}
          className="rounded-lg bg-red-800 px-3 py-2 text-sm text-white shadow hover:bg-red-700"
        >
          解散
        </button>
      ) : null}
      {onStatsClick ? (
        <button
          type="button"
          onClick={() => { playSound('button'); onStatsClick() }}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white shadow hover:bg-zinc-700"
        >
          战绩
        </button>
      ) : null}
      {onBack ? (
        <button
          type="button"
          onClick={() => { playSound('button'); onBack() }}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white shadow hover:bg-zinc-700"
        >
          返回
        </button>
      ) : null}
    </div>
  )
}
