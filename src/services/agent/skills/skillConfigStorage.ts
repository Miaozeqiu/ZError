import type { SkillConfigFile } from './skillTypes'

const STORAGE_KEY = 'zerror-agent-skills'
const CONFIG_FILE = 'agent-skills.json'
const defaultConfig = (): SkillConfigFile => ({ version: 1, skills: {} })

export function createSkillConfigStorage(migrateSkillConfig: (config: SkillConfigFile) => SkillConfigFile, onWrite: (config: SkillConfigFile) => void) {
const readLocal = (): SkillConfigFile => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as SkillConfigFile
    if (!raw || typeof raw !== 'object') return defaultConfig()
    return migrateSkillConfig({
      version: Number(raw.version) || 1,
      skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {},
    })
  } catch {
    return defaultConfig()
  }
}

const writeLocal = (config: SkillConfigFile) => {
  onWrite(config)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // quota
  }
}

const persistFile = (config: SkillConfigFile) => {
  void import('@tauri-apps/plugin-fs').then(async ({ writeTextFile, mkdir, BaseDirectory }) => {
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await writeTextFile(`.local/share/zerror/${CONFIG_FILE}`, JSON.stringify(config), {
      baseDir: BaseDirectory.Home,
    })
  }).catch(() => undefined)
}

const loadFile = async (): Promise<SkillConfigFile> => {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${CONFIG_FILE}`, {
      baseDir: BaseDirectory.Home,
    })) as SkillConfigFile
    if (!raw || typeof raw !== 'object') return defaultConfig()
    return migrateSkillConfig({
      version: Number(raw.version) || 1,
      skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {},
    })
  } catch {
    return defaultConfig()
  }
}


return { readLocal, writeLocal, persistFile, loadFile }
}
