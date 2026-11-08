<script setup>
import { computed } from 'vue'

const props = defineProps({
  proc: { type: Object, required: true },
  active: Boolean,
  prev: Boolean,
  up: Boolean,
  down: Boolean,
  gold: Boolean,
  hit: Boolean,
  step: Boolean,
  dim: Boolean,
  mute: Boolean,
  badge: { type: String, default: '' },
  edited: Boolean,
})

defineEmits(['pick'])

const both = computed(() => props.up && props.down)

const cls = computed(() => ({
  'is-active': props.active,
  'is-prev': props.prev && !props.active,
  'is-up': !props.active && props.up && !props.down,
  'is-down': !props.active && props.down && !props.up,
  'is-both': !props.active && both.value,
  'is-gold': props.gold,
  'is-hit': props.hit && !props.active,
  'is-step': props.step && !props.active,
  'is-dim': props.dim,
  'is-mute': props.mute,
}))

const relIcon = computed(() => {
  if (props.active) return ''
  if (both.value) return '↕'
  if (props.up) return '↑'
  if (props.down) return '↓'
  return ''
})
</script>

<template>
  <button
    type="button"
    class="proc"
    :class="cls"
    :data-pid="proc.id"
    :title="`${proc.id} · ${proc.dom} · ${proc.phase}过程组`"
    @click="$emit('pick', proc.id)"
  >
    <span class="proc-idx">{{ String(proc.idx).padStart(2, '0') }}</span>
    <span class="proc-name">{{ proc.id }}</span>
    <span v-if="relIcon" class="proc-rel">{{ relIcon }}</span>
    <span v-if="edited" class="proc-dot" title="此过程的数据被修改过"></span>
    <span v-if="badge" class="proc-badge">{{ badge }}</span>
  </button>
</template>