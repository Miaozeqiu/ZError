// 刷课 · play：播放、切任务点
function play() {
    var frames = __cxFrames(window, 0);
      var video = __cxFindPlayVideo();
      var playBtn = null;
      var cover = null;
      var searchDocs = [];
      if (video && video.ownerDocument) searchDocs.push(video.ownerDocument);
      for (var i = 0; i < frames.length; i++) {
        try { searchDocs.push(frames[i].document); } catch (e) {}
      }
      for (var d = 0; d < searchDocs.length; d++) {
        try {
          var doc = searchDocs[d];
          if (!playBtn) playBtn = doc.querySelector('.vjs-big-play-button, button.vjs-big-play-button, .vjs-play-control.vjs-paused');
          if (!cover) cover = doc.querySelector('.vjs-poster, .full_page_bg, .ans-job-poster');
        } catch (e) {}
      }
      if (playBtn) __cxClick(playBtn);
      else if (cover) __cxClick(cover);
      if (video) {
        try { video.muted = false; } catch (e) {}
        var start = video.play();
        if (start && start.catch) start.catch(function(){});
      }
      var snap = __cxVideoSnap(video) || {};
      var active = __cxActiveStep();
      return {
        page: (__cxHas(location.href, 'studentstudy') || document.querySelector('#coursetree')) ? 'player' : location.pathname,
        clickedPlay: !!playBtn,
        clickedCover: !playBtn && !!cover,
        hasVideo: !!video,
        paused: snap.paused == null ? null : snap.paused,
        ended: snap.ended || false,
        current: snap.current || 0,
        duration: snap.duration || 0,
        ready: snap.ready || 0,
        src: snap.src || '',
        step: active ? active.label : '',
        frameCount: frames.length,
      };
  }

function clickVideoTab() {
    var steps = __cxListSteps();
      var videos = steps.filter(function(s){ return s.video; });
      var current = null;
      for (var i = 0; i < steps.length; i++) if (steps[i].active) { current = steps[i]; break; }
      if (current && current.quiz) return { ok: false, quiz: true, step: current.label, steps: steps.length, videoCount: videos.length };
      // 当前视频未完成：留在当前（对齐 ocs 播当前 attachment）
      if (current && current.video && current.jobDone !== true) {
        return { ok: true, already: true, step: current.label, videoCount: videos.length, jobDone: false };
      }
      // 当前已完成（ans-job-icon-clear）或没有激活：找下一个未完成视频，不要反复播已看完的
      var hit = null;
      var start = 0;
      if (current && current.video) {
        for (var s = 0; s < steps.length; s++) if (steps[s] === current) { start = s + 1; break; }
      }
      for (var k = start; k < steps.length; k++) {
        if (steps[k].video && steps[k].jobDone !== true) { hit = steps[k]; break; }
      }
      if (!hit) {
        for (var n = 0; n < steps.length; n++) {
          if (steps[n].video && steps[n].jobDone !== true) { hit = steps[n]; break; }
        }
      }
      if (!hit) {
        // 本节视频任务点都完成了
        if (current && current.video && current.jobDone === true) {
          return { ok: false, done: true, step: current.label, videoCount: videos.length, error: '本节视频任务点已完成' };
        }
        for (var m = 0; m < steps.length; m++) if (steps[m].video) { hit = steps[m]; break; }
      }
      if (!hit) return { ok: false, step: current ? current.label : '', error: '没有视频标签', videoCount: videos.length };
      if (hit.active && hit.jobDone !== true) {
        return { ok: true, already: true, step: hit.label, videoCount: videos.length, jobDone: hit.jobDone === true };
      }
      __cxClick(hit.el);
      return { ok: true, step: hit.label, videoCount: videos.length, jobDone: hit.jobDone === true };
  }

