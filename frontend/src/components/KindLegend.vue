<script setup>
import { KIND, KIND_ORDER } from '../lib/constants'

defineProps({
  counts: { type: Object, default: () => ({}) },
  active: { type: String, default: null },
})
defineEmits(['toggle'])
</script>

<template>
  <div class="klegend">
    <button
      v-for="k in KIND_ORDER.filter((x) => counts[x])"
      :key="k"
      type="button"
      class="kl"
      :class="{ 'is-on': active === k }"
      :style="{ '--kc': KIND[k].color, '--kb': KIND[k].bg, '--kbd': KIND[k].bd }"
      :title="`${KIND[k].label}（点击只看这一类，再点取消）`"
      @click="$emit('toggle', k)"
    >
      <span class="kl-dot"></span>
      {{ KIND[k].short }}
      <b>{{ counts[k] }}</b>
    </button>
  </div>
</template>