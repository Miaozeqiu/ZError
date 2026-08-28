import { ref, watch } from 'vue'
import { serverRunning as globalServerRunning } from '../app/serverState'

export const serverRunning = ref(false)
export const isToggling = ref(false)
export const serverUrl = ref('')
export const serverPort = ref<number | null>(null)
export const isTauri = ref(false)

watch(serverRunning, (val) => {
  globalServerRunning.value = val
})
