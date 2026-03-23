import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function LogoutButton({ socketRef }) {
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
    <button
      type="button"
      onClick={onLogout}
      className="fixed right-4 top-4 z-50 flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white shadow hover:bg-zinc-700"
    >
      <LogOut className="h-4 w-4" />
      退出
    </button>
  )
}
