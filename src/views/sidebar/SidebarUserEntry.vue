<template>
  <div ref="entryRef" class="user-entry" data-tauri-drag-region-exclude @keydown.esc="userMenuOpen = false">
    <button
      class="user-chip"
      type="button"
      :title="isLoggedIn ? userDisplayName() : '登录校园账号'"
      :aria-label="isLoggedIn ? userDisplayName() : '登录校园账号'"
      :aria-expanded="isLoggedIn ? userMenuOpen : undefined"
      @click="onUserChipClick"
      @pointerenter="lookAt('pointer')"
      @pointerleave="lookAt('rest')"
    >
      <Blobatar
        v-if="isLoggedIn"
        ref="avatar"
        class="user-avatar"
        :name="avatarSeed"
        :size="28"
        background="circle"
        animate="always"
        aria-hidden="true"
      />
      <span v-else class="user-avatar user-avatar-guest">
        <svg class="user-avatar-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M512 447.223c-88.224 0-160-71.776-160-160s71.776-160 160-160c88.225 0 160 71.776 160 160s-71.775 160-160 160z m0-256c-52.935 0-96 43.065-96 96s43.065 96 96 96 96-43.065 96-96-43.065-96-96-96zM454.901 870.594c-96.594 0-184.933-3.802-231.263-49.955C203.308 800.386 193 774.164 193 742.701c0-31.629 10.247-62.812 30.457-92.686 17.978-26.573 42.908-50.741 74.098-71.833C359.256 536.46 437.418 512.53 512 512.53c74.55 0 152.55 23.943 214.002 65.691 31.05 21.094 55.861 45.273 73.746 71.867C819.822 679.937 830 711.096 830 742.701c0 31.552-10.317 57.827-30.664 78.097-50.714 50.521-151.822 50.128-258.88 49.723a7395.45 7395.45 0 0 0-56.914-0.001c-9.605 0.037-19.163 0.074-28.641 0.074zM512 806.447c9.567 0 19.149 0.037 28.701 0.073 49.52 0.191 96.284 0.37 135.808-4.396 38.418-4.633 64.546-13.604 77.659-26.668 5.079-5.06 11.832-13.96 11.832-32.755 0-38.089-27.688-78.744-75.963-111.54C638.933 596.442 574.04 576.53 512 576.53c-126.309 0-255 83.862-255 166.171 0 18.675 6.738 27.547 11.807 32.596 32.045 31.922 128.975 31.55 214.491 31.224 9.556-0.037 19.139-0.074 28.702-0.074z" fill="currentColor"/>
        </svg>
      </span>
      <span class="user-chip-text">{{ isLoggedIn ? userDisplayName() : '登录' }}</span>
    </button>
    <div v-if="userMenuOpen && isLoggedIn" class="user-menu">
      <div class="user-menu-name">{{ userDisplayName() }}</div>
      <div v-if="authUser" class="user-menu-meta user-menu-identity">
        <span v-if="authUser.id > 0" class="user-menu-id">#{{ authUser.id }}</span>
        <span class="user-menu-status" :class="certificationStatus.tone">{{ certificationStatus.label }}</span>
      </div>
      <div v-if="authUser?.campus_name" class="user-menu-meta">{{ authUser.campus_name }}</div>
      <div class="user-menu-divider" aria-hidden="true"></div>
      <button class="user-menu-item" type="button" @click="goCampus">校园题库</button>
      <button class="user-menu-item is-danger" type="button" @click="handleLogout">退出登录</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Blobatar } from '@blobatar/vue'
import { useGaze } from '@blobatar/vue/gaze'
import 'blobatar/motion.css'
import 'blobatar/gaze.css'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useExclusiveMenu } from '../../composables/useExclusiveMenu'
import { authUser, isLoggedIn, logoutAuth, openLoginDialog, userDisplayName } from '../../services/app/auth'

const emit = defineEmits<{ navigate: [tab: string] }>()
const entryRef = ref<HTMLElement | null>(null)
const userMenuOpen = ref(false)
const avatar = ref<InstanceType<typeof Blobatar> | null>(null)
const { lookAt } = useGaze(avatar, { travel: 3, target: 'rest' })
const avatarSeed = computed(() => {
  const user = authUser.value
  // 使用与网站一致的种子，同一账号在两端生成同一头像。
  const identity = user && user.id > 0 ? user.id : user?.nickname?.trim()
  return `ze-user-${identity || 'guest'}`
})
const certificationStatus = computed(() => {
  switch (authUser.value?.status) {
    case 'verified': return { label: '已认证', tone: 'is-verified' }
    case 'pending': return { label: '审核中', tone: 'is-pending' }
    case 'banned': return { label: '已限制', tone: 'is-restricted' }
    default: return { label: '未认证', tone: 'is-unverified' }
  }
})
useExclusiveMenu('sidebar-user-menu', userMenuOpen)

