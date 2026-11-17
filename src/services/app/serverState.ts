import { ref } from 'vue'

// 全局服务运行状态，供 Sidebar 等组件读取
export const serverRunning = ref(false)
