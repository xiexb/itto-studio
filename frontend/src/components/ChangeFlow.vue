<script setup>
import { computed } from 'vue'
import ArtifactChip from './ArtifactChip.vue'
import { CHG_DOMAINS, CHG_STEPS } from '../lib/constants'
import { select, setMode, state } from '../store/itto'

const step = computed(() => CHG_STEPS[state.changeStep] || CHG_STEPS[0])

function gotoStep(i) {
  state.changeStep = i
}

function jump(proc) {
  if (state.mode !== 'change') setMode('change')
  select(proc)
  const el = document.querySelector(`[data-pid="${CSS.escape(proc)}"]`)
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
</script>

<template>
  <section class="chgflow">
    <div class="cf-head">
      <div class="cf-title">
        <b>变更闭环</b>
        <em>Integrated Change Control</em>
      </div>
      <p>
        红色曲线＝变更请求上行 · 深红虚线＝批准后回流 · 橙色＝验证与移交。
        点任一步可聚焦对应过程，箭头方向即数据流方向。
      </p>
    </div>

    <div class="cf-steps">
      <button
        v-for="(s, i) in CHG_STEPS"
        :key="i"
        type="button"
        class="cfstep"
        :class="{ 'is-on': state.changeStep === i }"
        @click="gotoStep(i)"
      >
        <i>{{ s.n }}</i>
        <b>{{ s.t }}</b>
        <span>{{ s.d }}</span>
      </button>
    </div>

    <div class="cf-detail">
      <span class="cf-detail-title">{{ step.n }} {{ step.t }}</span>
      <span class="cf-lbl">本步产物</span>
      <ArtifactChip v-for="o in step.objs" :key="o" :name="o" dir="out" small clickable />
      <span class="cf-sep"></span>
      <span class="cf-lbl">落在</span>
      <button
        v-for="p in step.procs"
        :key="p"
        type="button"
        class="mini-btn"
        @click="jump(p)"
      >{{ p }}</button>
    </div>

    <div class="cf-map">
      <div class="cf-map-head">
        <b>变更影响面：会被修订的组件与项目文件</b>
        <span>按变更域分类 · 点任一对象可回到矩阵反查使用它的过程</span>
      </div>
      <div class="cm-grid">
        <div class="cm-h">变更域</div>
        <div class="cm-h" style="color: #4338ca">计划组件 / 基准</div>
        <div class="cm-h" style="color: #0e7490">项目文件</div>
        <template v-for="d in CHG_DOMAINS" :key="d.name">
          <div class="cm-dm" :style="{ '--dc': d.color }">{{ d.name }}</div>
          <div class="cm-cell">
            <ArtifactChip
              v-for="x in d.plan"
              :key="x"
              :name="x"
              dir="out"
              small
              clickable
            />
          </div>
          <div class="cm-cell">
            <ArtifactChip
              v-for="x in d.doc"
              :key="x"
              :name="x"
              dir="out"
              small
              clickable
            />
          </div>
        </template>
      </div>
    </div>
  </section>
</template>