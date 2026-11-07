import { computed, reactive } from 'vue'
import seed from '../data/seed.json'
import { DOMAIN_COLOR, DOMAIN_EN, DOMAIN_ORDER, GROUPS } from '../lib/constants'
import { classify } from '../lib/kind'
import { fuzzyMatch } from '../lib/fuzzy'

const API = '/api'
const LS_KEY = 'itto-studio-dataset-v1'

export const state = reactive({
  procs: {},
  edges: [],
  meta: { updatedAt: null, rev: 0, dataFile: '' },
  status: 'loading', // loading | ready | offline
  booted: false,
  saveState: 'idle', // idle | pending | saving | saved | local | error
  dirty: false,

  /* UI */
  active: null,
  mode: 'clean', // clean | golden | change
  query: '',
  editing: false,
  edgeKinds: { main: true, change: true, plan: true, perf: true, data: true }, // 按线型筛选连线
  focusDep: true,
  animate: true,
  edited: {}, // { 过程名: true }
  toasts: [],
  changeStep: 2,
  artifactView: null, // 点开的交付物名，非空时弹出 ArtifactModal
})

let saveTimer = null
let toastSeq = 0

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */
export function toast(message, type = 'info') {
  const id = ++toastSeq
  state.toasts.push({ id, message, type })
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id)
    if (i > -1) state.toasts.splice(i, 1)
  }, 2600)
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function persistLocal() {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ procs: state.procs, edges: state.edges, _updatedAt: new Date().toLocaleString() }),
    )
  } catch (e) {
    /* 忽略配额错误 */
  }
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 载入 / 保存                                                         */
/* ------------------------------------------------------------------ */
export async function boot() {
  try {
    const res = await fetch(`${API}/itto`)
    if (!res.ok) throw new Error('bad status')
    const data = await res.json()
    state.procs = data.procs || {}
    state.edges = data.edges || []
    state.meta = data.meta || state.meta
    state.status = 'ready'
  } catch (e) {
    const local = readLocal()
    const d = local && local.procs ? local : seed
    state.procs = clone(d.procs || {})
    state.edges = clone(d.edges || [])
    state.meta = {
      updatedAt: (d && d._updatedAt) || null,
      rev: 0,
      dataFile: '浏览器本地缓存（后端未连接）',
    }
    state.status = 'offline'
  }
  state.booted = true
  state.saveState = state.status === 'offline' ? 'local' : 'saved'
}

export async function saveNow() {
  clearTimeout(saveTimer)
  if (state.status === 'offline') {
    persistLocal()
    state.saveState = 'local'
    state.dirty = false
    return
  }
  state.saveState = 'saving'
  try {
    const res = await fetch(`${API}/itto`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ procs: state.procs, edges: state.edges }),
    })
    if (!res.ok) throw new Error('save failed')
    const data = await res.json()
    state.meta = { ...state.meta, updatedAt: data.updated_at, rev: data.rev }
    state.dirty = false
    state.saveState = 'saved'
    if (data.repaired && data.repaired.length) {
      toast(`已保存，后端自动修正 ${data.repaired.length} 处数据自洽问题`, 'warn')
    }
  } catch (e) {
    state.status = 'offline'
    persistLocal()
    state.saveState = 'local'
    state.dirty = false
    toast('后端连接中断，改动已转存到浏览器本地', 'warn')
  }
}

function touch() {
  state.dirty = true
  state.saveState = 'pending'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 650)
}

export async function resetDataset() {
  if (state.status === 'offline') {
    state.procs = clone(seed.procs)
    state.edges = clone(seed.edges)
    state.edited = {}
    touch()
    toast('已还原为内置原始数据', 'ok')
    return
  }
  try {
    const res = await fetch(`${API}/itto/reset`, { method: 'POST' })
    if (!res.ok) throw new Error()
    const data = await res.json()
    const fresh = await fetch(`${API}/itto`).then((r) => r.json())
    state.procs = fresh.procs
    state.edges = fresh.edges
    state.meta = fresh.meta
    state.edited = {}
    state.saveState = 'saved'
    toast('已还原为内置原始数据（原数据已备份到服务端）', 'ok')
  } catch (e) {
    toast('还原失败：后端不可用', 'error')
  }
}

