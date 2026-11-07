<script setup>
import { computed } from 'vue'
import { EDGE_PALETTE, EDGE_STYLE } from '../lib/constants'

const props = defineProps({
  edge: { type: Object, required: true },
  animate: { type: Boolean, default: true },
  sel: { type: Boolean, default: false },
})

const emit = defineEmits(['pick'])

/* 统一箭头：尺寸、形状、留白完全一致，不随线型变化 */
const ARROW = 'M0,0 L-9,-3.6 L-9,3.6 Z'

const palette = computed(() => EDGE_PALETTE[props.edge.colorKey] || EDGE_PALETTE.in)
const style = computed(() => EDGE_STYLE[props.edge.kind] || EDGE_STYLE.main)
const isSoft = computed(() => props.edge.kind === 'plan' || props.edge.kind === 'perf' || props.edge.kind === 'data')

</script>

<template>
  <g
    class="edge"
    :class="[`edge-${edge.kind}`, { 'is-soft': isSoft, 'is-sel': sel, 'is-dim-edge': edge.dim, 'is-hi-edge': edge.hi }]"
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
      class="edge-base"
      :d="edge.d"
      :stroke="palette.stroke"
      :stroke-width="style.width"
      :stroke-dasharray="style.dash || undefined"
      :opacity="style.opacity"
      fill="none"
      stroke-linecap="round"
    />
    <path
      v-if="animate"
      class="edge-flow"
      :d="edge.d"
      :stroke="palette.flow"
      stroke-width="2.8"
      fill="none"
      stroke-linecap="round"
      stroke-dasharray="6 26"
    />
    <path
      class="edge-arrow"
      :d="ARROW"
      :fill="palette.stroke"
      :transform="`translate(${edge.end.x} ${edge.end.y}) rotate(${edge.end.deg})`"
    />
  </g>
</template>