<template>
  <div class="app-header" :class="{ 'macos-header': isMacOS }" data-tauri-drag-region>
    <div class="header-left" v-if="!isMacOS">
      <div class="app-logo">
        <img
          src="/icons/app-icon.png"
          alt="ZError Logo"
          class="app-logo-img"
          width="20"
          height="20"
          draggable="false"
        />
      </div>
      <div class="app-title">ZError</div>
    </div>
    <button
      v-if="showExpandChats"
      class="expand-chats"
      type="button"
      title="展开对话列表"
      @click="setChatListCollapsed(false)"
    >
      展开对话
    </button>
    
    <div class="header-center" :class="{ 'is-browser-tabs': props.activeTab === 'browser' }">
      <HeaderTutorialStepper
        :active-tab="props.activeTab"
        @guide-to="emit('guide-to', $event)"
      />
      <HeaderBrowserTabs :active-tab="props.activeTab" />
      <button
        v-if="props.activeTab === 'questions'"
        class="campus-entry"
        type="button"
        title="打开校园题库"
        @click="$emit('navigate', 'campus')"
      >
        <svg class="campus-entry-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M309.312 384a32 32 0 0 1 32-32h128a32 32 0 1 1 0 64h-128a32 32 0 0 1-32-32zM309.312 554.688a32 32 0 0 1 32-32h128a32 32 0 1 1 0 64h-128a32 32 0 0 1-32-32z" fill="currentColor"/>
          <path d="M568.704 147.776L351.04 84.48C303.488 70.784 264.32 59.392 232.832 55.168c-32.96-4.416-64.192-1.92-90.88 19.008-26.368 20.8-36.736 50.688-41.408 84.16C96 190.656 96 232.64 96 284.096v622.592h-10.688a32 32 0 0 0 0 64h853.376a32 32 0 1 0 0-64H928V615.808c0-28.992 0-53.504-2.304-73.536-2.496-21.184-7.872-40.64-20.928-58.176-12.992-17.472-30.08-28.224-49.728-36.672-18.432-8-41.92-15.04-69.76-23.36l-70.592-21.184v-56.192c0-30.72 0-56.512-2.368-77.44-2.56-22.144-8-42.24-21.12-60.352-13.312-18.112-30.784-29.184-51.008-37.76-18.944-8.128-43.008-15.104-71.488-23.36z m145.92 321.92l50.56 15.104c30.016 9.024 49.92 15.04 64.512 21.376 13.888 5.952 19.904 10.944 23.744 16.128 3.84 5.184 6.912 12.352 8.64 27.392 1.92 15.872 1.92 36.608 1.92 67.968v289.024h-149.312V469.696z m-64 436.992H544v-97.92c0-18.496 0-35.392-1.856-49.216-2.048-15.104-6.848-31.168-20.032-44.352-13.184-13.184-29.184-17.984-44.352-20.032a395.904 395.904 0 0 0-49.216-1.856H382.08c-18.432 0-35.392 0-49.152 1.92-15.168 1.984-31.232 6.784-44.416 19.968-13.184 13.184-17.92 29.248-20.032 44.352-1.792 13.824-1.792 30.72-1.792 49.216v97.92H160V286.592c0-54.528 0.064-92.032 3.904-119.424 3.776-26.688 10.24-36.864 17.664-42.688 7.04-5.568 17.536-9.216 42.752-5.888 26.112 3.52 60.672 13.44 111.36 28.16l213.376 61.952c30.72 8.96 51.072 14.848 66.048 21.248 14.08 6.016 20.288 11.136 24.32 16.768 4.224 5.696 7.424 13.568 9.28 29.696 1.92 16.896 1.92 39.04 1.92 72.128v558.08z m-170.624 0H330.688v-96c0-21.056 0-33.6 1.28-42.56a30.08 30.08 0 0 1 1.536-7.104l0.192-0.32v-0.128l0.064-0.128h0.128a30.592 30.592 0 0 1 7.552-1.792c8.96-1.28 21.568-1.28 42.56-1.28h42.688c20.992 0 33.536 0 42.56 1.28a30.592 30.592 0 0 1 7.552 1.728l0.128 0.192 0.064 0.128 0.128 0.32a30.016 30.016 0 0 1 1.6 7.04c1.216 9.024 1.28 21.568 1.28 42.624v96z" fill="currentColor"/>
        </svg>
        <span class="campus-entry-text">想将题库分享给同学？试试校园题库吧</span>
      </button>

    </div>

    <div class="header-right" :class="{ 'header-right--macos': isMacOS }">
      <div
        v-if="tipVisible && tipText"
        class="update-tip"
        :class="`update-tip--${status}`"
        data-tauri-drag-region-exclude
      >
        <button
          type="button"
          class="update-tip-main"
          :title="tipTitle"
          @click="handleTipClick"
        >
          <span
            class="update-tip-icon-wrap"
            :class="{ 'is-progress': status === 'downloading' || status === 'installing' }"
            aria-hidden="true"
          >
            <svg
              v-if="status === 'downloading' || status === 'installing'"
              class="update-tip-ring"
              viewBox="0 0 36 36"
            >
              <circle class="update-tip-ring-bg" cx="18" cy="18" r="15.5" />
              <circle
                class="update-tip-ring-fg"
                cx="18"
                cy="18"
                r="15.5"
                :style="ringStyle"
              />
            </svg>
            <svg
              class="update-tip-icon"
              viewBox="0 0 1024 1024"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M307.173388 679.532423c0 28.903692-22.882089 52.26751-51.183621 52.267509h-51.123405C101.174367 731.920364 13.800914 652.796507 1.456629 547.599112-10.82744 442.401716 55.771484 344.49046 156.57311 319.561025 177.046558 156.255165 301.69373 27.031576 461.266196 3.727974c159.452034-23.243386 314.568515 65.213955 378.939445 216.17553 121.997667 36.731775 199.074179 159.452034 180.828723 288.073463-18.245456 128.621429-126.212788 224.003613-253.449249 223.822965a51.725565 51.725565 0 0 1-51.123405-52.267509c0-28.903692 22.882089-52.26751 51.183621-52.26751 76.35392 0.180648 141.266795-57.024576 152.226111-134.281736 10.959317-77.196944-35.346807-150.901359-108.569493-172.880208l-45.764179-13.849685-19.08848-44.559859c-45.884611-107.846901-156.682097-171.073727-270.671032-154.51432-113.928719 16.619623-203.048436 108.930789-217.68093 225.56923L249.305788 404.224756l-68.525836 16.920703c-49.979301 12.826013-82.917466 61.600994-76.835648 113.92872 6.142035 52.387942 49.37714 91.829438 100.982274 92.190734h51.183621c28.241316 0 51.183621 23.424034 51.183621 52.26751z m385.743856 107.003876a53.050318 53.050318 0 0 1 0 73.885063l-145.000188 148.010989a50.461029 50.461029 0 0 1-72.379662 0L330.597422 860.421362a53.050318 53.050318 0 0 1 0.60216-73.222687 50.400813 50.400813 0 0 1 71.777502-0.662376l57.747168 59.011704V418.25509c0-28.903692 22.882089-52.26751 51.183621-52.26751 28.241316 0 51.123405 23.363818 51.123405 52.26751v427.112265l57.626736-58.831056a50.400813 50.400813 0 0 1 72.25923 0z" fill="currentColor"/>
            </svg>
          </span>
          <span class="update-tip-text">{{ tipText }}</span>
        </button>
      </div>

      <div
        v-if="showStudyChip && linkedSubject"
        class="study-status"
        :class="{ 'is-evaluating': studyEvalRunning }"
        data-tauri-drag-region-exclude
      >
        <div
          class="study-status-main"
          :title="studyEvalRunning
            ? `正在评估 ${linkedSubject.name} 的学习效果`
            : `正在学习 ${linkedSubject.name}，Agent 能看到掌握进度`"
        >
          <span class="study-status-kicker" :class="{ 'is-eval': studyEvalRunning }">
            {{ studyEvalRunning ? '正在评估' : '正在学习' }}
          </span>
          <span class="study-status-name">{{ linkedSubject.name }}</span>
          <span class="study-status-progress">{{ subjectProgress(linkedSubject) }}%</span>
          <span class="study-status-bar" aria-hidden="true">
            <span :style="{ width: `${subjectProgress(linkedSubject)}%`, background: barColor(linkedSubject.progress) }" />
          </span>
        </div>
        <button
          type="button"
          class="study-status-graph"
          title="展开知识图谱"
          @click="expandStudyGraph(linkedSubject.id)"
        >
          <svg class="study-status-graph-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path class="edge" d="M8.1 8.4 10.6 10.7M15.9 9.1 13.5 10.8M8.7 16.2 10.7 13.9M15.6 15.8 13.5 13.9" />
            <circle class="node" cx="6.2" cy="6.8" r="2.35" />
            <circle class="node" cx="17.8" cy="7.6" r="2.35" />
            <circle class="node" cx="12" cy="12" r="2.55" />
            <circle class="node" cx="7" cy="17.8" r="2.35" />
            <circle class="node" cx="17.4" cy="17.4" r="2.35" />
          </svg>
        </button>
      </div>

      <div class="user-entry" data-tauri-drag-region-exclude>
        <button
          class="user-chip"
          type="button"
          :title="isLoggedIn ? userDisplayName() : '登录校园账号'"
          @click="onUserChipClick"
        >
          <img v-if="isLoggedIn && avatarSrc" class="user-avatar user-avatar-img" :src="avatarSrc" alt="" />
          <span v-else class="user-avatar">
            <svg class="user-avatar-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M512 447.223c-88.224 0-160-71.776-160-160s71.776-160 160-160c88.225 0 160 71.776 160 160s-71.775 160-160 160z m0-256c-52.935 0-96 43.065-96 96s43.065 96 96 96 96-43.065 96-96-43.065-96-96-96zM454.901 870.594c-96.594 0-184.933-3.802-231.263-49.955C203.308 800.386 193 774.164 193 742.701c0-31.629 10.247-62.812 30.457-92.686 17.978-26.573 42.908-50.741 74.098-71.833C359.256 536.46 437.418 512.53 512 512.53c74.55 0 152.55 23.943 214.002 65.691 31.05 21.094 55.861 45.273 73.746 71.867C819.822 679.937 830 711.096 830 742.701c0 31.552-10.317 57.827-30.664 78.097-50.714 50.521-151.822 50.128-258.88 49.723a7395.45 7395.45 0 0 0-56.914-0.001c-9.605 0.037-19.163 0.074-28.641 0.074zM512 806.447c9.567 0 19.149 0.037 28.701 0.073 49.52 0.191 96.284 0.37 135.808-4.396 38.418-4.633 64.546-13.604 77.659-26.668 5.079-5.06 11.832-13.96 11.832-32.755 0-38.089-27.688-78.744-75.963-111.54C638.933 596.442 574.04 576.53 512 576.53c-126.309 0-255 83.862-255 166.171 0 18.675 6.738 27.547 11.807 32.596 32.045 31.922 128.975 31.55 214.491 31.224 9.556-0.037 19.139-0.074 28.702-0.074z" fill="currentColor"/>
            </svg>
          </span>
          <span class="user-chip-text">{{ isLoggedIn ? userDisplayName() : '登录' }}</span>
        </button>
        <div v-if="userMenuOpen && isLoggedIn" class="user-menu">
          <div class="user-menu-name">{{ userDisplayName() }}</div>
          <div v-if="authUser?.campus_name" class="user-menu-meta">{{ authUser.campus_name }}</div>
          <div class="user-menu-divider" aria-hidden="true"></div>
          <button class="user-menu-item" type="button" @click="pickAvatar">{{ avatarUploading ? '上传中…' : '更换头像' }}</button>
          <button class="user-menu-item" type="button" @click="goCampus">校园题库</button>
          <button class="user-menu-item is-danger" type="button" @click="handleLogout">退出登录</button>
        </div>
        <input
          ref="avatarInput"
          class="avatar-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          @change="onAvatarPicked"
        />
      </div>

      <template v-if="!isMacOS">
        <button
          class="window-control minimize"
          @click="minimizeWindow"
          title="最小化"
        >
          <svg class="window-control-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M863.7 552.5H160.3c-10.6 0-19.2-8.6-19.2-19.2v-41.7c0-10.6 8.6-19.2 19.2-19.2h703.3c10.6 0 19.2 8.6 19.2 19.2v41.7c0 10.6-8.5 19.2-19.1 19.2z" fill="currentColor"/>
          </svg>
        </button>

        <button
          class="window-control maximize"
          @click="toggleMaximize"
          :title="isMaximized ? '还原' : '最大化'"
        >
          <svg class="window-control-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" v-if="!isMaximized">
            <path d="M770.9 923.3H253.1c-83.8 0-151.9-68.2-151.9-151.9V253.6c0-83.8 68.2-151.9 151.9-151.9h517.8c83.8 0 151.9 68.2 151.9 151.9v517.8c0 83.8-68.1 151.9-151.9 151.9zM253.1 181.7c-39.7 0-71.9 32.3-71.9 71.9v517.8c0 39.7 32.3 71.9 71.9 71.9h517.8c39.7 0 71.9-32.3 71.9-71.9V253.6c0-39.7-32.3-71.9-71.9-71.9H253.1z" fill="currentColor"/>
          </svg>
          <svg class="window-control-icon" viewBox="0 0 12 12" v-else>
            <rect x="2" y="3" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
            <rect x="4" y="1" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
        </button>

        <button
          class="window-control close"
          @click="closeWindow"
          title="关闭"
        >
          <svg class="window-control-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M897.6 183.5L183 898.1c-7.5 7.5-19.6 7.5-27.1 0l-29.5-29.5c-7.5-7.5-7.5-19.6 0-27.1L841 126.9c7.5-7.5 19.6-7.5 27.1 0l29.5 29.5c7.5 7.4 7.5 19.6 0 27.1z" fill="currentColor"/>
            <path d="M183 126.9l714.7 714.7c7.5 7.5 7.5 19.6 0 27.1l-29.5 29.5c-7.5 7.5-19.6 7.5-27.1 0L126.4 183.5c-7.5-7.5-7.5-19.6 0-27.1l29.5-29.5c7.4-7.5 19.6-7.5 27.1 0z" fill="currentColor"/>
          </svg>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
