<script setup>
import { computed } from 'vue'

const props = defineProps({
  open: Boolean,
  title: { type: String, default: '确认修改' },
  /** 操作摘要，如「删除输出：范围基准」 */
  summary: { type: String, default: '' },
  /** [{ from, to, art }] 将断开的连线 */
  brokenEdges: { type: Array, default: () => [] },
  /** [{ proc, art }] 将失去产出方的输入（一并移除） */
  orphans: { type: Array, default: () => [] },
  /** [过程名] 建议补连的上游产出方 */
  producers: { type: Array, default: () => [] },
  /** [过程名] 建议补连的下游消费方 */
  consumers: { type: Array, default: () => [] },
  /** 建议补连时的交付物名 */
  linkArt: { type: String, default: '' },
  confirmText: { type: String, default: '确认修改' },
  busy: Boolean,
})

const emit = defineEmits(['confirm', 'cancel'])

const hasImpact = computed(
  () =>
    props.brokenEdges.length ||
    props.orphans.length ||
    props.producers.length ||
    props.consumers.length,
)
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="ecm-mask" @click.self="emit('cancel')">
      <div class="ecm" role="dialog" aria-modal="true">
        <div class="ecm-head">
          <h4>{{ title }}</h4>
          <button type="button" class="ecm-x" @click="emit('cancel')">×</button>
        </div>

        <div v-if="summary" class="ecm-summary">{{ summary }}</div>

        <div class="ecm-body">
          <div v-if="!hasImpact" class="ecm-none">
            <span class="ecm-none-dot"></span>
            该修改不影响任何上下游过程与连线。
          </div>

          <section v-if="brokenEdges.length" class="ecm-sec">
            <h5>将断开 {{ brokenEdges.length }} 条连线</h5>
            <div class="ecm-rows">
              <div v-for="(e, i) in brokenEdges" :key="'e' + i" class="ecm-row">
                <span class="ecm-proc">{{ e.from }}</span>
                <span class="ecm-arw">→</span>
                <span class="ecm-art">{{ e.art }}</span>
                <span class="ecm-arw">→</span>
                <span class="ecm-proc">{{ e.to }}</span>
              </div>
            </div>
          </section>

          <section v-if="orphans.length" class="ecm-sec">
            <h5>这些过程的输入将失去产出方（一并移除）</h5>
            <div class="ecm-rows">
              <div v-for="(o, i) in orphans" :key="'o' + i" class="ecm-row">
                <span class="ecm-proc">{{ o.proc }}</span>
                <span class="ecm-arw">←</span>
                <span class="ecm-art">{{ o.art }}</span>
              </div>
            </div>
          </section>

          <section v-if="producers.length" class="ecm-sec">
            <h5>以下过程正产出「{{ linkArt }}」，确认后将自动补连</h5>
            <div class="ecm-rows">
              <div v-for="p in producers" :key="'p' + p" class="ecm-row">
                <span class="ecm-proc">{{ p }}</span>
                <span class="ecm-arw">→</span>
                <span class="ecm-art">{{ linkArt }}</span>
              </div>
            </div>
          </section>

          <section v-if="consumers.length" class="ecm-sec">
            <h5>以下过程已把「{{ linkArt }}」列为输入，确认后将自动补连</h5>
            <div class="ecm-rows">
              <div v-for="c in consumers" :key="'c' + c" class="ecm-row">
                <span class="ecm-art">{{ linkArt }}</span>
                <span class="ecm-arw">→</span>
                <span class="ecm-proc">{{ c }}</span>
              </div>
            </div>
          </section>
        </div>

        <div class="ecm-foot">
          <button type="button" class="btn" @click="emit('cancel')">取消</button>
          <button type="button" class="btn primary" :disabled="busy" @click="emit('confirm')">
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>
