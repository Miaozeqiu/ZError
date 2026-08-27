export const CHAOXING_LOGIN_PROMPT = `
学习通（Chaoxing）：
- 登录页 https://passport2.chaoxing.com 。账号框 #phone，密码框 #pwd，登录按钮 #loginBtn。下次自动登录点 .auto-lg-next .check-input。协议没有必须勾的框。
- 用户没给账号密码就先问。填完点登录，等 1–2 秒再 browser_get_state。
- 成功：离开 passport2 登录页，到达 i.mooc.chaoxing.com 或 i.chaoxing.com。失败：读 #phoneMsg #pwdMsg #loginTip。
- 出现滑块/图形验证就停，让用户完成后点 #loginBtn，不要破解。
- 扫码：右侧 #quickCode，等用户用 App 扫。验证码登录：点「验证码登录」，#phone + #sendCodeBtn，用户给短信后填 #vercode。
- 课程列表在跨域 iframe #frame_content，父页点不到。要看课就打开 https://mooc1-1.chaoxing.com/visit/interaction ，课名在 li.course a.color1。
`
