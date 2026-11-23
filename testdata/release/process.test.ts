import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { runReleaseProcess } from '../../scripts/release/process.mjs'

const directories: string[] = []
async function options(timeout = 5000) {
  const directory = await mkdtemp(join(tmpdir(), 'zerror-release-process-'))
  directories.push(directory)
  return { cwd: directory, env: process.env, timeout, label: 'fixture', logFile: join(directory, 'step.log') }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

it('保留标准输出、错误输出以及失败前的完整日志', async () => {
  const settings = await options()
  const chunks: string[] = []
  await expect(runReleaseProcess(process.execPath, ['-e', 'console.log("output");console.error("diagnostic");process.exitCode=7'],
    { ...settings, onOutput: (chunk: Buffer) => chunks.push(chunk.toString()) })).rejects.toThrow('fixture 退出码 7')
  const log = await readFile(settings.logFile, 'utf8')
  expect(log).toContain('output'); expect(log).toContain('diagnostic')
  expect(chunks.join('')).toBe(log)
})

it('成功进程返回，启动失败也落盘并结束等待', async () => {
  const settings = await options()
  await runReleaseProcess(process.execPath, ['-e', 'console.log("ready")'], settings)
  expect(await readFile(settings.logFile, 'utf8')).toContain('ready')
  await expect(runReleaseProcess(join(settings.cwd, 'missing-executable'), [], settings)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(settings.logFile, 'utf8')).toBe('')
})

it('存在长期存活的子孙进程时，输出管道不能突破截止时间', async () => {
  const settings = await options(1500)
  const started = Date.now()
  try {
    await expect(runReleaseProcess(process.execPath, ['-e', `
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:['ignore','inherit','inherit']});
      console.log('grandchild='+child.pid); child.unref();
      setInterval(()=>{},30000);
    `], settings)).rejects.toThrow('fixture 超时')
    expect(Date.now() - started).toBeLessThan(6000)
  } finally {
    const log = await readFile(settings.logFile, 'utf8')
    const pid = Number(/grandchild=(\d+)/.exec(log)?.[1])
    expect(pid).toBeGreaterThan(0)
    try { process.kill(pid) } catch { /* 已经退出时不再处理。 */ }
  }
}, 10000)
