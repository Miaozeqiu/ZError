(function (captureCaptcha) {
  const visible = element => element && element.getClientRects().length > 0
    && getComputedStyle(element).visibility === 'visible';
  const shown = selector => [...document.querySelectorAll(selector)].some(visible);
  if (location.origin === 'https://background.zjooc.cn' && location.pathname === '/gxptLogin') {
    const box = '.login_box ';
    const ready = ['input#login_name[type=text]', 'input#password[type=password]', 'button.dologin']
      .every(selector => shown(box + selector + ':enabled'));
    if (shown('#login-warp .login-dialog')) return { kind: 'reset' };
    const error = document.querySelector('#error_msg');
    const message = visible(error) ? error.textContent.replace(/\s+/g, '') : '';
    if (message) {
      const credentialsRejected = /(?:用户名|账号|帐号|账户|密码)(?:输入)?(?:错误|有误|不正确|不匹配|不存在)|(?:用户名|账号|帐号|账户)(?:与|和|或)密码不一致/.test(message);
      const captchaRejected = /验证码(?:输入)?(?:错误|有误|不正确|不匹配|不一致|无效|已?过期|已?失效)/.test(message);
      return { kind: 'rejected', rejection: captchaRejected ? 'captcha' : credentialsRejected ? 'credentials' : 'unknown' };
    }
    const challenge = shown(box + '.forms.code input[name=captchaCode]');
    const state = { kind: ready ? 'form' : 'loading', challenge };
    if (captureCaptcha && ready && challenge) {
      const image = document.querySelector(box + '.forms.code img[alt="点击刷新"]');
      if (visible(image) && image.complete && image.naturalWidth > 0 && image.naturalWidth <= 400
        && image.naturalHeight > 0 && image.naturalHeight <= 160) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          state.captchaImage = canvas.toDataURL('image/png');
        } catch { /* The verification can still be completed on the website. */ }
      }
    }
    return state;
  }
  if (location.origin !== 'https://www.zjooc.cn') return { kind: 'other' };
  const headerLinks = [...document.querySelectorAll('.front-header-top .ta-r a')].filter(visible);
  if (headerLinks.some(link => link.textContent.trim() === '退出')
    || shown('.front-header-item .avators-item.identity_switching')) return { kind: 'space' };
  if (headerLinks.some(link => link.textContent.trim() === '请登录')) return { kind: 'guest' };
  return { kind: 'loading' };
})
