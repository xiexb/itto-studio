<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { DOMAIN_CHAPTER, DOMAIN_EN, GROUP_COLOR, GROUPS } from '../lib/constants'
import { renderMarkdown } from '../lib/markdown'
import {
  closeDomain,
  domainColor,
  domainInfo,
  procList,
  saveDomainInfo,
  select,
  state,
} from '../store/itto'

const name = computed(() => state.domainView)
const info = computed(() => (name.value ? domainInfo(name.value) : {}))
const chapter = computed(() => info.value.chapter || DOMAIN_CHAPTER[name.value] || '')
const color = computed(() => domainColor(name.value))

const editing = ref(false)
const preview = ref(true)
const draft = reactive({ defn: '', role: '' })

watch(name, (v) => {
  editing.value = false
  if (v) {
    const d = domainInfo(v)
    draft.defn = d.defn || ''
    draft.role = d.role || ''
  }
})

function startEdit() {
  const d = info.value
  draft.defn = d.defn || ''
  draft.role = d.role || ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function save() {
  if (!name.value) return
  saveDomainInfo(name.value, draft.defn, draft.role)
  editing.value = false
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    save()
  }
}

function onMask() {
  /* 编辑中点遮罩不关闭，避免误触丢改动 */
  if (!editing.value) closeDomain()
}

/* 本领域的过程：按过程组分组，点击跳转到过程详情抽屉 */
const procGroups = computed(() => {
  if (!name.value) return []
  const rows = procList.value.filter((p) => p.dom === name.value)
  return GROUPS.map((g) => ({ phase: g, procs: rows.filter((p) => p.phase === g) })).filter(
    (x) => x.procs.length,
  )
})
const procCount = computed(() => procGroups.value.reduce((n, g) => n + g.procs.length, 0))

function goto(pid) {
  closeDomain()
  select(pid)
}

const defnHtml = computed(() => renderMarkdown(info.value.defn || ''))
const roleHtml = computed(() => renderMarkdown(info.value.role || ''))
const draftDefnHtml = computed(() => renderMarkdown(draft.defn))
const draftRoleHtml = computed(() => renderMarkdown(draft.role))
</script>

<template>
  <transition name="fade">
    <div v-if="name" class="dm-mask" @click.self="onMask">
      <div class="dm" role="dialog" aria-modal="true" :style="{ '--dc': color }">
        <div class="dm-head">
          <div class="dm-title">
            <span class="dm-dot"></span>
            <h4>{{ name }}</h4>
            <span class="dm-en">{{ DOMAIN_EN[name] }}</span>
            <span v-if="chapter" class="dm-chapter">{{ chapter }}</span>
          </div>
          <div class="dm-acts">
            <button
              v-if="!editing"
              type="button"
              class="btn tiny"
              title="编辑定义与作用（支持 Markdown）"
              @click="startEdit"
            >✎ 编辑</button>
            <template v-else>
              <button type="button" class="btn tiny primary" title="保存（Ctrl+Enter）" @click="save">✓ 保存</button>
              <button type="button" class="btn tiny" title="放弃改动" @click="cancelEdit">取消</button>
            </template>
            <button type="button" class="dm-x" title="关闭（Esc）" @click="closeDomain">×</button>
          </div>
        </div>

        <div class="dm-body">
          <section class="dm-sec">
            <div class="dm-sec-head">
              <b>定义</b><em>DEFINITION</em>
            </div>
            <template v-if="!editing">
              <div v-if="info.defn" class="dm-md md-body" v-html="defnHtml"></div>
              <div v-else class="dm-empty">暂无内容，点击右上「✎ 编辑」按教程补充。</div>
            </template>
            <template v-else>
              <textarea
                v-model="draft.defn"
                class="dm-ta"
                rows="6"
                placeholder="领域定义（支持 Markdown：- 列表、**加粗**、1. 有序列表…）"
                @keydown="onKey"
              ></textarea>
              <div v-if="preview && draft.defn.trim()" class="dm-md md-body is-preview" v-html="draftDefnHtml"></div>
            </template>
          </section>

          <section class="dm-sec">
            <div class="dm-sec-head">
              <b>作用</b><em>WHY IT MATTERS</em>
            </div>
            <template v-if="!editing">
              <div v-if="info.role" class="dm-md md-body" v-html="roleHtml"></div>
              <div v-else class="dm-empty">暂无内容，点击右上「✎ 编辑」按教程补充。</div>
            </template>
            <template v-else>
              <textarea
                v-model="draft.role"
                class="dm-ta"
                rows="7"
                placeholder="领域的地位、作用与意义（支持 Markdown）"
                @keydown="onKey"
              ></textarea>
              <div v-if="preview && draft.role.trim()" class="dm-md md-body is-preview" v-html="draftRoleHtml"></div>
            </template>
          </section>

          <section v-if="procGroups.length" class="dm-sec">
            <div class="dm-sec-head">
              <b>本领域过程</b><em>PROCESSES</em>
              <span class="dm-n">{{ procCount }}</span>
            </div>
            <div class="dm-procs">
              <div v-for="g in procGroups" :key="g.phase" class="dm-pgroup">
                <span class="dm-ph" :style="{ background: GROUP_COLOR[g.phase] }">{{ g.phase }}</span>
                <span class="dm-chips">
                  <button
                    v-for="p in g.procs"
                    :key="p.id"
                    type="button"
                    class="dm-chip"
                    :title="`查看「${p.id}」的 ITTO 详情`"
                    @click="goto(p.id)"
                  >{{ p.id }}</button>
                </span>
              </div>
            </div>
          </section>

          <div v-if="editing" class="dm-foot">
            <label class="dm-preview-toggle" title="编辑时在下方实时渲染 Markdown 效果">
              <input v-model="preview" type="checkbox" />实时预览
            </label>
            <span class="dm-hint">支持 Markdown · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 保存 · 改动随 ITTO 数据自动落盘</span>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
