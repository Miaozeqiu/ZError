const jsonToken = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],])/g;
const similarityPercent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function section(title, ...content) {
    const node = element('section', 'exchange-section');
    node.append(element('h3', 'exchange-title', title), ...content);
    return node;
}

function definition(label, value) {
    const row = element('div');
    row.append(element('dt', null, label), element('dd', null, value));
    return row;
}

export function renderMetadata(target, values) {
    target.replaceChildren(...values.map(([label, value]) => definition(label, value)));
}

export function renderHeaders(target, title, headers) {
    const entries = [...headers].sort(([left], [right]) => left.localeCompare(right));
    const list = element('dl', 'exchange-headers');
    for (const [name, value] of entries) {
        const row = definition(name, value);
        row.className = 'exchange-header-row';
        list.append(row);
    }
    target.replaceChildren(element('h3', 'exchange-title', title),
        entries.length ? list : element('p', 'exchange-empty', '暂无记录'));
}

function foldCorrectionCode(quoted, path, id) {
    const anchorStart = '<a href=\\"';
    const start = quoted.lastIndexOf(anchorStart);
    if (start < 0 || !quoted.endsWith('>标记为待修正</a>"')) return;
    const hrefStart = start + anchorStart.length;
    const hrefEnd = quoted.indexOf('\\"', hrefStart);
    if (hrefEnd < 0 || !quoted.slice(hrefStart, hrefEnd).endsWith(path)) return;

    const source = element('span', null, quoted.slice(start, -1));
    source.id = id;
    source.hidden = true;

    const toggle = element('button', 'json-fold-toggle', '展开按钮代码');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', id);
    toggle.addEventListener('click', () => {
        const expanded = source.hidden;
        source.hidden = !expanded;
        toggle.textContent = expanded ? '收起按钮代码' : '展开按钮代码';
        toggle.setAttribute('aria-expanded', String(expanded));
    });

    const value = element('span', 'json-string');
    value.append(quoted.slice(0, start), toggle, source, '"');
    return value;
}

export function highlightJson(target, text) {
    let response;
    try {
        response = JSON.parse(text);
    } catch {
        target.textContent = text;
        return;
    }
    const correctionPath = response?.data?.correction_path;
    const foldCorrection = typeof correctionPath === 'string' && correctionPath.startsWith('/correction/');
    const output = document.createDocumentFragment();
    let depth = 0;
    let previous;
    let isQuestionValue = false;
    for (const match of text.matchAll(jsonToken)) {
        const [token, quoted, keySeparator, number, literal, punctuation] = match;
        const opened = previous === '{' || previous === '[';
        const closing = punctuation === '}' || punctuation === ']';
        if (closing) depth--;
        if (previous === ',' || opened !== closing) {
            output.append('\n', '  '.repeat(depth));
        }
        const kind = keySeparator ? 'key' : quoted ? 'string' : number ? 'number' : literal ? 'literal' : 'punctuation';
        const folded = foldCorrection && isQuestionValue && kind === 'string'
            ? foldCorrectionCode(quoted, correctionPath, `${target.id}-correction-${match.index}`)
            : undefined;
        output.append(folded ?? element('span', 'json-' + kind, quoted ?? token));
        if (keySeparator) output.append(': ');
        if (punctuation === '{' || punctuation === '[') depth++;
        previous = punctuation;
        isQuestionValue = Boolean(keySeparator && quoted === '"question"');
    }
    target.replaceChildren(output);
}

function receiveContent(request) {
    const overview = element('div', 'exchange-overview');
    const endpoint = element('dl', 'receive-endpoint');
    const url = definition('请求 URL');
    url.lastElementChild.append(element('code', null, request.url));
    endpoint.append(...url.children);
    const meta = element('dl', 'exchange-meta');
    renderMetadata(meta, [
        ['请求方法', 'POST'],
        ['HTTP 状态码', request.httpStatus ?? '等待响应…'],
        ['接收时间', new Date(request.startedAt).toLocaleString('zh-CN')],
    ]);
    meta.querySelector('dd').replaceChildren(element('span', 'receive-method', 'POST'));
    overview.append(endpoint, meta);

    const body = element('pre', 'raw-response');
    body.tabIndex = 0;
    body.setAttribute('aria-label', '请求体');
    const code = element('code');
    highlightJson(code, request.body);
    body.append(code);
    const headers = element('section', 'exchange-section');
    renderHeaders(headers, '请求头', request.headers);
    return [section('基本信息', overview), section('请求体', body), headers];
}

