import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RELEASED_IDENTIFIER = 'com.zerror.app';

// This exact advisory concerns a released, valid identifier. Keep the identity
// and make the compatibility decision visible; all other diagnostics pass through.
export function formatTauriDiagnostic(line, preserveReleasedIdentity = true) {
  if (!preserveReleasedIdentity) return line;
  const plain = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const advisory = /^\s*Warn The bundle identifier "com\.zerror\.app" set in `[^`]+ identifier` ends with `\.app`\. This is not recommended because it conflicts with the application bundle extension on macOS\.\r?$/;
  if (!advisory.test(plain)) return line;
  return '        Info [compat] Keeping released identifier "com.zerror.app" for existing installations, browser data, keychain access and updates.'
    + (line.endsWith('\r') ? '\r' : '');
}

export function tauriDiagnostics(preserveReleasedIdentity) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        this.push(formatTauriDiagnostic(pending.slice(0, end), preserveReleasedIdentity) + '\n');
        pending = pending.slice(end + 1);
      }
      callback();
    },
    flush(callback) {
      pending += decoder.end();
      if (pending) this.push(formatTauriDiagnostic(pending, preserveReleasedIdentity));
      callback();
    },
  });
}

export function startTauri(args, { spawnProcess = spawn } = {}) {
  const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const child = spawnProcess(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), ...args], {
    stdio: ['inherit', 'inherit', 'pipe'],
    env: process.env,
    shell: false,
  });
  if (child.stderr) child.stderr.pipe(tauriDiagnostics(config.identifier === RELEASED_IDENTIFIER)).pipe(process.stderr);
  return child;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const child = startTauri(process.argv.slice(2));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => {
    console.error('[tauri] ' + error.message);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
}
