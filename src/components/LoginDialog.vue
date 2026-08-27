<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay dialog-overlay--vue" @click="handleOverlayClick">
      <div class="dialog-panel login-dialog-panel" @click.stop>
        <div class="dialog-header">
          <button class="btn-back" type="button" title="关闭" @click="close">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
              <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
            </svg>
          </button>
          <h3 class="dialog-title">登录 ZError</h3>
          <span class="header-spacer" aria-hidden="true"></span>
        </div>

        <div class="dialog-body">
          <div class="login-layout">
            <div class="qr-col">
              <img class="qr-image" :src="wechatQr" alt="未耕之地公众号二维码" />
              <div class="qr-caption">微信扫码关注「未耕之地」</div>
            </div>
            <div class="code-col">
              <div class="verification-text">
                <span class="verification-label">{{ verificationCode && !busy ? '验证码已生成' : '正在生成验证码' }}</span>
                <div class="verification-code-container">
                  <span v-if="!busy && verificationCode" class="tooltip">{{ copyStatus }}</span>
                  <div
                    class="verification-code-wrapper"
                    :class="{ 'is-loading': busy }"
                    @click="!busy && copyCode()"
                    @mouseleave="!busy && resetCopyStatus()"
                  >
                    <Transition name="verification-code-reveal" mode="out-in">
                      <span
                        :key="busy ? 'loading' : (verificationCode || 'empty')"
                        class="verification-code"
                        :class="{ 'is-placeholder': busy || !verificationCode }"
                      >
                        {{ busy || !verificationCode ? '046582' : verificationCode }}
                      </span>
                    </Transition>
                  </div>
                </div>
                <div class="code-timer-bar">
                  <div class="code-timer-progress" :style="{ width: `${codeTimerPercent}%` }"></div>
                </div>
              </div>
              <p class="hint">
                关注公众号 <strong>未耕之地</strong>，把这串 6 位验证码原样发给它。页面会自动登录。
              </p>
              <p v-if="statusText" class="status" :class="{ 'is-error': Boolean(error) }">{{ statusText }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import wechatQr from '../assets/wechat-oa-qr.jpg'
import { pollWechatLogin, triggerWechatLogin } from '../services/app/auth'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const verificationCode = ref('')
const busy = ref(false)
const error = ref('')
const copyStatus = ref('复制')
const waiting = ref(false)
const codeTimerPercent = ref(100)
const codeIssuedAt = ref(0)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let codeTimerRaf: number | null = null

const statusText = computed(() => {
  if (error.value) return error.value
  if (waiting.value && verificationCode.value) return '等待公众号确认…'
  return ''
})

const stopCodeTimer = () => {
  if (codeTimerRaf != null) {
    cancelAnimationFrame(codeTimerRaf)
    codeTimerRaf = null
  }
}

const startCodeTimer = (startTime: number) => {
  stopCodeTimer()
  const duration = 5 * 60 * 1000
  const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
  const updateProgress = () => {
    const progress = Math.min(Math.max((Date.now() - startTime) / duration, 0), 1)
    codeTimerPercent.value = Math.max(0, (1 - easeOutCubic(progress)) * 100)
    if (progress >= 1) {
      codeTimerPercent.value = 0
      codeTimerRaf = null
      return
    }
    codeTimerRaf = requestAnimationFrame(updateProgress)
  }
  updateProgress()
}

const stopPolling = () => {
  waiting.value = false
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

const close = () => {
  stopPolling()
  emit('close')
}

const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.closest('button') || target.closest('input')) return
  close()
}

const resetCopyStatus = () => {
  copyStatus.value = '复制'
}

const copyCode = async () => {
  if (!verificationCode.value || busy.value) return
  try {
    await writeText(verificationCode.value)
    copyStatus.value = '复制成功'
  } catch {
    try {
      await navigator.clipboard.writeText(verificationCode.value)
      copyStatus.value = '复制成功'
    } catch {
      error.value = '复制失败，请手动抄写'
    }
  }
}

const tick = async () => {
  if (!verificationCode.value) return
  try {
    const result = await pollWechatLogin(verificationCode.value)
    if (result.loggedIn) {
      stopPolling()
      emit('success')
      emit('close')
      return
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/IP mismatch/i.test(message)) {
      stopPolling()
      if (!busy.value) void requestCode()
      return
    }
  }
  pollTimer = setTimeout(() => { void tick() }, 1000)
}

const requestCode = async () => {
  stopPolling()
  busy.value = true
  error.value = ''
  copyStatus.value = '复制'
  codeTimerPercent.value = 100
  try {
    verificationCode.value = await triggerWechatLogin()
    codeIssuedAt.value = Date.now()
    startCodeTimer(codeIssuedAt.value)
    waiting.value = true
    void tick()
  } catch (err) {
    verificationCode.value = ''
    error.value = err instanceof Error ? err.message : '申请验证码失败'
    stopCodeTimer()
    codeTimerPercent.value = 0
  } finally {
    busy.value = false
  }
}

