/** 课程壳页内脚本。侧栏页签由宿主读取，不进 Agent Skill。 */
import helpersSrc from './course/helpers.js?raw'
import parseSrc from './course/parse.js?raw'
import { joinParts, pageScript } from './pageScript'

export const courseParseScript = () => (
  pageScript(joinParts(helpersSrc, parseSrc), 'return parse(document, location.href);')
)
