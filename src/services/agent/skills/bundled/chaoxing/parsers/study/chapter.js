// 刷课 · chapter：目录、打开章节
function inspect() {
    if (!__cxHas(location.host, 'chaoxing.com')) return null;
      if (document.querySelector('#ucode, .yzmInp, form[action*="processVerify"], img[src*="processVerify"]')
        || /请输入图片中的验证码|【\s*9010\s*】/.test(((document.body && document.body.innerText) || ''))) {
        return {
          page: 'captcha',
          captcha: true,
          quiz: false,
          video: null,
          hint: '学习通弹出图片验证码（9010）。自己认图读出 4 位，调用 browser_captcha 提交，然后继续刷课。不要问用户。',
        };
      }
      var jobDone = null;
      var video = __cxFindVideo();
      var iframeSrcs = [];
      var tree = __cxIframeTree(window, 0);
      for (var n = 0; n < tree.length && iframeSrcs.length < 12; n++) {
        if (tree[n].src) iframeSrcs.push(tree[n].src);
      }
      try {
        var iconDoc = (video && video.ownerDocument) || document;
        var icon = iconDoc.querySelector('.ans-job-icon.ans-job-video, .ans-job-icon');
        if (icon) {
          jobDone = __cxIconIsDone(icon);
        }
      } catch (e) {}
      var stepEl = document.querySelector('.prev_title');
      var step = stepEl ? __cxClean(stepEl.getAttribute('title') || stepEl.textContent || '') : '';
      var chapters = __cxParsePlayerTree(document);
      if (!chapters.length) {
        var nodes = document.querySelectorAll('#coursetree .posCatalog_select');
        for (var j = 0; j < nodes.length && chapters.length < 80; j++) {
          if (__cxHas(nodes[j].className, 'firstLayer')) continue;
          var name = nodes[j].querySelector('.posCatalog_name');
          var title = name ? __cxClean(name.getAttribute('title') || name.textContent || '') : '';
          if (!title) continue;
          var jobs = __cxJobCount(nodes[j]);
          chapters.push({
            title: title.slice(0, 80),
            index: __cxCatalogIndex(title),
            jobs: jobs,
            unfinished: jobs > 0,
            active: __cxHas(nodes[j].className, 'posCatalog_active'),
          });
        }
      }
      var treeJobs = __cxJobsFromText(__cxCatalogText(document.querySelector('#coursetree') || document.body));
      for (var t = 0; t < chapters.length; t++) {
        if (chapters[t].jobs) continue;
        var extra = __cxJobsForTitle(chapters[t].title, treeJobs);
        if (extra > 0) {
          chapters[t].jobs = extra;
          chapters[t].unfinished = true;
        }
      }
      chapters = __cxClearParentUnfinished(chapters);
      var path = location.pathname;
      var href = location.href;
      var page = 'other';
      if (__cxHas(href, 'passport2') || __cxHas(path, '/login')) page = 'login';
      else if (__cxHas(path, '/mycourse/tch')) page = 'teacher';
      else if (__cxHas(href, '/course/portal') || __cxHas(href, 'portal')) page = 'portal';
      else if (__cxHas(href, 'studentstudy') || document.querySelector('#coursetree')) page = 'player';
      else if (__cxHas(path, '/studentcourse')) page = 'chapters';
      else if (__cxHas(path, '/mycourse/stu')) page = 'student';
      else if (__cxHas(path, 'visit/interaction') || __cxHas(location.host, 'i.mooc.chaoxing') || __cxHas(location.host, 'i.chaoxing')) page = 'list';
      var chapterListUrl = '';
      for (var s = 0; s < iframeSrcs.length; s++) {
        if (__cxHas(iframeSrcs[s], '/studentcourse')) chapterListUrl = iframeSrcs[s];
      }
      if (!chapterListUrl && __cxHas(path, '/mycourse/stu')) {
        try {
          var u = new URL(href);
          var courseid = u.searchParams.get('courseid') || '';
          var clazzid = u.searchParams.get('clazzid') || '';
          var cpi = u.searchParams.get('cpi') || '';
          var enc = u.searchParams.get('enc') || u.searchParams.get('stuenc') || '';
          if (courseid && clazzid) {
            chapterListUrl = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=' + courseid
              + '&clazzid=' + clazzid
              + (cpi ? '&cpi=' + cpi : '')
              + '&ut=s'
              + (enc ? '&stuenc=' + enc : '');
          }
        } catch (e) {}
      }
      var chapterId = '';
      try {
        var cu = new URL(href);
        chapterId = cu.searchParams.get('chapterId') || cu.searchParams.get('chapterid') || cu.searchParams.get('knowledgeid') || '';
      } catch (e) {}
      var listed = __cxListSteps();
      var videoCount = 0;
      var videoIndex = 0;
      var listedIdx = -1;
      var moreVideos = false;
      for (var li = 0; li < listed.length; li++) {
        if (listed[li].active) listedIdx = li;
        if (listed[li].video) {
          videoCount++;
          if (listed[li].active) videoIndex = videoCount;
        }
      }
      for (var lk = listedIdx + 1; lk < listed.length; lk++) {
        if (listed[lk].quiz) break;
        if (listed[lk].video && listed[lk].jobDone !== true) { moreVideos = true; break; }
      }
      if (!step && listedIdx >= 0) step = listed[listedIdx].label;
      return {
        host: location.host,
        path: path,
        page: page,
        chapterId: chapterId,
        step: step,
        quiz: __cxHas(step, '测验') || __cxHas(step, '考试') || __cxHas(step, '作业'),
        jobDone: jobDone,
        steps: listed.map(function(item){
          return { label: item.label, video: item.video, quiz: item.quiz, doc: item.doc, active: item.active, jobDone: item.jobDone };
        }),
        videoCount: videoCount,
        videoIndex: videoIndex,
        moreVideos: moreVideos,
        current: (function(){
          var active = chapters.filter(function(item){ return item.active })[0];
          return __cxChapterLabel(active && active.title) || __cxChapterTitle();
        })(),
        next: (function(){
          var skip = function(item){
            var title = item && item.title || '';
            return __cxHas(title, '资料') || __cxHas(title, '讨论') || __cxHas(title, '问卷')
              || __cxHasUnfinishedChild(chapters, item);
          };
          var start = -1;
          for (var i = 0; i < chapters.length; i++) {
            if (chapters[i].active) { start = i; break; }
          }
          for (var k = start + 1; k < chapters.length; k++) {
            if (chapters[k].unfinished && !skip(chapters[k])) return chapters[k].title;
          }
          for (var n = 0; n < chapters.length; n++) {
            if (chapters[n].unfinished && !chapters[n].active && !skip(chapters[n])) return chapters[n].title;
          }
          return '';
        })(),
        unfinished: (function(){
          var fromTree = chapters.filter(function(item){ return item.unfinished }).map(function(item){ return item.title });
          if (fromTree.length) return fromTree;
          var jobs = __cxJobsFromText(__cxCatalogText(document.querySelector('#coursetree') || document.body));
          var names = [];
          for (var key in jobs) {
            if (jobs[key] > 0) names.push(key);
          }
          return names;
        })(),
        iframes: iframeSrcs.slice(0, 4),
        chapterListUrl: chapterListUrl,
        video: __cxVideoSnap(video),
      };
  }

