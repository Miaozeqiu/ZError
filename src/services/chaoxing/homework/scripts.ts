import { homeworkScript } from '../../agent/skillRuntime'

/** 作业解析器脚本来自 Skill `parsers/homework/`，这里只做调用。 */
export const READ_HOMEWORK_SNAPS = () => homeworkScript('snaps')
export const STASH_HOMEWORK = () => homeworkScript('stash')
export const START_HW_IMG = (index: number) => homeworkScript('startImg', index)
export const READ_HW_IMG_META = () => homeworkScript('imgMeta')
export const READ_HW_IMG_CHUNK = () => homeworkScript('imgChunk')
export const READ_HOMEWORK_LIVE = () => homeworkScript('live')
export const READ_HW_FILL_STATE = () => homeworkScript('fillState')
export const INSTALL_HW_LIVE_HOOK = () => homeworkScript('liveHook')
export const READ_HW_DIRTY = () => homeworkScript('dirty')
export const DEBUG_HW_BOX = (index: number) => homeworkScript('debugBox', index)
export const READ_HW_PICKED = (index: number) => homeworkScript('picked', index)
export const PICK_HW_IN_FRAMES = (index: number, letter: string) => homeworkScript('pickInFrames', index, letter)