watch(() => props.visible, (open) => {
  if (open) {
    if (!verificationCode.value) void requestCode()
    else {
      if (codeIssuedAt.value) startCodeTimer(codeIssuedAt.value)
      if (!waiting.value) {
        waiting.value = true
        void tick()
      }
    }
    return
  }
  stopPolling()
  stopCodeTimer()
})

onUnmounted(() => {
  stopPolling()
  stopCodeTimer()
})
</script>

<style>
@import '../styles/dialog.css';
</style>

<style scoped>
.login-dialog-panel {
  max-width: 520px;
}

.header-spacer {
  width: 32px;
  flex-shrink: 0;
}

.login-layout {
  display: grid;
  grid-template-columns: 168px 1fr;
  gap: 20px;
  align-items: start;
}

.qr-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.qr-image {
  width: 148px;
  height: 148px;
  object-fit: cover;
  border-radius: 12px;
  background: #fff;
}

.qr-caption {
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.code-col {
  min-width: 0;
}

.verification-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
}

.verification-label {
  font-size: 13px;
  color: var(--text-secondary, #718096);
}

.verification-code-container {
  position: relative;
  display: inline-block;
}

.verification-code-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 4px 8px;
  min-width: 6ch;
  margin-left: -8px;
  border-radius: 8px;
  transition: background 0.2s;
}

.verification-code-wrapper:hover {
  background: rgba(246, 153, 82, 0.08);
}

.verification-code-wrapper.is-loading {
  cursor: default;
  pointer-events: none;
}

.verification-code-wrapper.is-loading:hover {
  background: transparent;
}

.verification-code {
  display: inline-block;
  padding: 3px 6px;
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: 6px;
  min-width: 6ch;
  text-align: center;
  color: #f0a500;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.verification-code-wrapper:hover .verification-code {
  color: #d4920a;
}

.verification-code.is-placeholder {
  color: transparent;
  background-image: linear-gradient(90deg, rgba(224, 178, 122, 0.45) 0%, rgba(246, 153, 82, 0.95) 50%, rgba(224, 178, 122, 0.45) 100%);
  background-size: 200% 100%;
  background-position: 100% 50%;
  -webkit-background-clip: text;
  background-clip: text;
  filter: blur(5px);
  animation: verification-code-loading 1.35s linear infinite;
}

.verification-code-reveal-enter-active,
.verification-code-reveal-leave-active {
  transition: filter 0.45s ease, opacity 0.45s ease, transform 0.45s ease;
}

.verification-code-reveal-enter-from,
.verification-code-reveal-leave-to {
  filter: blur(10px);
  opacity: 0;
  transform: scale(1.04);
}

.verification-code-reveal-enter-to,
.verification-code-reveal-leave-from {
  filter: blur(0);
  opacity: 1;
  transform: scale(1);
}

@keyframes verification-code-loading {
  from {
    filter: blur(6px);
    opacity: 0.55;
    background-position: 100% 50%;
  }
  to {
    filter: blur(3px);
    opacity: 0.95;
    background-position: -100% 50%;
  }
}

.code-timer-bar {
  width: 100%;
  max-width: 220px;
  height: 3px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 8%, transparent);
  border-radius: 2px;
  overflow: hidden;
}

.code-timer-progress {
  height: 100%;
  background: #f0a500;
  border-radius: 2px;
}

.tooltip {
  width: max-content;
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.3em 0.6em;
  opacity: 0;
  pointer-events: none;
  background: #333;
  color: #fff;
  border-radius: 8px;
  font-size: 12px;
  transition: opacity 0.4s cubic-bezier(0.23, 1, 0.32, 1), transform 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  box-shadow: rgba(0, 0, 0, 0.25) 0 8px 15px;
}

.tooltip::before {
  position: absolute;
  content: "";
  height: 0.6em;
  width: 0.6em;
  bottom: -0.2em;
  left: 50%;
  transform: translate(-50%) rotate(45deg);
  background: #333;
}

.verification-code-container:hover .tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(-10px);
  animation: verification-code-shake 0.5s ease-in-out both;
}

@keyframes verification-code-shake {
  0% { rotate: 0; }
  25% { rotate: 7deg; }
  50% { rotate: -7deg; }
  75% { rotate: 1deg; }
  100% { rotate: 0; }
}

.hint,
.status {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary, #718096);
}

.status {
  margin-top: 10px;
}

.status.is-error {
  color: var(--color-error, #e11d48);
}

@media (max-width: 620px) {
  .login-layout {
    grid-template-columns: 1fr;
  }
}
</style>
