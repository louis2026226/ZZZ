import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import BLogin from './pages/BLogin.jsx'
import CLogin from './pages/CLogin.jsx'
import AdminRoom from './pages/AdminRoom.jsx'
import PlayerRoom from './pages/PlayerRoom.jsx'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login/b" element={<BLogin />} />
        <Route path="/login/c" element={<CLogin />} />
        <Route path="/b/dashboard" element={<AdminRoom />} />
        <Route path="/c/play" element={<PlayerRoom />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <div className="pointer-events-none fixed bottom-3 left-3 z-[60] text-[11px] font-medium text-zinc-400">
        V1.0.32
      </div>
    </>
  )
}
