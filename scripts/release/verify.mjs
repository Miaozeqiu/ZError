import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, rm, appendFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { featureResults, markdownReport } from './report.mjs'
import { runReleaseProcess } from './process.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const options = { phase: 'source', output: 'output/release-checks', cli: '', start: false, release: false, target: '' }
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]
  if (['--start', '--release'].includes(flag)) options[flag.slice(2)] = true
  else if (['--phase', '--output', '--cli', '--target'].includes(flag) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) options[flag.slice(2)] = process.argv[++i]
  else throw new Error(`未知选项或缺少值：${flag}`)
}
if (!['source', 'frontend', 'native', 'desktop'].includes(options.phase)) throw new Error('phase 必须是 source、frontend、native 或 desktop')
if (options.phase === 'desktop' && !options.cli) throw new Error('desktop 验证必须通过 --cli 指定安装包内的 CLI')
if (options.start && options.phase !== 'desktop') throw new Error('--start 仅用于 desktop 验证')
if (options.target && !/^[a-z0-9_-]+$/.test(options.target)) throw new Error('无效的 Rust target')
const output = resolve(root, options.output)
await mkdir(output, { recursive: true })
const manifest = JSON.parse(await readFile(resolve(root, 'scripts/release/features.json'), 'utf8'))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim()
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd:root,encoding:'utf8'}).trim())
const report = { schemaVersion: 1, revision, dirty, phase: options.phase, platform: process.platform, architecture: process.arch, startedAt: new Date().toISOString(), status: 'running', steps: [], features: [], manualChecks: manifest.manual }
const persist = () => writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
async function step(id, executable, args, timeout = 15 * 60 * 1000) {
  const row = { id, status: 'running', startedAt: new Date().toISOString() }; report.steps.push(row); await persist()
  console.log(`[release] ${id}`)
  try {
    await runReleaseProcess(executable, args, { cwd: root, env: process.env, timeout,
      label: id, logFile: resolve(output, `${id}.log`), onOutput: chunk => process.stdout.write(chunk) })
    row.status = 'passed'
  } catch (error) { row.status = 'failed'; row.error = String(error.message || error); throw error }
  finally { row.finishedAt = new Date().toISOString(); await persist() }
}
try {
  if (['source', 'frontend'].includes(options.phase)) {
    const json = resolve(output, 'vitest.json')
    await rm(json, {force:true})
    await step('frontend-tests', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', '--reporter=default', '--reporter=json', `--outputFile.json=${json}`])
    const results=JSON.parse(await readFile(json, 'utf8'))
    report.features = featureResults(manifest, results, root)
    report.testCount=results.numTotalTests
    await step('cli-types', process.execPath, ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit', '-p', 'testdata/cli/tsconfig.json'])
    await step('frontend-types', process.execPath, ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit'])
    await step('frontend-build', process.execPath, ['node_modules/vite/bin/vite.js', 'build'])
  }
  if (['source', 'native'].includes(options.phase)) {
    const nativeFlags = [...(options.release ? ['--release'] : []), ...(options.target ? ['--target', options.target] : [])]
    const cargo = args => process.platform === 'darwin' ? ['bash', ['scripts/cargo.sh', ...args, ...nativeFlags]] : ['cargo', [...args, ...nativeFlags, '--manifest-path', 'src-tauri/Cargo.toml', '--no-default-features']]
    await step('native-tests', ...cargo(['test', '--locked', '--lib', '--bin', 'zerror-cli']))
    await step('native-cli-build', ...cargo(['build', '--locked', '--bin', 'zerror-cli']))
    await step('skill-install-update', process.execPath, ['scripts/test-cli-skills.mjs', options.cli || `src-tauri/target/${options.target ? options.target + '/' : ''}${options.release ? 'release' : 'debug'}/zerror-cli${process.platform === 'win32' ? '.exe' : ''}`])
  }
  if (options.phase === 'desktop') {
    const binary = resolve(root, options.cli)
    await step('packaged-cli-version', binary, ['--version'])
    await step('packaged-skill-install-update', process.execPath, ['scripts/test-cli-skills.mjs', binary])
    if (options.start) await step('desktop-startup', binary, ['status'], 90000)
    await step('desktop-real-workflows', process.execPath, ['scripts/test-cli-installed.mjs', binary], 5 * 60 * 1000)
    await step('desktop-file-import', process.execPath, ['scripts/test-agent-file-import.mjs', binary], 5 * 60 * 1000)
  }
  report.status = 'passed'
} catch (error) { report.status = 'failed'; report.error = String(error.message || error); process.exitCode = 1 }
finally { report.finishedAt = new Date().toISOString(); await persist(); const markdown=markdownReport(report); await writeFile(resolve(output,'summary.md'),markdown); if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown+'\n'); console.log(`[release] ${report.status}: ${resolve(output, 'report.json')}`) }