const closeUserMenu = (event: Event) => {
  if (event.target instanceof Node && entryRef.value?.contains(event.target)) return
  userMenuOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', closeUserMenu, true))
onUnmounted(() => document.removeEventListener('mousedown', closeUserMenu, true))

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

const handleLogout = async () => {
  userMenuOpen.value = false
  await logoutAuth()
}

</script>

<style scoped>
.user-entry {
  position: relative;
  margin: 4px;
  flex: 0 0 auto;
  -webkit-app-region: no-drag;
}

.user-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border-primary, #d2d2d7) 72%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 82%, transparent);
  color: var(--text-primary, #2d3748);
  cursor: pointer;
}

.user-chip:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, var(--bg-secondary, #fff));
}

.user-chip:active {
  transform: scale(0.97);
}

.user-avatar {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}

.user-avatar-guest {
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #f5b942 22%, var(--bg-secondary, #fff));
  color: #8a5a00;
}

.user-avatar-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.user-chip-text {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.user-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 40;
  width: 180px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
  background: color-mix(in srgb, var(--bg-secondary, #fff) 94%, transparent);
  box-shadow: 0 10px 28px color-mix(in srgb, #000 12%, transparent);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.user-menu-name {
  padding: 4px 8px 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.user-menu-meta,
.user-menu-item {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.user-menu-identity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-block: 2px 4px;
}

.user-menu-id {
  font-variant-numeric: tabular-nums;
}

.user-menu-status {
  --status-color: var(--text-secondary, #718096);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.2;
  color: color-mix(in srgb, var(--status-color) 72%, var(--text-primary, #242424));
  background: color-mix(in srgb, var(--status-color) 14%, transparent);
}

.user-menu-status.is-verified { --status-color: var(--color-success, #2f9d5b); }
.user-menu-status.is-pending { --status-color: var(--color-warning, #d48806); }
.user-menu-status.is-restricted { --status-color: var(--color-error, #ff4d4f); }

.user-menu-divider {
  height: 1px;
  margin: 6px 4px;
  background: color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
}

.user-menu-item {
  width: 100%;
  display: block;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
}

.user-menu-item:hover {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.user-menu-item.is-danger {
  color: var(--color-error, #ff3b30);
}

.user-menu-item.is-danger:hover {
  color: var(--color-error, #ff3b30);
  background: color-mix(in srgb, var(--color-error, #ff3b30) 10%, transparent);
}

:global([data-theme="dark"]) .user-chip {
  border-color: color-mix(in srgb, var(--border-primary, #3d3d3f) 88%, transparent);
  background: color-mix(in srgb, var(--bg-tertiary, #3a3a3c) 82%, transparent);
}

:global([data-theme="dark"]) .user-chip:hover {
  background: color-mix(in srgb, var(--bg-tertiary, #3a3a3c) 96%, transparent);
}

:global([data-theme="dark"]) .user-avatar-guest {
  background: color-mix(in srgb, #f5d08a 20%, var(--bg-tertiary, #3a3a3c));
  color: #f0c674;
}

:global([data-theme="dark"]) .user-menu {
  border-color: color-mix(in srgb, var(--border-primary, #3d3d3f) 90%, transparent);
  background: color-mix(in srgb, var(--bg-tertiary, #3a3a3c) 88%, var(--bg-secondary, #2c2c2e));
  box-shadow:
    0 1px 2px color-mix(in srgb, #000 28%, transparent),
    0 12px 32px color-mix(in srgb, #000 42%, transparent);
}

:global([data-theme="dark"]) .user-menu-item:hover {
  background: color-mix(in srgb, var(--text-primary, #f5f5f7) 8%, transparent);
}

:global([data-theme="dark"]) .user-menu-item.is-danger:hover {
  background: color-mix(in srgb, var(--color-error, #ff453a) 14%, transparent);
}


.user-chip:focus-visible, .user-menu-item:focus-visible { outline: 2px solid var(--color-primary, #2563eb); outline-offset: 2px; }
</style>
