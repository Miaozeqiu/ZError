import { chaoxingPlatformAdapter } from './chaoxing/adapter'
import { registerPlatformAdapter } from './registry'

export type {
  HomeworkAction,
  HomeworkToolArgs,
  PlatformAdapter,
  PlatformId,
  PlatformRole,
  StudyPlayOptions,
} from './types'

export {
  getPlatformAdapter,
  listPlatformAdapters,
  registerPlatformAdapter,
  resolvePlatformAdapter,
  resolvePlatformRole,
} from './registry'

export {
  isPlatformTool,
  normalizePlatformTool,
  PLATFORM_TOOLS,
  usedPlatformTool,
  type PlatformToolName,
} from './toolNames'

let registered = false

/** 注册内置平台适配器（幂等）。 */
export const ensurePlatformAdapters = () => {
  if (registered) return
  registerPlatformAdapter(chaoxingPlatformAdapter)
  registered = true
}

ensurePlatformAdapters()