function localContent(local, verify) {
    const labels = { similar: '仅相似', candidate: '已送判断', used: '已采用' };
    const list = element('ul', 'local-match-list');
    list.setAttribute('aria-label', '相似题目');
    for (const match of Array.isArray(local.data) ? local.data : []) {
        if (!(match.similarity > 0)) continue;
        const status = Object.hasOwn(labels, match.status) ? match.status : 'similar';
        const meta = element('div', 'local-match-meta');
        const score = match.similarity < 0.001 ? '<0.1%' : match.similarity < 1 && match.similarity >= 0.9995
            ? '>99.9%' : similarityPercent.format(match.similarity);
        const label = element('span', 'local-match-score', '题干相似度 ');
        label.append(element('strong', null, score));
        meta.append(element('span', 'local-match-status ' + status, labels[status]), label);
        const row = element('li', 'local-match-row');
        row.append(element('p', 'local-match-question', match.question), meta);
        if (match.rejection_reason) row.append(element('p', 'process-note local-match-note', match.rejection_reason));
        list.append(row);
    }
    const detail = section('本地题库', element('p', 'process-note local-search-note', local.detail));
    if (verify) detail.append(element('p', 'process-note local-search-note', verify));
    if (list.childElementCount) {
        const heading = element('div', 'exchange-section-heading');
        detail.prepend(heading);
        heading.append(heading.nextElementSibling, element('span', 'exchange-header-count', list.childElementCount + ' 道相似题'));
        detail.append(list);
    }
    return detail;
}

function searchContent(trace, detail) {
    if (!trace) return element('p', 'exchange-empty', detail);
    const card = element('div', 'search-trace-card');
    const header = element('div', 'search-trace-header');
    const meta = element('div', 'search-trace-meta');
    if (Number.isFinite(trace.durationMs)) meta.append(element('span', 'search-trace-duration', trace.durationMs + ' ms'));
    const success = trace.status === 'success';
    meta.append(element('span', 'search-trace-status ' + (success ? 'success' : 'error'), success ? '成功' : '失败'));
    header.append(element('div', 'search-trace-title', trace.modelName || '联网搜索'), meta);
    card.append(header, element('div', 'search-trace-query', trace.query));
    if (trace.error) card.append(element('p', 'search-trace-error', trace.error));
    const results = element('div', 'search-trace-results');
    for (const item of Array.isArray(trace.results) ? trace.results : []) {
        let url;
        try {
            const parsed = new URL(item.url);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed;
        } catch { /* The title and excerpt are still useful. */ }
        const row = element('article', 'search-result-row');
        const title = element(url ? 'a' : 'span', 'search-result-title', item.title || url?.host);
        if (url) {
            title.href = url.href;
            title.target = '_blank';
            title.rel = 'noopener noreferrer';
            row.append(title, element('span', 'search-result-source', url.host));
        } else {
            row.append(title);
        }
        if (item.snippet) row.append(element('p', 'search-result-snippet', item.snippet));
        results.append(row);
    }
    if (results.childElementCount) card.append(results);
    else if (success) card.append(element('p', 'exchange-empty', detail));
    return card;
}

function modelCard(model, summary) {
    const card = element('article', 'model-response-card' + (summary ? ' is-summary' : '') + (model.failed ? ' is-failed' : ''));
    const header = element('div', 'model-response-card-header');
    const title = element('div', 'model-response-card-title');
    const name = element('span', 'card-model-name', model.modelName);
    name.title = model.modelName;
    title.append(name);
    if (model.platformName) title.append(element('span', 'card-platform-name', model.platformName));
    const badge = model.isLoading ? ['card-loading-badge', '响应中'] : model.failed ? ['card-failed-badge', '失败'] : ['card-done-badge', '完成'];
    header.append(title, element('span', ...badge));
    const body = element('div', 'model-response-card-body');
    if (model.reasoningContent) {
        const reasoning = element('details', 'query-panel-reasoning');
        reasoning.append(element('summary', null, '模型思考'), element('p', 'query-panel-model-text', model.reasoningContent));
        body.append(reasoning);
    }
    body.append(element('p', 'query-panel-model-text', model.response || (model.isLoading ? '等待模型响应…' : '暂无响应内容')));
    card.append(header, body);
    return card;
}

function modelContent(stage, summary, fallback) {
    const models = Array.isArray(stage.data) ? stage.data : fallback ? [fallback] : [];
    if (!models.length) return element('p', 'exchange-empty', stage.detail);
    const container = element('div');
    if (summary || models.length === 1) {
        container.append(...models.map(model => modelCard(model, summary)));
        return container;
    }
    const tabs = element('div', 'multi-model-tabs');
    const panel = element('div');
    for (const model of models) {
        const state = model.isLoading ? 'loading' : model.failed ? 'failed' : 'success';
        const button = element('button', 'multi-model-tab ' + state, model.modelName);
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            for (const tab of tabs.children) {
                tab.classList.toggle('active', tab === button);
                tab.setAttribute('aria-pressed', String(tab === button));
            }
            panel.replaceChildren(modelCard(model, false));
        });
        tabs.append(button);
    }
    container.append(tabs, panel);
    tabs.firstElementChild.click();
    return container;
}

export function renderStageDetail(target, step, stage, request, verify, fallbackModel) {
    if (step === 'receive') target.replaceChildren(...receiveContent(request));
    else if (step === 'local') target.replaceChildren(localContent(stage, verify));
    else if (step === 'search') target.replaceChildren(searchContent(stage.data, stage.detail));
    else target.replaceChildren(modelContent(stage, step === 'summary', step === 'model' ? fallbackModel : undefined));
    target.className = 'exchange-details';
}
