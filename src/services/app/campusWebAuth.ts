import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { themeState } from '../../composables/useTheme'
import {
  acceptCampusWebSession, authReady, authRevision, authToken, authUser, clearAuthSession,
} from './auth'

export const CAMPUS_ORIGIN = 'https://tiku.zerrorai.com'
export const CAMPUS_WORKSPACE_URL = `${CAMPUS_ORIGIN}/campus?embed=1`
const CHANNEL = 'zerror-campus-auth-v1'

export function useCampusWebAuth(frame: Ref<HTMLIFrameElement | null>) {
  const error = ref('')
  let port: MessagePort | null = null
  let proposal = 0

  const publishTheme = () => {
    port?.postMessage({ type: 'theme', theme: themeState.value.effective })
  }

  const publish = () => {
    if (!authReady.value || !port) return
    const user = authUser.value
    port.postMessage({
      type: 'session',
      revision: authRevision.value,
      token: authToken.value,
      user: user ? {
        id: user.id, nickname: user.nickname, created_at: user.created_at, status: user.status,
      } : null,
    })
  }

  const connect = () => {
    const target = frame.value?.contentWindow
    if (!target) return
    error.value = ''
    port?.close()
    proposal++
    const channel = new MessageChannel()
    const current = channel.port1
    port = current
    current.onmessage = async ({ data }) => {
      if (port === current && data?.type === 'storage-error') {
        error.value = '校园题库无法保存登录状态，请重新打开软件'
        return
      }
      if (port !== current || !authReady.value || !data || data.type !== 'change') return
      if (data.revision !== authRevision.value) { publish(); return }
      const request = ++proposal
      error.value = ''
      if (data.token === '') {
        clearAuthSession()
        publish()
        return
      }
      if (typeof data.token !== 'string' || !data.token.trim() || data.token.length > 16384) {
        publish()
        return
      }
      try {
        await acceptCampusWebSession(data.token, data.revision,
          () => port === current && proposal === request)
      } catch {
        if (port === current && proposal === request) error.value = '网页登录同步失败，请重新登录'
      }
      if (port === current && proposal === request) publish()
    }
    target.postMessage({ channel: CHANNEL, type: 'connect' }, CAMPUS_ORIGIN, [channel.port2])
    publishTheme()
    publish()
  }

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== CAMPUS_ORIGIN || event.source !== frame.value?.contentWindow) return
    if (event.data?.channel === CHANNEL && event.data?.type === 'ready') connect()
  }

  watch(() => themeState.value.effective, publishTheme)
  watch([authReady, authRevision, authToken, authUser], publish)
  onMounted(() => window.addEventListener('message', onMessage))
  onUnmounted(() => {
    window.removeEventListener('message', onMessage)
    port?.close()
    port = null
    proposal++
  })
  return { connect, error }
}
