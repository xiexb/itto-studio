<script setup>
import { computed } from 'vue'
import { KIND } from '../lib/constants'
import { classify } from '../lib/kind'
import { openArtifact } from '../store/itto'

const props = defineProps({
  name: { type: String, required: true },
  dir: { type: String, default: 'in' },
  removable: Boolean,
  movable: Boolean,
  first: Boolean,
  last: Boolean,
  small: Boolean,
  dim: Boolean,
  focus: Boolean,
  clickable: Boolean,
})

defineEmits(['remove', 'pick', 'move'])

const kind = computed(() => classify(props.name))
const meta = computed(() => KIND[kind.value])

const style = computed(() => {
  const m = meta.value
  if (props.dir === 'out') {
    return { background: m.bg, borderColor: m.bg, color: m.color, fontWeight: 600 }
  }
  return { background: '#fff', borderColor: m.bd, color: m.color }
})

function onChipClick() {
  if (props.clickable) openArtifact(props.name)
}
</script>

<template>
  <span
    class="chip"
    :class="[{ 'is-small': small, 'is-dim': dim, 'is-focus': focus, 'is-clickable': clickable }]"
    :style="style"
    :title="`${name} · ${meta.label}${clickable ? ' · 点击查看它在49个过程中的关系' : ''}`"
    @click="onChipClick"
  >
    <span class="chip-kind">{{ meta.short }}</span>
    <span class="chip-name">{{ name }}</span>
    <template v-if="movable">
      <button
        type="button"
        class="chip-mv"
        title="上移"
        :disabled="first"
        @click.stop="$emit('move', -1)"
      >↑</button>
      <button
        type="button"
        class="chip-mv"
        title="下移"
        :disabled="last"
        @click.stop="$emit('move', 1)"
      >↓</button>
    </template>
    <button v-if="removable" type="button" class="chip-x" title="删除" @click.stop="$emit('remove')">×</button>
  </span>
</template>
