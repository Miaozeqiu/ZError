// 刷课 · captcha：验证码
function captchaCheck() {
    var hit = function(doc){
        if (!doc) return false;
        try {
          if (doc.querySelector('#ucode, .yzmInp, form[action*="processVerify"], img[src*="processVerify"], #ccc')) return true;
          var t = ((doc.body && (doc.body.innerText || doc.body.textContent)) || '');
          return /请输入图片中的验证码|【\s*9010\s*】|processVerify/.test(t);
        } catch (e) { return false; }
      };
      if (hit(document)) return { captcha: true, message: '【9010】请输入图片中的验证码' };
      try {
        var extras = window.__ZE_FRAME_SNAPS__ || [];
        for (var i = 0; i < extras.length; i++) {
          if (/请输入图片中的验证码|【\s*9010\s*】|processVerify|#ucode/.test(String(extras[i].text || ''))) {
            return { captcha: true, message: '【9010】请输入图片中的验证码' };
          }
        }
      } catch (e) {}
      return { captcha: false };
  }

function captchaImage() {
    var img = null;
      try { img = document.querySelector('#ccc, .yzmImg img, img[src*="processVerify"]'); } catch (e) {}
      if (img && !img.complete) {
        if (!window.__ZE_CAPTCHA_WAIT__) {
          window.__ZE_CAPTCHA_WAIT__ = true;
          img.onload = function(){ window.__ZE_CAPTCHA_WAIT__ = false; };
        }
        return window.__ZE_CAPTCHA_IMG__ || { captcha: true, pending: true, src: String(img.src || '') };
      }
      if (img) {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 104;
          canvas.height = img.naturalHeight || img.height || 44;
          var ctx = canvas.getContext('2d');
          if (ctx && canvas.width > 0 && canvas.height > 0) {
            ctx.drawImage(img, 0, 0);
            var data = canvas.toDataURL('image/jpeg', 0.92);
            if (data && data.length > 80) {
              window.__ZE_CAPTCHA_IMG__ = { captcha: true, image: data, src: String(img.src || '') };
              return window.__ZE_CAPTCHA_IMG__;
            }
          }
        } catch (e) {}
        if (img.src && !window.__ZE_CAPTCHA_FETCHING__) {
          window.__ZE_CAPTCHA_FETCHING__ = true;
          fetch(img.src, { credentials: 'include', cache: 'no-store' }).then(function(res){ return res.blob(); }).then(function(blob){
            var reader = new FileReader();
            reader.onload = function(){
              window.__ZE_CAPTCHA_IMG__ = { captcha: true, image: reader.result, src: String(img.src || '') };
              window.__ZE_CAPTCHA_FETCHING__ = false;
            };
            reader.readAsDataURL(blob);
          }).catch(function(){ window.__ZE_CAPTCHA_FETCHING__ = false; });
        }
        return window.__ZE_CAPTCHA_IMG__ || { captcha: true, pending: true, src: String(img.src || '') };
      }
      return window.__ZE_CAPTCHA_IMG__ || { captcha: true, image: null };
  }

function captchaRefresh() {
    window.__ZE_CAPTCHA_IMG__ = null;
      window.__ZE_CAPTCHA_FETCHING__ = false;
      window.__ZE_CAPTCHA_WAIT__ = false;
      var img = null;
      try { img = document.querySelector('#ccc, .yzmImg img, img[src*="processVerify"]'); } catch (e) {}
      if (!img) return { ok: false };
      try { img.click(); } catch (e) {}
      var src = String(img.src || '');
      if (src) {
        img.src = /[?&]t=/.test(src)
          ? src.replace(/([?&]t=)\d+/, '$1' + Date.now())
          : src + (src.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
      }
      return { ok: true };
  }

function captchaFill(code) {
    code = String(code || '').replace(/\s+/g, '');
      if (!/^[0-9a-zA-Z]{4}$/.test(code)) return { ok: false, error: '验证码必须是 4 位字母或数字' };
      var input = document.querySelector('#ucode, .yzmInp, input[name="ucode"]');
      if (!input) return { ok: false, error: '没有验证码输入框' };
      input.focus();
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      var form = input.form || document.querySelector('form[action*="processVerify"]');
      var btn = document.querySelector('input.submit, input[type="submit"], button[type="submit"], .submit');
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit(btn || undefined);
      else if (btn) btn.click();
      else if (form) form.submit();
      return { ok: true, code: code };
  }
