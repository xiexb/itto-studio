<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArtifactChip from './ArtifactChip.vue'
import EditConfirmModal from './EditConfirmModal.vue'
import FuzzyCombobox from './FuzzyCombobox.vue'
import KindLegend from './KindLegend.vue'
import { CHG_STEPS, GROUP_COLOR, KIND, MASTERY, MASTERY_DEFAULT, masteryOf, NOTE_SCOPES, scopeOf } from '../lib/constants'
import { DFD_FIG, dfdUrl } from '../lib/dfd'
import { classify, kindCounts, kindOf } from '../lib/kind'
import { fuzzyMatch, highlightParts } from '../lib/fuzzy'
import { escapeHtml, markdownToText, renderMarkdown } from '../lib/markdown'
import {
  activeInEdges,
  activeMeta,
  activeOutEdges,
  activeProc,
  addEdge,
  addInput,
  addOutput,
  addNote,
  applyDelInput,
  applyDelOutput,
  artifactItems,
  artifactPool,
  delEdge,
  delNote,
  domainColor,
  editNote,
  moveArtifact,
  moveEdge,
  openArtifact,
  planAddInput,
  planAddOutput,
  planDelInput,
  planDelOutput,
  procList,
  select,
  setMode,
  setProcMastery,
  state,
  toggleEditing,
} from '../store/itto'

const emit = defineEmits(['close'])

const proc = activeProc
const meta = activeMeta
const inEdges = activeInEdges
const outEdges = activeOutEdges

const kindFilter = ref(null)
const inQ = ref('')
const outQ = ref('')
const upProcQ = ref('')
const upArtQ = ref('')
const downProcQ = ref('')
const downArtQ = ref('')
const upFrom = ref(null)
const downTo = ref(null)
const upArtRef = ref(null)
const downArtRef = ref(null)

/* ---- 学习笔记列表：默认展示；保存时可一并设置当时的掌握程度与应用范围 ---- */
const noteDraft = ref('')
const noteMastery = ref(MASTERY_DEFAULT)
const noteScopes = ref([])

/** 应用范围可多选；按固定顺序（综合 → 案例 → 论文）保存 */
function toggleNoteScope(name) {
  const set = new Set(noteScopes.value)
  if (set.has(name)) set.delete(name)
  else set.add(name)
  noteScopes.value = NOTE_SCOPES.map((s) => s.name).filter((n) => set.has(n))
}

function scopeStyle(name) {
  const s = scopeOf(name)
  return s ? { color: s.color, background: s.bg, borderColor: s.bd } : null
}
/* 掌握程度沿用上一次状态：优先取当前过程最近一次设置，否则取全局上次所选（本地持久化） */
const LS_MASTERY = 'itto-studio-last-mastery'
let lastMasteryUsed = Number(localStorage.getItem(LS_MASTERY))
if (!MASTERY.some((m) => m.level === lastMasteryUsed)) lastMasteryUsed = MASTERY_DEFAULT

const noteList = computed(() => (proc.value ? proc.value.notes || [] : []))
/** 新的在前，方便回看最近记录；i 保留原数组下标供删除用 */
const noteItems = computed(() =>
  noteList.value.map((n, i) => ({ n, i })).reverse(),
)

function nmInfo(n) {
  return masteryOf(n.mastery?.level)
}
function nmBadgeStyle(n) {
  const m = nmInfo(n)
  return m ? { color: m.color, background: m.bg, borderColor: m.bd } : null
}

/** 该过程最近一次设置的掌握程度：先看显式记录 mNote，再看笔记里带 mastery 的记录 */
function lastProcMastery(pid) {
  const p = state.procs[pid]
  if (!p) return MASTERY_DEFAULT
  if (p.mNote && MASTERY.some((m) => m.level === p.mNote.level)) return p.mNote.level
  const notes = p.notes || []
  for (let i = notes.length - 1; i >= 0; i--) {
    if (notes[i].mastery?.level) return notes[i].mastery.level
  }
  return MASTERY_DEFAULT
}

/** 过程名右侧的最终掌握程度徽标（含待学习默认态，始终显示） */
const finalMasteryLv = computed(() => (state.active ? lastProcMastery(state.active) : MASTERY_DEFAULT))
const finalMastery = computed(() => masteryOf(finalMasteryLv.value))
const finalMasteryStyle = computed(() => {
  const m = finalMastery.value
  return m ? { color: m.color, background: m.bg, borderColor: m.bd } : null
})

/* ---- 掌握程度修改弹层（挂在头部徽标上），内含变更轨迹 ---- */
const fmOpen = ref(false)
const mHistory = computed(() => (proc.value ? proc.value.mHistory || [] : []))

function fmPick(level) {
  const lv = MASTERY.some((m) => m.level === level) ? level : 0
  setProcMastery(state.active, lv)
  noteMastery.value = lv
  lastMasteryUsed = lv
  localStorage.setItem(LS_MASTERY, String(lv))
  fmOpen.value = false
}

/* 弹层点开时监听全局点击，点其它地方收起 */
function onDocClick() {
  fmOpen.value = false
}
watch(fmOpen, (v) => {
  if (v) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})

