<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fuzzyMatch, highlightParts } from '../lib/fuzzy'
import { KIND } from '../lib/constants'

const props = defineProps({
  modelValue: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  allowFree: { type: Boolean, default: false },
  disabled: Boolean,
  emptyText: { type: String, default: '无匹配项' },
  compact: Boolean,
})

const emit = defineEmits(['update:modelValue', 'pick', 'free', 'enter'])

const inputEl = ref(null)
const q = ref(props.modelValue)
const open = ref(false)
const sel = ref(0)
const listStyle = ref({})
const results = computed(() => {
  const arr = []
  for (const it of props.items) {
    const m = fuzzyMatch(q.value, it.value)
    if (m.ok) arr.push({ it, m })
  }
  arr.sort((a, b) => b.m.score - a.m.score)
  return arr.slice(0, 60)
})

watch(
  () => props.modelValue,
  (v) => {
    if (v !== q.value) q.value = v || ''
  },
)

function place() {
  const el = inputEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const w = Math.max(r.width + 60, 280)
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 12))
  const spaceBelow = window.innerHeight - r.bottom
  const up = spaceBelow < 230 && r.top > spaceBelow
  listStyle.value = {
    width: `${w}px`,
    left: `${left}px`,
    top: up ? 'auto' : `${Math.round(r.bottom + 6)}px`,
    bottom: up ? `${Math.round(window.innerHeight - r.top + 6)}px` : 'auto',
    maxHeight: `${up ? Math.min(300, r.top - 20) : Math.min(300, spaceBelow - 16)}px`,
  }
}

function openList() {
  if (props.disabled) return
  sel.value = 0
  open.value = true
  nextTick(place)
}

function close() {
  open.value = false
}

function onInput() {
  emit('update:modelValue', q.value)
  openList()
}

function pick(item) {
  q.value = item.value
  emit('update:modelValue', item.value)
  emit('pick', item)
  close()
}

function onEnter() {
  if (open.value && results.value.length && sel.value >= 0) {
    pick(results.value[sel.value].it)
    return
  }
  const v = q.value.trim()
  if (!v) return
  if (props.allowFree) {
    emit('free', v)
    close()
  } else {
    emit('enter', v)
  }
}

function onKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) return openList()
    if (results.value.length) sel.value = (sel.value + 1) % results.value.length
    scrollSel()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (results.value.length) sel.value = (sel.value - 1 + results.value.length) % results.value.length
    scrollSel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    onEnter()
  } else if (e.key === 'Escape') {
    if (open.value) {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  } else if (e.key === 'Tab') {
    close()
  }
}

function scrollSel() {
  nextTick(() => {
    const box = document.getElementById('cb-list-' + uid)
    if (!box) return
    const on = box.querySelector('.cb-item.is-on')
    if (on) on.scrollIntoView({ block: 'nearest' })
  })
}

const uid = Math.random().toString(36).slice(2, 9)

function onDocDown(e) {
  if (!open.value) return
  const el = inputEl.value
  const box = document.getElementById('cb-list-' + uid)
  if (el && el.contains(e.target)) return
  if (box && box.contains(e.target)) return
  close()
}

function onWindowChange() {
  if (open.value) close()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('scroll', onWindowChange, true)
  window.addEventListener('resize', onWindowChange)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('scroll', onWindowChange, true)
  window.removeEventListener('resize', onWindowChange)
})

defineExpose({ open: openList, close, focus: () => inputEl.value && inputEl.value.focus() })

function parts(text, idx) {
  return highlightParts(text, idx)
}
function tagColor(it) {
  const k = KIND[it.kind]
  return k ? k.color : '#64748b'
}
</script>

<template>
  <div class="combo" :class="{ compact }">
    <input
      ref="inputEl"
      v-model="q"
      type="text"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @focus="openList"
      @keydown="onKeydown"
      @blur="close"
    />
    <Teleport to="body">
      <div
        v-if="open"
        :id="'cb-list-' + uid"
        class="cb-list"
        :style="listStyle"
        @mousedown.prevent
      >
        <template v-if="results.length">
          <div
            v-for="(r, i) in results"
            :key="r.it.value + i"
            class="cb-item"
            :class="{ 'is-on': i === sel }"
            @mouseenter="sel = i"
            @mousedown.prevent="pick(r.it)"
          >
            <span class="cb-name">
              <template v-for="(p, j) in parts(r.it.value, r.m.idx)" :key="j">
                <b v-if="p.hit">{{ p.ch }}</b>
                <span v-else>{{ p.ch }}</span>
              </template>
            </span>
            <span v-if="r.it.tag" class="cb-tag" :class="r.it.tagCls || ''">{{ r.it.tag }}</span>
            <span
              v-if="r.it.kind"
              class="cb-kind"
              :style="{ background: KIND[r.it.kind].bg, color: KIND[r.it.kind].color }"
            >{{ KIND[r.it.kind].short }}</span>
          </div>
        </template>
        <div v-else class="cb-empty">{{ emptyText }}</div>
      </div>
    </Teleport>
  </div>
</template>