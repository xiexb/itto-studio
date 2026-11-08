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
  openDomain,
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

/* 黄金链路模式下当前点选的过程（最近一次点击），其余点选过的过程用浅色高亮 */
const goldCurrent = computed(() => state.goldPeek[state.goldPeek.length - 1] || null)

/* 闭环设计涉及的全部过程：这些过程在变更闭环模式下正常显示，不淡化 */
const loopNodes = computed(() => {
  const s = new Set()
  for (const st of CHG_STEPS) for (const p of st.procs) s.add(p)
  return s
})

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
    /* 点选的过程：在链路基础上叠加它们的主要输入输出；
     * 最近点选的过程是「当前」，更早点选的保留但连线压淡，再点同一个过程取消 */
    const peekIds = state.goldPeek
    if (peekIds.length) {
      const cur = peekIds[peekIds.length - 1]
      const map = new Map()
      for (const peek of peekIds) {
        for (const e of state.edges) {
          if (e[0] !== peek && e[1] !== peek) continue
          if ((e[3] || 'main') !== 'main') continue
          const key = e[0] + '\u0001' + e[1]
          if (seen.has(key)) continue // 该关系已在黄金链路上
          let g = map.get(key)
          if (!g) {
            g = { key, from: e[0], to: e[1], arts: [], kinds: ['main'], overlay: true, peekOf: peek }
            map.set(key, g)
          }
          if (!g.arts.some((a) => a.name === e[2])) g.arts.push({ name: e[2], kind: 'main' })
        }
      }
      for (const g of map.values()) {
        /* 不属于当前点选过程的叠加线压淡，与当前点击区分 */
        g.faint = g.from !== cur && g.to !== cur
      }
      out.push(...map.values())
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

  /* 纯净模式：与黄金链路一致，显示所有点选过程的关系；
   * 当前点选过程的线清晰，先前点选过程的线压淡 */
  const picks = state.cleanPicks
  if (!picks.length) return []
  const cur = state.active
  const map = new Map()
  for (const pick of picks) {
    for (const e of state.edges) {
      if (e[0] !== pick && e[1] !== pick) continue
      if (skipSameCell(e)) continue
      const kind = e[3] || 'main'
      if (!state.edgeKinds[kind]) continue
      const key = e[0] + '\u0001' + e[1]
      let g = map.get(key)
      if (!g) {
        g = { key, from: e[0], to: e[1], arts: [], kinds: [], peekOf: pick }
        map.set(key, g)
      }
      if (!g.arts.some((a) => a.name === e[2])) g.arts.push({ name: e[2], kind })
      if (!g.kinds.includes(kind)) g.kinds.push(kind)
    }
  }
  for (const g of map.values()) g.faint = g.from !== cur && g.to !== cur
  return [...map.values()]
})

function flags(p) {
  const id = p.id
  /* 黄金链路模式下点选过的过程：当前点击用选中态高亮，之前点击的用浅色高亮区分 */
  const isPeek = state.mode === 'golden' && goldCurrent.value === id
  const isPrevPeek = state.mode === 'golden' && !isPeek && state.goldPeek.includes(id)
  /* 纯净模式下先前点选过的过程：同样用浅色高亮，当前选中过程仍是 active */
  const isPrevPick = state.mode === 'clean' && state.active !== id && state.cleanPicks.includes(id)
  const isActive = state.active === id || isPeek
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
    /* 不在链路上的过程也正常显示，不淡化 */
    dim = false
  } else if (state.mode === 'change') {
    /* 只淡化与闭环无关的过程；闭环内的过程一律正常显示，当前步骤改用红色描边标出 */
    mute = !loopNodes.value.has(id) && !isActive
  } else if (searchState.value.active) {
    dim = !hit
  } else if (state.active && state.focusDep) {
    /* 先前点选过的过程保留浅色高亮，不被完全压暗 */
    dim = !isActive && !up && !down && !isPrevPick
  }

  return {
    active: isActive,
    prev: isPrevPeek || isPrevPick,
    up,
    down,
    gold: state.mode === 'golden' && goldenNodes.value.has(id),
    hit,
    step: state.mode === 'change' && stepNodes.value.has(id),
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
        <div
          class="row-head rh-click"
          :style="{ '--dc': domainColor(row.name) }"
          role="button"
          tabindex="0"
          :title="`查看「${row.name}」的定义与作用（教程原文，可编辑）`"
          @click="openDomain(row.name)"
          @keydown.enter.prevent="openDomain(row.name)"
          @keydown.space.prevent="openDomain(row.name)"
        >
          <span class="rh-bar"></span>
          <span class="rh-name">{{ row.name }}</span>
          <span class="rh-en">{{ domainEn(row.name) }}</span>
          <span class="rh-go" aria-hidden="true">定义/作用 ›</span>
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
      :active="state.mode === 'golden' ? goldCurrent : state.active"
      :animate="state.animate"
    />
  </div>
</template>