function scrollToNotes() {
  const sec = document.querySelector('.sec-note')
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ---- 笔记编辑：把原文本回填到顶部编辑器，保存走 editNote ---- */
const editingIdx = ref(-1) // noteItems 里展示序（对应原数组下标 .i）

function startEditNote(n) {
  editingIdx.value = n.i
  noteDraft.value = n.text
  noteMastery.value = n.mastery?.level || MASTERY_DEFAULT
  noteScopes.value = Array.isArray(n.scope) ? n.scope.slice() : []
  /* 编辑器里把 @名字 摊回 chip */
  const el = noteEditorEl.value
  if (el) {
    el.innerHTML = ''
    for (const sp of noteParts(n.text)) {
      if (sp.t === 'art') {
        el.appendChild(makeChipEl(sp.v))
      } else {
        const lines = String(sp.v).split('\n')
        lines.forEach((ln, li) => {
          if (li > 0) el.appendChild(document.createElement('br'))
          if (ln) el.appendChild(document.createTextNode(ln))
        })
      }
    }
    el.dataset.dirty = '1'
  }
  scrollToNotes()
  noteEditorEl.value && noteEditorEl.value.focus()
}

function cancelEditNote() {
  editingIdx.value = -1
  noteDraft.value = ''
  noteScopes.value = []
  clearEditor()
}

function makeChipEl(name) {
  const chip = document.createElement('span')
  chip.className = 'chip is-small note-mention'
  chip.contentEditable = 'false'
  chip.dataset.art = name
  const meta = KIND[classify(name)]
  chip.style.background = meta.bg
  chip.style.borderColor = meta.bd
  chip.style.color = meta.color
  const kEl = document.createElement('span')
  kEl.className = 'chip-kind'
  kEl.textContent = meta.short
  const nEl = document.createElement('span')
  nEl.className = 'chip-name'
  nEl.textContent = name
  chip.appendChild(kEl)
  chip.appendChild(nEl)
  return chip
}

function saveNoteOrEdit() {
  const v = noteDraft.value.trim()
  if (!v) return
  if (editingIdx.value >= 0) {
    editNote(state.active, editingIdx.value, v, noteMastery.value, noteScopes.value)
    editingIdx.value = -1
  } else {
    addNote(state.active, v, noteMastery.value, noteScopes.value)
  }
  lastMasteryUsed = noteMastery.value
  localStorage.setItem(LS_MASTERY, String(lastMasteryUsed))
  noteDraft.value = ''
  noteScopes.value = []
  clearEditor()
  atClose()
}

/* ---- 笔记详情：列表默认只显示一行，点「详情」展开完整 Markdown ---- */
const noteOpen = ref({})
function toggleNoteOpen(i) {
  noteOpen.value = { ...noteOpen.value, [i]: !noteOpen.value[i] }
}
function notePreview(text) {
  return markdownToText(text) || '（空笔记）'
}

function onDelNote(i) {
  delNote(state.active, i)
  noteOpen.value = {}
  hisOpen.value = {}
  if (editingIdx.value === i) cancelEditNote()
}

/* ---- 笔记历史展开 ---- */
const hisOpen = ref({}) // { 原数组下标: true }
function toggleHis(i) {
  hisOpen.value = { ...hisOpen.value, [i]: !hisOpen.value[i] }
}

/* ---- 笔记里的 @ 交付物提及：输入时模糊搜索，选中即插入 chip（与输入/输出标签同款） ---- */
const noteEditorEl = ref(null)
const at = ref(null) // { query, textNode, offset, results: [{it, m}], sel }
const atListStyle = ref({})
const atListEl = ref(null)

/** 光标所在文本节点里向左找 @：@ 与光标之间不能有空白或第二个 @ */
function atQueryInNode(node, offset) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const left = node.textContent.slice(0, offset)
  const atPos = left.lastIndexOf('@')
  if (atPos === -1) return null
  const word = left.slice(atPos + 1)
  if (/[\s@]/.test(word)) return null
  return { node, offset: atPos, query: word }
}

function atPlace() {
  const el = noteEditorEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const w = Math.max(r.width * 0.7, 260)
  const left = Math.max(8, Math.min(r.left + 12, window.innerWidth - w - 12))
  const spaceBelow = window.innerHeight - r.bottom
  const up = spaceBelow < 240 && r.top > spaceBelow
  atListStyle.value = {
    width: `${w}px`,
    left: `${left}px`,
    top: up ? 'auto' : `${Math.round(r.bottom + 6)}px`,
    bottom: up ? `${Math.round(window.innerHeight - r.top + 6)}px` : 'auto',
    maxHeight: `${up ? Math.min(280, r.top - 20) : Math.min(280, spaceBelow - 16)}px`,
  }
}

function atCompute() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return atClose()
  const range = sel.getRangeAt(0)
  if (!noteEditorEl.value || !noteEditorEl.value.contains(range.startContainer)) return atClose()
  if (!range.collapsed) return atClose()
  const hit = atQueryInNode(range.startContainer, range.startOffset)
  if (!hit) return atClose()
  const results = []
  for (const it of artifactItems.value) {
    const m = fuzzyMatch(hit.query, it.value)
    if (m.ok) results.push({ it, m })
  }
  results.sort((a, b) => b.m.score - a.m.score)
  results.splice(60)
  if (!results.length) {
    at.value = null
    return
  }
  const changedSrc = !at.value || at.value.offset !== hit.offset || at.value.query !== hit.query
  at.value = { ...hit, results, sel: changedSrc ? 0 : at.value.sel }
  nextTick(atPlace)
}

function atClose() {
  at.value = null
}

/** 选中候选：把「@query」替换成不可编辑的 chip + 后跟一个空格文本节点 */
function atPick(r) {
  const hit = at.value
  const editor = noteEditorEl.value
  if (!hit || !editor) return
  const node = hit.node
  const text = node.textContent
  const before = text.slice(0, hit.offset)
  const after = text.slice(hit.offset + 1 + hit.query.length)
  const chip = makeChipEl(r.it.value)

  const parent = node.parentNode
  const tail = document.createTextNode(after ? ' ' + after : ' ')
  parent.insertBefore(document.createTextNode(before), node)
  parent.insertBefore(chip, node)
  parent.insertBefore(tail, node)
  parent.removeChild(node)

  editor.dataset.dirty = '1'
  atClose()
  syncDraftFromEditor()

  /* 光标放到 chip 后的空格之后 */
  const sel = window.getSelection()
  if (sel) {
    const pos = document.createRange()
    pos.setStart(tail, 1)
    pos.collapse(true)
    sel.removeAllRanges()
    sel.addRange(pos)
  }
  editor.focus()
}