import HeaderTutorialStepper from './appHeader/HeaderTutorialStepper.vue'
import HeaderBrowserTabs from './appHeader/HeaderBrowserTabs.vue'
import { activeChat, chatListCollapsed, setChatListCollapsed, studyEvalRunning } from '../services/agent/chat'
import { useAppUpdate } from '../composables/useAppUpdate'
import { useExclusiveMenu } from '../composables/useExclusiveMenu'
import { databaseService, type StudySubject } from '../services/app/database'
import { progressColor } from '../utils/study/studyGraph'
import { authUser, isLoggedIn, logoutAuth, openLoginDialog, uploadAuthAvatar, userAvatarSrc, userDisplayName } from '../services/app/auth'

const STUDY_STORAGE_KEY = 'zerror-study-subject'

const props = defineProps<{
  activeTab?: string
}>()

const emit = defineEmits<{
  'guide-to': [target: string]
  navigate: [tab: string]
}>()

const {
  tipVisible,
  tipText,
  tipTitle,
  status,
  progress,
  handleTipClick,
} = useAppUpdate()

const RING_C = 2 * Math.PI * 15.5
const ringStyle = computed(() => {
  const pct = Math.min(100, Math.max(status.value === 'installing' ? 100 : progress.value, 4))
  const offset = RING_C * (1 - pct / 100)
  return {
    strokeDasharray: `${RING_C}`,
    strokeDashoffset: `${offset}`,
  }
})

