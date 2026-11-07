<script setup>
import { computed, ref, watch } from 'vue'
import { GROUP_COLOR, KIND } from '../lib/constants'
import {
  artifactRelations,
  closeArtifact,
  domainColor,
  select,
  state,
} from '../store/itto'

const VIA = {
  out: { label: '产出', cls: 'is-out', hint: '列为关键输出' },
  upd: { label: '更新', cls: 'is-upd', hint: '受控更新' },
  in: { label: '输入', cls: 'is-in', hint: '列为关键输入' },
  gen: { label: '环境', cls: 'is-gen', hint: '通用输入（环境 / 资产）' },
}

const rel = artifactRelations

const kindMeta = computed(() => (rel.value ? KIND[rel.value.kind] : null))

/* 环境类交付物（事业环境因素 / 组织过程资产）覆盖几乎所有过程，
 * 大数量下按过程组折叠展示，其余类型按关系角色直接列行 */
const isEnv = computed(() => rel.value && rel.value.kind === 'env')

const rows = computed(() => rel.value?.rows || [])
const outRows = computed(() => rows.value.filter((r) => r.via.has('out') || r.via.has('upd')))
const inRows = computed(() => rows.value.filter((r) => r.via.has('in') || r.via.has('gen')))

const counts = computed(() => ({
  out: rows.value.filter((r) => r.via.has('out')).length,
  upd: rows.value.filter((r) => r.via.has('upd')).length,
  in: rows.value.filter((r) => r.via.has('in')).length,
  gen: rows.value.filter((r) => r.via.has('gen')).length,
}))

/* 环境类的折叠视图：{ phase -> procIds } */
const envPhaseMap = computed(() => {
  if (!isEnv.value) return []
  const m = []
  for (const phase of ['启动', '规划', '执行', '监控', '收尾']) {
    const procs = rows.value.filter((r) => r.phase === phase)
    if (procs.length) m.push({ phase, procs })
  }
  return m
})

watch(
  () => state.artifactView,
  (v) => {
    if (!v) return
    /* 环境类默认收起，其余默认展开输入区 */
    openSec.value = isEnv.value ? '' : 'in'
  },
)

const openSec = ref('in')

function toggleSec(key) {
  openSec.value = openSec.value === key ? '' : key
}

function goto(pid) {
  closeArtifact()
  select(pid)
}

function pickArt(name) {
  openArtifact(name)
}
</script>

<template>
  <transition name="fade">
    <div v-if="rel" class="am-mask" @click.self="closeArtifact()">
      <div class="am" role="dialog" aria-modal="true">
        <div class="am-head">
          <div class="am-title">
            <span
              class="am-kind"
              :style="{ background: kindMeta.bg, color: kindMeta.color, borderColor: kindMeta.bd }"
            >{{ kindMeta.short }}</span>
            <h4>{{ rel.name }}</h4>
          </div>
          <button type="button" class="am-x" title="关闭（Esc）" @click="closeArtifact()">×</button>
        </div>

        <div class="am-stats">
          <span class="am-stat"><b style="color: #C2410C">{{ counts.out }}</b> 过程产出</span>
          <i></i>
          <span class="am-stat"><b style="color: #B91C1C">{{ counts.upd }}</b> 过程受控更新</span>
          <i></i>
          <span class="am-stat"><b style="color: #059669">{{ counts.in }}</b> 过程作为关键输入</span>
          <i></i>
          <span class="am-stat"><b style="color: #475569">{{ counts.gen }}</b> 过程通用输入</span>
        </div>

        <div class="am-body">
          <!-- 产出 / 更新 -->
          <section class="am-sec" :class="{ 'is-open': openSec === 'out' }">
            <button type="button" class="am-sec-head" @click="toggleSec('out')">
              <span class="am-sec-arrow">{{ openSec === 'out' ? '▾' : '▸' }}</span>
              <b>谁产出它 / 谁更新它</b>
              <span class="am-sec-n">{{ outRows.length }}</span>
              <span class="am-sec-hint">输出 {{ counts.out }} · 更新 {{ counts.upd }}</span>
            </button>
            <div v-if="openSec === 'out'" class="am-sec-body">
              <div v-if="!outRows.length" class="am-none">
                没有过程把它列为关键输出或受控更新 —— 它可能来自项目之外（如「协议」来自卖方）。
              </div>
              <button
                v-for="r in outRows"
                :key="'o' + r.proc"
                type="button"
                class="am-row"
                @click="goto(r.proc)"
              >
                <span class="am-row-idx">{{ String(r.idx).padStart(2, '0') }}</span>
                <span class="am-row-proc">{{ r.proc }}</span>
                <span class="am-badges">
                  <i v-if="r.via.has('out')" class="am-badge is-out">产出</i>
                  <i v-if="r.via.has('upd')" class="am-badge is-upd">更新</i>
                </span>
                <span class="am-row-dom" :style="{ color: domainColor(r.dom) }">{{ r.dom }}</span>
                <span class="am-row-ph" :style="{ background: GROUP_COLOR[r.phase] }">{{ r.phase }}</span>
              </button>
            </div>
          </section>

          <!-- 输入 -->
          <section class="am-sec" :class="{ 'is-open': openSec === 'in' }">
            <button type="button" class="am-sec-head" @click="toggleSec('in')">
              <span class="am-sec-arrow">{{ openSec === 'in' ? '▾' : '▸' }}</span>
              <b>谁使用它</b>
              <span class="am-sec-n">{{ inRows.length }}</span>
              <span class="am-sec-hint">关键输入 {{ counts.in }} · 通用输入 {{ counts.gen }}</span>
            </button>
            <div v-if="openSec === 'in'" class="am-sec-body">
              <div v-if="!inRows.length" class="am-none">没有过程把它列为输入。</div>
              <template v-if="!isEnv">
                <button
                  v-for="r in inRows"
                  :key="'i' + r.proc"
                  type="button"
                  class="am-row"
                  @click="goto(r.proc)"
                >
                  <span class="am-row-idx">{{ String(r.idx).padStart(2, '0') }}</span>
                  <span class="am-row-proc">{{ r.proc }}</span>
                  <span class="am-badges">
                    <i v-if="r.via.has('in')" class="am-badge is-in">输入</i>
                    <i v-if="r.via.has('gen')" class="am-badge is-gen">环境</i>
                  </span>
                  <span class="am-row-dom" :style="{ color: domainColor(r.dom) }">{{ r.dom }}</span>
                  <span class="am-row-ph" :style="{ background: GROUP_COLOR[r.phase] }">{{ r.phase }}</span>
                </button>
              </template>
              <template v-else>
                <div v-for="g in envPhaseMap" :key="g.phase" class="am-env-group">
                  <span class="am-env-ph" :style="{ background: GROUP_COLOR[g.phase] }">{{ g.phase }}</span>
                  <span class="am-env-n">{{ g.procs.length }} 个过程</span>
                  <span class="am-env-chips">
                    <button
                      v-for="r in g.procs"
                      :key="r.proc"
                      type="button"
                      class="am-env-chip"
                      @click="goto(r.proc)"
                    >{{ r.proc }}</button>
                  </span>
                </div>
              </template>
            </div>
          </section>

          <div class="am-tip">
            点击任一过程行可跳转查看该过程的完整 ITTO；
            <template v-if="!isEnv">
              流转链：产出 → 交付 → 输入下游，环环相扣。
            </template>
            <template v-else>
              这类环境输入贯穿几乎所有过程，是每个过程的底座。
            </template>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