function atMove(dir) {
  if (!at.value) return
  const n = at.value.results.length
  at.value.sel = (at.value.sel + dir + n) % n
  nextTick(() => {
    const on = atListEl.value && atListEl.value.querySelector('.cb-item.is-on')
    if (on) on.scrollIntoView({ block: 'nearest' })
  })
}

/** editor 内纯文本（chip 摊平成 @名字），与 noteParts 的解析规则一致 */
function editorText() {
  const el = noteEditorEl.value
  if (!el) return ''
  let out = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const art = node.dataset && node.dataset.art
      out += art ? '@' + art : '\n' + node.textContent
    }
  }
  return out
}

function syncDraftFromEditor() {
  noteDraft.value = editorText()
}

function clearEditor() {
  const el = noteEditorEl.value
  if (!el) return
  el.innerHTML = ''
  el.dataset.dirty = '0'
  noteDraft.value = ''
}

function onEditorInput() {
  const el = noteEditorEl.value
  if (el) el.dataset.dirty = '1'
  syncDraftFromEditor()
  atCompute()
}

function onNoteKeydown(e) {
  if (e.key === 'ArrowDown' && at.value) {
    e.preventDefault()
    atMove(1)
  } else if (e.key === 'ArrowUp' && at.value) {
    e.preventDefault()
    atMove(-1)
  } else if (e.key === 'Enter' && at.value) {
    e.preventDefault()
    atPick(at.value.results[at.value.sel])
  } else if (e.key === 'Escape' && at.value) {
    e.preventDefault()
    e.stopPropagation()
    atClose()
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    saveNoteOrEdit()
  } else if (e.key === 'Enter') {
    /* contenteditable 默认会插 <div>/<br>，统一手动插换行文本，保证 editorText 的纯文本化稳定 */
    e.preventDefault()
    document.execCommand('insertLineBreak')
    syncDraftFromEditor()
  }
}

/** 交付物名按长度降序（中文无空格分词，优先匹配最长名字） */
const artNamesSorted = computed(() =>
  artifactPool.value.map((a) => a.name).sort((a, b) => b.length - a.length),
)

/** 把笔记文本切成 [{t:'text'|'art', v, kind?}]：@后能整体匹配到交付物名才算提及 */
function noteParts(text) {
  const s = String(text)
  const parts = []
  let i = 0
  let buf = ''
  const flush = () => {
    if (buf) {
      parts.push({ t: 'text', v: buf })
      buf = ''
    }
  }
  while (i < s.length) {
    if (s[i] !== '@') {
      buf += s[i]
      i++
      continue
    }
    const rest = s.slice(i + 1)
    const name = artNamesSorted.value.find((n) => rest.startsWith(n))
    if (!name) {
      buf += s[i]
      i++
      continue
    }
    flush()
    parts.push({ t: 'art', v: name, kind: classify(name) })
    i += 1 + name.length
  }
  flush()
  return parts
}

function atParts(name, idx) {
  return highlightParts(name, idx)
}

/* ---- 笔记正文按 Markdown 渲染；@交付物仍渲染成可点击 chip ---- */
function mentionHtml(name) {
  const meta = KIND[classify(name)]
  const safeName = escapeHtml(name)
  return (
    `<span class="chip is-small note-mention is-clickable" data-art="${safeName}"` +
    ` title="${safeName} · ${escapeHtml(meta.label)} · 点击查看它在49个过程中的关系"` +
    ` style="background:#fff;border-color:${meta.bd};color:${meta.color}">` +
    `<span class="chip-kind">${meta.short}</span>` +
    `<span class="chip-name">${safeName}</span></span>`
  )
}

function noteHtml(text) {
  return renderMarkdown(text, {
    mentions: artifactPool.value.map((a) => a.name),
    renderMention: mentionHtml,
  })
}

function onNoteBodyClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-art]') : null
  if (el && el.dataset.art) openArtifact(el.dataset.art)
}

watch(
  () => state.active,
  (id) => {
    kindFilter.value = null
    inQ.value = ''
    outQ.value = ''
    dfdOpen.value = false
    dfdZoom.value = false
    genOpen.value = false
    updOpen.value = false
    upProcQ.value = ''
    upArtQ.value = ''
    downProcQ.value = ''
    downArtQ.value = ''
    upFrom.value = null
    downTo.value = null
    noteDraft.value = ''
    editingIdx.value = -1
    hisOpen.value = {}
    noteOpen.value = {}
    noteScopes.value = []
    noteMastery.value = lastProcMastery(id) || lastMasteryUsed
    atClose()
    nextTick(() => {
      clearEditor()
      const box = document.querySelector('.drawer-body')
      if (box) box.scrollTop = 0
    })
  },
)

const ins = computed(() => (proc.value ? proc.value.ins || [] : []))
const outs = computed(() => (proc.value ? proc.value.outs || [] : []))
const insGen = computed(() => (proc.value ? proc.value.insGen || [] : []))
const outsUpd = computed(() => (proc.value ? proc.value.outsUpd || [] : []))
const updDetail = computed(() => (proc.value ? proc.value.updDetail || {} : {}))
const tools = computed(() => (proc.value ? proc.value.tools || [] : []))
const toolsDetail = computed(() => (proc.value ? proc.value.toolsDetail || {} : {}))
/** 受控更新的细项总数：每个更新对象下 updDetail 列表的具体条目数，无明细则按 1 计 */
const updItemCount = computed(() =>
  outsUpd.value.reduce(
    (sum, n) => sum + (updDetail.value[n]?.length || 1),
    0,
  ),
)
const counts = computed(() => kindCounts([...ins.value, ...outs.value, ...insGen.value, ...outsUpd.value]))
const tabIdx = computed(() => (meta.value ? meta.value.idx : 0))
const genOpen = ref(false)
const updOpen = ref(false)

const procItems = computed(() =>
  procList.value
    .filter((p) => p.id !== state.active)
    .map((p) => ({ value: p.id, tag: p.phase, tagCls: 'ph' })),
)

