<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import ArtifactModal from './components/ArtifactModal.vue'
import MatrixBoard from './components/MatrixBoard.vue'
import DetailDrawer from './components/DetailDrawer.vue'
import ChangeFlow from './components/ChangeFlow.vue'
import ToastHost from './components/ToastHost.vue'
import { boot, closeArtifact, initFromHash, saveNow, select, state } from './store/itto'

const drawerOpen = computed(() => !!state.active)

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase()
  const typing = tag === 'input' || tag === 'textarea'
  if (e.key === 'Escape' && !typing) {
    if (state.artifactView) closeArtifact()
    else select(null)
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveNow()
  }
  if (e.key === '/' && !typing) {
    e.preventDefault()
    const el = document.querySelector('.search input')
    if (el) el.focus()
  }
}

function onHash() {
  initFromHash()
}

onMounted(async () => {
  await boot()
  initFromHash()
  window.addEventListener('keydown', onKey)
  window.addEventListener('hashchange', onHash)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('hashchange', onHash)
})
</script>

<template>
  <div class="app" :class="{ 'drawer-open': drawerOpen }">
    <AppHeader />

    <div class="body">
      <main class="stage">
        <div class="stage-inner">
          <ChangeFlow v-if="state.mode === 'change'" />
          <MatrixBoard />

          <footer class="foot">
            <div class="foot-item">
              <b>读图方法</b>
              <span>同一格里多个过程＝同领域同阶段，自上而下即执行顺序；点开一个过程才展开它自己的关系。</span>
            </div>
            <div class="foot-item">
              <b>线的语义</b>
              <span>
                <i class="lg lg-in"></i>绿色＝上游给我输入
                <i class="lg lg-out"></i>蓝色＝我的输出去向
                <i class="lg lg-plan"></i>虚线＝计划 / 基准 / 绩效等通用流转
                <i class="lg lg-flow"></i>光点方向＝数据流方向
              </span>
            </div>
            <div class="foot-item">
              <b>快捷键</b>
              <span><kbd>Esc</kbd> 关闭抽屉 · <kbd>/</kbd> 聚焦搜索 · <kbd>Ctrl</kbd>+<kbd>S</kbd> 立即保存</span>
            </div>
          </footer>
        </div>
      </main>

      <DetailDrawer @close="select(null)" />
    </div>

    <ToastHost />
    <ArtifactModal />
  </div>
</template>