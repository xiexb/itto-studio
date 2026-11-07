<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import ArtifactChip from './ArtifactChip.vue'
import EditConfirmModal from './EditConfirmModal.vue'
import FuzzyCombobox from './FuzzyCombobox.vue'
import KindLegend from './KindLegend.vue'
import { CHG_STEPS, GROUP_COLOR, KIND } from '../lib/constants'
import { DFD_FIG, dfdUrl } from '../lib/dfd'
import { classify, kindCounts, kindOf } from '../lib/kind'
import {
  activeInEdges,
  activeMeta,
  activeOutEdges,
  activeProc,
  addEdge,
  addInput,
  addOutput,
  applyDelInput,
  applyDelOutput,
  artifactItems,
  delEdge,
  domainColor,
  moveArtifact,
  moveEdge,
  planAddInput,
  planAddOutput,
  planDelInput,
  planDelOutput,
  procList,
  select,
  setMode,
  state,
  toggleEditing,
} from '../store/itto'

const emit = defineEmits(['close'])

const proc = activeProc
const meta = activeMeta
const inEdges = activeInEdges
const outEdges = activeOutEdges

const kindFilter = ref(null)
const inQ = ref('')
const outQ = ref('')
const upProcQ = ref('')
const upArtQ = ref('')
const downProcQ = ref('')
const downArtQ = ref('')
const upFrom = ref(null)
const downTo = ref(null)
const upArtRef = ref(null)
const downArtRef = ref(null)

watch(
  () => state.active,
  () => {
    kindFilter.value = null
    inQ.value = ''
    outQ.value = ''
    genOpen.value = false
    updOpen.value = false
    upProcQ.value = ''
    upArtQ.value = ''
    downProcQ.value = ''
    downArtQ.value = ''
    upFrom.value = null
    downTo.value = null
    nextTick(() => {
      const box = document.querySelector('.drawer-body')
      if (box) box.scrollTop = 0
    })
  },
)

const ins = computed(() => (proc.value ? proc.value.ins || [] : []))
const outs = computed(() => (proc.value ? proc.value.outs || [] : []))
const insGen = computed(() => (proc.value ? proc.value.insGen || [] : []))
const outsUpd = computed(() => (proc.value ? proc.value.outsUpd || [] : []))
const updDetail = computed(() => (proc.value ? proc.value.updDetail || {} : {}))
const tools = computed(() => (proc.value ? proc.value.tools || [] : []))
const toolsDetail = computed(() => (proc.value ? proc.value.toolsDetail || {} : {}))
/** 受控更新的细项总数：每个更新对象下 updDetail 列表的具体条目数，无明细则按 1 计 */
const updItemCount = computed(() =>
  outsUpd.value.reduce(
    (sum, n) => sum + (updDetail.value[n]?.length || 1),
    0,
  ),
)
const counts = computed(() => kindCounts([...ins.value, ...outs.value, ...insGen.value, ...outsUpd.value]))
const tabIdx = computed(() => (meta.value ? meta.value.idx : 0))
const genOpen = ref(false)
const updOpen = ref(false)

const procItems = computed(() =>
  procList.value
    .filter((p) => p.id !== state.active)
    .map((p) => ({ value: p.id, tag: p.phase, tagCls: 'ph' })),
)

const upArtItems = computed(() => {
  if (!upFrom.value) return []
  const src = state.procs[upFrom.value]
  return (src?.outs || []).map((x) => ({ value: x, tag: 'OUT', tagCls: 'out', kind: classify(x) }))
})

const downArtItems = computed(() =>
  outs.value.map((x) => ({ value: x, tag: 'OUT', tagCls: 'out', kind: classify(x) })),
)

const planOutCount = computed(() => outs.value.filter((x) => classify(x) === 'plan').length)
const docOutCount = computed(() => outs.value.filter((x) => classify(x) === 'pdoc').length)
const isCCB = computed(() => state.active === '实施整体变更控制')

const stepOn = computed(() => CHG_STEPS.map((s) => s.procs.includes(state.active)))

/* ---- 教程数据流向图（图8-1 ~ 图17-4） ---- */
const dfdFig = computed(() => (state.active && DFD_FIG[state.active]) || '')
const dfdSrc = computed(() => dfdUrl(state.active))

