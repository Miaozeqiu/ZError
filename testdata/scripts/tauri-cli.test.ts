import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { formatTauriDiagnostic, tauriDiagnostics } from '../../scripts/tauri-cli.mjs'

const advisory = '        Warn The bundle identifier "com.zerror.app" set in `tauri.conf.json identifier` ends with `.app`. This is not recommended because it conflicts with the application bundle extension on macOS.'

describe('released application identity diagnostics', () => {
  it('turns the exact suffix advisory into an explicit compatibility notice', () => {
    expect(formatTauriDiagnostic(advisory)).toContain('Info [compat] Keeping released identifier "com.zerror.app"')
    expect(formatTauriDiagnostic('\x1b[33m' + advisory + '\x1b[0m')).toContain('Info [compat]')
    expect(formatTauriDiagnostic(advisory, false)).toBe(advisory)
    for (const line of [advisory.replace('com.zerror.app', 'com.other.app'), 'Warn dependency mismatch', 'error: compilation failed', advisory.replace('Warn', 'Error')]) {
      expect(formatTauriDiagnostic(line)).toBe(line)
    }
  })
  it('preserves UTF-8, split lines, Windows newlines and a final diagnostic without a newline', async () => {
    const stream = tauriDiagnostics(true)
    let output = ''
    stream.on('data', chunk => { output += chunk.toString() })
    const done = new Promise<void>(resolve => stream.on('end', resolve))
    const bytes = Buffer.from('Warn 中文\r\n' + advisory + '\r\nerror: failed')
    for (const byte of bytes) stream.write(Buffer.from([byte]))
    stream.end()
    await done
    expect(output).toMatch(/^Warn 中文\r\n/)
    expect(output).toContain('Info [compat]')
    expect(output).toMatch(/\r\nerror: failed$/)
  })
  it('preserves the native CLI failure exit code', () => {
    const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js')
    const args = ['__invalid_cli_command__']
    const options = { encoding: 'utf8' as const }
    const original = spawnSync(process.execPath, [cli, ...args], options)
    const wrapped = spawnSync(process.execPath, ['scripts/tauri-cli.mjs', ...args], options)
    expect(original.status).not.toBe(0)
    expect(wrapped.status).toBe(original.status)
    expect(wrapped.stderr).toContain('unrecognized subcommand')
  })
  it('keeps the released identifier, product name, updater key and update endpoint', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
    expect(config.identifier).toBe('com.zerror.app')
    expect(config.productName).toBe('ZError')
    expect(config.plugins.updater.endpoints).toEqual(['https://open.zerrorai.com/v1/app-updates/native/{{target}}/{{arch}}'])
    expect(createHash('sha256').update(config.plugins.updater.pubkey).digest('hex')).toBe('709ab4585df4610e1c4d6016d7c192c76a32ad0c3750334359caf04c58809520')
    expect(readFileSync('scripts/sign-macos-dev.mjs', 'utf8')).toContain('--identifier\', \'com.zerror.app')
    expect(readFileSync('src-tauri/src/secret_keychain.rs', 'utf8')).toContain('identifier "com.zerror.app"')
  })
})


describe('Tauri metadata commands do not launch development services', () => {
  for (const args of [['--version'], ['signer', '--help'], ['dev', '--help'], ['build', '--help']]) {
    it(`runs ${args.join(' ')} without Cargo, CEF or a signing identity`, () => {
      const home = mkdtempSync(join(tmpdir(), 'zerror-cli-metadata-'))
      try {
        const result = spawnSync(process.execPath, ['scripts/run-tauri.mjs', ...args], {
          env: { ...process.env, HOME: home, USERPROFILE: home, CEF_PATH: join(home, 'missing-cef'), ZERROR_MACOS_SIGNING_IDENTITY: '-' },
          encoding: 'utf8', timeout: 10000,
        })
        expect(result.error).toBeUndefined()
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toMatch(/tauri-cli|Usage:/)
        expect(result.stdout + result.stderr).not.toMatch(/\[run-tauri\]|\[agent-bridge\]|H\.264|setup-cef/)
      } finally { rmSync(home, { recursive: true, force: true }) }
    })
  }
})
