import { io } from 'socket.io-client'

const url =
  import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '')

export function createSocket() {
  return io(url, {
    transports: ['websocket', 'polling'],
  })
}
