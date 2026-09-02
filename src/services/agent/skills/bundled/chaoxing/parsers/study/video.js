// 刷课 · video：播放器、任务点、附件
function __cxFindVideo(){
    var frames = __cxFrames(window, 0);
    var best = null;
    var bestScore = -1;
    // 对齐 ocs：优先播「当前可见/正在播」的那个，不要永远命中第一个 iframe 视频
    for (var i = 0; i < frames.length; i++) {
      try {
        var doc = frames[i].document;
        var href = '';
        try { href = (frames[i].location && frames[i].location.href) || ''; } catch (e) {}
        var nodes = doc.querySelectorAll('#video_html5_api, video[id*="video_html5"], video');
        for (var n = 0; n < nodes.length; n++) {
          var video = nodes[n];
          var width = 0;
          var height = 0;
          try { width = video.offsetWidth || 0; height = video.offsetHeight || 0; } catch (e) {}
          var score = 0;
          if (width >= 80 && height >= 40) score += 8;
          else if (width > 0 && height > 0) score += 2;
          if (__cxHas(href, 'ananas') || __cxHas(href, 'modules/video')) score += 5;
          if (video.id && __cxHas(video.id, 'video_html5')) score += 2;
          var duration = Number(video.duration);
          if (isFinite(duration) && duration > 1) score += 1;
          try {
            if (video.paused === false && !video.ended) score += 20;
            if (video.currentTime > 0.5) score += 4;
          } catch (e) {}
          if (score > bestScore) {
            bestScore = score;
            best = video;
          }
        }
      } catch (e) {}
    }
    return best;
  }

function __cxActiveStep(){
    var steps = __cxListSteps();
    for (var i = 0; i < steps.length; i++) if (steps[i].active) return steps[i];
    return null;
  }

