<script setup>
import { computed, ref } from 'vue'
import { fuzzyMatch, highlightParts } from '../lib/fuzzy'
import { EDGE_KIND_COLORS, EDGE_STYLE, KIND } from '../lib/constants'
import { classify } from '../lib/kind'
import {
  artifactPool,
  exportDataset,
  importDataset,
  procList,
  resetDataset,
  saveNow,
  searchState,
  setMode,
  state,
} from '../store/itto'

const fileEl = ref(null)
const showSuggest = ref(false)

/* 连线类型多选项：key 与 edgeRouter 的 kind 一致；
 * 色样直接取 EDGE_KIND_COLORS 的 输入/输出 双色，与画布连线同源 */
const EDGE_KINDS = Object.entries(EDGE_KIND_COLORS).map(([key, c]) => ({
  key,
  label: c.label,
  color: c.color,
  in: c.in,
  out: c.out,
  bg: EDGE_STYLE[key]?.bg || 'rgba(15,23,42,.07)',
}))

const hitCount = computed(() => searchState.value.procs.size)

const suggestions = computed(() => {
  const q = state.query.trim()
  if (!q) return []
  const arr = []
  for (const a of artifactPool.value) {
    const m = fuzzyMatch(q, a.name)
    if (m.ok) arr.push({ name: a.name, idx: m.idx, score: m.score, kind: classify(a.name) })
  }
  arr.sort((a, b) => b.score - a.score)
  return arr.slice(0, 8)
})

function parts(text, idx) {
  return highlightParts(text, idx)
}

function pickSuggest(name) {
  state.query = name
  showSuggest.value = false
}

function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (f) importDataset(f)
  e.target.value = ''
}

async function onReset() {
  if (!window.confirm('确定把数据还原为内置的 PMBOK 原始版本吗？当前数据会在服务端自动备份。')) return
  await resetDataset()
}

const statusInfo = computed(() => {
  if (state.status === 'offline') {
    return { cls: 'is-offline', text: '本地模式 · 后端未连接', sub: '改动保存在浏览器，连接后端后可恢复落盘' }
  }
  if (state.saveState === 'saving') return { cls: 'is-saving', text: '保存中…', sub: state.meta.dataFile }
  if (state.saveState === 'pending') return { cls: 'is-saving', text: '待保存…', sub: state.meta.dataFile }
  const t = state.meta.updatedAt || ''
  const hm = t.includes(' ') ? t.split(' ')[1] : t
  return { cls: 'is-ok', text: `已同步 ${hm || ''}`.trim(), sub: state.meta.dataFile }
})

const tabs = [
  { key: 'clean', label: '纯净矩阵', hint: '点过程展开关系 · 再点收起' },
  { key: 'golden', label: '黄金链路', hint: '案例题主干 · 点任意过程叠加其主要输入输出' },
  { key: 'change', label: '变更闭环', hint: '六步 + 影响面' },
]
</script>

<template>
  <header class="topbar">
    <div class="tb-row">
      <div class="brand">
        <div class="brand-logo">ITTO</div>
        <div class="brand-text">
          <h1>49 过程关系图谱<span>PMBOK 第 6 版 · 按第 4 版教程校对</span></h1>
          <div class="brand-meta">
            10 大知识领域 · 5 大过程组 · {{ procList.length }} 个过程 · {{ state.edges.length }} 条关系
          </div>
        </div>
      </div>

      <div class="tb-actions">
        <div class="status" :class="statusInfo.cls" :title="statusInfo.sub">
          <span class="dot"></span>
          <span>{{ statusInfo.text }}</span>
        </div>
        <button type="button" class="btn" @click="saveNow">保存</button>
        <button type="button" class="btn" @click="exportDataset">导出</button>
        <button type="button" class="btn" @click="fileEl.click()">导入</button>
        <button type="button" class="btn danger" @click="onReset">还原</button>
        <input ref="fileEl" type="file" accept=".json,application/json" hidden @change="onFile" />
      </div>
    </div>

    <div class="tb-row tb-row-2">
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="tab"
          :class="{ 'is-on': state.mode === t.key }"
          :title="t.hint"
          @click="setMode(t.key)"
        >{{ t.label }}</button>
      </div>

      <div class="search-wrap">
        <div class="search">
          <span class="search-icon">⌕</span>
          <input
            v-model="state.query"
            type="text"
            placeholder="搜过程 / 交付物：WBS、风险登记册、变更请求…"
            @focus="showSuggest = true"
            @input="showSuggest = true"
          />
          <span v-if="state.query" class="search-hit">{{ hitCount }} 个过程</span>
          <button v-if="state.query" type="button" class="search-clear" @click="state.query = ''">×</button>
        </div>
        <div v-if="showSuggest && suggestions.length" class="suggest">
          <div class="suggest-head">交付物候选</div>
          <button
            v-for="s in suggestions"
            :key="s.name"
            type="button"
            class="suggest-item"
            @mousedown.prevent="pickSuggest(s.name)"
          >
            <span class="si-name">
              <template v-for="(p, i) in parts(s.name, s.idx)" :key="i">
                <b v-if="p.hit">{{ p.ch }}</b>
                <span v-else>{{ p.ch }}</span>
              </template>
            </span>
            <span class="si-kind" :style="{ background: KIND[s.kind].bg, color: KIND[s.kind].color }">
              {{ KIND[s.kind].short }}
            </span>
          </button>
        </div>
      </div>

      <div class="switches">
        <div class="kind-filter" title="勾选要显示的连线类型；色样 = 输入深色 / 输出亮色，与连线实际颜色一致">
          <button
            v-for="k in EDGE_KINDS"
            :key="k.key"
            type="button"
            class="kf-chip"
            :class="{ 'is-on': state.edgeKinds[k.key] }"
            :style="state.edgeKinds[k.key] ? { '--kc': k.color, '--kb': k.bg, '--kin': k.in, '--kout': k.out } : null"
            @click="state.edgeKinds[k.key] = !state.edgeKinds[k.key]"
          >
            <span class="kf-line" :class="'kf-' + k.key"></span>{{ k.label }}
          </button>
        </div>
        <label class="sw" title="只保留与当前过程有关联的卡片，其余淡化">
          <input v-model="state.focusDep" type="checkbox" />
          <span>聚焦依赖</span>
        </label>
        <label class="sw" title="主交付物用箭簇、细流用光点，沿数据流方向流动">
          <input v-model="state.animate" type="checkbox" />
          <span>流向动画</span>
        </label>
      </div>
    </div>
  </header>
</template>