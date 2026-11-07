/**
 * 模糊匹配：先按子串，再按字符顺序（如「风登」→「风险登记册」）
 * 返回 { ok, score, idx }，idx 为命中字符下标，用于高亮
 */
export function fuzzyMatch(query, text) {
  const q = String(query || '').trim().toLowerCase()
  const s = String(text || '').toLowerCase()
  if (!q) return { ok: true, score: 1, idx: [] }

  const p = s.indexOf(q)
  if (p > -1) {
    const idx = []
    for (let i = 0; i < q.length; i++) idx.push(p + i)
    return { ok: true, score: 1000 - p * 3 - s.length, idx }
  }

  let pos = 0
  let gaps = 0
  let last = -1
  const idx = []
  for (const ch of q) {
    const k = s.indexOf(ch, pos)
    if (k === -1) return { ok: false, score: 0, idx: [] }
    if (last >= 0) gaps += k - last - 1
    last = k
    idx.push(k)
    pos = k + 1
  }
  return { ok: true, score: 400 - gaps * 4 - s.length, idx }
}

/** 把命中字符切成 [{ch, hit}]，供模板渲染高亮 */
export function highlightParts(text, idx) {
  if (!idx || !idx.length) return [{ ch: String(text), hit: false }]
  const set = new Set(idx)
  const out = []
  let buf = ''
  let bufHit = null
  for (let i = 0; i < String(text).length; i++) {
    const hit = set.has(i)
    const ch = String(text)[i]
    if (bufHit === null || hit === bufHit) {
      buf += ch
      bufHit = hit
    } else {
      out.push({ ch: buf, hit: bufHit })
      buf = ch
      bufHit = hit
    }
  }
  if (buf) out.push({ ch: buf, hit: bufHit })
  return out
}