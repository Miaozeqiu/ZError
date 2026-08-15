import { computed, ref } from 'vue'

export type ImportTaskStatus = 'queued' | 'reading' | 'analyzing' | 'saving' | 'done' | 'failed'
export type ImportTaskStepStatus = 'running' | 'done' | 'failed'
export type ImportTaskStepKind = 'model' | 'tool'

export interface ImportStepPreview {
  question: string
  options?: string
  answer: string
  question_type?: string
}

export interface ImportTaskStep {
  id: string
  kind: ImportTaskStepKind
  name: string
  label: string
  target?: string
  detail?: string
  preview?: ImportStepPreview[]
  previewCount?: number
  status: ImportTaskStepStatus
  startedAt: number
  finishedAt?: number
}

export interface ImportTask {
  id: string
  fileName: string
  filePath: string
  folderId: number
  folderName: string
  status: ImportTaskStatus
  progressText: string
  importedCount: number
  steps: ImportTaskStep[]
  summary?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

const STORAGE_KEY = 'zerror-agent-import-tasks'
const tasks = ref<ImportTask[]>([])

const loadPersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as ImportTask[]
    if (!Array.isArray(parsed)) return
    tasks.value = parsed.map((task) => {
      const steps = Array.isArray(task.steps) ? task.steps : []
      if (task.status === 'done' || task.status === 'failed') {
        return { ...task, steps }
      }
      return {
        ...task,
        steps: steps.map((step) =>
          step.status === 'running'
            ? { ...step, status: 'failed', detail: step.detail || '应用关闭时中断', finishedAt: Date.now() }
            : step
        ),
        status: 'failed',
        progressText: '应用重启后未完成',
        error: '应用关闭时任务仍在进行，请重新导入',
        finishedAt: Date.now(),
      }
    })
  } catch {
    tasks.value = []
  }
}

const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.value.slice(0, 50)))
  } catch {
    // ignore quota
  }
}

loadPersisted()

export const importTasks = computed(() => tasks.value)
export const runningImportCount = computed(() =>
  tasks.value.filter((task) => task.status !== 'done' && task.status !== 'failed').length
)

export const createImportTask = (input: {
  fileName: string
  filePath: string
  folderId: number
  folderName: string
}): ImportTask => {
  const task: ImportTask = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: input.fileName,
    filePath: input.filePath,
    folderId: input.folderId,
    folderName: input.folderName,
    status: 'queued',
    progressText: '等待识别',
    importedCount: 0,
    steps: [],
    createdAt: Date.now(),
  }
  tasks.value = [task, ...tasks.value].slice(0, 50)
  persist()
  return task
}

export const updateImportTask = (id: string, patch: Partial<ImportTask>) => {
  tasks.value = tasks.value.map((task) => (task.id === id ? { ...task, ...patch } : task))
  persist()
}

const clipDetail = (detail?: string) => {
  if (!detail) return detail
  return detail.length > 240 ? `${detail.slice(0, 239)}…` : detail
}

const clipPreview = (preview?: ImportStepPreview[]) => {
  if (!preview?.length) return preview
  return preview.slice(0, 40).map((item) => ({
    question: String(item.question || '').slice(0, 180),
    options: item.options ? String(item.options).slice(0, 160) : '',
    answer: String(item.answer || '').slice(0, 80),
    question_type: item.question_type ? String(item.question_type).slice(0, 12) : '',
  }))
}

const normalizeStep = (step: ImportTaskStep) => ({
  ...step,
  detail: clipDetail(step.detail),
  preview: clipPreview(step.preview),
})

export const addImportTaskStep = (id: string, step: ImportTaskStep) => {
  tasks.value = tasks.value.map((task) => {
    if (task.id !== id) return task
    return { ...task, steps: [...(task.steps || []), normalizeStep(step)] }
  })
  persist()
}

export const patchImportTaskStep = (id: string, stepId: string, patch: Partial<ImportTaskStep>) => {
  tasks.value = tasks.value.map((task) => {
    if (task.id !== id) return task
    return {
      ...task,
      steps: (task.steps || []).map((step) =>
        step.id === stepId ? normalizeStep({ ...step, ...patch }) : step
      ),
    }
  })
  persist()
}

export const removeImportTask = (id: string) => {
  tasks.value = tasks.value.filter((task) => task.id !== id)
  persist()
}

export const clearFinishedImportTasks = () => {
  tasks.value = tasks.value.filter((task) => task.status !== 'done' && task.status !== 'failed')
  persist()
}
