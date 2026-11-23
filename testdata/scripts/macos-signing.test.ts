import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { selectMacosSigningIdentity, signDevelopmentBinary, macosCargoRunner } from '../../scripts/sign-macos-dev.mjs'
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, mkdtempSync: vi.fn(actual.mkdtempSync), writeFileSync: vi.fn(actual.writeFileSync), rmSync: vi.fn(actual.rmSync) }
})
const identity = 'a'.repeat(40)
const catalog = `  1) ${identity} "Developer ID Application: Example (TEST)"\n  2) ${'b'.repeat(40)} "Apple Development: Example (DEV)"`
describe('stable development code identity', () => {
  it('prefers the unique distribution identity and never picks one arbitrarily when ambiguous', () => {
    expect(selectMacosSigningIdentity(catalog)).toBe(identity)
    expect(selectMacosSigningIdentity(`${catalog}\n3) ${'c'.repeat(40)} "Developer ID Application: Another (OTHER)"`)).toBeUndefined()
    expect(selectMacosSigningIdentity(catalog, { ZERROR_MACOS_SIGNING_IDENTITY: 'chosen identity' })).toBe('chosen identity')
  })
  it('does not use the private signing key again when the executable already has the expected identity', () => {
    const run = vi.fn(() => ({ status: 0 }))
    signDevelopmentBinary('/tmp/unchanged-binary', identity, run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][1]).toContain('--verify')
    expect(run.mock.calls[0][1]).toContain(`=identifier "com.zerror.app" and certificate leaf = H"${identity}"`)
  })
  it('signs rebuilt executables with one fixed application identifier and stops on failure', () => {
    const run = vi.fn().mockReturnValueOnce({ status: 1 }).mockReturnValueOnce({ status: 0 })
    signDevelopmentBinary('/tmp/rebuilt-binary', identity, run)
    expect(run.mock.calls[1][1]).toEqual(['--force', '--sign', identity, '--identifier', 'com.zerror.app', '--timestamp=none', '/tmp/rebuilt-binary'])
    expect(() => signDevelopmentBinary('/tmp/binary', '-', run)).toThrow('临时签名')
    expect(() => signDevelopmentBinary('/tmp/binary', identity, () => ({ status: 1 }))).toThrow('停止启动')
  })
  it('生成独立启动器，在脚本内部转义路径，并清理临时目录', () => {
    const directory = '/tmp/zerror-cargo-runner-test'
    vi.mocked(mkdtempSync).mockReturnValueOnce(directory)
    vi.mocked(writeFileSync).mockImplementationOnce(() => {})
    vi.mocked(rmSync).mockImplementationOnce(() => {})
    const runner = macosCargoRunner("/project's directory/runner.sh")
    expect(mkdtempSync).toHaveBeenLastCalledWith('/tmp/zerror-cargo-runner-')
    expect(runner.command).toBe(`/bin/bash ${path.join(directory, 'launch.sh')}`)
    expect(writeFileSync).toHaveBeenLastCalledWith(path.join(directory, 'launch.sh'),
      `#!/bin/bash\nexec /bin/bash '/project'\\''s directory/runner.sh' "$@"\n`, { mode: 0o700 })
    runner.cleanup()
    expect(rmSync).toHaveBeenLastCalledWith(directory, { recursive: true, force: true })
  })
  // 此启动器只供 macOS 使用；Unix 主机额外验证 bash 的实际参数传递。
  if (process.platform !== 'win32') {
  it('preserves runner paths containing spaces or apostrophes', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zerror-runner-test-'))
    const runnerFile = path.join(directory, "parent's project", 'runner.sh')
    mkdirSync(path.dirname(runnerFile))
    writeFileSync(runnerFile, 'printf "%s\\n" "$@"')
    const runner = macosCargoRunner(runnerFile)
    try {
      // Match Cargo's environment-variable parsing, not shell parsing.
      const [command, ...args] = runner.command.split(/\s+/)
      const result = spawnSync(command, [...args, '/tmp/binary with spaces', "argument's value"], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("/tmp/binary with spaces\nargument's value\n")
    } finally { runner.cleanup(); rmSync(directory, { recursive: true, force: true }) }
  })
  }
})
