// 刷课 · watch：进度监控
function videoHook() {
    var root = window;
      try { if (window.top && window.top.document) root = window.top; } catch (e) {}
      var write = function(video){
        video = video || __cxFindPlayVideo();
        if (!video) {
          root.__ZE_VIDEO__ = null;
          return false;
        }
        root.__ZE_VIDEO__ = __cxVideoSnap(video);
        return true;
      };
      var bind = function(){
        var video = __cxFindPlayVideo();
        if (!video) return write(null);
        if (!video.__zeBound) {
          video.__zeBound = true;
          var on = function(){ write(video); };
          video.addEventListener('timeupdate', on);
          video.addEventListener('play', on);
          video.addEventListener('pause', on);
          video.addEventListener('ended', on);
          video.addEventListener('seeked', on);
          video.addEventListener('loadedmetadata', on);
        }
        return write(video);
      };
      if (!root.__ZE_HOOK_TIMER__) root.__ZE_HOOK_TIMER__ = setInterval(bind, 1500);
      bind();
      return root.__ZE_VIDEO__ || { hooked: true, hasVideo: false };
  }

function videoTick() {
    var video = __cxFindPlayVideo();
      if (video) return __cxVideoSnap(video);
      var cached = window.__ZE_VIDEO__;
      if (cached && cached.ts && (Date.now() - cached.ts) < 800) return cached;
      try {
        if (window.top && window.top.__ZE_VIDEO__) cached = window.top.__ZE_VIDEO__;
      } catch (e) {}
      return cached || null;
  }

function jobTick() {
    var jobs = __cxJobsFromAttachments();
      if (!jobs || !jobs.length) {
        jobs = __cxListSteps().map(function(item){
          return {
            mid: '',
            jobid: '',
            label: item.label,
            kind: item.video ? 'video' : item.quiz ? 'quiz' : 'doc',
            video: !!item.video,
            quiz: !!item.quiz,
            doc: !!item.doc,
            jobDone: item.jobDone === true,
            passed: item.jobDone === true,
            unfinished: item.jobDone !== true,
            active: !!item.active,
          };
        });
      } else {
        jobs = __cxMarkActive(jobs);
      }
      var video = __cxFindVideo();
      var tick = video ? __cxVideoSnap(video) : null;
      if (!tick) {
        try { tick = window.__ZE_VIDEO__ || (window.top && window.top.__ZE_VIDEO__) || null; } catch (e) { tick = window.__ZE_VIDEO__ || null; }
      }
      return { jobs: jobs, video: tick, ts: Date.now() };
  }