const isMaximized = ref(false)
const isTauri = ref(false)
const isMacOS = ref(false)

const studySubjects = ref<StudySubject[]>([])
const userMenuOpen = ref(false)
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)
const avatarSrc = computed(() => userAvatarSrc())
useExclusiveMenu('header-user-menu', userMenuOpen)

const showStudyChip = computed(() => {
  const tab = props.activeTab || ''
  return tab === 'agent' || tab === 'import-tasks'
})

const showExpandChats = computed(() => showStudyChip.value && chatListCollapsed.value)

const linkedSubject = computed(() => {
  const id = Number(activeChat.value?.studySubjectId)
  if (!Number.isFinite(id) || id <= 0) return null
  return studySubjects.value.find((item) => item.id === id) || null
})

const subjectProgress = (subject: StudySubject) => Math.round((Number(subject.progress) || 0) * 100)
const barColor = (progress: number) => progressColor(progress)

const loadStudySubjects = async () => {
  try {
    studySubjects.value = await databaseService.listStudySubjects()
  } catch {
    studySubjects.value = []
  }
}

const openStudyGraphPane = (id: number) => {
  localStorage.setItem(STUDY_STORAGE_KEY, String(id))
  window.dispatchEvent(new CustomEvent('open-study-graph', { detail: { subjectId: id, expand: true } }))
}

