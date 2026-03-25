import { useEffect, useState, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket, resolveMainSocketOrigin } from '../socket.js'

export default function SuperAdmin() {
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createUsername, setCreateUsername] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createErr, setCreateErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // username to delete

  const load = useCallback(() => {
    if (sessionStorage.getItem('superAdminOk') !== '1') {
      nav('/super-admin', { replace: true })
      return
    }
    setErr('')
    setLoading(true)
    ;(async () => {
      try {
        const origin = await resolveMainSocketOrigin()
        const s = createSocket(origin)
        s.emit('super_admin_list_b', {}, (res) => {
          s.disconnect()
          setLoading(false)
          if (!res?.ok) {
            setErr(res?.error || '加载失败')
            return
          }
          setList(res.list || [])
        })
      } catch {
        setLoading(false)
        setErr('无法连接服务')
      }
    })()
  }, [nav])

  useEffect(() => {
    if (sessionStorage.getItem('superAdminOk') !== '1') {
      nav('/super-admin', { replace: true })
      return
    }
    load()
  }, [nav, load])

  function updateRow(targetUsername, patch) {
    ;(async () => {
      try {
        const origin = await resolveMainSocketOrigin()
        const s = createSocket(origin)
        s.emit('super_admin_update_b', { username: targetUsername, ...patch }, (res) => {
          s.disconnect()
          if (!res?.ok) {
            setErr(res?.error || '操作失败')
            return
          }
          load()
        })
      } catch {
        setErr('无法连接服务')
      }
    })()
  }

  function doCreate() {
    setCreateErr('')
    const u = createUsername.trim()
    const p = createPassword.trim()
    if (!u) { setCreateErr('请输入用户名'); return }
    if (p.length < 4) { setCreateErr('密码至少 4 个字符'); return }
    ;(async () => {
      try {
        const origin = await resolveMainSocketOrigin()
        const s = createSocket(origin)
        s.emit('super_admin_create_b', { username: u, password: p }, (res) => {
          s.disconnect()
          if (!res?.ok) {
            setCreateErr(res?.error || '创建失败')
            return
          }
          setCreateOpen(false)
          setCreateUsername('')
          setCreatePassword('')
          load()
        })
      } catch {
        setCreateErr('无法连接服务')
      }
    })()
  }

  function doDelete(username) {
    ;(async () => {
      try {
        const origin = await resolveMainSocketOrigin()
        const s = createSocket(origin)
        s.emit('super_admin_delete_b', { username }, (res) => {
          s.disconnect()
          if (!res?.ok) {
            setErr(res?.error || '删除失败')
            return
          }
          setConfirmDelete(null)
          load()
        })
      } catch {
        setErr('无法连接服务')
      }
    })()
  }

  function logout() {
    sessionStorage.removeItem('superAdminOk')
    sessionStorage.removeItem('superAdminSuUser')
    sessionStorage.removeItem('superAdminSuPass')
    nav('/super-admin', { replace: true })
  }

  if (sessionStorage.getItem('superAdminOk') !== '1') return null

  return (
    <div className="min-h-full bg-zinc-950 p-4 text-white md:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">总后台</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-800/40"
              onClick={() => { setCreateErr(''); setCreateOpen(true) }}
            >
              创建 B 账号
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
              onClick={() => load()}
            >
              刷新
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900/40"
              onClick={logout}
            >
              退出
            </button>
          </div>
        </div>
        {loading ? <p className="text-zinc-400">加载中…</p> : null}
        {err ? <p className="mb-2 text-sm text-red-400">{err}</p> : null}
        <div className="overflow-x-auto rounded-lg border border-zinc-700">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="p-2">B 账号</th>
                <th className="p-2">创建时间</th>
                <th className="p-2">状态</th>
                <th className="p-2">授权</th>
                <th className="p-2">建房数</th>
                <th className="p-2">已结算局数</th>
                <th className="p-2">总盈亏</th>
                <th className="p-2">去重 C 人数</th>
                <th className="p-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <Fragment key={row.username}>
                  <tr className="border-t border-zinc-800 bg-zinc-900/50">
                    <td className="p-2 font-medium">{row.username}</td>
                    <td className="p-2 text-zinc-400">
                      {row.createdAt
                        ? new Date(row.createdAt).toLocaleString('zh-CN')
                        : '—'}
                    </td>
                    <td className="p-2">
                      {row.status === 'banned'
                        ? <span className="text-red-400">封禁</span>
                        : row.status === 'disabled'
                          ? <span className="text-amber-400">停用</span>
                          : <span className="text-emerald-400">正常</span>}
                    </td>
                    <td className="p-2">{row.authorized ? '是' : <span className="text-red-400">否</span>}</td>
                    <td className="p-2">{row.roomCount ?? 0}</td>
                    <td className="p-2">{row.totalRoundsSettled ?? 0}</td>
                    <td className="p-2">
                      <span className={(row.selfPnL ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {(row.selfPnL ?? 0) >= 0 ? '+' : ''}{row.selfPnL ?? 0}
                      </span>
                    </td>
                    <td className="p-2">{row.distinctCCount ?? 0}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
                          onClick={() => updateRow(row.username, { authorized: !row.authorized })}
                        >
                          {row.authorized ? '取消授权' : '授权'}
                        </button>
                        <button
                          type="button"
                          className="rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
                          onClick={() => updateRow(row.username, { status: 'banned' })}
                        >
                          封禁
                        </button>
                        <button
                          type="button"
                          className="rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
                          onClick={() => updateRow(row.username, { status: 'disabled' })}
                        >
                          停用
                        </button>
                        <button
                          type="button"
                          className="rounded bg-emerald-900/60 px-2 py-0.5 text-xs hover:bg-emerald-800/60"
                          onClick={() => updateRow(row.username, { status: 'active' })}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          className="rounded bg-zinc-600 px-2 py-0.5 text-xs hover:bg-zinc-500"
                          onClick={() => setExpanded((x) => (x === row.username ? null : row.username))}
                        >
                          C 明细
                        </button>
                        <button
                          type="button"
                          className="rounded bg-red-900/60 px-2 py-0.5 text-xs text-red-300 hover:bg-red-800/60"
                          onClick={() => setConfirmDelete(row.username)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.username ? (
                    <tr className="border-t border-zinc-800 bg-zinc-950">
                      <td colSpan={8} className="p-3 text-zinc-300">
                        <div className="text-xs text-zinc-500">各 C 累计（进入过该 B 房间）</div>
                        <ul className="mt-1 max-h-40 list-inside list-disc overflow-y-auto text-sm">
                          {(row.cRows || []).length === 0 ? (
                            <li>暂无</li>
                          ) : (
                            (row.cRows || []).map((c) => (
                              <li key={c.username}>
                                {c.username}：
                                <span className={c.total >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  {c.total >= 0 ? '+' : ''}{c.total}
                                </span>
                              </li>
                            ))
                          )}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && list.length === 0 ? (
          <p className="mt-4 text-zinc-500">暂无 B 账号，请点击"创建 B 账号"新建</p>
        ) : null}
      </div>

      {/* 创建B账号弹窗 */}
      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">创建 B 账号</h2>
            <div>
              <label className="block text-sm text-zinc-400">用户名</label>
              <input
                type="text"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value.slice(0, 20))}
                placeholder="1-20 个字符"
                className="mt-1 w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">密码</label>
              <input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="至少 4 个字符"
                className="mt-1 w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </div>
            {createErr ? <p className="text-sm text-red-400">{createErr}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="flex-1 rounded-lg border border-zinc-600 py-2 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={doCreate}
                className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-medium hover:bg-amber-500"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除确认弹窗 */}
      {confirmDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-xs space-y-4 rounded-xl border border-red-800 bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">确认删除</h2>
            <p className="text-sm text-zinc-300">
              将删除账号 <span className="font-bold text-amber-400">{confirmDelete}</span> 及其所有历史数据，此操作不可撤销。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-lg border border-zinc-600 py-2 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => doDelete(confirmDelete)}
                className="flex-1 rounded-lg bg-red-700 py-2 text-sm font-medium hover:bg-red-600"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