function install() {
    return __zeBindChapters();
  }

function refresh() {
    if (typeof window.__ZE_PUBLISH_CHAPTERS__ === 'function') return window.__ZE_PUBLISH_CHAPTERS__();
      return window.__ZE_CHAPTERS__ || { needInstall: true };
  }

function clickTab() {
    return __cxClickChapterTab();
  }

function openChapter(rawTitle, rawId) {
    var wantRaw = __cxClean(rawTitle);
      var wantIndex = __cxCatalogIndex(wantRaw);
      var want = __cxBareTitle(wantRaw);
      var wantId = String(rawId || '').replace(/\D/g, '');
      if (!want && !wantIndex && !wantId) return { ok: false, error: '缺少节名' };
      var frames = __cxFrames(window, 0);
      var clickName = function(el, via){
        if (!el) return null;
        var name = el;
        if (el.querySelector) {
          name = el.querySelector('.posCatalog_name, .posCatalog_title, a.clicktitle, a') || el;
        }
        var box = name.closest ? name.closest('.posCatalog_select, li, .chapter_item, .catalog_item') : el;
        __cxClick(name);
        return {
          ok: true,
          title: __cxChapterLabel((name.getAttribute && name.getAttribute('title')) || name.textContent || ''),
          active: box ? __cxHas(box.className, 'posCatalog_active') : false,
          via: via,
        };
      };
      if (wantId) {
        for (var f = 0; f < frames.length; f++) {
          var doc = null;
          try { doc = frames[f].document; } catch (e) { continue; }
          if (!doc) continue;
          var byId = doc.getElementById('cur' + wantId) || doc.getElementById(wantId);
          if (byId) return clickName(byId, 'id');
          var idNodes = doc.querySelectorAll('#coursetree .posCatalog_select, a.clicktitle, .catalog_title, a[href*="chapterId"], a[href*="knowledgeid"]');
          for (var n = 0; n < idNodes.length; n++) {
            var html = '';
            try { html = idNodes[n].outerHTML || ''; } catch (e) {}
            if (html.indexOf('cur' + wantId) >= 0 || /chapterId=/.test(html) && html.indexOf(wantId) >= 0) {
              return clickName(idNodes[n], 'id-html');
            }
            var click = String(idNodes[n].getAttribute && idNodes[n].getAttribute('onclick') || '');
            if (click.indexOf(wantId) >= 0 && /getTeacherAjax/.test(click)) return clickName(idNodes[n], 'id-ajax');
          }
        }
      }
      var exactIndex = null;
      var exact = null;
      var fuzzy = null;
      for (var f2 = 0; f2 < frames.length; f2++) {
        var doc2 = null;
        try { doc2 = frames[f2].document; } catch (e) { continue; }
        if (!doc2) continue;
        var prefer = doc2.querySelectorAll('#coursetree .posCatalog_select .posCatalog_name, #coursetree .posCatalog_name');
        var nodes = prefer.length
          ? prefer
          : doc2.querySelectorAll('a.clicktitle, .posCatalog_name, a.chapter_item, .catalog_name a, .chapter_Td a, .catalog_title a, .catalog_title, .catalog_title div, li.chapter a');
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var title = __cxChapterLabel(el.getAttribute('title') || el.textContent || '');
          var bar = el.querySelector ? el.querySelector('.posCatalog_sbar') : null;
          var index = (bar ? __cxClean(bar.textContent || '') : '') || __cxCatalogIndex(title);
          if (!title && !index) continue;
          if (__cxSkipTitle(title || index) && !index) continue;
          if (wantIndex && index === wantIndex && !exactIndex) exactIndex = el;
          var bare = __cxBareTitle(title || index);
          if (wantIndex && index && wantIndex !== index) continue;
          if (want && bare === want && !exact) exact = el;
          else if (!wantIndex && want && !fuzzy && (__cxHas(bare, want) || __cxHas(want, bare))) fuzzy = el;
        }
        if (exactIndex || exact) break;
      }
      var hit = exactIndex || exact || fuzzy;
      if (!hit) return { ok: false, error: '目录里没有「' + (want || wantIndex) + '」', want: want };
      return clickName(hit, wantIndex && hit === exactIndex ? 'index' : 'click');
  }