const expandStudyGraph = (id: number) => {
  openStudyGraphPane(id)
}

const closeUserMenu = (event: Event) => {
  const target = event.target as HTMLElement | null
  if (target?.closest('.user-entry')) return
  userMenuOpen.value = false
}

onMounted(() => {
  void loadStudySubjects()
  window.addEventListener('study-graph-updated', loadStudySubjects)
  document.addEventListener('mousedown', closeUserMenu, true)
})

onUnmounted(() => {
  window.removeEventListener('study-graph-updated', loadStudySubjects)
  document.removeEventListener('mousedown', closeUserMenu, true)
})

const minimizeWindow = async () => {
  console.log('Minimize button clicked')
  console.log('isTauri.value:', isTauri.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping minimize')
    return
  }
  
  try {
    console.log('Attempting to minimize window...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.minimize()
    console.log('Window minimized successfully')
  } catch (error) {
    console.error('Failed to minimize window:', error)
  }
}

const toggleMaximize = async () => {
  console.log('Maximize/Restore button clicked')
  console.log('isTauri.value:', isTauri.value)
  console.log('isMaximized.value:', isMaximized.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping maximize/restore')
    return
  }
  
  try {
    console.log('Attempting to toggle maximize...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    if (isMaximized.value) {
      console.log('Unmaximizing window...')
      await appWindow.unmaximize()
    } else {
      console.log('Maximizing window...')
      await appWindow.maximize()
    }
    isMaximized.value = !isMaximized.value
    console.log('Window toggle completed, new state:', isMaximized.value)
  } catch (error) {
    console.error('Failed to toggle maximize:', error)
  }
}

const closeWindow = async () => {
  console.log('Close button clicked')

  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping close')
    return
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.close()
    console.log('Window closed successfully')
  } catch (error) {
    console.error('Failed to close window:', error)
  }
}