function __cxVideoInStep(step){
    if (!step || !step.el) return null;
    try {
      var root = step.el;
      var nodes = root.querySelectorAll ? root.querySelectorAll('video') : [];
      for (var i = 0; i < nodes.length; i++) {
        if ((nodes[i].offsetWidth || 0) > 0) return nodes[i];
      }
      var iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
      for (var f = 0; f < iframes.length; f++) {
        try {
          var doc = iframes[f].contentDocument;
          if (!doc) continue;
          var vs = doc.querySelectorAll('#video_html5_api, video');
          for (var v = 0; v < vs.length; v++) {
            if ((vs[v].offsetWidth || 0) > 0 || Number(vs[v].duration) > 1) return vs[v];
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

function __cxFindPlayVideo(){
    var active = __cxActiveStep();
    var inStep = __cxVideoInStep(active);
    if (inStep) return inStep;
    return __cxFindVideo();
  }

function __cxVideoSnap(video){
    if (!video) return null;
    var duration = Number(video.duration);
    return {
      current: Number(video.currentTime) || 0,
      duration: isFinite(duration) && duration > 0 ? duration : 0,
      paused: !!video.paused,
      ended: !!video.ended,
      ready: Number(video.readyState) || 0,
      src: String(video.currentSrc || video.src || ''),
      ts: Date.now(),
    };
  }

function __cxJobIconDone(el){
    if (!el) return null;
    try {
      var icon = null;
      if (el.classList && (el.classList.contains('ans-job-icon') || __cxHas(el.className, 'ans-job-icon'))) {
        icon = el;
      } else if (el.querySelector) {
        icon = el.querySelector('.ans-job-icon');
      }
      if (!icon && el.parentElement && el.parentElement.querySelector) {
        icon = el.parentElement.querySelector('.ans-job-icon');
      }
      if (!icon) return null;
      return __cxIconIsDone(icon);
    } catch (e) { return null; }
  }

function __cxIconIsDone(icon){
    if (!icon) return null;
    try {
      var cls = String(icon.className || '');
      var label = String(icon.getAttribute('aria-label') || icon.getAttribute('title') || '');
      if (__cxHas(cls, 'ans-job-icon-clear') || __cxHas(cls, 'icon-clear') || __cxHas(cls, 'finish') || __cxHas(cls, 'clear')) return true;
      if (__cxHas(label, '已完成') || __cxHas(label, '任务点完成')) return true;
      var pos = '';
      try { pos = window.getComputedStyle(icon).backgroundPosition || ''; } catch (e) {}
      if (pos === '0px -24px' || pos.indexOf('-24px') >= 0) return true;
      // 明确未完成标记
      if (__cxHas(cls, 'ans-job-icon') && !__cxHas(cls, 'clear') && !__cxHas(cls, 'finish')) {
        if (__cxHas(label, '未完成') || __cxHas(label, '任务点')) return false;
      }
      return false;
    } catch (e) { return null; }
  }

function __cxVideoJobIcons(){
    var frames = __cxFrames(window, 0);
    var videos = [];
    var fallback = [];
    for (var f = 0; f < frames.length; f++) {
      try {
        var nodes = frames[f].document.querySelectorAll('.ans-job-icon');
        for (var i = 0; i < nodes.length; i++) {
          var icon = nodes[i];
          var cls = String(icon.className || '');
          if (__cxHas(cls, 'ans-job-video')) videos.push(icon);
          else if (!__cxHas(cls, 'work') && !__cxHas(cls, 'doc') && !__cxHas(cls, 'book') && !__cxHas(cls, 'quiz')) {
            fallback.push(icon);
          }
        }
      } catch (e) {}
    }
    return videos.length ? videos : fallback;
  }

function __cxCollectTabSteps(doc){
    var out = [];
    var nodes = doc.querySelectorAll('.prev_title, .prev_white, .prevTabs a, .prevTabs span, .prevTabs li, .switchTab a, .switchTab span, .tabtags a, .tabtags li');
    var videoIcons = __cxVideoJobIcons();
    var videoOrd = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var label = __cxClean(el.getAttribute('title') || el.textContent || '');
      if (!label || label.length > 24) continue;
      var isVideo = __cxHas(label, '视频') && !__cxHas(label, '测验');
      var isQuiz = __cxHas(label, '测验') || __cxHas(label, '考试') || __cxHas(label, '作业');
      var isDoc = __cxHas(label, '文档') || __cxHas(label, 'PPT') || __cxHas(label, '阅读') || __cxHas(label, '图文');
      if (!isVideo && !isQuiz && !isDoc) continue;
      var cls = String(el.className || '');
      var done = __cxJobIconDone(el);
      // 标签本身通常没有完成图标；视频任务点按序号对齐 .ans-job-icon
      if (isVideo) {
        videoOrd += 1;
        if (done == null && videoIcons[videoOrd - 1]) done = __cxIconIsDone(videoIcons[videoOrd - 1]);
      }
      out.push({
        el: el,
        label: label,
        video: isVideo,
        quiz: isQuiz,
        doc: isDoc,
        active: __cxHas(cls, 'currents') || __cxHas(cls, 'active') || __cxHas(cls, 'select') || __cxHas(cls, 'curr'),
        jobDone: done,
      });
    }
    return out;
  }

function __cxCollectJobSteps(){
    var out = [];
    var frames = __cxFrames(window, 0);
    for (var f = 0; f < frames.length; f++) {
      try {
        var doc = frames[f].document;
        var boxes = doc.querySelectorAll('.ans-attach-ct, .ans-cc, .moduleDiv');
        for (var i = 0; i < boxes.length; i++) {
          var box = boxes[i];
          var iframe = box.querySelector && box.querySelector('iframe');
          var src = iframe ? String(iframe.src || iframe.getAttribute('src') || '') : '';
          var html = '';
          try { html = String(box.className || ''); } catch (e) {}
          var isVideo = !!box.querySelector('video') || __cxHas(src, 'ananas') || __cxHas(src, 'insertvideo') || __cxHas(src, 'modules/video') || __cxHas(html, 'insertvideo');
          var isQuiz = __cxHas(src, 'work') || __cxHas(src, 'quiz') || __cxHas(src, 'exam') || __cxHas(html, 'work');
          var isDoc = __cxHas(src, 'pdf') || __cxHas(src, 'document') || __cxHas(src, 'innerbook') || __cxHas(html, 'insertdoc');
          if (!isVideo && !isQuiz && !isDoc) continue;
          var playing = false;
          try { playing = !!(box.querySelector('video') && box.querySelector('video').paused === false); } catch (e) {}
          out.push({
            el: box,
            label: isVideo ? ('视频' + (out.filter(function(s){ return s.video }).length + 1)) : (isQuiz ? '测验' : '文档'),
            video: isVideo,
            quiz: isQuiz,
            doc: isDoc,
            active: playing || __cxHas(String(box.className || ''), 'active'),
            jobDone: __cxJobIconDone(box),
          });
        }
      } catch (e) {}
    }
    return out;
  }

function __cxListSteps(){
    var frames = __cxFrames(window, 0);
    var best = [];
    for (var f = 0; f < frames.length; f++) {
      try {
        var got = __cxCollectTabSteps(frames[f].document);
        if (got.length > best.length) best = got;
      } catch (e) {}
    }
    var videoTabs = 0;
    for (var t = 0; t < best.length; t++) if (best[t].video) videoTabs++;
    if (videoTabs <= 1) {
      var jobs = __cxCollectJobSteps();
      var videoJobs = 0;
      for (var j = 0; j < jobs.length; j++) if (jobs[j].video) videoJobs++;
      if (videoJobs > videoTabs) best = jobs;
    }
    // 不要把「第一个」强行标成 active：切到视频2后若 class 还没跟上，会被当成还在视频1，play 又跳回去。
    if (best.length && !best.some(function(item){ return item.active; })) {
      var playing = null;
      try { playing = __cxFindVideo(); } catch (e) {}
      if (playing) {
        for (var p = 0; p < best.length; p++) {
          try {
            if (best[p].el && best[p].el.contains && best[p].el.contains(playing)) {
              best[p].active = true;
              break;
            }
            var boxVideo = __cxVideoInStep(best[p]);
            if (boxVideo && boxVideo === playing) { best[p].active = true; break; }
          } catch (e) {}
        }
      }
    }
    return best;
  }

function __cxClickChapterTab(){
    var sels = ['a[data-url*="studentcourse"]', '[data-url*="studentcourse"]', 'a[data-url*="/mycourse/studentcourse"]'];
    for (var s = 0; s < sels.length; s++) {
      var el = document.querySelector(sels[s]);
      if (!el) continue;
      __cxClick(el);
      return { ok: true, via: sels[s] };
    }
    var nodes = document.querySelectorAll('a, [role="tab"], li, span');
    for (var i = 0; i < nodes.length; i++) {
      var t = __cxClean(nodes[i].getAttribute('title') || nodes[i].textContent || '');
      if (t === '章节') {
        __cxClick(nodes[i]);
        return { ok: true, via: 'text' };
      }
    }
    return { ok: false, error: '没有章节标签' };
  }

function __cxAttachments(win){
      try {
        var list = win.attachments;
        if (list && list.length) return list;
      } catch (e) {}
      return null;
    }

function __cxJobsFromAttachments(){
      var frames = __cxFrames(window, 0);
      for (var f = 0; f < frames.length; f++) {
        var list = __cxAttachments(frames[f]);
        if (!list || !list.length) continue;
        var videoN = 0;
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var a = list[i] || {};
          var prop = a.property || {};
          var module = String(prop.module || '');
          var isVideo = module === 'insertvideo' || module === 'insertaudio';
          var isQuiz = module === 'work';
          var isDoc = module === 'insertdoc' || module === 'insertbook' || module === 'insertflash';
          if (!isVideo && !isQuiz && !isDoc) continue;
          if (isVideo) videoN += 1;
          var name = __cxClean(prop.name || prop.title || prop.bookname || '');
          var passed = a.isPassed === true;
          var isJob = a.job === true;
          // 对齐 ocs：job=待做任务点；isPassed=已完成；否则非任务点（刷课时跳过）
          out.push({
            mid: String(prop.mid || ''),
            jobid: String(a.jobid || prop._jobid || ''),
            label: name || (isVideo ? ('视频' + videoN) : isQuiz ? '测验' : '文档'),
            kind: isVideo ? 'video' : isQuiz ? 'quiz' : 'doc',
            video: isVideo,
            quiz: isQuiz,
            doc: isDoc,
            jobDone: passed || !isJob,
            passed: passed,
            unfinished: isJob && !passed,
            active: false,
          });
        }
        if (out.length) return out;
      }
      return null;
    }

function __cxMarkActive(jobs){
      var steps = __cxListSteps();
      var activeLabel = '';
      var activeVideoOrd = 0;
      var videoOrd = 0;
      for (var s = 0; s < steps.length; s++) {
        if (steps[s].video) {
          videoOrd += 1;
          if (steps[s].active) {
            activeLabel = steps[s].label;
            activeVideoOrd = videoOrd;
          }
        } else if (steps[s].active) {
          activeLabel = steps[s].label;
        }
      }
      // DOM 完成图标（ans-job-icon-clear）比 attachments 内存状态更及时
      var icons = __cxVideoJobIcons();
      var videoSeen = 0;
      for (var j = 0; j < jobs.length; j++) {
        var job = jobs[j];
        if (job.video) {
          videoSeen += 1;
          job.active = Boolean(
            (activeVideoOrd && videoSeen === activeVideoOrd)
            || (activeLabel && job.label === activeLabel)
          );
          var iconDone = icons[videoSeen - 1] ? __cxIconIsDone(icons[videoSeen - 1]) : null;
          if (iconDone === true) {
            job.jobDone = true;
            job.unfinished = false;
          } else if (iconDone === false && job.jobDone !== true) {
            job.jobDone = false;
            job.unfinished = true;
          }
          // 步骤标签上的完成态
          var stepVideoOrd = 0;
          for (var t = 0; t < steps.length; t++) {
            if (!steps[t].video) continue;
            stepVideoOrd += 1;
            if (stepVideoOrd === videoSeen && steps[t].jobDone === true) {
              job.jobDone = true;
              job.unfinished = false;
            }
          }
        } else {
          job.active = Boolean(activeLabel && (job.label === activeLabel || (job.quiz && __cxHas(activeLabel, '测验'))));
        }
        if (job.unfinished == null) job.unfinished = job.jobDone !== true;
      }
      if (jobs.length && !jobs.some(function(item){ return item.active; })) {
        var playing = __cxFindVideo();
        if (playing && playing.paused === false) {
          for (var k = 0; k < jobs.length; k++) {
            if (jobs[k].video && jobs[k].jobDone !== true) { jobs[k].active = true; break; }
          }
        }
      }
      return jobs;
    }
