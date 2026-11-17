import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export function selectMacosSigningIdentity(output, env = {}) {
  const explicit = env.ZERROR_MACOS_SIGNING_IDENTITY || env.APPLE_SIGNING_IDENTITY;
  if (explicit) return explicit;
  const identities = [...output.matchAll(/^\s*\d+\)\s+([\da-f]{40})\s+"([^"]+)"/gmi)]
    .map(([, hash, name]) => ({ hash, name }));
  const distribution = identities.filter(item => item.name.startsWith('Developer ID Application:'));
  if (distribution.length === 1) return distribution[0].hash;
  if (distribution.length > 1) return undefined;
  const development = identities.filter(item => item.name.startsWith('Apple Development:'));
  return development.length === 1 ? development[0].hash : undefined;
}
export function signDevelopmentBinary(binary, identity, run = spawnSync) {
  if (!identity || identity === '-') {
    throw new Error('开发版需要稳定签名才能持续静默访问安全存储。请配置 ZERROR_MACOS_SIGNING_IDENTITY，不能使用临时签名。');
  }
  if (/^[\da-f]{40}$/i.test(identity)) {
    const existing = run('/usr/bin/codesign', ['--verify', '--strict', '--test-requirement', `=identifier "com.zerror.app" and certificate leaf = H"${identity}"`, binary], { stdio: 'ignore' });
    if (!existing.error && existing.status === 0) return;
  }
  const result = run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', 'com.zerror.app', '--timestamp=none', binary], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('开发版代码签名失败，已停止启动，避免再次触发钥匙串授权。');
}
export function macosCargoRunner(runnerFile) {
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  // Cargo splits runner environment variables on whitespace, without shell
  // parsing. Use a private, whitespace-free launcher path; quote only inside
  // the shell script, where shell quoting actually applies.
  const directory = mkdtempSync('/tmp/zerror-cargo-runner-');
  const launcher = path.join(directory, 'launch.sh');
  writeFileSync(launcher, `#!/bin/bash\nexec /bin/bash ${quote(runnerFile)} "$@"\n`, { mode: 0o700 });
  return {
    command: `/bin/bash ${launcher}`,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { signDevelopmentBinary(process.argv[2], process.env.ZERROR_MACOS_SIGNING_IDENTITY || process.env.APPLE_SIGNING_IDENTITY); }
  catch (error) { console.error(`[zerror] ${error.message}`); process.exitCode = 1; }
}
