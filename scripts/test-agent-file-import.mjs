// 对运行中的软件验证实际 DOCX 读取、脚本解析和本地数据库写入；所有测试记录均会清理。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Document, Packer, Paragraph } from 'docx';
import mammoth from 'mammoth';

const binary = resolve(process.argv[2] || `src-tauri/target/debug/zerror-cli${process.platform === 'win32' ? '.exe' : ''}`);
const output = resolve('output/agent-file-import');
await mkdir(output, { recursive: true });
const fixture = process.argv[3] ? resolve(process.argv[3]) : resolve(output, 'fixture.docx');
const expected = Number(process.argv[4] || 225);
if (!process.argv[3]) {
  const paragraphs = ['题库概览', ...Array.from({ length: expected }, (_, i) => [`${i + 1}. 回归测试题${i + 1}？`, 'A. 甲', 'B. 乙✓', '【答案】B【解析】原文依据']).flat()];
  await writeFile(fixture, await Packer.toBuffer(new Document({ sections: [{ children: paragraphs.map(text => new Paragraph(text)) }] })));
}
const script = await readFile('testdata/agent/fixtures/questionDocumentScript.js', 'utf8');
// 使用另一条 DOCX 读取实现生成预期数据，逐题核对原生提取是否丢失内容。
// 执行的是仓库内受控测试脚本，文档文本仅作为数据传入。
const referenceText = (await mammoth.extractRawText({path:fixture})).value;
const reference = new Function('document', script)({lines:referenceText.split(/\r?\n/)});
assert.equal(reference.length,expected,'独立提取器的题数必须与预期一致');
const sessions = new Set();
const folders = new Set();
const checks = [];
let modelServer, platformId, originalAgent, originalTemplateMode;
const cli = (args, input) => new Promise((resolve, reject) => {
  const child = spawn(binary, [...args, '--no-start'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let text = '', error = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('CLI 调用超时')); }, 120_000);
  child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
  child.once('error', cause => { clearTimeout(timer); reject(cause); });
  child.once('close', code => {
    clearTimeout(timer);
    try {
      const result = JSON.parse(text);
      if (['tools', 'agent'].includes(args[0]) && result.result?.id) sessions.add(result.result.id);
      if (code || !result.ok) throw new Error(result.error || error || `CLI 退出 ${code}`);
      resolve(result.result);
    } catch (cause) { reject(cause); }
  });
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
});
const call = (method, params = {}) => cli(['call', method, '--json', '-'], params);
let sessionId;
const tool = async (name, args) => {
  const task = await cli(['tools', 'run', '--wait', '--timeout', '90', '--json', '-'], { ...(sessionId ? { sessionId } : {}), name, args });
  sessionId = task.id; sessions.add(sessionId);
  const receipt = await call('tools.result', { id: task.id, messageId: task.messageId });
  assert.equal(receipt.status, 'done', receipt.error);
  return receipt.result;
};
try {
  originalTemplateMode=await call('config.get',{key:'questionImport.saveMode'});
  await call('config.set',{key:'questionImport.saveMode',value:'ask'});
  const tools = await call('tools.list');
  assert.ok(tools.some(tool => tool.function.name === 'run_file_script'));
  const info = await tool('get_file_info', { path: fixture });
  assert.equal(info.type, 'Word');
  const sample = await tool('read_range', { path: fixture, start:0, end:45 });
  assert.ok(sample.content.length > 0); checks.push('原生 DOCX 读取与分页');
  const parsed = await tool('run_file_script', { path: fixture, code: script });
  assert.equal(parsed.count, expected); assert.equal(parsed.saved, 0); assert.equal(parsed.missing_answers, 0);
  assert.ok(JSON.stringify(parsed).length < 2500); checks.push(`脚本解析 ${expected} 道题，返回小体积结果引用`);
  const folderId = (await call('folders.add', { name:`文件导入回归 ${Date.now()}` })).id; folders.add(folderId);
  const saved = await tool('save_questions', { result_id: parsed.result_id, folder_id: folderId });
  assert.equal(saved.complete, true); assert.equal(saved.total_saved, expected);
  assert.ok(['pending','existing'].includes(saved.template?.status),'成功入库后应产生模板回执，已有模板不重复询问');
  checks.push('成功入库后生成导入算法模板保存回执');
  const all = await call('questions.list', { folderId, page:1, pageSize:200 });
  assert.equal(all.total, expected);
  const items = [...all.items];
  for (let page=2;items.length<all.total;page++) {
    const batch = await call('questions.list', { folderId, page, pageSize:200 });
    assert.ok(batch.items.length, '分页不得提前结束'); items.push(...batch.items);
  }
  assert.equal(items.length, expected);
  assert.ok(items.every(row => row.question && row.answer && row.options?.includes('A.')));
  const stored = new Map(items.map(row=>[row.question,row]));
  assert.equal(stored.size,expected,'不应有重复题干掩盖缺题');
  for (const question of reference) {
    const row=stored.get(question.question); assert.ok(row,'不得缺题或改写题干');
    assert.equal(row.options,question.options,'逐题保留全部选项');
    assert.equal(row.answer,question.answer,'逐题保留原文答案');
  }
  checks.push('原生数据库入库，独立读取器逐题比对题干、选项和答案');
  assert.equal((await tool('save_questions', { result_id: parsed.result_id, folder_id: folderId })).saved, 0);
  assert.equal((await call('questions.list', { folderId, page:1, pageSize:1 })).total, expected); checks.push('重复提交不重复插入');
  // 分段识题路径以相同解析样本模拟模型的结构化输出，验证普通批量工具没有回归。
  const second = (await call('folders.add', { name:`分批导入回归 ${Date.now()}` })).id; folders.add(second);
  const questions = parsed.preview.map(row => ({ question:row.question, options:row.options, answer:row.answer, question_type:'单选' }));
  const batch = await tool('save_questions', { questions, folder_id:second });
  assert.equal(batch.saved, questions.length);
  assert.equal((await call('questions.list', { folderId:second, page:1, pageSize:10 })).total, questions.length); checks.push('普通批量工具实际入库');
  // 本地模型返回受控工具调用，验证真实 Agent 的工具发现、上下文传递和结果引用，不消耗远程额度。
  const third = (await call('folders.add', { name:`Agent 导入回归 ${Date.now()}` })).id; folders.add(third);
  let requests = 0;
  modelServer = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString()); requests++;
      assert.ok(requests <= 8, '模型调用不得无限循环');
      const results = input.messages.filter(message => message.role === 'tool').map(message => {
        try { return JSON.parse(message.content); } catch { return {}; }
      });
      const saved = results.find(result => result.complete && result.total_saved === expected);
      const parsed = results.find(result => result.result_id && result.count === expected);
      let name, args;
      if (saved) { /* 有真实保存回执后才结束模型回合。 */ }
      else if (parsed) { name='save_questions'; args={result_id:parsed.result_id,folder_id:third}; }
      else if (results.some(result => result.content && result.unit)) { name='run_file_script'; args={path:fixture,code:script}; }
      else if (results.some(result => result.type === 'Word')) { name='read_range'; args={path:fixture,start:0,end:45}; }
      else if (results.some(result => Array.isArray(result.loaded))) { name='get_file_info'; args={path:fixture}; }
      else { name='load_agent_tools'; args={names:['get_file_info','read_range','run_file_script','save_questions']}; }
      assert.ok(!name || input.tools.some(tool => tool.function.name === name), '必须先发现工具才能调用');
      const delta = name ? { role:'assistant',tool_calls:[{index:0,id:`import-call-${requests}`,type:'function',function:{name,arguments:JSON.stringify(args)}}] }
        : {role:'assistant',content:`IMPORT_AGENT_OK ${expected}`};
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
      res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:name?'tool_calls':'stop'}]})}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (cause) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:String(cause)})); }
  });
  await new Promise(resolve => modelServer.listen(0,'127.0.0.1',resolve));
  const models = await call('models.list'); originalAgent=models.selectedAgentModel;
  const settings = await call('models.add', {name:`文件导入测试 ${Date.now()}`,baseUrl:`http://127.0.0.1:${modelServer.address().port}/v1`,apiKey:'synthetic-import-test-key',model:{modelId:'import-test',supportsTools:true}});
  const platform = settings.platforms.find(item => !models.platforms.some(old => old.id === item.id));
  platformId=platform.id;
  await call('models.select',{id:platform.models[0].id,role:'agent'});
  const agent = await cli(['agent','run',`导入测试：从 ${fixture} 导入原文题目到 folder_id=${third}`,'--wait','--timeout','90']);
  sessions.add(agent.id);
  assert.ok(agent.messages.some(message => message.content.includes(`IMPORT_AGENT_OK ${expected}`)));
  assert.equal(requests,6);
  const agentRows = await call('questions.list',{folderId:third,page:1,pageSize:1});
  assert.equal(agentRows.total,expected);
  checks.push('真实 Agent 回合经本地模型发现工具、读文件、脚本解析和保存（6 次模型请求）');
  const report = { status:'passed', count:expected, checks, testedAt:new Date().toISOString() };
  await writeFile(resolve(output, 'desktop-import.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  const failures = [];
  if (originalTemplateMode !== undefined) try {
    if (await call('config.get',{key:'questionImport.saveMode'}) === 'ask') await call('config.set',{key:'questionImport.saveMode',value:originalTemplateMode});
  } catch (cause) { failures.push(cause); }
  if (platformId) try { await call('models.platform_remove',{platformId,confirm:true}); } catch (cause) { failures.push(cause); }
  if (originalAgent) try { await call('models.select',{id:originalAgent,role:'agent'}); } catch (cause) { failures.push(cause); }
  if (modelServer) { modelServer.closeAllConnections(); await new Promise(resolve=>modelServer.close(resolve)); }
  for (const id of sessions) try { await call('agent.remove', { id, confirm:true }); } catch (cause) { failures.push(cause); }
  for (const id of folders) try { await call('folders.delete', { id, deleteQuestions:true, confirm:true }); } catch (cause) { failures.push(cause); }
  if (failures.length) throw new AggregateError(failures, '文件导入测试记录清理失败');
}
