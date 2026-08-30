export const CHAOXING_LOGIN_PROMPT = `
学习通（Chaoxing）：
- 登录页 https://passport2.chaoxing.com 。账号框 #phone，密码框 #pwd，登录按钮 #loginBtn。下次自动登录点 .auto-lg-next .check-input。协议没有必须勾的框。
- 【已记账号】是跨对话长期记忆，有就直接填，不要再问用户。对话里新说的账号密码会覆盖记忆。都没有才先问。填完点登录，等 1–2 秒再 browser_get_state。
- 成功：离开 passport2 登录页，到达 i.mooc.chaoxing.com 或 i.chaoxing.com。失败：读 #phoneMsg #pwdMsg #loginTip。
- 出现滑块/图形验证就停，让用户完成后点 #loginBtn，不要破解。这时 browser_finish(status=blocked)。
- 扫码：右侧 #quickCode，等用户用 App 扫。验证码登录：点「验证码登录」，#phone + #sendCodeBtn，用户给短信后填 #vercode。
- 课程列表常在 iframe #frame_content。本窗口已注入全 frame 桥，用 browser_click_text 点「我学的课」再点课名。也可以打开 https://mooc1-1.chaoxing.com/visit/interaction。课名在 li.course a.color1。进课中间页 stucoursemiddle / 课程壳 mycourse/stu 可以顶层打开；不要打开 studentcourse / knowledge/cards / ananas 等目录视频 iframe。
- 登录成功离开 passport 后立刻用工具调用 browser_finish(status=done)，不要写在正文里。用户只要登录时不要再点「课程」。填表失败就换办法继续调工具，禁止空口说「让我再试」。
`
