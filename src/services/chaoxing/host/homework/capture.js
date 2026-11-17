// 作业 · capture：题盒截图给视觉模型
function capture(index) {
    var at = Math.max(0, Number(index || 1) - 1);
      window.__ZE_HW_LOCAL_SHOTS__ = window.__ZE_HW_LOCAL_SHOTS__ || {};
      var boxes = __hwBoxes(document);
      var box = boxes[at];
      if (!box) return { ok: false, error: '没有第' + (at + 1) + '题' };
      try { box.scrollIntoView({ block: 'center' }); } catch (e) {}
      var slot = window.__ZE_HW_LOCAL_SHOTS__[at];
      if (slot && slot.ready) return { ok: true, ready: true, index: at + 1, len: String(slot.data || '').length };
      if (window.__ZE_HW_CAPTURING__ === at) return { ok: true, pending: true, index: at + 1 };
      window.__ZE_HW_CAPTURING__ = at;
      __hwShotBox(box, function(data){
        window.__ZE_HW_LOCAL_SHOTS__[at] = { ready: true, data: data || '' };
        window.__ZE_HW_CAPTURING__ = null;
      });
      return { ok: true, pending: true, index: at + 1, imageCount: __hwImgs(box).length };
  }
