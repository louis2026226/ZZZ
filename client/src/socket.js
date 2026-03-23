import { io } from 'socket.io-client'

let mainOriginCache = null

const MAIN_PORT_FALLBACK = Number(import.meta.env.VITE_MAIN_PORT) || 3000

export async function resolveMainSocketOrigin() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL
  if (typeof window === 'undefined') return ''
  if (mainOriginCache) return mainOriginCache
  const loc = window.location
  async function loadPorts(base) {
    const r = await fetch(`${base}/api/server-ports`)
    if (!r.ok) return null
    return r.json()
  }
  try {
    let j = await loadPorts(loc.origin)
    if (!j) {
      const guess = `${loc.protocol}//${loc.hostname}:${MAIN_PORT_FALLBACK}`
      j = await loadPorts(guess)
    }
    if (!j) {
      mainOriginCache = loc.origin
      return mainOriginCache
    }
    const ap = j.adminPort != null ? String(j.adminPort) : ''
    if (ap && loc.port === ap) {
      mainOriginCache = `${loc.protocol}//${loc.hostname}:${j.mainPort}`
      return mainOriginCache
    }
    mainOriginCache = loc.origin
    return mainOriginCache
  } catch {
    mainOriginCache = loc.origin
    return mainOriginCache
  }
}

export function createSocket(baseUrl) {
  const url =
    baseUrl ||
    import.meta.env.VITE_SOCKET_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  return io(url, {
    transports: ['websocket', 'polling'],
  })
}
