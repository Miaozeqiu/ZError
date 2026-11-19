type Dispatch = (command: Record<string, unknown>) => Promise<any>
const logged = { status: 'logged_in' }
const manual = { status: 'manual' }
const stale = { status: 'stale' }
const fields = {
  chaoxing: { account: 'input#phone', password: 'input#pwd[type="password"]', button: '#loginBtn' },
  zjooc: { account: '.login_box input#login_name[type=text]', password: '.login_box input#password[type=password]', button: '.login_box button.dologin' },
}

/** Browser-host tests exercise commands from a fake repository. Actual workflows are tested in each site repository. */
export async function runLoginCommands(
  _host: string, site: 'chaoxing' | 'zjooc', _capability: string,
  input: { verify: boolean; submittingCaptcha: boolean; restart: boolean }, send: Dispatch,
) {
  const read = (capture = false, delay = 0) => send({ op: 'read', capture, delay })
  let state = await read(input.submittingCaptcha)
  if (state.kind === 'space') return logged
  if (input.verify) {
    while (state.kind === 'form' || state.kind === 'rejected') {
      if (state.rejection === 'credentials') {
        await send({ op: 'reject_credentials' })
        return manual
      }
      state = await read(false, 2000)
    }
    return state.kind === 'space' ? logged : manual
  }
  const { account, password, button } = fields[site]
  if (input.submittingCaptcha) {
    if (!(await send({ op: 'submit', button, captcha: '.login_box .forms.code input[name=captchaCode]' }))) return stale
    return (await read()).kind === 'space' ? logged : manual
  }
  if (state.kind === 'other') {
    await send({ op: 'navigate', url: site === 'chaoxing' ? 'https://i.chaoxing.com/' : 'https://www.zjooc.cn/' })
    state = await read()
  }
  if (input.restart && state.rejection === 'credentials') {
    await send({ op: 'navigate', url: 'https://background.zjooc.cn/gxptLogin' })
    const previous = state.document
    for (let attempt = 0; attempt < 8; attempt++) {
      state = await read()
      if (state.kind === 'form' && state.document !== previous) break
    }
  }
  if (site === 'chaoxing' && state.kind === 'form' && !state.modern) {
    await send({ op: 'navigate', url: 'https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com' })
    state = await read()
  }
  if (state.kind === 'guest') {
    if (!(await send({ op: 'open_form', selector: '.front-header-top .ta-r a', label: '请登录' }))) return manual
    state = await read()
  }
  if (state.kind !== 'form') return manual
  if (await send({ op: 'fill_credentials', account, password }) !== 'filled') return manual
  const current = await read(site === 'zjooc')
  if (current.kind === 'challenge') return manual
  if (current.kind !== 'form' || current.document !== state.document) return stale
  if (site === 'zjooc') {
    if (!current.challenge) return manual
    if (current.imageAvailable) await send({ op: 'issue_captcha' })
    return { status: 'captcha' }
  }
  if (!(await send({ op: 'submit', button }))) return stale
  state = await read()
  return state.kind === 'space' ? logged : state.rejected ? { status: 'rejected' } : manual
}
