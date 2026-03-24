import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket } from '../socket.js'
import { playSound } from '../utils/sound.js'

export default function CLogin() {
  const nav = useNavigate()
  const [username, setUsername] = useState(() => localStorage.getItem('cUser') || '')
  const [roomId, setRoomId] = useState(() => localStorage.getItem('cRoomId') || '')
  const [err, setErr] = useState('')

  function onSubmit(e) {
    e.preventDefault()
    setErr('')
    const rid = roomId.trim()
    if (!/^\d{3}$/.test(rid)) {
      setErr('房号须为 3 位数字')
      return
    }
    const s = createSocket()
    s.emit('c_login', { username: username.trim(), roomId: rid }, (res) => {
      if (!res?.ok) {
        setErr(res?.error || '验证失败')
        s.disconnect()
        return
      }
      sessionStorage.setItem('cUser', username.trim())
      sessionStorage.setItem('cRoomId', rid)
      localStorage.setItem('cUser', username.trim())
      localStorage.setItem('cRoomId', rid)
      s.disconnect()
      nav('/c/play')
    })
  }

  return (
    <div
      className="flex min-h-full items-center justify-center bg-zinc-950 p-6 text-white"
      onClick={() => nav('/')}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6"
      >
        <h2 className="text-lg font-semibold">C 端登录</h2>
        <div>
          <label className="block text-sm text-zinc-400">用户名</label>
          <input
            className="mt-1 w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400">3 位房号</label>
          <input
            className="mt-1 w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 tracking-widest"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.replace(/\D/g, '').slice(0, 3))}
            placeholder="例如 328"
            maxLength={3}
          />
        </div>
        {err ? <p className="text-sm text-red-400">{err}</p> : null}
        <button
          type="submit"
          onClick={() => playSound('button')}
          className="w-full rounded-lg bg-emerald-600 py-2 font-medium hover:bg-emerald-500"
        >
          进入房间
        </button>
        <div className="mt-[100px] text-center text-sm text-zinc-500">
          V1.0.83
        </div>
      </form>
    </div>
  )
}
