import { useState } from 'react'

export default function SuperAdminLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  function onSubmit(e) {
    e.preventDefault()
    setErr('第2步将接入后端登录校验')
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-950 p-6 text-white">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6"
      >
        <h2 className="text-lg font-semibold">总后台登录</h2>
        <div>
          <label className="block text-sm text-zinc-400">账号</label>
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
          className="w-full rounded-lg bg-amber-600 py-2 font-medium hover:bg-amber-500"
        >
          登录
        </button>
      </form>
    </div>
  )
}
