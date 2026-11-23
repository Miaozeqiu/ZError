import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error 发布工具由 Node 直接运行。
import { featureResults } from '../../scripts/release/report.mjs'

describe('release gate evidence', () => {
  const check = (mutate: (data: any, manifest: any) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'zerror-report-'))
    try {
      const path = join(root, 'feature.test.ts'); writeFileSync(path, '')
      const manifest = { schemaVersion: 1, features: [{ id: 'critical', name: 'Critical flow', tests: ['feature.test.ts'] }] }
      const data = { success: true, numTotalTests: 1, numFailedTests: 0, testResults: [{ name: path, status: 'passed', assertionResults: [{ status: 'passed' }] }] }
      mutate(data, manifest)
      return featureResults(manifest, data, root)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  it('requires actual passing suites for every declared feature', () => { expect(check(() => {})).toEqual([expect.objectContaining({ id: 'critical', status: 'passed', suites: ['feature.test.ts'] })]) })
  it('fails if a feature was filtered out, removed or renamed', () => {
    expect(() => check(data => { data.testResults = [] })).toThrow()
    expect(() => check((_, manifest) => { manifest.features[0].tests = ['missing.test.ts'] })).toThrow()
  })
  it('fails on skipped, todo, failed and empty assertions even if the process exits successfully', () => {
    for (const status of ['skipped', 'pending', 'todo', 'failed']) expect(() => check(data => { data.testResults[0].assertionResults[0].status = status })).toThrow()
    expect(() => check(data => { data.testResults[0].assertionResults = [] })).toThrow()
    expect(() => check(data => { data.numPendingTests = 1 })).toThrow()
  })
})
