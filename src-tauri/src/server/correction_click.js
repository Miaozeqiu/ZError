if (this.dataset.correctionFallback) return true;
event.preventDefault();
event.stopPropagation();
if (this.dataset.correctionState) return false;
const link = this;
const [id, token] = link.pathname.split('/').slice(-2);
const expectedOrigin = link.protocol + '//' + link.host;
const frame = document.createElement('iframe');
frame.setAttribute('aria-hidden', 'true');
frame.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;border:0';
link.dataset.correctionState = 'submitting';
link.setAttribute('aria-disabled', 'true');
link.textContent = '标记中…';
let timer;
function finish(success, message) {
    clearTimeout(timer);
    window.removeEventListener('message', receive);
    frame.remove();
    if (success) {
        const label = document.createElement('span');
        label.style.cssText = 'display:block;margin-top:8px;color:#54713a;font-size:13px';
        label.textContent = '已标记待修正';
        link.replaceWith(label);
    } else {
        delete link.dataset.correctionState;
        link.dataset.correctionFallback = '1';
        link.removeAttribute('aria-disabled');
        link.title = message;
        link.textContent = '在本地页面标记待修正';
    }
}
function receive(message) {
    const data = message.data;
    if (message.source === frame.contentWindow && message.origin === expectedOrigin && data && data.kind === 'zerror-local-correction' && data.id === id && data.token === token) {
        finish(data.success === true, data.message);
    }
}
try {
    (document.body || document.documentElement).appendChild(frame);
    const doc = frame.contentDocument;
    const form = doc.createElement('form');
    form.method = 'POST';
    form.action = link.href;
    doc.body.appendChild(form);
    window.addEventListener('message', receive);
    timer = setTimeout(function () { finish(false, '内嵌提交未获确认'); }, 6000);
    form.submit();
} catch (error) {
    finish(false, '内嵌提交不可用');
}
return false;
