import { homeworkScript } from '../../agent/skillRuntime'

/** 作业解析器脚本来自 Skill `parsers/homework/`，这里只做调用。 */
export const CHAOXING_CLICK_HOMEWORK_TAB = () => homeworkScript('clickTab')
export const CHAOXING_HOMEWORK_CAPTURE = () => homeworkScript('capture')
export const CHAOXING_HOMEWORK_FILL = () => homeworkScript('fill')
export const CHAOXING_HOMEWORK_SUBMIT = () => homeworkScript('submit')
