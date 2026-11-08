<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { EDGE_PALETTE, EDGE_STYLE } from '../lib/constants'

const props = defineProps({
  edge: { type: Object, required: true },
  animate: { type: Boolean, default: true },
  sel: { type: Boolean, default: false },
})

const emit = defineEmits(['pick'])

/* 统一箭头：尺寸、形状、留白完全一致，不随线型变化 */
const ARROW = 'M0,0 L-9,-3.6 L-9,3.6 Z'
/* 主交付物流转箭头：沿线滑动的开口箭簇（chevron），比光点醒目得多 */
const RUNNER = 'M-7,-5.5 L7,0 L-7,5.5'

const palette = computed(() => EDGE_PALETTE[props.edge.colorKey] || EDGE_PALETTE.in)
const style = computed(() => EDGE_STYLE[props.edge.kind] || EDGE_STYLE.main)
const isSoft = computed(() => props.edge.kind === 'plan' || props.edge.kind === 'perf' || props.edge.kind === 'data')
const isMain = computed(() => props.edge.kind === 'main')

/* 让箭簇匀速滑动：按路径实际长度换算动画时长（约 150px/s），
 * 并用边 key 的散列给每条线一个固定负延迟，错开节奏避免齐步走 */
const baseEl = ref(null)
const dur = ref(2)

function updateDur() {
  const el = baseEl.value
  if (!el || typeof el.getTotalLength !== 'function') return
  let len = 0
  try {
    len = el.getTotalLength()
  } catch (e) {
    return
  }
  if (len > 0) dur.value = Math.min(4.5, Math.max(1.2, len / 150))
}

function hashOf(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const runnerStyle = computed(() => {
  const d = dur.value
  const delay = -((hashOf(props.edge.key) % 100) / 100) * d
  return {
    offsetPath: `path('${props.edge.d}')`,
    animationDuration: d.toFixed(2) + 's',
    animationDelay: delay.toFixed(2) + 's',
  }
})

onMounted(updateDur)
watch(() => props.edge.d, () => nextTick(updateDur))
</script>

<template>
  <g
    class="edge"
    :class="[`edge-${edge.kind}`, { 'is-soft': isSoft, 'is-sel': sel, 'is-dim-edge': edge.dim, 'is-hi-edge': edge.hi, 'is-faint-edge': edge.faint }]"
    @click.stop="emit('pick', edge, $event)"
  >
    <path
      class="edge-halo"
      :d="edge.d"
      :stroke="palette.stroke"
      stroke-width="8"
      fill="none"
      opacity="0.07"
    />
    <path class="edge-hit" :d="edge.d" :data-ekey="edge.key" />
    <path
      ref="baseEl"
      class="edge-base"
      :d="edge.d"
      :stroke="palette.stroke"
      :stroke-width="style.width"
      :stroke-dasharray="style.dash || undefined"
      :opacity="style.opacity"
      fill="none"
      stroke-linecap="round"
    />
    <!-- 细流（计划/绩效/文件/变更）保留原光点动画 -->
    <path
      v-if="animate && !isMain"
      class="edge-flow"
      :d="edge.d"
      :stroke="palette.flow"
      stroke-width="2.8"
      fill="none"
      stroke-linecap="round"
      stroke-dasharray="6 26"
    />
    <!-- 主交付物：箭簇沿数据流方向滑动 -->
    <path
      v-if="animate && isMain"
      class="edge-runner"
      :d="RUNNER"
      :stroke="palette.stroke"
      stroke-width="3"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
      :style="runnerStyle"
    />
    <path
      class="edge-arrow"
      :d="ARROW"
      :fill="palette.stroke"
      :transform="`translate(${edge.end.x} ${edge.end.y}) rotate(${edge.end.deg})`"
    />
  </g>
</template>