function pad(n) {
  return String(n).padStart(2, '0')
}
function dimmed(n) {
  return !!kindFilter.value && classify(n) !== kindFilter.value
}
function focused(n) {
  return !!kindFilter.value && classify(n) === kindFilter.value
}
function toggleFilter(k) {
  kindFilter.value = kindFilter.value === k ? null : k
}
function goto(id) {
  select(id)
}
function goChange() {
  setMode('change')
}

/* ---- 关键输入：可搜索已有项，也允许自由新建 ---- */
function onPickIn(item) {
  requestAddInput(item.value)
  inQ.value = ''
}
function onFreeIn(v) {
  requestAddInput(v)
  inQ.value = ''
}
function addInFromInput() {
  if (!inQ.value.trim()) return
  requestAddInput(inQ.value)
  inQ.value = ''
}

/* ---- 关键输出：只能从已有交付物中选择，避免造出无产出的孤儿项 ---- */
function onPickOut(item) {
  requestAddOutput(item.value)
  outQ.value = ''
}

/* ---- 编辑确认弹窗：先预演影响面，确认后一次性应用 ---- */
const confirm = ref(null) // { kind, id, name, title, summary, brokenEdges, orphans, producers, consumers, linkArt, confirmText }

function openConfirm(plan) {
  confirm.value = plan
}
function closeConfirm() {
  confirm.value = null
}

function requestDelInput(id, name) {
  const plan = planDelInput(id, name)
  openConfirm({
    kind: 'delInput',
    id,
    name,
    title: '删除输入的影响',
    summary: `删除「${id}」的输入：${name}`,
    brokenEdges: plan.brokenEdges,
    confirmText: '确认删除',
  })
}

function requestDelOutput(id, name) {
  const plan = planDelOutput(id, name)
  openConfirm({
    kind: 'delOutput',
    id,
    name,
    title: '删除输出的影响',
    summary: `删除「${id}」的输出：${name}`,
    brokenEdges: plan.brokenEdges,
    orphans: plan.orphans,
    confirmText: '确认删除',
  })
}

function requestAddInput(id, raw) {
  const v = String(raw || '').trim()
  if (!v) return
  const plan = planAddInput(id, v)
  openConfirm({
    kind: 'addInput',
    id,
    name: v,
    title: '新增输入',
    summary: `为「${id}」新增输入：${v}`,
    producers: plan.producers,
    linkArt: v,
    confirmText: plan.producers.length ? '确认并自动补连' : '确认新增',
  })
}

function requestAddOutput(id, raw) {
  const v = String(raw || '').trim()
  if (!v) return
  const plan = planAddOutput(id, v)
  openConfirm({
    kind: 'addOutput',
    id,
    name: v,
    title: '新增输出',
    summary: `为「${id}」新增输出：${v}`,
    consumers: plan.consumers,
    linkArt: v,
    confirmText: plan.consumers.length ? '确认并自动补连' : '确认新增',
  })
}

function onConfirm() {
  const c = confirm.value
  if (!c) return
  if (c.kind === 'delInput') {
    applyDelInput(c.id, c.name)
  } else if (c.kind === 'delOutput') {
    applyDelOutput(c.id, c.name)
  } else if (c.kind === 'addInput') {
    if (addInput(c.id, c.name) && c.producers.length) {
      for (const p of c.producers) addEdge(p, c.id, c.name)
    }
  } else if (c.kind === 'addOutput') {
    if (addOutput(c.id, c.name) && c.consumers.length) {
      for (const t of c.consumers) addEdge(c.id, t, c.name)
    }
  }
  closeConfirm()
}

/* ---- 上游：两步，先过程再它产出的交付物 ---- */
function onPickUpProc(item) {
  upFrom.value = item.value
  upArtQ.value = ''
  nextTick(() => upArtRef.value && upArtRef.value.open())
}
function onPickUpArt(item) {
  if (!upFrom.value) return
  addEdge(upFrom.value, state.active, item.value)
  upProcQ.value = ''
  upArtQ.value = ''
}

/* ---- 下游：两步，先过程再本过程产出的交付物 ---- */
function onPickDownProc(item) {
  downTo.value = item.value
  downArtQ.value = ''
  nextTick(() => downArtRef.value && downArtRef.value.open())
}
function onPickDownArt(item) {
  if (!downTo.value) return
  addEdge(state.active, downTo.value, item.value)
  downProcQ.value = ''
  downArtQ.value = ''
}
</script>

