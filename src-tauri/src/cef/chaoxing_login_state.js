(function () {
  const visible = element => element && element.getClientRects().length > 0
    && getComputedStyle(element).visibility === 'visible';
  const active = element => visible(element) && !element.disabled
    && element.getAttribute('aria-disabled') !== 'true';
  const anyVisible = selector => [...document.querySelectorAll(selector)].some(visible);
  const { origin, pathname } = location;
  if ((origin === 'https://i.chaoxing.com' || origin === 'https://i.mooc.chaoxing.com')
    && /^\/(?:$|(?:space|base)(?:\/|$))/i.test(pathname)) {
    const courseFrame = document.querySelector('iframe#frame_content[src]');
    const courseUrl = courseFrame && new URL(courseFrame.src, origin);
    const signedIn = anyVisible('#zne_kc_icon, #zne_sy_icon, a[href*="logout" i], a[href*="loginOut" i]')
      || (/^\/base\/?$/i.test(pathname) && visible(courseFrame) && courseUrl?.protocol === 'https:'
        && courseUrl.hostname.endsWith('.chaoxing.com') && /^\/visit\/(?:interaction|courses)\/?$/i.test(courseUrl.pathname));
    return { kind: signedIn ? 'space' : 'loading' };
  }
  if (origin !== 'https://passport2.chaoxing.com') return { kind: 'other' };
  if (!/^\/login\/?$/i.test(pathname)) return { kind: 'passport' };

  const error = [...document.querySelectorAll('#phoneMsg, #pwdMsg, #loginTip')]
    .filter(visible).map(element => (element.innerText || '').trim()).filter(Boolean);
  const challengeFlag = String(document.querySelector('#needVcode')?.value || '').trim();
  if ((challengeFlag && !/^(?:0|false|no)$/i.test(challengeFlag))
    || anyVisible('#vercode, .geetest_panel, .geetest_slider, .geetest_captcha, .nc-container, iframe[src*="captcha" i]')
    || error.some(text => /验证码|滑块|安全验证|人机验证/.test(text))) {
    return { kind: 'challenge' };
  }
  const account = document.querySelector('input#phone');
  const password = document.querySelector('input#pwd[type="password"]');
  const button = document.querySelector('#loginBtn');
  const formReady = active(account) && !account.readOnly && /^(text|tel|email|number)$/.test(account.type)
    && active(password) && !password.readOnly && active(button);
  return {
    kind: formReady ? 'form' : 'loading',
    modern: new URLSearchParams(location.search).get('newversion') === 'true',
    rejected: error.length > 0,
  };
})()