const onUserChipClick = () => {
  if (!isLoggedIn.value) {
    openLoginDialog()
    return
  }
  userMenuOpen.value = !userMenuOpen.value
}

const goCampus = () => {
  userMenuOpen.value = false
  emit('navigate', 'campus')
}

const pickAvatar = () => {
  if (avatarUploading.value) return
  avatarInput.value?.click()
}

const onAvatarPicked = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    window.alert('请选择 JPG、PNG 或 WebP 图片')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    window.alert('图片不能超过 5MB')
    return
  }
  avatarUploading.value = true
  try {
    await uploadAuthAvatar(file)
    userMenuOpen.value = false
  } catch (error) {
    window.alert(error instanceof Error ? error.message : '上传头像失败')
  } finally {
    avatarUploading.value = false
  }
}

const handleLogout = async () => {
  userMenuOpen.value = false
  await logoutAuth()
}

// 检测是否在Tauri环境中运行
const checkTauriEnvironment = () => {
  console.log('Checking Tauri environment...')
  console.log('window.__TAURI__:', typeof window !== 'undefined' ? window.__TAURI__ : 'window undefined')
  console.log('window.__TAURI_INTERNALS__:', typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : 'window undefined')
  
  // 更新检测逻辑，使用 __TAURI_INTERNALS__ 作为检测标准
  const isTauriEnv = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined
  console.log('Tauri environment detected:', isTauriEnv)
  
  // 检测是否是 macOS
  if (typeof window !== 'undefined') {
    isMacOS.value = navigator.platform.toLowerCase().includes('mac') || 
                    navigator.userAgent.toLowerCase().includes('mac')
    console.log('macOS detected:', isMacOS.value)
  }
  
  return isTauriEnv
}

// 监听窗口状态变化
onMounted(async () => {
  isTauri.value = checkTauriEnvironment()
  
  if (!isTauri.value) {
    console.log('Running in browser environment, Tauri APIs disabled')
    return
  }
  
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    isMaximized.value = await appWindow.isMaximized()
    
    // 监听窗口最大化/还原事件
    const unlistenResize = await appWindow.onResized(() => {
      appWindow.isMaximized().then(maximized => {
        isMaximized.value = maximized
      })
    })
    
    // 组件卸载时清理监听器
    return () => {
      unlistenResize()
    }
  } catch (error) {
    console.error('Failed to setup window listeners:', error)
  }
})
</script>

<style scoped src="./AppHeader.css"></style>
