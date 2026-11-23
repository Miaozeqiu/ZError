// 通过真实 CLI 对接本地 Open 兼容服务，验证安装和升级。
// Agent 目录及安装登记均使用临时路径，不修改用户现有技能。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, realpath, rm, rename } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
const binary = resolve(process.argv[2] || 'src-tauri/target/debug/zerror-cli')
const root = await realpath(await mkdtemp(join(tmpdir(), 'zerror-cli-skills-')))
const run = promisify(execFile)
const hash = value => createHash('sha256').update(value).digest('hex')
const env = { ...process.env, HOME: root, USERPROFILE: root, LOCALAPPDATA: join(root, 'LocalAppData'), CODEX_HOME: join(root, '.codex'), XDG_CONFIG_HOME: join(root, '.config') }
const registry = process.platform === 'win32' ? join(env.LOCALAPPDATA, 'ZError/cli/agent-skills/installed.json') : join(root, '.local/share/zerror/cli/agent-skills/installed.json')
function publish(version) {
  const content = `---\nname: zerror\ndescription: 本地集成测试\nmetadata:\n  version: "${version}"\n---\nUse the CLI.\n`
  const files = [{ path: 'SKILL.md', bytes: Buffer.byteLength(content), sha256: hash(content), content }]
  const identity = `zerror-agent-skill:1\nzerror\n${version}\n1\n` + files.map(f => `${f.path}\t${f.bytes}\t${f.sha256}\n`).join('')
  return { schemaVersion: 1, name: 'zerror', version, cliProtocol: 1, revision: hash(identity), files }
}
let current = publish('1.0.0'), requests = 0
const server = createServer((req, res) => {
  requests++
  if (req.url !== '/v1/agent-skills/zerror') { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(current))
}).listen(0, '127.0.0.1')
await once(server, 'listening')
const source = `http://127.0.0.1:${server.address().port}`
async function cli(args, code = 0) {
  let result
  try { result = await run(binary, ['skill', ...args], { env, timeout: 20000, maxBuffer: 2 * 1024 * 1024 }) }
  catch (error) { result = error; assert.equal(error.code, code, error.stderr || error.stdout || error.message) }
  if (code === 0) assert.equal(result.code, undefined, result.stderr)
  return JSON.parse(result.stdout)
}
let target = join(env.CODEX_HOME, 'skills/zerror')
try {
  assert.deepEqual((await cli(['list'])).result.installations, [])
  const installed = await cli(['install', '--agent', 'codex', '--source', source, '--no-auto-update'])
  assert.equal(installed.result.version, '1.0.0'); assert.equal(installed.result.automatic, false)
  const normalized = path => (path.startsWith('\\\\?\\') ? path.slice(4) : path).replaceAll('\\', '/')
  assert.equal(normalized(installed.result.path), normalized(target))
  target = installed.result.path
  const beforeList = requests
  assert.equal((await cli(['list'])).result.installations.length, 1)
  assert.equal(requests, beforeList)
  current = publish('1.0.1')
  assert.equal((await cli(['check'])).result.installations[0].result.updateAvailable, true)
  assert.equal((await cli(['update'])).result.installations[0].result.version, '1.0.1')
  await cli(['install', '--agent', 'shared', '--source', source])
  const beforeSync = requests
  await cli(['sync']); assert.equal(requests, beforeSync, 'fresh installs must not trigger another request')
  const rows = JSON.parse(await readFile(registry, 'utf8'))
  for (const row of rows) row.checkedAt = 0
  await writeFile(registry, JSON.stringify(rows))
  current = publish('1.0.2')
  await cli(['sync'])
  assert.equal(JSON.parse(await readFile(join(target, '.zerror-skill.json'), 'utf8')).version, '1.0.1', 'manual installation must not auto-update')
  assert.equal(JSON.parse(await readFile(join(root, '.agents/skills/zerror/.zerror-skill.json'), 'utf8')).version, '1.0.2')
  const original = await readFile(join(target, 'SKILL.md'), 'utf8')
  await writeFile(join(target, 'SKILL.md'), 'local edit')
  assert.equal((await cli(['update', '--agent', 'codex'], 4)).ok, false)
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'local edit')
  await writeFile(join(target, 'SKILL.md'), original)
  const beforeTamper = await readFile(join(target, 'SKILL.md'), 'utf8')
  current.files[0].content += 'tampered'
  await cli(['update', '--agent', 'codex'], 4)
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), beforeTamper)
  current = publish('1.0.2')
  await cli(['update', '--agent', 'codex', '--source', 'https://other.example'], 4)
  await cli(['update', '--agent', 'codex'])
  const backup = join(dirname(dirname(target)), `.zerror-${hash(target).slice(0, 16)}-previous`)
  await rename(target, backup)
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  await cli(['update', '--agent', 'codex'], 4)
  assert.equal(JSON.parse(await readFile(join(target, '.zerror-skill.json'), 'utf8')).version, '1.0.2', 'offline recovery must restore the last installation before fetching')
  console.log('CLI Skill integration passed: isolated install, catalog check, manual and automatic updates, local edit protection, integrity, source binding, offline recovery.')
} finally {
  server.close(); server.closeAllConnections()
  await rm(root, { recursive: true, force: true })
}
