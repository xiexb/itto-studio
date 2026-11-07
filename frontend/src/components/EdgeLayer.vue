<script setup>
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DependencyEdge from './DependencyEdge.vue'
import { layoutEdges } from '../lib/edgeRouter'

const props = defineProps({
  pairs: { type: Array, default: () => [] },
  mode: { type: String, default: 'sel' },
  active: { type: String, default: null },
  animate: { type: Boolean, default: true },
})

const gridEl = inject('gridEl', ref(null))
const size = ref({ w: 0, h: 0 })
const renderEdges = ref([])
/* 已锁定的浮层：[{ key, from, to, arts, x, y, flip }] */
const pins = ref([])

let raf = 0
let ro = null

function measure() {
  const grid = gridEl.value
  if (!grid) return
  const gr = grid.getBoundingClientRect()
  size.value = { w: Math.round(gr.width), h: Math.round(grid.offsetHeight) }

  const boxes = {}
  grid.querySelectorAll('[data-pid]').forEach((el) => {
    const r = el.getBoundingClientRect()
    const x = r.left - gr.left
    const y = r.top - gr.top
    boxes[el.dataset.pid] = {
      x,
      y,
      w: r.width,
      h: r.height,
      cx: x + r.width / 2,
      cy: y + r.height / 2,
    }
  })

  renderEdges.value = layoutEdges(props.pairs, boxes, { mode: props.mode, active: props.active })

  /* 关系消失（切换模式 / 选中过程）时，同步移除对应的锁定浮层 */
  if (pins.value.length) {
    const keys = new Set(renderEdges.value.map((e) => e.key))
    pins.value = pins.value.filter((p) => keys.has(p.key))
  }
}

function schedule() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    measure()
  })
}

function isPinned(key) {
  return pins.value.some((p) => p.key === key)
}

/* 点击连线：未锁定则锁定（浮层停在点击位置），已锁定则解除 */
function onPick(edge, ev) {
  const i = pins.value.findIndex((p) => p.key === edge.key)
  if (i > -1) {
    pins.value.splice(i, 1)
    return
  }
  pins.value.push({
    key: edge.key,
    from: edge.from,
    to: edge.to,
    arts: edge.arts,
    x: ev.clientX,
    y: ev.clientY,
    flip: ev.clientY < 190,
  })
}

function unpin(key) {
  pins.value = pins.value.filter((p) => p.key !== key)
}

function clearPins() {
  pins.value = []
}

function onKey(e) {
  if (e.key === 'Escape') clearPins()
}

onMounted(() => {
  ro = new ResizeObserver(schedule)
  if (gridEl.value) ro.observe(gridEl.value)
  window.addEventListener('resize', schedule)
  window.addEventListener('keydown', onKey)
  /* 字体加载完成后卡片高度会变，补测一次 */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule)
  schedule()
})

onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('resize', schedule)
  window.removeEventListener('keydown', onKey)
  if (raf) cancelAnimationFrame(raf)
})

watch(
  () => [props.pairs, props.mode, props.active],
  () => schedule(),
  { deep: false },
)
</script>

<template>
  <svg
    class="edge-layer"
    :width="size.w"
    :height="size.h"
    :viewBox="`0 0 ${size.w} ${size.h}`"
  >
    <DependencyEdge
      v-for="e in renderEdges"
      :key="e.key"
      :edge="e"
      :animate="animate"
      :sel="isPinned(e.key)"
      @pick="onPick"
    />
  </svg>

  <Teleport to="body">
    <div
      v-for="p in pins"
      :key="p.key"
      class="edge-pop"
      :class="{ 'is-flip': p.flip }"
      :style="{ left: p.x + 'px', top: p.y + 'px' }"
    >
      <div class="ep-head">
        <span class="ep-flow">{{ p.from }} → {{ p.to }}</span>
        <button type="button" class="ep-close" title="解除锁定" @click="unpin(p.key)">×</button>
      </div>
      <div class="ep-arts">
        <span v-for="a in p.arts" :key="a.name" class="ep-art">{{ a.name }}</span>
      </div>
    </div>

    <button
      v-if="pins.length"
      type="button"
      class="edge-clear"
      title="取消所有锁定的连线浮层（Esc）"
      @click="clearPins"
    >
      ✕ 取消锁定（{{ pins.length }}）
    </button>
  </Teleport>
</template>