const upArtItems = computed(() => {
  if (!upFrom.value) return []
  const src = state.procs[upFrom.value]
  return (src?.outs || []).map((x) => ({ value: x, tag: 'OUT', tagCls: 'out', kind: classify(x) }))
})

const downArtItems = computed(() =>
  outs.value.map((x) => ({ value: x, tag: 'OUT', tagCls: 'out', kind: classify(x) })),
)

const planOutCount = computed(() => outs.value.filter((x) => classify(x) === 'plan').length)
const docOutCount = computed(() => outs.value.filter((x) => classify(x) === 'pdoc').length)
const isCCB = computed(() => state.active === '实施整体变更控制')

const stepOn = computed(() => CHG_STEPS.map((s) => s.procs.includes(state.active)))

/* ---- 教程数据流向图（图8-1 ~ 图17-4）：点缩略图页内灯箱预览 ---- */
const dfdFig = computed(() => (state.active && DFD_FIG[state.active]) || '')
const dfdSrc = computed(() => dfdUrl(state.active))
const dfdOpen = ref(false)
const dfdZoom = ref(false)

/* 灯箱打开时 Esc 只关灯箱：捕获阶段先拦截，避免连抽屉一起关掉 */
function onDfdKey(e) {
  if (e.key === 'Escape' && dfdOpen.value) {
    e.stopPropagation()
    e.preventDefault()
    dfdOpen.value = false
  }
}
onMounted(() => window.addEventListener('keydown', onDfdKey, true))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onDfdKey, true)
})

function pad(n) {
  return String(n).padStart(2, '0')
}
function dimmed(n) {
  return !!kindFilter.value && classify(n) !== kindFilter.value
}
function focused(n) {
  return !!kindFilter.value && classify(n) === kindFilter.value
}
function toggleFilter(k) {
  kindFilter.value = kindFilter.value === k ? null : k
}
function goto(id) {
  select(id)
}
function goChange() {
  setMode('change')
}

/* ---- 关键输入：可搜索已有项，也允许自由新建 ---- */
function onPickIn(item) {
  requestAddInput(item.value)
  inQ.value = ''
}
function onFreeIn(v) {
  requestAddInput(v)
  inQ.value = ''
}
function addInFromInput() {
  if (!inQ.value.trim()) return
  requestAddInput(inQ.value)
  inQ.value = ''
}

/* ---- 关键输出：只能从已有交付物中选择，避免造出无产出的孤儿项 ---- */
function onPickOut(item) {
  requestAddOutput(item.value)
  outQ.value = ''
}

/* ---- 编辑确认弹窗：先预演影响面，确认后一次性应用 ---- */
const confirm = ref(null) // { kind, id, name, title, summary, brokenEdges, orphans, producers, consumers, linkArt, confirmText }

function openConfirm(plan) {
  confirm.value = plan
}
function closeConfirm() {
  confirm.value = null
}

function requestDelInput(id, name) {
  const plan = planDelInput(id, name)
  openConfirm({
    kind: 'delInput',
    id,
    name,
    title: '删除输入的影响',
    summary: `删除「${id}」的输入：${name}`,
    brokenEdges: plan.brokenEdges,
    confirmText: '确认删除',
  })
}

function requestDelOutput(id, name) {
  const plan = planDelOutput(id, name)
  openConfirm({
    kind: 'delOutput',
    id,
    name,
    title: '删除输出的影响',
    summary: `删除「${id}」的输出：${name}`,
    brokenEdges: plan.brokenEdges,
    orphans: plan.orphans,
    confirmText: '确认删除',
  })
}

function requestAddInput(id, raw) {
  const v = String(raw || '').trim()
  if (!v) return
  const plan = planAddInput(id, v)
  openConfirm({
    kind: 'addInput',
    id,
    name: v,
    title: '新增输入',
    summary: `为「${id}」新增输入：${v}`,
    producers: plan.producers,
    linkArt: v,
    confirmText: plan.producers.length ? '确认并自动补连' : '确认新增',
  })
}

function requestAddOutput(id, raw) {
  const v = String(raw || '').trim()
  if (!v) return
  const plan = planAddOutput(id, v)
  openConfirm({
    kind: 'addOutput',
    id,
    name: v,
    title: '新增输出',
    summary: `为「${id}」新增输出：${v}`,
    consumers: plan.consumers,
    linkArt: v,
    confirmText: plan.consumers.length ? '确认并自动补连' : '确认新增',
  })
}

function onConfirm() {
  const c = confirm.value
  if (!c) return
  if (c.kind === 'delInput') {
    applyDelInput(c.id, c.name)
  } else if (c.kind === 'delOutput') {
    applyDelOutput(c.id, c.name)
  } else if (c.kind === 'addInput') {
    if (addInput(c.id, c.name) && c.producers.length) {
      for (const p of c.producers) addEdge(p, c.id, c.name)
    }
  } else if (c.kind === 'addOutput') {
    if (addOutput(c.id, c.name) && c.consumers.length) {
      for (const t of c.consumers) addEdge(c.id, t, c.name)
    }
  }
  closeConfirm()
}

/* ---- 上游：两步，先过程再它产出的交付物 ---- */
function onPickUpProc(item) {
  upFrom.value = item.value
  upArtQ.value = ''
  nextTick(() => upArtRef.value && upArtRef.value.open())
}
function onPickUpArt(item) {
  if (!upFrom.value) return
  addEdge(upFrom.value, state.active, item.value)
  upProcQ.value = ''
  upArtQ.value = ''
}

/* ---- 下游：两步，先过程再本过程产出的交付物 ---- */
function onPickDownProc(item) {
  downTo.value = item.value
  downArtQ.value = ''
  nextTick(() => downArtRef.value && downArtRef.value.open())
}
function onPickDownArt(item) {
  if (!downTo.value) return
  addEdge(state.active, downTo.value, item.value)
  downProcQ.value = ''
  downArtQ.value = ''
}
</script>

