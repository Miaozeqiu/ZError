import { configValue, patchConfig, safeCliOutput, type CliHandlerGroup } from '../contracts'

export const configHandlers = {
  'config.get': async p => {
    const { settingsManager } = await import('../../app/settings')
    await settingsManager.ready
    return configValue(safeCliOutput(settingsManager.getSettings()), p.key)
  },
  'config.set': async (p, context) => {
    const { settingsManager } = await import('../../app/settings')
    const saved = await settingsManager.commit(async draft => {
      await context.assertActive()
      Object.assign(draft, patchConfig(draft, p.key, p.value))
    })
    return { key: p.key, value: configValue(safeCliOutput(saved), p.key), saved: true }
  },
} satisfies CliHandlerGroup<'config'>
