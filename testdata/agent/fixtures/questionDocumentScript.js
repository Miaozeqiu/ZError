// 测试用 Agent 脚本：按样本结构解析，不绑定文件名、题数或平台。
const questions = [];
let current = null;
for (const line of document.lines) {
  const text = line.trim();
  const question = text.match(/^\d+[.．、]\s*(.+)/);
  if (question) {
    current = { question: question[1], options: '', answer: '', question_type: '单选' };
    questions.push(current);
    continue;
  }
  if (!current) continue;
  if (/^[A-H][.．、]/.test(text)) {
    current.options += (current.options ? '\n' : '') + text.replace(/[✓✔✅]/g, '').trim();
  }
  const answer = text.match(/【答案】\s*([^【]+)/);
  if (answer) current.answer = answer[1].trim();
}
return questions;
