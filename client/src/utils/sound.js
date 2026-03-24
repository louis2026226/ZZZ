let _ctx = null
const _buffers = {}

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
  return _ctx
}

async function _load(key) {
  if (_buffers[key]) return
  try {
    const ctx = getCtx()
    const res = await fetch(`/${key}.mp3`)
    const arr = await res.arrayBuffer()
    _buffers[key] = await ctx.decodeAudioData(arr)
  } catch (_) {}
}

// 模块加载时立即预解码，确保首次点击无延迟
_load('button')
_load('me')

export function playSound(key) {
  try {
    const ctx = getCtx()
    const buf = _buffers[key]
    if (!buf) return
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
  } catch (_) {}
}