function clickStep(want) {
    var req = want;
      if (typeof want === 'string' || typeof want === 'number') req = { label: String(want || '') };
      req = req || {};
      var wantLabel = __cxClean(req.label || '');
      var wantMid = __cxClean(req.mid || '');
      var wantJobid = __cxClean(req.jobid || '');
      var wantVideoIndex = parseInt(req.videoIndex, 10) || 0;
      var wantStepIndex = parseInt(req.index, 10) || 0;
      function playInside(hit){
        if (!hit || !hit.el || !hit.el.querySelectorAll) return;
        try {
          var videos = [];
          var nodes = hit.el.querySelectorAll('video');
          for (var i = 0; i < nodes.length; i++) videos.push(nodes[i]);
          var iframes = hit.el.querySelectorAll('iframe');
          for (var f = 0; f < iframes.length; f++) {
            try {
              var doc = iframes[f].contentDocument;
              if (!doc) continue;
              var vs = doc.querySelectorAll('video');
              for (var v = 0; v < vs.length; v++) videos.push(vs[v]);
            } catch (e) {}
          }
          for (var p = 0; p < videos.length; p++) {
            try {
              videos[p].muted = false;
              var st = videos[p].play();
              if (st && st.catch) st.catch(function(){});
            } catch (e) {}
          }
        } catch (e) {}
      }
      function blobOf(el){
        try {
          var iframe = el && el.querySelector && el.querySelector('iframe');
          return String((el && el.outerHTML) || '') + ' ' + String((iframe && (iframe.src || iframe.getAttribute('src'))) || '');
        } catch (e) { return ''; }
      }
      var steps = __cxListSteps();
      if (!steps.length) return { ok: false, error: '没有任务点标签' };
      var hit = null;
      if (wantMid) {
        for (var a = 0; a < steps.length; a++) {
          if (blobOf(steps[a].el).indexOf(wantMid) >= 0) { hit = steps[a]; break; }
        }
      }
      if (!hit && wantJobid) {
        for (var b = 0; b < steps.length; b++) {
          if (blobOf(steps[b].el).indexOf(wantJobid) >= 0) { hit = steps[b]; break; }
        }
      }
      if (!hit && wantVideoIndex > 0) {
        var vo = 0;
        for (var c = 0; c < steps.length; c++) {
          if (!steps[c].video) continue;
          vo += 1;
          if (vo === wantVideoIndex) { hit = steps[c]; break; }
        }
      }
      if (!hit && wantStepIndex > 0 && wantStepIndex <= steps.length) hit = steps[wantStepIndex - 1];
      if (!hit && wantLabel) {
        var videoOrd = 0;
        for (var d = 0; d < steps.length; d++) {
          var label = __cxClean(steps[d].label || '');
          if (steps[d].video) videoOrd += 1;
          if (label === wantLabel) { hit = steps[d]; break; }
          if (wantLabel === String(d + 1)) { hit = steps[d]; break; }
          if (steps[d].video && (wantLabel === String(videoOrd) || wantLabel === ('视频' + videoOrd) || wantLabel === ('视频 ' + videoOrd))) {
            hit = steps[d];
            break;
          }
        }
      }
      if (!hit && wantLabel) {
        for (var e = 0; e < steps.length; e++) {
          if (__cxHas(steps[e].label, wantLabel) || __cxHas(wantLabel, steps[e].label)) { hit = steps[e]; break; }
        }
      }
      if (!hit) {
        return {
          ok: false,
          error: '没有「' + (wantLabel || ('视频' + wantVideoIndex) || wantMid || '任务点') + '」',
          steps: steps.map(function(s){ return s.label; }),
          videoCount: steps.filter(function(s){ return s.video; }).length,
        };
      }
      var videoOrdOut = 0;
      for (var o = 0; o < steps.length; o++) {
        if (!steps[o].video) continue;
        videoOrdOut += 1;
        if (steps[o] === hit) break;
      }
      if (hit.active) {
        playInside(hit);
        return { ok: true, already: true, step: hit.label, video: !!hit.video, quiz: !!hit.quiz, doc: !!hit.doc, videoIndex: videoOrdOut || wantVideoIndex };
      }
      __cxClick(hit.el);
      playInside(hit);
      return { ok: true, step: hit.label, video: !!hit.video, quiz: !!hit.quiz, doc: !!hit.doc, videoIndex: videoOrdOut || wantVideoIndex };
  }

function nextStep() {
    var steps = __cxListSteps();
      var idx = -1;
      for (var i = 0; i < steps.length; i++) if (steps[i].active) { idx = i; break; }
      var videos = steps.filter(function(s){ return s.video });
      for (var k = idx + 1; k < steps.length; k++) {
        if (steps[k].quiz) {
          if (steps[k].jobDone === true) continue;
          __cxClick(steps[k].el);
          return { ok: false, quiz: true, step: steps[k].label, chapterDone: false, videoCount: videos.length, opened: true };
        }
        if (steps[k].doc) continue;
        if (steps[k].video && steps[k].jobDone !== true) {
          __cxClick(steps[k].el);
          return {
            ok: true,
            step: steps[k].label,
            index: k,
            videoCount: videos.length,
            more: true,
            chapterDone: false,
          };
        }
      }
      var frames = __cxFrames(window, 0);
      for (var f = 0; f < frames.length; f++) {
        try {
          var nodes = frames[f].document.querySelectorAll('a, button, span, div, li');
          for (var n = 0; n < nodes.length; n++) {
            var label = __cxClean(nodes[n].getAttribute('title') || nodes[n].textContent || '');
            if (label === '下一个任务点' || label === '下一任务点' || label === '下一个视频') {
              __cxClick(nodes[n]);
              return { ok: true, step: label, more: true, chapterDone: false, videoCount: videos.length };
            }
          }
        } catch (e) {}
      }
      return {
        ok: false,
        more: false,
        chapterDone: true,
        videoCount: videos.length,
        step: idx >= 0 ? steps[idx].label : '',
      };
  }
