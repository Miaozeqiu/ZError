import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

/** 超时和启动失败也保留日志，且不等待子孙进程持有的输出管道。 */
export function runReleaseProcess(executable, args, { cwd, env, timeout, logFile, label, onOutput = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let text = '', timer, settled = false
    const finish = async error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill()
        child.stdout.destroy(); child.stderr.destroy(); child.unref()
      }
      try {
        await writeFile(logFile, text)
        error ? reject(error) : resolve()
      } catch (cause) { reject(cause) }
    }
    for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => { text += chunk; onOutput(chunk) })
    child.once('error', finish)
    child.once('close', code => finish(code === 0 ? undefined : new Error(`${label} 退出码 ${code}`)))
    timer = setTimeout(() => finish(new Error(`${label} 超时`)), timeout)
  })
}
