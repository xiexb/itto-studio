<script setup>
import { state } from '../store/itto'
</script>

<template>
  <div class="toast-host">
    <transition-group name="toast">
      <div v-for="t in state.toasts" :key="t.id" class="toast" :class="`toast-${t.type}`">
        <span class="toast-dot"></span>
        {{ t.message }}
      </div>
    </transition-group>
  </div>
</template>