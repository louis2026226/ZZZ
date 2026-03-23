import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function LogoutButton({ socketRef, onStatsClick, onBackToLobby }) {
  const nav = useNavigate()

  function onLogout() {
    if (socketRef?.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    sessionStorage.removeItem('bUser')
    sessionStorage.removeItem('bRoomId')
    sessionStorage.removeItem('cUser')
    sessionStorage.removeItem('cRoomId')
    nav('/')
  }

  return (
    <div className="fixed left-3 top-3 z-50 flex gap-2">
      <button
        type="button"
        onClick={onLogout}
        className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white shadow hover:bg-zinc-700"
      >
        <LogOut className="h-4 w-4" />
        退出
      </button>
      {onStatsClick ? (
        <button
          type="button"
          onClick={onStatsClick}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white shadow hover:bg-zinc-700"
        >
          战绩
        </button>
      ) : null}
      {onBackToLobby ? (
        <button
          type="button"
          onClick={onBackToLobby}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white shadow hover:bg-zinc-700"
        >
          返回大厅
        </button>
      ) : null}
    </div>
  )
}