<template>
  <aside class="drawer" :class="{ open: !!state.active }">
    <div v-if="proc" class="drawer-inner">
      <div class="drawer-head">
        <button type="button" class="dh-close" title="关闭（Esc）" @click="emit('close')">×</button>
        <div class="dh-tags">
          <span class="badge" :style="{ background: GROUP_COLOR[proc.phase] }">{{ proc.phase }}过程组</span>
          <span class="badge soft" :style="{ color: domainColor(proc.dom), background: domainColor(proc.dom) + '16' }">
            {{ proc.dom }}
          </span>
        </div>
        <div class="dh-title">
          <h2>{{ state.active }}</h2>
          <div class="mastery-wrap">
            <button
              type="button"
              class="dh-mastery"
              :class="{ 'is-open': fmOpen }"
              :style="finalMasteryStyle"
              :title="`最终掌握程度：${finalMastery.label}（点击修改 · 查看变更记录）`"
              @click.stop="fmOpen = !fmOpen"
            >{{ finalMastery.stars }} {{ finalMastery.label }} <i class="dh-m-caret">▾</i></button>
            <transition name="pop">
              <div v-if="fmOpen" class="mastery-pop" @click.stop>
                <div class="mp-title">掌握程度</div>
                <button
                  v-for="m in MASTERY"
                  :key="m.level"
                  type="button"
                  class="mp-opt"
                  :class="{ 'is-cur': finalMasteryLv === m.level }"
                  :style="{ '--mc': m.color, '--mb': m.bg, '--md': m.bd }"
                  @click="fmPick(m.level)"
                >
                  <span class="mp-stars">{{ m.stars }}</span>{{ m.label }}
                  <span v-if="finalMasteryLv === m.level" class="mp-cur">✓</span>
                </button>
                <div v-if="mHistory.length" class="mp-his">
                  <div class="mp-his-title">变更记录</div>
                  <div v-for="(h, hi) in [...mHistory].reverse()" :key="hi" class="mp-his-row">
                    <span class="mp-his-at">{{ h.at }}</span>
                    <span
                      class="mp-his-lv"
                      :style="{ color: masteryOf(h.level).color, background: masteryOf(h.level).bg }"
                    >{{ masteryOf(h.level).stars }} {{ masteryOf(h.level).label }}</span>
                  </div>
                </div>
                <div v-else class="mp-his-empty">暂无变更记录（直接选择上面的级别即可记录）</div>
              </div>
            </transition>
          </div>
          <div class="dh-tools">
            <span v-if="state.edited[state.active]" class="edited-tag">已修改</span>
            <button
              type="button"
              class="btn tiny"
              :class="{ 'is-on': state.editing }"
              :title="state.editing ? '完成编辑 ITTO 数据' : '编辑 ITTO 数据（输入/输出/上下游）'"
              @click="toggleEditing"
            >{{ state.editing ? '✓ 完成' : '✎ 编辑' }}</button>
          </div>
        </div>
        <div class="dh-stats">
          <span class="idx-pill">№ {{ pad(tabIdx) }}</span>
          <span class="dh-stat"><i class="dot-in"></i>输入 {{ ins.length + insGen.length }}</span>
          <span class="dh-stat"><i class="dot-tool"></i>工具 {{ tools.length }}</span>
          <span class="dh-stat"><i class="dot-out"></i>输出 {{ outs.length + outsUpd.length }}</span>
        </div>
        <div v-if="proc.defn || proc.role" class="dh-defbox">
          <p v-if="proc.defn" class="dh-def"><b>定义</b>{{ proc.defn }}</p>
          <p v-if="proc.role" class="dh-role"><b>主要作用</b>{{ proc.role }}</p>
        </div>
      </div>

      <div class="drawer-body">
        <section class="sec sec-note">
          <div class="sec-head">
            <span class="sec-ico">记</span>
            <span class="sec-title">学习笔记</span>
            <em>NOTES</em>
            <span class="sec-n">{{ noteList.length }}</span>
          </div>
          <div class="sec-bd">
            <div class="note-composer" :class="{ 'is-editing': editingIdx >= 0 }">
              <div
                ref="noteEditorEl"
                class="note-input note-editor"
                contenteditable="true"
                data-placeholder="记录记忆口诀、易错点、真题考法… 支持 Markdown，输入 @ 可引用交付物"
                @input="onEditorInput"
                @click="atCompute"
                @keyup="atCompute"
                @keydown="onNoteKeydown"
                @blur="atClose"
              ></div>
              <div class="nc-scope">
                <span class="nc-m-label">应用范围</span>
                <button
                  v-for="s in NOTE_SCOPES"
                  :key="s.name"
                  type="button"
                  class="nc-s-opt"
                  :class="{ 'is-on': noteScopes.includes(s.name) }"
                  :style="{ '--sc': s.color, '--sb': s.bg, '--sd': s.bd }"
                  :title="`标记这条笔记的应用范围（可多选）：${s.name}`"
                  @click="toggleNoteScope(s.name)"
                >{{ s.name }}</button>
              </div>
              <div class="nc-foot">
                <div class="nc-mastery">
                  <span class="nc-m-label">掌握程度</span>
                  <button
                    v-for="m in MASTERY"
                    :key="m.level"
                    type="button"
                    class="nc-m-opt"
                    :class="{ 'is-on': noteMastery === m.level }"
                    :style="{ '--mc': m.color, '--mb': m.bg, '--md': m.bd }"
                    :title="m.stars"
                    @click="noteMastery = noteMastery === m.level ? 0 : m.level"
                  >{{ m.label }}</button>
                </div>
                <button
                  type="button"
                  class="nc-save"
                  :disabled="!noteDraft.trim()"
                  :title="editingIdx >= 0 ? '保存修改（Ctrl+Enter）' : '保存笔记（Ctrl+Enter）'"
                  @click="saveNoteOrEdit"
                >{{ editingIdx >= 0 ? '保存修改' : '保存笔记' }}</button>
                <button
                  v-if="editingIdx >= 0"
                  type="button"
                  class="nc-cancel"
                  title="取消编辑"
                  @click="cancelEditNote"
                >取消</button>
              </div>
              <Teleport to="body">
                <div
                  v-if="at"
                  ref="atListEl"
                  class="cb-list at-list"
                  :style="atListStyle"
                  @mousedown.prevent
                >
                  <div
                    v-for="(r, i) in at.results"
                    :key="r.it.value + i"
                    class="cb-item"
                    :class="{ 'is-on': i === at.sel }"
                    @mouseenter="at.sel = i"
                    @mousedown.prevent="atPick(r)"
                  >
                    <span class="cb-name">
                      <template v-for="(p, j) in atParts(r.it.value, r.m.idx)" :key="j">
                        <b v-if="p.hit">{{ p.ch }}</b>
                        <span v-else>{{ p.ch }}</span>
                      </template>
                    </span>
                    <span v-if="r.it.tag" class="cb-tag" :class="r.it.tagCls || ''">{{ r.it.tag }}</span>
                    <span
                      class="cb-kind"
                      :style="{ background: KIND[r.it.kind].bg, color: KIND[r.it.kind].color }"
                    >{{ KIND[r.it.kind].short }}</span>
                  </div>
                </div>
              </Teleport>
            </div>
            <ul v-if="noteItems.length" class="note-list">
              <li
                v-for="{ n, i } in noteItems"
                :key="n.at + i"
                class="note-item"
                :class="{ 'is-editing': editingIdx === i }"
              >
                <div class="ni-head">
                  <span class="ni-at"><i>🕘</i>{{ n.at || '—' }}</span>
                  <span
                    v-if="n.mastery"
                    class="ni-mastery"
                    :style="nmBadgeStyle(n)"
                    :title="n.mAt && n.mAt !== n.at ? `掌握程度设置于 ${n.mAt}` : ''"
                  >{{ nmInfo(n).stars }} {{ nmInfo(n).label }}</span>
                  <span class="ni-ops">
                    <button
                      type="button"
                      class="ni-detail"
                      :class="{ 'is-on': noteOpen[i] }"
                      :title="noteOpen[i] ? '收起笔记详情' : '查看笔记详情（完整 Markdown）'"
                      @click="toggleNoteOpen(i)"
                    >{{ noteOpen[i] ? '收起' : '详情' }}</button>
                    <button
                      type="button"
                      class="ni-edit"
                      title="编辑这条笔记（原文进入下方编辑器，修改保存后原内容进历史）"
                      @click="editingIdx === i ? cancelEditNote() : startEditNote(n)"
                    >{{ editingIdx === i ? '✕ 退出' : '✎ 编辑' }}</button>
                    <button
                      v-if="n.his && n.his.length"
                      type="button"
                      class="ni-his-btn"
                      :class="{ 'is-on': hisOpen[i] }"
                      :title="`查看修改记录（${n.his.length} 次）`"
                      @click="toggleHis(i)"
                    >↺ {{ n.his.length }}</button>
                    <button
                      type="button"
                      class="ni-del"
                      title="删除这条笔记"
                      @click="onDelNote(i)"
                    >×</button>
                  </span>
                </div>
                <div v-if="n.scope && n.scope.length" class="ni-scope-row">
                  <span
                    v-for="s in n.scope"
                    :key="s"
                    class="ni-scope"
                    :style="scopeStyle(s)"
                  >{{ s }}</span>
                </div>
                <div
                  v-if="noteOpen[i]"
                  class="ni-text md-body"
                  v-html="noteHtml(n.text)"
                  @click="onNoteBodyClick"
                ></div>
                <p
                  v-else
                  class="ni-preview"
                  title="点击查看笔记详情"
                  @click="toggleNoteOpen(i)"
                >{{ notePreview(n.text) }}</p>
                <div v-if="editingIdx === i" class="ni-editing-tip">正在编辑：内容已载入上方编辑器</div>
                <div v-if="(n.his && n.his.length && hisOpen[i]) || false" class="ni-his">
                  <div class="ni-his-title">修改记录（{{ n.his.length }}）</div>
                  <div v-for="(h, hi) in [...n.his].reverse()" :key="hi" class="ni-his-item">
                    <div class="ni-his-meta">
                      <span class="ni-his-at"><i>🕘</i>{{ h.at }} 修改前</span>
                      <span
                        v-if="h.mastery"
                        class="ni-mastery"
                        :style="nmBadgeStyle(h)"
                      >{{ masteryOf(h.mastery.level).stars }} {{ masteryOf(h.mastery.level).label }}</span>
                      <span
                        v-for="s in (h.scope || [])"
                        :key="s"
                        class="ni-scope is-small"
                        :style="scopeStyle(s)"
                      >{{ s }}</span>
                    </div>
                    <div class="ni-his-text md-body" v-html="noteHtml(h.text)" @click="onNoteBodyClick"></div>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="note-empty">还没有笔记，写下第一条吧</p>
          </div>
        </section>

        <KindLegend :counts="counts" :active="kindFilter" @toggle="toggleFilter" />

        <section v-if="dfdFig" class="sec sec-dfd">
          <div class="sec-head">
            <span class="sec-ico">图</span>
            <span class="sec-title">数据流向图</span>
            <em>DFD</em>
            <span class="sec-n">{{ dfdFig }}</span>
          </div>
          <div class="sec-bd">
            <button
              type="button"
              class="dfd-box"
              :title="`${dfdFig} ${state.active} 数据流向图（点击页内预览）`"
              @click="dfdOpen = true"
            >
              <img :src="dfdSrc" :alt="`${state.active} 数据流向图 ${dfdFig}`" loading="lazy" />
              <span class="dfd-zoom-hint">⤢ 点击预览</span>
            </button>
          </div>
        </section>

        <section class="sec sec-in">
          <div class="sec-head">
            <span class="sec-ico">入</span>
            <span class="sec-title">关键输入</span>
            <em>INPUTS</em>
            <span class="sec-n">{{ ins.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="sec-inset">
          <div class="chips">
            <ArtifactChip
              v-for="(n, i) in ins"
              :key="n"
              :name="n"
              dir="in"
              :removable="state.editing"
              :movable="state.editing"
              :first="state.editing && i === 0"
              :last="state.editing && i === ins.length - 1"
              :dim="dimmed(n)"
              :focus="focused(n)"
              :clickable="!state.editing"
              @remove="requestDelInput(state.active, n)"
              @move="moveArtifact(state.active, 'in', n, $event)"
            />
            <span v-if="!ins.length" class="empty-note">暂无输入项</span>
          </div>
          <div v-if="state.editing" class="adder">
            <FuzzyCombobox
              v-model="inQ"
              :items="artifactItems"
              allow-free
              placeholder="搜索已有项，或直接输入新建"
              @pick="onPickIn"
              @free="onFreeIn"
            />
            <button type="button" class="add-btn" title="添加" @click="addInFromInput">+</button>
          </div>

          <button
            v-if="insGen.length"
            type="button"
            class="agg-bar agg-in"
            :class="{ 'is-open': genOpen }"
            @click="genOpen = !genOpen"
          >
            <span class="agg-arrow">{{ genOpen ? '▾' : '▸' }}</span>
            通用输入（环境与资产）
            <span class="agg-n">{{ insGen.length }}</span>
            <span class="agg-hint">{{ genOpen ? '点击收起' : '点击展开' }}</span>
          </button>
          <div v-if="genOpen" class="chips agg-detail">
            <ArtifactChip
              v-for="n in insGen"
              :key="'g' + n"
              :name="n"
              dir="in"
              :dim="dimmed(n)"
              :focus="focused(n)"
              clickable
            />
          </div>
          </div>
          </div>
        </section>

        <section v-if="tools.length" class="sec sec-tool">
          <div class="sec-head">
            <span class="sec-ico">工</span>
            <span class="sec-title">工具与技术</span>
            <em>TOOLS</em>
            <span class="sec-n">{{ tools.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="sec-inset">
          <div class="tool-list">
            <div v-for="n in tools" :key="'t' + n" class="tool-item">
              <span class="tool-name">{{ n }}</span>
              <ul v-if="toolsDetail[n] && toolsDetail[n].length" class="upd-detail">
                <li v-for="d in toolsDetail[n]" :key="d">{{ d }}</li>
              </ul>
            </div>
          </div>
          </div>
          </div>
        </section>

        <section class="sec sec-out">
          <div class="sec-head">
            <span class="sec-ico">出</span>
            <span class="sec-title">关键输出</span>
            <em>OUTPUTS</em>
            <span class="sec-n">{{ outs.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="sec-inset">
          <div class="chips">
            <ArtifactChip
              v-for="(n, i) in outs"
              :key="n"
              :name="n"
              dir="out"
              :removable="state.editing"
              :movable="state.editing"
              :first="state.editing && i === 0"
              :last="state.editing && i === outs.length - 1"
              :dim="dimmed(n)"
              :focus="focused(n)"
              clickable
              @remove="requestDelOutput(state.active, n)"
              @move="moveArtifact(state.active, 'out', n, $event)"
            />
            <span v-if="!outs.length" class="empty-note">暂无输出项</span>
          </div>
          <div v-if="state.editing" class="adder">
            <FuzzyCombobox
              v-model="outQ"
              :items="artifactItems"
              placeholder="搜索并选择已有项（不可自建）"
              empty-text="无匹配项 · 输出只能从已有项中选择"
              @pick="onPickOut"
            />
          </div>

          <button
            v-if="outsUpd.length"
            type="button"
            class="agg-bar agg-out"
            :class="{ 'is-open': updOpen }"
            @click="updOpen = !updOpen"
          >
            <span class="agg-arrow">{{ updOpen ? '▾' : '▸' }}</span>
            受控更新（计划 / 文件 / 资产更新）
            <span class="agg-n">{{ updItemCount }}</span>
            <span class="agg-hint">{{ updOpen ? '点击收起' : '点击展开' }}</span>
          </button>
          <div v-if="updOpen" class="upd-list">
            <div v-for="n in outsUpd" :key="'u' + n" class="upd-item">
              <ArtifactChip :name="n" dir="out" :dim="dimmed(n)" :focus="focused(n)" clickable />
              <ul v-if="updDetail[n] && updDetail[n].length" class="upd-detail">
                <li v-for="d in updDetail[n]" :key="d">{{ d }}</li>
              </ul>
            </div>
          </div>
          </div>
          </div>
        </section>

        <section class="sec sec-up">
          <div class="sec-head">
            <span class="sec-ico">源</span>
            <span class="sec-title">上游来源</span>
            <em>INCOMING</em>
            <span class="sec-n">{{ inEdges.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="sec-inset">
          <div class="flow">
            <button
              v-for="(e, i) in inEdges"
              :key="'u' + e.join('|')"
              type="button"
              class="flow-item"
              @click="goto(e[0])"
            >
              <span class="fi-proc">{{ e[0] }}</span>
              <span class="fi-arw">→</span>
              <span class="fi-art" :style="{ color: kindOf(e[2]).color }">{{ e[2] }}</span>
              <template v-if="state.editing">
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === 0 }"
                  title="上移"
                  @click.stop="moveEdge(e, -1, inEdges)"
                >↑</span>
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === inEdges.length - 1 }"
                  title="下移"
                  @click.stop="moveEdge(e, 1, inEdges)"
                >↓</span>
                <span
                  class="fi-del"
                  title="删除该上游关系"
                  @click.stop="delEdge(e[0], state.active, e[2])"
                >×</span>
              </template>
            </button>
            <div v-if="!inEdges.length" class="empty-note">暂无标注的上游来源</div>
          </div>
          <div v-if="state.editing" class="adder stack">
            <FuzzyCombobox
              v-model="upProcQ"
              :items="procItems"
              placeholder="① 搜索来源过程"
              @pick="onPickUpProc"
            />
            <FuzzyCombobox
              ref="upArtRef"
              v-model="upArtQ"
              :items="upArtItems"
              :disabled="!upFrom"
              :placeholder="upFrom ? `② 选「${upFrom}」产出的交付物` : '② 先选来源过程'"
              empty-text="该过程还没有输出项"
              @pick="onPickUpArt"
            />
          </div>
          </div>
          </div>
        </section>

        <section class="sec sec-down">
          <div class="sec-head">
            <span class="sec-ico">去</span>
            <span class="sec-title">下游去向</span>
            <em>OUTGOING</em>
            <span class="sec-n">{{ outEdges.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="sec-inset">
          <div class="flow">
            <button
              v-for="(e, i) in outEdges"
              :key="'d' + e.join('|')"
              type="button"
              class="flow-item"
              @click="goto(e[1])"
            >
              <span class="fi-art" :style="{ color: kindOf(e[2]).color }">{{ e[2] }}</span>
              <span class="fi-arw">→</span>
              <span class="fi-proc">{{ e[1] }}</span>
              <template v-if="state.editing">
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === 0 }"
                  title="上移"
                  @click.stop="moveEdge(e, -1, outEdges)"
                >↑</span>
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === outEdges.length - 1 }"
                  title="下移"
                  @click.stop="moveEdge(e, 1, outEdges)"
                >↓</span>
                <span
                  class="fi-del"
                  title="删除该下游关系"
                  @click.stop="delEdge(state.active, e[1], e[2])"
                >×</span>
              </template>
            </button>
            <div v-if="!outEdges.length" class="empty-note">暂无标注的下游去向</div>
          </div>
          <div v-if="state.editing" class="adder stack">
            <FuzzyCombobox
              v-model="downProcQ"
              :items="procItems"
              placeholder="① 搜索去向过程"
              @pick="onPickDownProc"
            />
            <FuzzyCombobox
              ref="downArtRef"
              v-model="downArtQ"
              :items="downArtItems"
              :disabled="!downTo"
              :placeholder="downTo ? '② 选本过程产出的交付物' : '② 先选去向过程'"
              empty-text="本过程还没有输出项"
              @pick="onPickDownArt"
            />
          </div>
          </div>
          </div>
        </section>

        <section class="sec sec-chg">
          <div class="sec-head">
            <span class="sec-ico">变</span>
            <span class="sec-title">变更控制</span>
            <em>CHANGE</em>
          </div>
          <div class="sec-bd">
          <div class="chgbox">
            <p v-if="isCCB">
              本过程就是<b style="color: #b91c1c">变更闸门</b>：所有变更请求在此
              <b>记录 → 评估影响 → CCB 审批</b>，通过后才允许修订组件与项目文件，
              并把<b>批准的变更请求</b>发回执行、质量控制与采购过程落地。
            </p>
            <p v-else>
              本过程输出中有 <b style="color: #4338ca">{{ planOutCount }} 个计划组件 / 基准</b>、
              <b style="color: #0e7490">{{ docOutCount }} 个项目文件</b>。
              它们都是<b>受控对象</b> —— 要改必须先提交变更请求，经「实施整体变更控制」由 CCB 批准，
              不能在本过程里直接改。
            </p>
            <div class="chgmini">
              <span
                v-for="(s, i) in CHG_STEPS"
                :key="i"
                :class="{ 'is-on': stepOn[i] }"
              >{{ s.n }} {{ s.t.replace('变更请求', '变更') }}</span>
            </div>
            <button type="button" class="btn tiny" @click="goChange">在矩阵中查看变更闭环 →</button>
          </div>
          </div>
        </section>

        <div class="tipbox">
          <b>怎么读：</b>绿色线＝谁给了我输入；蓝色线＝我的输出去了哪；虚线＝计划 / 基准 / 绩效这类通用流转。<br />
          编辑只改动这份图谱的数据，不影响过程编号与分组；改动会实时同步到后端 JSON 文件。
        </div>
      </div>
    </div>

    <div v-else class="drawer-placeholder">
      <div class="dp-icon">◎</div>
      <b>点任意过程查看详情</b>
      <span>输入 / 输出、上下游来源去向、变更影响面都在这里</span>
    </div>

    <EditConfirmModal
      :open="!!confirm"
      :title="confirm?.title"
      :summary="confirm?.summary"
      :broken-edges="confirm?.brokenEdges || []"
      :orphans="confirm?.orphans || []"
      :producers="confirm?.producers || []"
      :consumers="confirm?.consumers || []"
      :link-art="confirm?.linkArt || ''"
      :confirm-text="confirm?.confirmText"
      @confirm="onConfirm"
      @cancel="closeConfirm"
    />

    <!-- DFD 页内灯箱预览：不跳新窗口，Esc / 点遮罩 / × 关闭，点图切换缩放 -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="dfdOpen" class="dfd-mask" @click.self="dfdOpen = false">
          <div class="dfd-lightbox" role="dialog" aria-modal="true">
            <div class="dfd-lb-head">
              <span class="dfd-lb-fig">{{ dfdFig }}</span>
              <b>{{ state.active }} 数据流向图</b>
              <span class="dfd-lb-hint">{{ dfdZoom ? '点击图适应宽度 · 滚动条平移' : '点击图放大到原始尺寸' }}</span>
              <button type="button" class="dfd-lb-x" title="关闭（Esc）" @click="dfdOpen = false">×</button>
            </div>
            <div class="dfd-lb-body" :class="{ 'is-zoom': dfdZoom }" @click="dfdZoom = !dfdZoom">
              <img :src="dfdSrc" :alt="`${state.active} 数据流向图 ${dfdFig}`" />
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </aside>
</template>