function hook() {
    var texts = [];
      var docs = [];
      walk(window, 0, texts, docs);
      try {
        var extras = window.__ZE_FRAME_SNAPS__ || [];
        for (var x = 0; x < extras.length; x++) {
          if (extras[x] && extras[x].text) texts.push(String(extras[x].text));
        }
      } catch (e) {}
      var pageText = texts.join('\n');
      var progress = progressOf(pageText);
      var jobs = jobsFromText(pageText);
      for (var d = 0; d < docs.length; d++) catalogFromDoc(docs[d], jobs);
      var unfinished = [];
      for (var key in jobs) {
        if (jobs[key] > 0 && !skip(key)) unfinished.push(catalogIndex(key) ? key : (bare(key) || key));
      }
      unfinished = unfinished.filter(function(title){
        var idx = catalogIndex(title);
        if (!idx) return true;
        var prefix = idx + '.';
        for (var u = 0; u < unfinished.length; u++) {
          var other = catalogIndex(unfinished[u]);
          if (other && other.indexOf(prefix) === 0) return false;
        }
        return true;
      });
      var href = location.href || '';
      var page = 'other';
      if (/studentcourse/.test(href)) page = 'chapters';
      else if (/studentstudy/.test(href) || document.querySelector('#coursetree')) page = 'player';
      else if (/\/mycourse\/stu/.test(href)) page = (progress || unfinished.length) ? 'chapters' : 'student';
      var current = '';
      try {
        var name = document.querySelector('#coursetree .posCatalog_active .posCatalog_name');
        current = clean((name && (name.getAttribute('title') || name.textContent)) || '');
      } catch (e) {}
      var snap = {
        url: href,
        page: page,
        current: current,
        progress: progress,
        unfinished: unfinished,
        unfinishedCount: progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length,
        chapters: unfinished.map(function(t){ return { title: t, jobs: jobs[t] || 1, unfinished: true }; }),
        ts: Date.now(),
      };
      window.__ZE_CHAPTERS__ = snap;
      if (!unfinished.length && !progress && !document.querySelector('#coursetree, .catalog_title, .posCatalog_select') && !window.__ZE_CHAPTER_FETCHING__) {
        var src = '';
        var frames = document.querySelectorAll('a[data-url*="studentcourse"], [data-url*="studentcourse"], iframe[src*="studentcourse"], iframe[src], [data-url]');
        for (var f = 0; f < frames.length; f++) {
          var u = frames[f].src || frames[f].getAttribute('src') || frames[f].getAttribute('data-url') || '';
          if (u.indexOf('studentcourse') >= 0) { src = u; break; }
        }
        if (!src) {
          try {
            var cu = new URL(href);
            var courseid = cu.searchParams.get('courseid') || cu.searchParams.get('courseId') || '';
            var clazzid = cu.searchParams.get('clazzid') || cu.searchParams.get('clazzId') || '';
            var cpi = cu.searchParams.get('cpi') || '';
            var enc = cu.searchParams.get('enc') || cu.searchParams.get('stuenc') || '';
            var t = cu.searchParams.get('t') || '';
            if (courseid && clazzid) {
              src = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=' + courseid
                + '&clazzid=' + clazzid + (cpi ? '&cpi=' + cpi : '') + '&ut=s' + (t ? '&t=' + t : '') + (enc ? '&stuenc=' + enc : '');
            }
          } catch (e) {}
        }
        if (src) {
          try { src = new URL(src, location.href).href; } catch (e) {}
          window.__ZE_CHAPTER_FETCHING__ = true;
          fetch(src, { credentials: 'include' }).then(function(res){ return res.text(); }).then(function(html){
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var remoteText = textOf(doc);
            var remoteProgress = progressOf(remoteText) || progress;
            var remoteJobs = jobsFromText(remoteText);
            catalogFromDoc(doc, remoteJobs);
            var names = [];
            for (var k in remoteJobs) {
              if (remoteJobs[k] > 0 && !skip(k)) names.push(catalogIndex(k) ? k : (bare(k) || k));
            }
            names = names.filter(function(title){
              var idx = catalogIndex(title);
              if (!idx) return true;
              var prefix = idx + '.';
              for (var n = 0; n < names.length; n++) {
                var other = catalogIndex(names[n]);
                if (other && other.indexOf(prefix) === 0) return false;
              }
              return true;
            });
            if (names.length || remoteProgress) {
              window.__ZE_CHAPTERS__ = {
                url: href,
                page: 'chapters',
                current: current,
                progress: remoteProgress,
                unfinished: names,
                unfinishedCount: remoteProgress && remoteProgress.total > remoteProgress.done ? remoteProgress.total - remoteProgress.done : names.length,
                chapters: names.map(function(t){ return { title: t, jobs: remoteJobs[t] || 1, unfinished: true }; }),
                ts: Date.now(),
                via: 'fetch',
              };
            }
            window.__ZE_CHAPTER_FETCHING__ = false;
          }).catch(function(){ window.__ZE_CHAPTER_FETCHING__ = false; });
        }
      }
      return snap;
  }

function tick() {
    try { if (window.__ZE_CHAPTERS__) return window.__ZE_CHAPTERS__; } catch (e) {}
      try { if (window.top && window.top.__ZE_CHAPTERS__) return window.top.__ZE_CHAPTERS__; } catch (e) {}
      return null;
  }
