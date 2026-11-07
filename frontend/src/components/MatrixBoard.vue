<script setup>
import { computed, provide, ref } from 'vue'
import ProcessCard from './ProcessCard.vue'
import EdgeLayer from './EdgeLayer.vue'
import { CHG_EDGES, CHG_MARK, CHG_STEPS, GOLDEN, GROUPS } from '../lib/constants'
import {
  activeNeighbors,
  domainColor,
  domainEn,
  domainRows,
  phaseCounts,
  searchState,
  select,
  state,
} from '../store/itto'

const gridEl = ref(null)
provide('gridEl', gridEl)

const rows = domainRows
const neighbors = activeNeighbors

const goldenNodes = computed(() => {
  const s = new Set()
  for (const [a, b] of GOLDEN) {
    s.add(a)
    s.add(b)
  }
  return s
})

const stepNodes = computed(() => new Set(CHG_STEPS[state.changeStep]?.procs || []))

/* 同格竖线过滤：计划/绩效/文件类细流在格内是冗余信息，不画；
 * 主交付物（main）与变更（change）的同格关系保留 —— 走卡片右侧通道绕行，避免信息丢失 */
function skipSameCell(e) {
  const a = state.procs[e[0]]
  const b = state.procs[e[1]]
  if (!a || !b || a.dom !== b.dom || a.phase !== b.phase) return false
  const k = e[3] || 'main'
  return k !== 'main' && k !== 'change'
}

/* 当前要画的线：先按模式取子集，再交给 EdgeLayer 聚合成「一条线」 */
const pairs = computed(() => {
  if (state.mode === 'golden') {
    const out = []
    const seen = new Set()
    for (const [f, t] of GOLDEN) {
      const key = f + '\u0001' + t
      if (seen.has(key)) continue
      seen.add(key)
      const arts = state.edges.filter((e) => e[0] === f && e[1] === t).map((e) => e[2])
      out.push({
        key,
        from: f,
        to: t,
        arts: (arts.length ? arts : ['']).map((n) => ({ name: n, kind: 'main' })),
        kinds: ['main'],
      })
    }
    return out
  }

  if (state.mode === 'change') {
    const map = new Map()
    for (const [f, t, art, kind] of CHG_EDGES) {
      if (skipSameCell([f, t, art, kind])) continue
      const key = f + '\u0001' + t
      let g = map.get(key)
      if (!g) {
        g = { key, from: f, to: t, arts: [], kinds: [] }
        map.set(key, g)
      }
      g.arts.push({ name: art, kind })
      g.kinds.push(kind)
    }
    return [...map.values()]
  }

  if (!state.active) return []
  const src = state.edges.filter((e) => {
    if (e[0] !== state.active && e[1] !== state.active) return false
    if (skipSameCell(e)) return false
    const k = e[3] || 'main'
    if (!state.edgeKinds[k]) return false
    return true
  })
  const map = new Map()
  for (const e of src) {
    const key = e[0] + '\u0001' + e[1]
    let g = map.get(key)
    if (!g) {
      g = { key, from: e[0], to: e[1], arts: [], kinds: [] }
      map.set(key, g)
    }
    const art = e[2]
    const kind = e[3] || 'main'
    if (!g.arts.some((a) => a.name === art)) g.arts.push({ name: art, kind })
    if (!g.kinds.includes(kind)) g.kinds.push(kind)
  }
  return [...map.values()]
})

function flags(p) {
  const id = p.id
  const isActive = state.active === id
  let up = neighbors.value.up.has(id)
  let down = neighbors.value.down.has(id)
  const hit = searchState.value.active && searchState.value.procs.has(id)
  /* 变更闭环模式用红色主题表达关系，不用全局上下游绿蓝配色 */
  if (state.mode === 'change') {
    up = false
    down = false
  }

  let dim = false
  let mute = false
  if (state.mode === 'golden') {
    dim = !goldenNodes.value.has(id)
  } else if (state.mode === 'change') {
    mute = !stepNodes.value.has(id) && !isActive
  } else if (searchState.value.active) {
    dim = !hit
  } else if (state.active && state.focusDep) {
    dim = !isActive && !up && !down
  }

  return {
    active: isActive,
    up,
    down,
    gold: state.mode === 'golden' && goldenNodes.value.has(id),
    hit,
    dim,
    mute,
    badge: state.mode === 'change' ? CHG_MARK[id] || '' : '',
    edited: !!state.edited[id],
  }
}
</script>

<template>
  <div class="board">
    <div ref="gridEl" class="grid">
      <div class="corner">
        <span class="corner-t">知识领域</span>
        <span class="corner-s">过程组 →</span>
      </div>

      <div v-for="g in GROUPS" :key="g" class="col-head">
        <span class="ch-name">{{ g }}</span>
        <span class="ch-count">{{ phaseCounts[g] }}</span>
      </div>

      <template v-for="row in rows" :key="row.name">
        <div class="row-head" :style="{ '--dc': domainColor(row.name) }">
          <span class="rh-bar"></span>
          <span class="rh-name">{{ row.name }}</span>
          <span class="rh-en">{{ domainEn(row.name) }}</span>
        </div>

        <div
          v-for="g in GROUPS"
          :key="g"
          class="cell"
          :class="{ 'is-empty': !row.cells[g] || !row.cells[g].length }"
        >
          <template v-if="row.cells[g] && row.cells[g].length">
            <ProcessCard
              v-for="p in row.cells[g]"
              :key="p.id"
              v-bind="flags(p)"
              :proc="p"
              @pick="select"
            />
          </template>
          <span v-else class="cell-none">—</span>
        </div>
      </template>
    </div>

    <EdgeLayer
      :pairs="pairs"
      :mode="state.mode"
      :active="state.active"
      :animate="state.animate"
    />
  </div>
</template>