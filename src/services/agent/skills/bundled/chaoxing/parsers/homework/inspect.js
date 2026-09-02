// 作业 · inspect：读题、点标签
function clickTab() {
    var sels = ['a[data-url*="work"]', '[data-url*="work"]', 'a[data-url*="/work/"]', 'a[href*="pageHeader=8"]'];
      for (var s = 0; s < sels.length; s++) {
        var el = document.querySelector(sels[s]);
        if (!el) continue;
        __hwClick(el);
        return { ok: true, via: sels[s] };
      }
      var nodes = document.querySelectorAll('a, [role="tab"], li, span, div');
      for (var i = 0; i < nodes.length; i++) {
        var t = __hwClean(nodes[i].getAttribute('title') || nodes[i].textContent || '');
        if (t === '作业') {
          __hwClick(nodes[i]);
          return { ok: true, via: 'text' };
        }
      }
      return { ok: false, error: '没有作业标签' };
  }

function inspect() {
    var href = location.href || '';
      var topText = ((document.body && document.body.innerText) || '');
      var questions = __hwParseQuestions(document);
      var works = __hwParseWorks(document, href);
      try {
        var extras = window.__ZE_FRAME_SNAPS__ || [];
        for (var e = 0; e < extras.length; e++) {
          var item = extras[e] || {};
          var extraText = String(item.text || '');
          var extraHref = String(item.href || '');
          if (item.works && item.works.length && item.works.length > works.length) works = item.works;
          if (item.questions && item.questions.length && item.questions.length > questions.length) questions = item.questions;
          if (!works.length && /作业|待做|待批阅|已完成/.test(extraText)) {
            var fake = document.implementation.createHTMLDocument('hw');
            fake.body.textContent = extraText;
            var parsed = __hwParseWorks(fake, extraHref);
            if (parsed.length) works = parsed;
          }
          if (!questions.length && /【单选|【多选|【填空|【判断|选择题|填空题/.test(extraText)) {
            // 跨域答题页只有正文时，至少带回题干行
            var lines = extraText.split('\n').map(__hwClean).filter(function(line){ return line.length > 6 && line.length < 200; });
            for (var li = 0; li < lines.length && questions.length < 40; li++) {
              if (/^\d+[.、]|【单选|【多选|【填空|【判断|【简答/.test(lines[li])) {
                questions.push({ id: String(questions.length + 1), index: questions.length + 1, type: __hwTypeName(lines[li], ''), typeName: '', stem: lines[li].slice(0, 400), options: [], filled: false });
              }
            }
          }
        }
      } catch (err) {}
      if (!questions.length) questions = __hwParseText(topText);
      var page = __hwPageOf(href, topText, questions, works);
      var pending = works.filter(function(item){ return item.status === '待做' || item.status === '未做' || item.status === '未完成'; });
      var title = __hwClean((topText.match(/作业[^\n]{0,40}/) || [])[0] || '');
      if (title.length > 40) title = title.slice(0, 40);
      var compact = questions.map(function(q){
        return {
          id: q.id,
          index: q.index,
          type: q.type,
          typeName: q.typeName,
          stem: String(q.stem || '').slice(0, 400),
          images: (q.images || []).slice(0, 6),
          options: (q.options || []).slice(0, 8).map(function(o){ return { letter: o.letter, text: String(o.text || '').slice(0, 80), selected: !!o.selected, image: o.image || '', images: o.images || [] }; }),
          filled: !!q.filled,
          imageCount: q.imageCount || 0,
          needsVision: !!q.needsVision,
        };
      });
      return {
        ok: true,
        page: page,
        title: title,
        url: href,
        works: works.slice(0, 20),
        pending: pending.slice(0, 20),
        pendingCount: pending.length,
        questions: compact,
        questionCount: compact.length,
        filledCount: compact.filter(function(q){ return q.filled; }).length,
        hint: page === 'list'
          ? (pending.length ? ('待做 ' + pending.length + ' 份：' + pending.map(function(w){ return w.title; }).join('、') + '。调用 browser_homework action=open，title 填作业名。') : (works.length ? '没有待做作业。' : '作业列表还没读到。先点「作业」再 list。'))
          : page === 'do'
            ? ('已读到 ' + questions.length + ' 道题。公式/题目图会自动用视觉模型读成文字。自己作答后 browser_homework action=fill。')
            : page === 'view'
              ? '这是已交/查看页，不要再提交。'
              : '不在作业页。先打开课程再点「作业」。',
      };
  }

function snaps() {
    var extras = window.__ZE_FRAME_SNAPS__ || [];
      var out = [];
      for (var i = 0; i < extras.length && out.length < 8; i++) {
        var item = extras[i] || {};
        var questions = item.questions || [];
        var works = item.works || [];
        out.push({
          href: String(item.href || '').slice(0, 400),
          kind: String(item.kind || ''),
          title: String(item.title || '').slice(0, 80),
          text: (questions.length || works.length) ? '' : String(item.text || '').slice(0, 5000),
          works: works.slice(0, 20),
          questions: questions.slice(0, 40)
        });
      }
      return {
        url: location.href || '',
        title: String(document.title || ''),
        text: ((document.body && document.body.innerText) || '').slice(0, 4000),
        extras: out,
        asked: typeof window.__ZE_ASK_FRAMES__ === 'function'
      };
  }
