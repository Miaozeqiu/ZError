import { computed, onMounted, onUnmounted } from 'vue'
import { settingsApi } from './deps'
import { analyzeUrlQuestion } from './pipeline'
import {
  closeRequestDetails,
  filteredRequestLogs,
  selectedLog,
  showLogDetails,
  showRequestDetails,
  slideInActive,
} from './runtime'
import {
  addSampleLogs,
  bindQuestionServerEvents,
  clearLogs,
  checkTauriEnvironment,
  getServerStatus,
  onVisibilityChange,
  startServer,
  startSSEConnection,
  stopServer,
  unbindQuestionServerEvents,
} from './session'
import {
  isTauri,
  isToggling,
  serverPort,
  serverRunning,
  serverUrl,
} from './serverRefs'

export const useQuestionServer = () => {
  const { settings } = settingsApi
  const configuredPort = computed(() => settings.network.serverPort)
  const networkOpen = computed(() => settings.network.enableLanAccess)

  onMounted(async () => {
    serverPort.value = configuredPort.value
    await checkTauriEnvironment()
    setTimeout(async () => {
      await getServerStatus()
      if (serverRunning.value) startSSEConnection()
    }, 100)
    await bindQuestionServerEvents()
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (!isTauri.value) addSampleLogs()
  })

  onUnmounted(() => {
    unbindQuestionServerEvents()
  })

  return {
    serverRunning,
    isToggling,
    serverUrl,
    serverPort,
    configuredPort,
    networkOpen,
    isTauri,
    filteredRequestLogs,
    selectedLog,
    showLogDetails,
    slideInActive,
    startServer,
    stopServer,
    showRequestDetails,
    closeRequestDetails,
    clearLogs,
    analyzeUrlQuestion,
  }
}