<template>
  <aside class="drawer" :class="{ open: !!state.active }">
    <div v-if="proc" class="drawer-inner">
      <div class="drawer-head">
        <button type="button" class="dh-close" title="关闭（Esc）" @click="emit('close')">×</button>
        <div class="dh-tags">
          <span class="badge" :style="{ background: GROUP_COLOR[proc.phase] }">{{ proc.phase }}过程组</span>
          <span class="badge soft" :style="{ color: domainColor(proc.dom), background: domainColor(proc.dom) + '16' }">
            {{ proc.dom }}
          </span>
        </div>
        <h2>{{ state.active }}</h2>
        <div class="dh-stats">
          <span class="idx-pill">№ {{ pad(tabIdx) }}</span>
          <span class="dh-stat"><i class="dot-in"></i>输入 {{ ins.length + insGen.length }}</span>
          <span class="dh-stat"><i class="dot-tool"></i>工具 {{ tools.length }}</span>
          <span class="dh-stat"><i class="dot-out"></i>输出 {{ outs.length + outsUpd.length }}</span>
        </div>
        <div v-if="proc.defn || proc.role" class="dh-defbox">
          <p v-if="proc.defn" class="dh-def"><b>定义</b>{{ proc.defn }}</p>
          <p v-if="proc.role" class="dh-role"><b>主要作用</b>{{ proc.role }}</p>
        </div>
        <div class="dh-actions">
          <button type="button" class="btn tiny" :class="{ 'is-on': state.editing }" @click="toggleEditing">
            {{ state.editing ? '✓ 完成编辑' : '✎ 编辑' }}
          </button>
          <span v-if="state.edited[state.active]" class="edited-tag">此过程已修改</span>
        </div>
      </div>

      <div class="drawer-body">
        <KindLegend :counts="counts" :active="kindFilter" @toggle="toggleFilter" />

        <section v-if="dfdFig" class="sec sec-dfd">
          <div class="sec-head">
            <span class="sec-ico">图</span>
            <span class="sec-title">数据流向图</span>
            <em>DFD</em>
            <span class="sec-n">{{ dfdFig }}</span>
          </div>
          <div class="sec-bd">
            <a
              class="dfd-box"
              :href="dfdSrc"
              target="_blank"
              rel="noopener"
              :title="`${dfdFig} ${state.active} 数据流向图（点击打开原图）`"
            >
              <img :src="dfdSrc" :alt="`${state.active} 数据流向图 ${dfdFig}`" loading="lazy" />
            </a>
          </div>
        </section>

        <section class="sec sec-in">
          <div class="sec-head">
            <span class="sec-ico">入</span>
            <span class="sec-title">关键输入</span>
            <em>INPUTS</em>
            <span class="sec-n">{{ ins.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="chips">
            <ArtifactChip
              v-for="(n, i) in ins"
              :key="n"
              :name="n"
              dir="in"
              :removable="state.editing"
              :movable="state.editing"
              :first="state.editing && i === 0"
              :last="state.editing && i === ins.length - 1"
              :dim="dimmed(n)"
              :focus="focused(n)"
              :clickable="!state.editing"
              @remove="requestDelInput(state.active, n)"
              @move="moveArtifact(state.active, 'in', n, $event)"
            />
            <span v-if="!ins.length" class="empty-note">暂无输入项</span>
          </div>
          <div v-if="state.editing" class="adder">
            <FuzzyCombobox
              v-model="inQ"
              :items="artifactItems"
              allow-free
              placeholder="搜索已有项，或直接输入新建"
              @pick="onPickIn"
              @free="onFreeIn"
            />
            <button type="button" class="add-btn" title="添加" @click="addInFromInput">+</button>
          </div>

          <button
            v-if="insGen.length"
            type="button"
            class="agg-bar agg-in"
            :class="{ 'is-open': genOpen }"
            @click="genOpen = !genOpen"
          >
            <span class="agg-arrow">{{ genOpen ? '▾' : '▸' }}</span>
            通用输入（环境与资产）
            <span class="agg-n">{{ insGen.length }}</span>
            <span class="agg-hint">{{ genOpen ? '点击收起' : '点击展开' }}</span>
          </button>
          <div v-if="genOpen" class="chips agg-detail">
            <ArtifactChip
              v-for="n in insGen"
              :key="'g' + n"
              :name="n"
              dir="in"
              :dim="dimmed(n)"
              :focus="focused(n)"
              clickable
            />
          </div>
          </div>
        </section>

        <section v-if="tools.length" class="sec sec-tool">
          <div class="sec-head">
            <span class="sec-ico">工</span>
            <span class="sec-title">工具与技术</span>
            <em>TOOLS</em>
            <span class="sec-n">{{ tools.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="tool-list">
            <div v-for="n in tools" :key="'t' + n" class="tool-item">
              <span class="tool-name">{{ n }}</span>
              <ul v-if="toolsDetail[n] && toolsDetail[n].length" class="upd-detail">
                <li v-for="d in toolsDetail[n]" :key="d">{{ d }}</li>
              </ul>
            </div>
          </div>
          </div>
        </section>

        <section class="sec sec-out">
          <div class="sec-head">
            <span class="sec-ico">出</span>
            <span class="sec-title">关键输出</span>
            <em>OUTPUTS</em>
            <span class="sec-n">{{ outs.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="chips">
            <ArtifactChip
              v-for="(n, i) in outs"
              :key="n"
              :name="n"
              dir="out"
              :removable="state.editing"
              :movable="state.editing"
              :first="state.editing && i === 0"
              :last="state.editing && i === outs.length - 1"
              :dim="dimmed(n)"
              :focus="focused(n)"
              clickable
              @remove="requestDelOutput(state.active, n)"
              @move="moveArtifact(state.active, 'out', n, $event)"
            />
            <span v-if="!outs.length" class="empty-note">暂无输出项</span>
          </div>
          <div v-if="state.editing" class="adder">
            <FuzzyCombobox
              v-model="outQ"
              :items="artifactItems"
              placeholder="搜索并选择已有项（不可自建）"
              empty-text="无匹配项 · 输出只能从已有项中选择"
              @pick="onPickOut"
            />
          </div>

          <button
            v-if="outsUpd.length"
            type="button"
            class="agg-bar agg-out"
            :class="{ 'is-open': updOpen }"
            @click="updOpen = !updOpen"
          >
            <span class="agg-arrow">{{ updOpen ? '▾' : '▸' }}</span>
            受控更新（计划 / 文件 / 资产更新）
            <span class="agg-n">{{ updItemCount }}</span>
            <span class="agg-hint">{{ updOpen ? '点击收起' : '点击展开' }}</span>
          </button>
          <div v-if="updOpen" class="upd-list">
            <div v-for="n in outsUpd" :key="'u' + n" class="upd-item">
              <ArtifactChip :name="n" dir="out" :dim="dimmed(n)" :focus="focused(n)" clickable />
              <ul v-if="updDetail[n] && updDetail[n].length" class="upd-detail">
                <li v-for="d in updDetail[n]" :key="d">{{ d }}</li>
              </ul>
            </div>
          </div>
          </div>
        </section>

        <section class="sec sec-up">
          <div class="sec-head">
            <span class="sec-ico">源</span>
            <span class="sec-title">上游来源</span>
            <em>INCOMING</em>
            <span class="sec-n">{{ inEdges.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="flow">
            <button
              v-for="(e, i) in inEdges"
              :key="'u' + e.join('|')"
              type="button"
              class="flow-item"
              @click="goto(e[0])"
            >
              <span class="fi-proc">{{ e[0] }}</span>
              <span class="fi-arw">→</span>
              <span class="fi-art" :style="{ color: kindOf(e[2]).color }">{{ e[2] }}</span>
              <template v-if="state.editing">
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === 0 }"
                  title="上移"
                  @click.stop="moveEdge(e, -1, inEdges)"
                >↑</span>
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === inEdges.length - 1 }"
                  title="下移"
                  @click.stop="moveEdge(e, 1, inEdges)"
                >↓</span>
                <span
                  class="fi-del"
                  title="删除该上游关系"
                  @click.stop="delEdge(e[0], state.active, e[2])"
                >×</span>
              </template>
            </button>
            <div v-if="!inEdges.length" class="empty-note">暂无标注的上游来源</div>
          </div>
          <div v-if="state.editing" class="adder stack">
            <FuzzyCombobox
              v-model="upProcQ"
              :items="procItems"
              placeholder="① 搜索来源过程"
              @pick="onPickUpProc"
            />
            <FuzzyCombobox
              ref="upArtRef"
              v-model="upArtQ"
              :items="upArtItems"
              :disabled="!upFrom"
              :placeholder="upFrom ? `② 选「${upFrom}」产出的交付物` : '② 先选来源过程'"
              empty-text="该过程还没有输出项"
              @pick="onPickUpArt"
            />
          </div>
          </div>
        </section>

        <section class="sec sec-down">
          <div class="sec-head">
            <span class="sec-ico">去</span>
            <span class="sec-title">下游去向</span>
            <em>OUTGOING</em>
            <span class="sec-n">{{ outEdges.length }}</span>
          </div>
          <div class="sec-bd">
          <div class="flow">
            <button
              v-for="(e, i) in outEdges"
              :key="'d' + e.join('|')"
              type="button"
              class="flow-item"
              @click="goto(e[1])"
            >
              <span class="fi-art" :style="{ color: kindOf(e[2]).color }">{{ e[2] }}</span>
              <span class="fi-arw">→</span>
              <span class="fi-proc">{{ e[1] }}</span>
              <template v-if="state.editing">
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === 0 }"
                  title="上移"
                  @click.stop="moveEdge(e, -1, outEdges)"
                >↑</span>
                <span
                  class="fi-mv"
                  :class="{ 'is-off': i === outEdges.length - 1 }"
                  title="下移"
                  @click.stop="moveEdge(e, 1, outEdges)"
                >↓</span>
                <span
                  class="fi-del"
                  title="删除该下游关系"
                  @click.stop="delEdge(state.active, e[1], e[2])"
                >×</span>
              </template>
            </button>
            <div v-if="!outEdges.length" class="empty-note">暂无标注的下游去向</div>
          </div>
          <div v-if="state.editing" class="adder stack">
            <FuzzyCombobox
              v-model="downProcQ"
              :items="procItems"
              placeholder="① 搜索去向过程"
              @pick="onPickDownProc"
            />
            <FuzzyCombobox
              ref="downArtRef"
              v-model="downArtQ"
              :items="downArtItems"
              :disabled="!downTo"
              :placeholder="downTo ? '② 选本过程产出的交付物' : '② 先选去向过程'"
              empty-text="本过程还没有输出项"
              @pick="onPickDownArt"
            />
          </div>
          </div>
        </section>

        <section class="sec sec-chg">
          <div class="sec-head">
            <span class="sec-ico">变</span>
            <span class="sec-title">变更控制</span>
            <em>CHANGE</em>
          </div>
          <div class="sec-bd">
          <div class="chgbox">
            <p v-if="isCCB">
              本过程就是<b style="color: #b91c1c">变更闸门</b>：所有变更请求在此
              <b>记录 → 评估影响 → CCB 审批</b>，通过后才允许修订组件与项目文件，
              并把<b>批准的变更请求</b>发回执行、质量控制与采购过程落地。
            </p>
            <p v-else>
              本过程输出中有 <b style="color: #4338ca">{{ planOutCount }} 个计划组件 / 基准</b>、
              <b style="color: #0e7490">{{ docOutCount }} 个项目文件</b>。
              它们都是<b>受控对象</b> —— 要改必须先提交变更请求，经「实施整体变更控制」由 CCB 批准，
              不能在本过程里直接改。
            </p>
            <div class="chgmini">
              <span
                v-for="(s, i) in CHG_STEPS"
                :key="i"
                :class="{ 'is-on': stepOn[i] }"
              >{{ s.n }} {{ s.t.replace('变更请求', '变更') }}</span>
            </div>
            <button type="button" class="btn tiny" @click="goChange">在矩阵中查看变更闭环 →</button>
          </div>
          </div>
        </section>

        <div class="tipbox">
          <b>怎么读：</b>绿色线＝谁给了我输入；蓝色线＝我的输出去了哪；虚线＝计划 / 基准 / 绩效这类通用流转。<br />
          编辑只改动这份图谱的数据，不影响过程编号与分组；改动会实时同步到后端 JSON 文件。
        </div>
      </div>
    </div>

    <div v-else class="drawer-placeholder">
      <div class="dp-icon">◎</div>
      <b>点任意过程查看详情</b>
      <span>输入 / 输出、上下游来源去向、变更影响面都在这里</span>
    </div>

    <EditConfirmModal
      :open="!!confirm"
      :title="confirm?.title"
      :summary="confirm?.summary"
      :broken-edges="confirm?.brokenEdges || []"
      :orphans="confirm?.orphans || []"
      :producers="confirm?.producers || []"
      :consumers="confirm?.consumers || []"
      :link-art="confirm?.linkArt || ''"
      :confirm-text="confirm?.confirmText"
      @confirm="onConfirm"
      @cancel="closeConfirm"
    />
  </aside>
</template>