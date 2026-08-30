---
name: chaoxing-login
description: >-
  Logs into 学习通 (Chaoxing) at passport2.chaoxing.com using the in-app browser
  tools. Use when the user asks to 登录学习通, 打开学习通, 超星登录, or operate the
  Chaoxing space / course list after login.
---

# 学习通登录

给浏览器 Agent 用。只用当前窗口的 `browser_*` 工具，不要另开外部浏览器，不要把账号密码写进代码或日志。

## 入口

- 登录页：`https://passport2.chaoxing.com`（会跳到 `/login?fid=&refer=`）
- 成功后：`https://i.mooc.chaoxing.com/space/index`（标题常是学校名）
- 课程列表常在 iframe `#frame_content`。已注入全 frame 桥，可直接点；也可打开顶层课表 `https://mooc1-1.chaoxing.com/visit/interaction`。不要打开 `studentcourse` / `knowledge/cards` / `ananas` 等 iframe 文档地址

## 先看页面

1. `browser_get_state`
2. 已在 `i.mooc.chaoxing.com` / `i.chaoxing.com` 且没有 `#loginBtn` → 已登录，不要再填密码
3. 否则 `browser_navigate` 到 `https://passport2.chaoxing.com`，再 `browser_get_page`

## 账号密码登录

优先用【已记账号】里的学习通账号密码，有就直接填，不要再问。用户新说的「账号 … 密码 …」会覆盖记忆；说「忘掉学习通账号」会删掉。都没有才先问。

1. `browser_type` `#phone` ← 手机号/超星号
2. `browser_type` `#pwd` ← 密码
3. 需要保持登录时点 `.auto-lg-next .check-input`（下次自动登录，不是协议勾选）
4. `browser_click` `#loginBtn`
5. 等 1–2 秒，再 `browser_get_state` / `browser_get_page`

协议「我已阅读并同意」只是文案 `#passportAgreement`，没有必须点的复选框。

`browser_type` 填不上时，用 `browser_eval`：

```js
(function(){
  var el = document.querySelector('#phone');
  if (!el) return { ok:false, error:'没有 #phone' };
  el.focus();
  el.value = '用户给的账号';
  el.dispatchEvent(new Event('input', { bubbles:true }));
  el.dispatchEvent(new Event('change', { bubbles:true }));
  return { ok:true, value: el.value };
})()
```

`#pwd` 同样处理。

## 判断结果

成功：

- 离开 `passport2.chaoxing.com/login`
- 到达 `i.mooc.chaoxing.com` 或 `i.chaoxing.com`
- 出现「退出登录」、用户名，或课程页

失败（停在登录页）：

- 读 `#phoneMsg`、`#pwdMsg`、`#loginTip` 的可见文字
- 据实告诉用户，不要重试同一组错误密码

验证码 / 滑块：

- `#needVcode` 有值，或出现 geetest / 滑块 / 图形验证
- 停下来让用户自己完成，完成后再点 `#loginBtn`
- 不要破解、不要绕过

## 扫码

右侧 `#quickCode` 是二维码。用户要扫码时：打开登录页，提醒用学习通 App 扫，等跳到空间页。扫到一半会出现「请在学习通上点击确认以登录」。不要假装已经扫过。

## 验证码登录

1. 点带「验证码登录」的链接
2. `#phone`（此时 placeholder 是「手机号码」）
3. 点 `#sendCodeBtn`「获取验证码」
4. 让用户把短信验证码发过来，填 `#vercode`
5. 点 `#loginBtn`

## 登录后看课

主空间侧栏：

| 文案 | 选择器 | 说明 |
| --- | --- | --- |
| 首页 | `#zne_sy_icon` | 切 iframe |
| 课程 | `#zne_kc_icon` | 切 iframe |
| 退出登录 | 含该文本的链接 | 顶栏 |

课程列表页（直接打开 interaction URL）：

- 标签：`我教的课` / `我学的课`
- 课名在 `li.course a.color1` 或 `.course-name`
- 点课名进入课程

iframe 里的点击：用 `browser_click_text` / 全 frame 桥，**不要** `browser_navigate` 进 iframe 自己的地址。

## 不要做

- 不要把密码写进回复、步骤摘要或 `browser_eval` 以外的地方
- 不要伪造登录成功
- 不要自动走微信 / QQ 第三方登录（用户自己点）
- 不要把学习通 iframe 文档（studentcourse、cards、ananas、insert*）当顶层网址打开
