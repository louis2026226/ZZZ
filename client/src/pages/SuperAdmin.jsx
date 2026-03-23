import { useEffect, useState, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSocket } from '../socket.js'

function creds() {
  return {
    suUser: sessionStorage.getItem('superAdminSuUser') || '',
    suPass: sessionStorage.getItem('superAdminSuPass') || '',
  }
}

export default function SuperAdmin() {
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(() => {
    const { suUser, suPass } = creds()
    if (!suUser || !suPass) {
      nav('/super-admin', { replace: true })
      return
    }
    setErr('')
    const s = createSocket()
    s.emit('super_admin_list_b', { suUser, suPass }, (res) => {
      s.disconnect()
      setLoading(false)
      if (!res?.ok) {
        setErr(res?.error || '加载失败')
        return
      }
      setList(res.list || [])
    })
  }, [nav])

  useEffect(() => {
    if (sessionStorage.getItem('superAdminOk') !== '1') {
      nav('/super-admin', { replace: true })
      return
    }
    load()
  }, [nav, load])

  function updateRow(targetUsername, patch) {
    const { suUser, suPass } = creds()
    const s = createSocket()
    s.emit(
      'super_admin_update_b',
      { suUser, suPass, targetUsername, ...patch },
      (res) => {
        s.disconnect()
        if (!res?.ok) {
          setErr(res?.error || '操作失败')
          return
        }
        load()
      }
    )
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
                <th className="p-2">已结算局数</th>
                <th className="p-2">房主输赢</th>
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
                      {row.state === 'banned'
                        ? '封禁'
                        : row.state === 'disabled'
                          ? '停用'
                          : '正常'}
                    </td>
                    <td className="p-2">{row.authorized ? '是' : '否'}</td>
                    <td className="p-2">{row.totalRoundsSettled ?? 0}</td>
                    <td className="p-2">{row.selfPnL ?? 0}</td>
                    <td className="p-2">{row.distinctCCount ?? 0}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
                          onClick={() =>
                            updateRow(row.username, { authorized: !row.authorized })
                          }
                        >
                          {row.authorized ? '取消授权' : '授权'}
                        </button>
                        <button
                          type="button"
                          className="rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
                          onClick={() => updateRow(row.username, { state: 'banned' })}
                        >
                          封禁
                        </button>
                        <button
                          type="button"
                          className="rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600"
                          onClick={() => updateRow(row.username, { state: 'disabled' })}
                        >
                          停用
                        </button>
                        <button
                          type="button"
                          className="rounded bg-emerald-900/60 px-2 py-0.5 text-xs hover:bg-emerald-800/60"
                          onClick={() => updateRow(row.username, { state: 'active' })}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          className="rounded bg-zinc-600 px-2 py-0.5 text-xs hover:bg-zinc-500"
                          onClick={() =>
                            setExpanded((x) => (x === row.username ? null : row.username))
                          }
                        >
                          C 明细
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.username ? (
                    <tr className="border-t border-zinc-800 bg-zinc-950">
                      <td colSpan={8} className="p-3 text-zinc-300">
                        <div className="text-xs text-zinc-500">各 C 累计输赢（进入过该 B 房间）</div>
                        <ul className="mt-1 max-h-40 list-inside list-disc overflow-y-auto text-sm">
                          {(row.cRows || []).length === 0 ? (
                            <li>暂无</li>
                          ) : (
                            (row.cRows || []).map((c) => (
                              <li key={c.username}>
                                {c.username}：{c.pnl}
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
          <p className="mt-4 text-zinc-500">暂无 B 账号记录（有 B 登录后会出现）</p>
        ) : null}
      </div>
    </div>
  )
}
