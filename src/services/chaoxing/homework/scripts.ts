import {
  homeworkDebugBoxScript,
  homeworkInvokeScript,
  homeworkLocateScript,
  homeworkProbeScript,
  homeworkReadDomScript,
  homeworkReadFillStateScript,
  homeworkReadLiveScript,
  homeworkReadPickedScript,
} from '../../parser/homeworkRuntime'

export const READ_HOMEWORK_DOM = () => homeworkReadDomScript()
export const READ_HOMEWORK_LIVE = () => homeworkReadLiveScript()
export const PROBE_HOMEWORK_PAGE = () => homeworkProbeScript()
export const READ_HW_FILL_STATE = () => homeworkReadFillStateScript()
export const DEBUG_HW_BOX = (index: number) => homeworkDebugBoxScript(index)
export const READ_HW_PICKED = (index: number) => homeworkReadPickedScript(index)

export const LOCATE_HW_TAB = () => homeworkLocateScript({ kind: 'control', name: 'homework-tab' })
export const LOCATE_HW_PICK = (index: number, letter: string) => (
  homeworkLocateScript({ kind: 'option', index, letter })
)
export const INVOKE_HW_PICK = (index: number, letter: string) => (
  homeworkInvokeScript({ kind: 'option', index, letter })
)
export const LOCATE_HW_BLANK = (index: number, slot = 0) => (
  homeworkLocateScript({ kind: 'blank', index, slot })
)
export const LOCATE_HW_SAVE = () => homeworkLocateScript({ kind: 'control', name: 'save' })
export const LOCATE_HW_SUBMIT = () => homeworkLocateScript({ kind: 'control', name: 'submit' })
export const LOCATE_HW_CONFIRM = () => homeworkLocateScript({ kind: 'control', name: 'confirm' })
export const INVOKE_HW_SAVE = () => homeworkInvokeScript({ kind: 'control', name: 'save' })
export const INVOKE_HW_SUBMIT = () => homeworkInvokeScript({ kind: 'control', name: 'submit' })
export const INVOKE_HW_CONFIRM = () => homeworkInvokeScript({ kind: 'control', name: 'confirm' })