export function exportDataset() {
  if (state.status === 'ready') {
    window.open(`${API}/itto/export`, '_blank')
    return
  }
  const blob = new Blob(
    [JSON.stringify({ procs: state.procs, edges: state.edges }, null, 1)],
    { type: 'application/json' },
  )
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `ITTO数据-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function importDataset(file) {
  const text = await file.text()
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    toast('文件不是合法 JSON', 'error')
    return
  }
  if (!data || !data.procs || !Array.isArray(data.edges)) {
    toast('缺少 procs / edges 字段', 'error')
    return
  }
  state.procs = data.procs
  state.edges = data.edges
  state.edited = {}
  await saveNow()
  toast(`已导入 ${Object.keys(data.procs).length} 个过程、${data.edges.length} 条关系`, 'ok')
}

/* ------------------------------------------------------------------ */
/* 派生数据                                                            */
/* ------------------------------------------------------------------ */
export const procList = computed(() => {
  const rows = []
  const seen = new Set()
  let idx = 0
  for (const dom of DOMAIN_ORDER) {
    for (const id of Object.keys(state.procs)) {
      const p = state.procs[id]
      if (p.dom !== dom) continue
      if (seen.has(id)) continue
      seen.add(id)
      rows.push({ id, dom: p.dom, phase: p.phase, idx: ++idx })
    }
  }
  /* 兜底：数据里出现了未知领域，也要能显示 */
  for (const id of Object.keys(state.procs)) {
    if (seen.has(id)) continue
    const p = state.procs[id]
    seen.add(id)
    rows.push({ id, dom: p.dom, phase: p.phase, idx: ++idx })
  }
  return rows
})

export const procMap = computed(() => {
  const m = {}
  for (const r of procList.value) m[r.id] = r
  return m
})

export const domainRows = computed(() => {
  const map = new Map()
  for (const dom of DOMAIN_ORDER) map.set(dom, { name: dom, cells: Object.fromEntries(GROUPS.map((g) => [g, []])) })
  for (const r of procList.value) {
    if (!map.has(r.dom)) {
      map.set(r.dom, { name: r.dom, cells: Object.fromEntries(GROUPS.map((g) => [g, []])) })
    }
    const row = map.get(r.dom)
    if (!row.cells[r.phase]) row.cells[r.phase] = []
    row.cells[r.phase].push(r)
  }
  return [...map.values()].filter((row) => Object.values(row.cells).some((c) => c.length))
})

export const phaseCounts = computed(() => {
  const m = Object.fromEntries(GROUPS.map((g) => [g, 0]))
  for (const r of procList.value) m[r.phase] = (m[r.phase] || 0) + 1
  return m
})

export const artifactPool = computed(() => {
  const m = new Map()
  const bump = (x) => {
    const o = m.get(x) || { name: x, ins: 0, outs: 0 }
    o.ins++
    m.set(x, o)
  }
  for (const p of Object.values(state.procs)) {
    for (const x of p.ins || []) bump(x)
    for (const x of p.insGen || []) bump(x)
    for (const x of p.outs || []) {
      const o = m.get(x) || { name: x, ins: 0, outs: 0 }
      o.outs++
      m.set(x, o)
    }
    for (const x of p.outsUpd || []) {
      const o = m.get(x) || { name: x, ins: 0, outs: 0 }
      o.outs++
      m.set(x, o)
    }
  }
  return [...m.values()].sort((a, b) => b.ins + b.outs - (a.ins + a.outs))
})

export const artifactItems = computed(() =>
  artifactPool.value.map((a) => ({
    value: a.name,
    tag: a.ins && a.outs ? 'IN·OUT' : a.outs ? 'OUT' : 'IN',
    tagCls: a.ins && a.outs ? 'mix' : a.outs ? 'out' : 'in',
    kind: classify(a.name),
  })),
)

export const searchState = computed(() => {
  const q = state.query.trim()
  if (!q) return { active: false, procs: new Set(), arts: new Set() }
  const arts = new Set()
  for (const a of artifactPool.value) {
    if (fuzzyMatch(q, a.name).ok) arts.add(a.name)
  }
  const procs = new Set()
  for (const [id, p] of Object.entries(state.procs)) {
    if (fuzzyMatch(q, id).ok) procs.add(id)
    if ((p.ins || []).some((a) => arts.has(a))) procs.add(id)
    if ((p.insGen || []).some((a) => arts.has(a))) procs.add(id)
    if ((p.outs || []).some((a) => arts.has(a))) procs.add(id)
    if ((p.outsUpd || []).some((a) => arts.has(a))) procs.add(id)
  }
  return { active: true, procs, arts }
})

export const activeProc = computed(() => (state.active ? state.procs[state.active] : null))

export const activeMeta = computed(() => (state.active ? procMap.value[state.active] : null))

export const activeInEdges = computed(() =>
  state.active ? state.edges.filter((e) => e[1] === state.active) : [],
)

export const activeOutEdges = computed(() =>
  state.active ? state.edges.filter((e) => e[0] === state.active) : [],
)

export const activeNeighbors = computed(() => {
  const up = new Set()
  const down = new Set()
  if (!state.active) return { up, down }
  for (const e of state.edges) {
    if (e[0] === state.active) down.add(e[1])
    if (e[1] === state.active) up.add(e[0])
  }
  return { up, down }
})

/* ------------------------------------------------------------------ */
/* 交付物 × 49 过程 关系视图                                            */
/* ------------------------------------------------------------------ */

/**
 * 交付物在 49 个过程中的完整关系：
 *   produced —— 哪些过程把它列为关键输出（含「核心名（更新）」的受控更新，
 *               更新类单独归入 updated；通用输入 insGen 单独归入 genIn）
 *   每条记录 { proc, phase, dom, via: 'out' | 'upd' | 'in' | 'gen' }，
 *   按教程领域顺序（procList 的 idx）排序，同一过程可出现多个角色。
 */
export const artifactRelations = computed(() => {
  if (!state.artifactView) return null
  const name = state.artifactView
  const core = (x) => String(x).replace(/[（(]更新[)）]/g, '')
  const target = core(name)
  const order = procMap.value
  const roles = new Map() // procId -> { proc, phase, dom, idx, via: Set }

  const add = (pid, via) => {
    const p = state.procs[pid]
    if (!p) return
    const m = order[pid]
    if (!roles.has(pid)) {
      roles.set(pid, {
        proc: pid,
        phase: p.phase,
        dom: p.dom,
        idx: m ? m.idx : 999,
        via: new Set(),
      })
    }
    roles.get(pid).via.add(via)
  }

  for (const [pid, p] of Object.entries(state.procs)) {
    if ((p.outs || []).includes(name)) add(pid, 'out')
    if ((p.outsUpd || []).some((x) => core(x) === target)) add(pid, 'upd')
    if ((p.ins || []).includes(name)) add(pid, 'in')
    if ((p.insGen || []).includes(name)) add(pid, 'gen')
  }

  return {
    name,
    kind: classify(name),
    rows: [...roles.values()].sort((a, b) => a.idx - b.idx),
  }
})

export function openArtifact(name) {
  state.artifactView = name
}

export function closeArtifact() {
  state.artifactView = null
}

/* ------------------------------------------------------------------ */
/* UI 动作                                                             */
/* ------------------------------------------------------------------ */
function syncHash(value) {
  const next = value ? '#' + encodeURIComponent(value) : ' '
  try {
    if (location.hash !== next) history.replaceState(null, '', value ? next : location.pathname + location.search)
  } catch (e) {
    /* file:// 下忽略 */
  }
}

export function select(id) {
  /* 变更闭环模式下点过程：保持闭环聚焦，只高亮该过程，不跳出 */
  if (state.mode !== 'clean' && state.mode !== 'change') state.mode = 'clean'
  state.active = id || null
  state.editing = false
  syncHash(id || '')
}

export function setMode(mode) {
  state.mode = mode
  state.editing = false
  if (mode !== 'clean') {
    state.active = null
  }
  syncHash(mode === 'clean' ? '' : mode)
}

/** 支持 #过程名 / #golden / #change 直接定位，方便收藏与分享 */
export function initFromHash() {
  const h = decodeURIComponent((location.hash || '').slice(1))
  if (!h) return
  if (h === 'golden' || h === 'change') {
    setMode(h)
    return
  }
  if (state.procs[h]) select(h)
}

export function toggleEditing() {
  state.editing = !state.editing
}

export function markEdited(id) {
  state.edited = { ...state.edited, [id]: true }
}

/* ------------------------------------------------------------------ */
/* 数据编辑                                                            */
/* ------------------------------------------------------------------ */
function ensureEdgeLists(from, to, art) {
  const core = (x) => String(x).replace(/（更新）|\(更新\)/g, '')
  const src = state.procs[from]
  if (!src.outs.includes(art) && !(src.outsUpd || []).some((x) => core(x) === core(art))) {
    src.outs.push(art)
  }
  const dst = state.procs[to]
  if (!dst.ins.includes(art) && !(dst.insGen || []).includes(art)) {
    dst.ins.push(art)
  }
}

const coreName = (x) => String(x).replace(/（更新）|\(更新\)/g, '')

/**
 * 预演一次「删除输入」的影响：不修改任何数据，只算哪些边会失效、
 * 哪些上游过程仍在产出该输入（用于提示可以顺手补一条连线）。
 * 返回 { brokenEdges: [{from,to,art}], producers: [过程名] }
 */
export function planDelInput(id, name) {
  const brokenEdges = state.edges.filter((e) => e[1] === id && e[2] === name).map((e) => ({ from: e[0], to: e[1], art: e[2] }))
  const producers = [...new Set(brokenEdges.map((e) => e.from))]
  return { brokenEdges, producers }
}

/**
 * 预演一次「删除输出」的影响：
 *   brokenEdges —— 下游正以它为输入的边（连线将断）
 *   orphans —— 其它过程仍把该交付物列在输入里、但删除后不再有任何产出方的孤儿项
 */
export function planDelOutput(id, name) {
  const brokenEdges = state.edges
    .filter((e) => e[0] === id && e[2] === name)
    .map((e) => ({ from: e[0], to: e[1], art: e[2] }))
  const orphans = []
  for (const [pid, p] of Object.entries(state.procs)) {
    if (pid === id || !(p.ins || []).includes(name)) continue
    if (!isStillProduced(id, name)) orphans.push({ proc: pid, art: name })
  }
  return { brokenEdges, orphans }
}

/** 删除 procId 的输出 art 后，是否还有别的过程（含更新类输出核心名匹配）在产出它 */
function isStillProduced(exceptId, name) {
  const core = coreName(name)
  return Object.entries(state.procs).some(([pid, p]) => {
    if (pid === exceptId) return false
    if ((p.outs || []).includes(name)) return true
    return (p.outsUpd || []).some((x) => coreName(x) === core)
  })
}

/** 预演「新增输入」：若该输入已有别的过程产出，建议顺手连线 */
export function planAddInput(id, name) {
  const producers = Object.entries(state.procs)
    .filter(([pid, p]) => pid !== id && ((p.outs || []).includes(name) || (p.outsUpd || []).some((x) => coreName(x) === coreName(name))))
    .map(([pid]) => pid)
  return { producers }
}

/** 预演「新增输出」：若已有过程把它列为输入，建议顺手连线 */
export function planAddOutput(id, name) {
  const consumers = Object.entries(state.procs)
    .filter(([pid, p]) => pid !== id && (p.ins || []).includes(name))
    .map(([pid]) => pid)
  return { consumers }
}

/** 一次性应用删除输入：删清单项 + 断开相关边 */
export function applyDelInput(id, name) {
  const p = state.procs[id]
  if (!p) return
  p.ins = p.ins.filter((x) => x !== name)
  state.edges = state.edges.filter((e) => !(e[1] === id && e[2] === name))
  markEdited(id)
  touch()
  toast(`已删除输入：${name}`, 'ok')
}

/**
 * 应用删除输出：
 *   dropEdges —— 一并断开相关连线
 *   cleanOrphans —— 顺手从失去产出方的过程输入清单里移除该交付物
 */
export function applyDelOutput(id, name, { dropEdges = true, cleanOrphans = true } = {}) {
  const p = state.procs[id]
  if (!p) return
  p.outs = p.outs.filter((x) => x !== name)
  if (dropEdges) {
    state.edges = state.edges.filter((e) => !(e[0] === id && e[2] === name))
  }
  if (cleanOrphans && !isStillProduced(id, name)) {
    for (const [pid, other] of Object.entries(state.procs)) {
      if (pid !== id && (other.ins || []).includes(name)) {
        other.ins = other.ins.filter((x) => x !== name)
        markEdited(pid)
      }
    }
  }
  markEdited(id)
  touch()
  toast(`已删除输出：${name}`, 'ok')
}

export function addInput(id, raw) {
  const v = String(raw || '').trim()
  if (!v) return false
  const p = state.procs[id]
  if (p.ins.includes(v) || (p.insGen || []).includes(v)) {
    toast('该输入已存在', 'warn')
    return false
  }
  p.ins.push(v)
  markEdited(id)
  touch()
  toast(`已添加输入：${v}`, 'ok')
  return true
}

export function delInput(id, name) {
  applyDelInput(id, name)
}

export function addOutput(id, raw) {
  const v = String(raw || '').trim()
  if (!v) return false
  const p = state.procs[id]
  const core = (x) => String(x).replace(/（更新）|\(更新\)/g, '')
  if (p.outs.includes(v) || (p.outsUpd || []).some((x) => core(x) === core(v))) {
    toast('该输出已存在', 'warn')
    return false
  }
  p.outs.push(v)
  markEdited(id)
  touch()
  toast(`已添加输出：${v}`, 'ok')
  return true
}

export function delOutput(id, name) {
  applyDelOutput(id, name)
}

export function addEdge(from, to, art) {
  if (!from || !to || !art) return false
  if (state.edges.some((e) => e[0] === from && e[1] === to && e[2] === art)) {
    toast('这条关系已存在', 'warn')
    return false
  }
  state.edges.push([from, to, art, 'main'])
  ensureEdgeLists(from, to, art)
  markEdited(from)
  markEdited(to)
  touch()
  toast(`已建立关系：${from} → ${to}（${art}）`, 'ok')
  return true
}

export function delEdge(from, to, art) {
  state.edges = state.edges.filter((e) => !(e[0] === from && e[1] === to && e[2] === art))
  markEdited(from)
  markEdited(to)
  touch()
  toast(`已删除关系：${from} → ${to}`, 'ok')
}

export function moveArtifact(id, dir, name, delta) {
  const list = state.procs[id][dir === 'in' ? 'ins' : 'outs']
  const i = list.indexOf(name)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return
  list.splice(i, 1)
  list.splice(j, 0, name)
  markEdited(id)
  touch()
}

/** 在上下游列表里移动一条关系的顺序（siblings 为当前筛选后的可见列表） */
export function moveEdge(edge, delta, siblings) {
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
  const i = siblings.findIndex((e) => same(e, edge))
  const j = i + delta
  if (i < 0 || j < 0 || j >= siblings.length) return
  const other = siblings[j]
  const gi = state.edges.findIndex((e) => same(e, edge))
  const gj = state.edges.findIndex((e) => same(e, other))
  if (gi < 0 || gj < 0) return
  state.edges.splice(gi, 1)
  state.edges.splice(gj, 0, edge)
  markEdited(edge[0])
  markEdited(edge[1])
  touch()
}

/* 领域 / 过程组的展示色 */
export function domainColor(dom) {
  return DOMAIN_COLOR[dom] || '#475569'
}
export function domainEn(dom) {
  return DOMAIN_EN[dom] || ''
}

export function useItto() {
  return {
    state,
    procList,
    procMap,
    domainRows,
    phaseCounts,
    artifactPool,
    artifactItems,
    searchState,
    activeProc,
    activeMeta,
    activeInEdges,
    activeOutEdges,
    activeNeighbors,
    artifactRelations,
    openArtifact,
    closeArtifact,
    boot,
    saveNow,
    resetDataset,
    exportDataset,
    importDataset,
    select,
    setMode,
    toggleEditing,
    addInput,
    delInput,
    addOutput,
    delOutput,
    addEdge,
    delEdge,
    moveArtifact,
    moveEdge,
    planDelInput,
    planDelOutput,
    planAddInput,
    planAddOutput,
    applyDelInput,
    applyDelOutput,
    domainColor,
    domainEn,
    toast,
  }
}