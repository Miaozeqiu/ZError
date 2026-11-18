use super::{bind_page, frames};
use serde_json::{json, Value};

// Fixed read-only probe. It never returns form values or page text, even after
// the password form has been marked private by fill_secret.
const LOGIN_STATE: &str = r##"(function () {
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
})()"##;

pub async fn state(id: &str) -> Result<Value, String> {
    read_state(id, LOGIN_STATE).await
}

pub async fn zjooc_state(id: &str, capture_captcha: bool) -> Result<Value, String> {
    let probe = format!("{}({})", include_str!("zjooc_login_state.js").trim(), capture_captcha);
    read_state(id, &probe).await
}

async fn read_state(id: &str, probe: &str) -> Result<Value, String> {
    let page = bind_page(id).await?;
    let tree = page
        .conn
        .call("Page.getFrameTree", json!({}), page.session.as_deref())
        .await?;
    let root = tree
        .pointer("/frameTree/frame")
        .ok_or("登录页面尚未就绪")?;
    let mut rows = Vec::new();
    frames::flatten(root, "", page.session.as_deref(), &mut rows);
    let frame = rows.first().ok_or("缺少登录页面身份")?;
    let observed = match frames::evaluate(&page, frame, probe).await {
        Ok(result) => result,
        Err(error) if crate::cdp_client::is_session_dead(&error) => return Err(error),
        Err(_) => json!({ "kind": "loading" }),
    };
    let mut observed = observed.as_object().cloned().ok_or("登录状态无效")?;
    observed.insert("url".into(), json!(frame.url));
    observed.insert("frameId".into(), json!(frame.id));
    observed.insert("loaderId".into(), json!(frame.loader_id));
    Ok(Value::Object(observed))
}
