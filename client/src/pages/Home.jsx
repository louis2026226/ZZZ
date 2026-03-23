import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-zinc-950 p-6 text-white">
      <h1 className="text-2xl font-semibold">江西豆豆</h1>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          className="rounded-lg bg-amber-600 px-6 py-3 text-center font-medium hover:bg-amber-500"
          to="/login/b"
        >
          B 端登录（管理员）
        </Link>
        <Link
          className="rounded-lg bg-emerald-600 px-6 py-3 text-center font-medium hover:bg-emerald-500"
          to="/login/c"
        >
          C 端登录（玩家）
        </Link>
      </div>
    </div>
  )
}
