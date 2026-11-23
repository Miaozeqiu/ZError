import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { parse } from 'yaml'
const workflow = (file: string) => parse(readFileSync(new URL(`../../.github/workflows/${file}.yml`,import.meta.url),'utf8'))
describe('release cannot bypass functional verification', () => {
  it('所有 Actions 工作流都可以解析，避免未覆盖的入口因 YAML 语法错误无法启动', () => {
    const directory = new URL('../../.github/workflows/', import.meta.url)
    for (const file of readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
      expect(() => parse(readFileSync(new URL(file, directory), 'utf8')), file).not.toThrow()
    }
  })
  it('waits for frontend regressions and verified platform builds before signing', () => {
    const release=workflow('release-desktop')
    expect(release.jobs.regression.uses).toBe('./.github/workflows/release-checks.yml')
    expect(release.jobs.sign.needs).toEqual(expect.arrayContaining(['regression','build-desktop']))
    expect(release.jobs.publish.needs).toContain('sign')
  })
  it('runs the entire feature suite on all supported desktop systems', () => {
    const checks=workflow('release-checks')
    expect(checks.jobs.frontend.strategy.matrix.os).toEqual(expect.arrayContaining(['ubuntu-24.04','windows-2025','macos-15']))
    expect(checks.jobs.frontend.steps.some((s:any)=>s.run?.includes('test:release -- --phase frontend'))).toBe(true)
  })
  it('requires native tests and real desktop smoke before uploading installers', () => {
    const builds=workflow('build-desktop')
    expect(builds.jobs.macos['runs-on']).toBe('macos-15')
    for (const platform of ['windows','macos','linux']) {
      const steps=builds.jobs[platform].steps
      const native=steps.findIndex((s:any)=>s.run?.includes('--phase native'))
      const desktop=steps.findIndex((s:any)=>s.run?.includes('--phase desktop'))
      const install=steps.findIndex((s:any)=>s.name?.startsWith('Install the generated'))
      expect(install).toBeGreaterThan(native); expect(desktop).toBeGreaterThan(install)
      const upload=steps.findIndex((s:any)=>/^Upload (installer|macOS packages|Linux packages)$/.test(s.name||''))
      expect(native).toBeGreaterThan(0); expect(desktop).toBeGreaterThan(native); expect(upload).toBeGreaterThan(desktop)
      expect(steps[native]['continue-on-error']).not.toBe(true); expect(steps[desktop]['continue-on-error']).not.toBe(true)
    }
  })
})
