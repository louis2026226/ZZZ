import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket } from '../socket.js'
import { playSound } from '../utils/sound.js'

export default function BLogin() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  function onSubmit(e) {
    e.preventDefault()
    setErr('')
    const s = createSocket()
    s.emit('b_login', { username: username.trim(), password }, (res) => {
      if (!res?.ok) {
        setErr(res?.error || '登录失败')
        s.disconnect()
        return
      }
      sessionStorage.setItem('bUser', username.trim())
      s.disconnect()
      nav('/b/dashboard')
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
        <h2 className="text-lg font-semibold">B 端登录</h2>
        <div>
          <label className="block text-sm text-zinc-400">用户名</label>
          <input
            className="mt-1 w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400">密码</label>
          <input
            type="password"
            className="mt-1 w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {err ? <p className="text-sm text-red-400">{err}</p> : null}
        <button
          type="submit"
          onClick={() => playSound('button')}
          className="w-full rounded-lg bg-amber-600 py-2 font-medium hover:bg-amber-500"
        >
          登录
        </button>
        <div className="mt-[100px] text-center text-sm text-zinc-500">
          V1.0.98
        </div>
      </form>
    </div>
  )
}
