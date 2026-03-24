const _sounds = {}
export function playSound(key) {
  if (!_sounds[key]) _sounds[key] = new Audio(`/${key}.mp3`)
  const a = _sounds[key]
  a.currentTime = 0
  a.play().catch(() => {})
}
