import { ref } from 'vue'

export interface StudyGraphStreamState {
  subjectId?: number
  mermaid: string
  streaming: boolean
}

export const studyGraphStream = ref<StudyGraphStreamState | null>(null)

export const emitStudyGraphStream = (detail: {
  subjectId?: number
  mermaid: string
  streaming?: boolean
}) => {
  const mermaid = String(detail.mermaid || '').trim()
  if (!mermaid) return
  studyGraphStream.value = {
    subjectId: detail.subjectId,
    mermaid,
    streaming: detail.streaming !== false,
  }
  window.dispatchEvent(new CustomEvent('study-graph-stream', { detail: studyGraphStream.value }))
}

export const finishStudyGraphStream = (subjectId?: number) => {
  const current = studyGraphStream.value
  if (!current?.streaming) return
  if (subjectId != null && current.subjectId != null && current.subjectId !== subjectId) return
  studyGraphStream.value = { ...current, streaming: false }
}

export const clearStudyGraphStream = (subjectId?: number) => {
  if (subjectId != null && studyGraphStream.value?.subjectId != null && studyGraphStream.value.subjectId !== subjectId) {
    return
  }
  studyGraphStream.value = null
}
