// 按需对运行中的桌面应用执行集成测试；仅使用本地夹具，
// 结束后恢复原模型选择并删除脚本创建的业务记录。
import { randomUUID } from 'node:crypto';
import { createServer as createSocketServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const binary = resolve(process.argv[2] || `src-tauri/target/debug/zerror-cli${process.platform === 'win32' ? '.exe' : ''}`);
const sessions = new Set();
const fixtureHost = `release-${randomUUID()}.invalid`;
let originalTheme, originalPort, originalLan, startedServer = false;
let folderId, platformId, originalAgent, accountCreated = false, slow = false, modelCalls = 0;
const checks = [];
const cli = (args, input, expectedFailure = false) => new Promise((resolve, reject) => {
  const child = spawn(binary, [...args, '--no-start'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let text = '', error = '';
  const timeout = setTimeout(() => { child.kill(); reject(new Error('CLI child timeout')); }, 45000);
  child.stdout.on('data', chunk => { text += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('close', code => {
    clearTimeout(timeout);
    try {
      const parsed = JSON.parse(text);
      if (['agent', 'tools'].includes(args[0]) && args[1] === 'run' && parsed.result?.id) sessions.add(parsed.result.id);
      if (expectedFailure) { assert.notEqual(code, 0); assert.equal(parsed.ok, false); resolve(parsed); return; }
      if (code !== 0 || !parsed.ok) throw new Error(`${input?.name || args.slice(0, 2).join(' ')}: ${parsed.error || error || `exit ${code}`} ${parsed.result?.messages?.at(-1)?.error || ''}`);
      resolve(parsed.result);
    }
    catch (e) { reject(e); }
  });
  child.stdin.end(input === undefined ? '' : JSON.stringify(input));
});
const call = (method, params = {}) => cli(['call', method, '--json', '-'], params);
const server = createServer(async (req, res) => {
  if (req.url.includes('chat/completions')) {
    for await (const _ of req) { /* Drain the request without logging model context. */ }
    modelCalls++;
    if (slow) { await new Promise(resolve => setTimeout(resolve, 2000)); if (res.destroyed) return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of [{ choices: [{ index: 0, delta: { role: 'assistant', content: 'CLI_SMOKE_OK' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }]) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end('data: [DONE]\n\n');
  } else if (req.url === '/frame') {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
    res.end('<button onclick="this.textContent=\'Frame verified\'">Frame button</button>');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><title>CLI fixture</title><body><h1>CLI fixture</h1><input id="fixture-input" aria-label="Fixture input"><iframe id="fixture-child" src="/frame"></iframe><button onclick="this.textContent=\'CLI clicked\'+document.getElementById(\'fixture-input\').value">CLI button</button></body></html>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  // Vite 首次发现延迟导入时，开发界面可能重载一次。
  // 预热仅使用只读命令，不重试执行结果不确定的写入。
  for (let attempt = 0; ; attempt++) {
    try { await call('tools.list'); break; }
    catch (error) { if (attempt >= 10) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.ok((await call('status')).version); checks.push('native connection');
  originalTheme = await call('config.get', { key:'theme' });
  const theme = originalTheme === 'dark' ? 'light' : 'dark';
  assert.equal((await call('config.set', { key:'theme', value:theme })).saved, true);
  assert.equal(await call('config.get', { key:'theme' }), theme); checks.push('durable theme change and readback');
  await call('accounts.set', { host: fixtureHost, account: 'synthetic-cli-user', password: 'synthetic-cli-password' }); accountCreated = true;
  const accounts = await call('accounts.list');
  assert.ok(accounts.some(row => row.host === fixtureHost && row.accountConfigured && row.passwordConfigured));
  assert.ok(!JSON.stringify(accounts).includes('synthetic-cli-password'));
  await call('accounts.remove', { host: fixtureHost, confirm: true }); accountCreated = false; checks.push('isolated credentials via stdin');
  folderId = (await call('folders.add', { name: `CLI test ${Date.now()}` })).id;
  const question = await call('questions.add', { folderId, content: 'CLI integration unique fixture', answer: 'fixture' });
  const questionId = question.id || question.Id; assert.ok(questionId);
  await cli(['call','questions.delete','--json','-'], {id:questionId}, true);
  assert.ok(JSON.stringify(await call('questions.list',{folderId,page:1,pageSize:1})).includes('CLI integration unique fixture'));
  await call('questions.update',{id:questionId,answer:'updated fixture answer'});
  assert.ok(JSON.stringify(await call('questions.list',{folderId,page:1,pageSize:1})).includes('updated fixture answer'));
  await call('folders.rename',{id:folderId,name:`CLI renamed ${folderId}`});
  assert.ok(JSON.stringify(await call('folders.list')).includes(`CLI renamed ${folderId}`));
  const found = await call('questions.search', { folderId, keyword: 'CLI integration', pageSize: 10 });
  assert.ok(JSON.stringify(found).includes('CLI integration unique fixture')); checks.push('question pagination, update, search, folder rename and deletion authorization');

  const originalServer = await call('server.status');
  let http = originalServer;
  if (!originalServer.running) {
    originalPort = await call('config.get',{key:'network.serverPort'});
    originalLan = await call('config.get',{key:'network.enableLanAccess'});
    const socket = createSocketServer(); await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    await call('config.set',{key:'network.serverPort',value:port});
    await call('config.set',{key:'network.enableLanAccess',value:false});
    // 分发前先登记，确保启动回执不确定时也能执行清理。
    startedServer=true; http=await call('server.start');
  }
  assert.equal(http.running,true);
  const origin=`http://127.0.0.1:${http.port}`;
  assert.equal((await (await fetch(origin+'/api/status',{signal:AbortSignal.timeout(5000)})).json()).status,'running');
  const invalid=await fetch(origin+'/query',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
  assert.equal(invalid.status,400); checks.push('real question HTTP server startup, health and invalid request rejection');

  const models = await call('models.list'); originalAgent = models.selectedAgentModel;
  const next = await call('models.add', { name: `CLI fixture ${Date.now()}`, baseUrl: `${url}/v1`, apiKey: 'synthetic-cli-smoke-key', model: { modelId: 'cli-fixture', supportsTools: true } });
  const platform = next.platforms.find(p => !models.platforms.some(old => old.id === p.id));
  platformId = platform.id;
  await call('models.select', { id: platform.models[0].id, role: 'agent' });
  const done = await cli(['agent', 'run', 'CLI local integration check', '--wait', '--timeout', '25']);
  sessions.add(done.id);
  assert.ok(done.messages.some(m => m.content.includes('CLI_SMOKE_OK')));
  assert.ok(modelCalls > 0); checks.push('Agent run and wait through local mock model');
  assert.ok(done.messageId); slow = true;
  const running = await call('agent.run', { sessionId: done.id, text: 'CLI stop fixture' });
  assert.ok(running.messageId && running.messageId !== done.messageId);
  const previous = await call('agent.status', { id: done.id, messageId: done.messageId });
  assert.equal(previous.busy, false); assert.equal(previous.messageId, done.messageId);
  await cli(['agent', 'stop', done.id, '--message', done.messageId]);
  assert.equal((await call('agent.status', { id: running.id, messageId: running.messageId })).busy, true);
  assert.equal((await call('agent.stop', { id: running.id, messageId: running.messageId })).busy, false);
  checks.push('scoped task status and stop preserve the successor');

  const browser = await call('browser.open', { url }); sessions.add(browser.sessionId);
  assert.equal((await call('browser.state', { id: browser.id })).id, browser.id);
  const browserTool = async (name, args = {}) => {
    const task = await cli(['tools', 'run', '--wait', '--timeout', '25', '--json', '-'], { sessionId: browser.sessionId, name, args });
    const receipt = await call('tools.result', { id: task.id, messageId: task.messageId });
    assert.equal(receipt.status, 'done', receipt.error);
    assert.notEqual(receipt.result?.ok, false, JSON.stringify(receipt.result));
    return receipt.result;
  };
  // 打开标签是异步加载；只轮询读取，不重放点击。每次核对本次消息的回执，防止旧历史误通过。
  const verifyPage = async expected => {
    const deadline = Date.now() + 10000;
    let result;
    do {
      result = await browserTool('browser_get_page');
      if (String(result.snapshot || '').includes(expected)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    } while (Date.now() < deadline);
    assert.fail(`页面未出现 ${expected}: ${JSON.stringify(result).slice(0, 1500)}`);
  };
  await verifyPage('CLI button');
  await browserTool('browser_click', { text: 'CLI button' });
  await verifyPage('CLI clicked'); checks.push('native browser observe, click and verify');
  await browserTool('browser_type', { selector: '#fixture-input', text: 'Fixture typed' });
  await browserTool('browser_click', { text: 'CLI clicked' });
  await verifyPage('CLI clickedFixture typed'); checks.push('native browser input and DOM event propagation');
  await browserTool('browser_click', { text: 'Frame button', frame: 'fixture-child' });
  await verifyPage('Frame verified'); checks.push('native child iframe observation and action');
  assert.ok(JSON.stringify((await call('tools.result', { id: browser.sessionId })).result).includes('CLI clicked')); checks.push('complete tool result');
  await call('questions.delete',{id:questionId,confirm:true});
  assert.ok(!JSON.stringify(await call('questions.search',{folderId,keyword:'CLI integration unique fixture'})).includes('CLI integration unique fixture')); checks.push('question deletion and database readback');
} finally {
  const cleanup = [], cleanupErrors = [];
  if (startedServer) { try { await call('server.stop'); assert.equal((await call('server.status')).running,false); } catch(error) { cleanupErrors.push(error); } }
  for (const [key,value] of [['theme',originalTheme],['network.serverPort',originalPort],['network.enableLanAccess',originalLan]]) if(value!==undefined) cleanup.push(() => call('config.set',{key,value}));
  if (accountCreated) cleanup.push(() => call('accounts.remove', { host: fixtureHost, confirm: true }));
  for (const id of sessions) cleanup.push(() => call('agent.remove', { id, confirm: true }));
  if (folderId) cleanup.push(() => call('folders.delete', { id: folderId, deleteQuestions: true, confirm: true }));
  if (originalAgent !== undefined) { try { await call('models.select', { id: originalAgent, role: 'agent' }); } catch(error) { cleanupErrors.push(error); } }
  if (platformId) cleanup.push(() => call('models.platform_remove', { platformId, confirm: true }));
  const failures = (await Promise.allSettled(cleanup.map(fn=>fn()))).filter(result => result.status === 'rejected');
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.equal(failures.length + cleanupErrors.length, 0, `Fixture cleanup failed: ${failures.map(item=>item.reason?.message || item.reason).join('; ')}`);
  if (originalTheme !== undefined) assert.equal(await call('config.get',{key:'theme'}),originalTheme);
  if (originalPort !== undefined) assert.equal(await call('config.get',{key:'network.serverPort'}),originalPort);
  if (originalLan !== undefined) assert.equal(await call('config.get',{key:'network.enableLanAccess'}),originalLan);
  if (originalAgent !== undefined) assert.equal((await call('models.list')).selectedAgentModel, originalAgent, 'Original model selection must be durably restored');
}
console.log(JSON.stringify({ ok: true, checks, restored: true }));
