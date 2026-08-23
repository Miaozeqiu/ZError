# 用户登录与账号接口

题库登录走 **zzx**（`https://app.zaizhexue.top`，也可用 `https://api-org.zerror.cc`）。  
校园题库（`https://campuses.zerror.cc`）不单独登录，复用这里下发的 Token。

实现：`zzx/routes/auth.py`、`zzx/routes/wechat.py`、`zzx/routes/qq.py`、`zzx/routes/user.py`。  
QQ 细节另见 `API_QQ_LOGIN.md`。

---

## 1. Token

登录成功后前端保存：

```text
Authorization: Bearer {encrypted}|{timestamp}
```

- `{encrypted}`：`openid|timestamp` 加密后的 hex
- `{timestamp}`：Unix 秒，明文缀在后面
- 校验：解密得到 openid，再查 `users.openid`
- 过期：zzx `validateToken` 按 30 天；校园题库按 365 天
- 校园接口也可 `?token=` 传同一串

新用户默认 `api_call_count = 200`，`status = unverified`。

---

## 2. 微信公众号登录（主流程）

用户在网页拿 6 位验证码，把验证码发给公众号。公众号回调把验证码写成已验证，网页轮询拿到 Token。

```
网页 POST /trigger_login  → 得到 verification_code
用户把验证码发给公众号
公众号 POST /weChatLogIn  → Redis[code] = 微信 openid
网页轮询 POST /polling    → 返回 token
```

### 2.1 申请验证码

`POST /trigger_login`

同一 IP 在 5 分钟内、验证码仍为 `pending` 时，重复请求返回同一个码。

```json
{ "verification_code": "123456" }
```

### 2.2 轮询登录结果

`POST /polling`

```json
{ "verification_code": "123456" }
```

未完成：

```json
{ "logged_in": false }
```

IP 与申请时不一致：

```json
{ "logged_in": false, "error": "IP mismatch" }
```

成功（用户已把验证码发给公众号）：

```json
{
  "logged_in": true,
  "user": {
    "nickname": "用户1234",
    "token": "加密串|时间戳",
    "createdTime": "2026-01-01T00:00:00"
  }
}
```

成功后验证码作废。新用户由公众号侧自动建号。

### 2.3 公众号回调（服务端，不是网页调）

`GET|POST /weChatLogIn`

- GET：微信服务器验签，回 `echostr`
- POST：XML。若文本正好是 Redis 里 `pending` 的验证码，则建号或登录，并把 Redis 值改成该用户的微信 `openid`

用户也可回复 `@昵称` 改名。

### 2.4 校验 Token

`POST /validateToken`

```json
{ "token": "加密串|时间戳" }
```

有效 200；无效 400；过期 401；用户不存在 404。

---

## 3. QQ 登录

前端用 QQ OAuth 拿到 `access_token`，后端向 `graph.qq.com` 换 `openid`。  
QQ App ID：`102824367`。

未绑定过微信的 QQ **不能单独注册**，必须先走公众号验证码，再绑定。

### 3.1 检查是否已绑定

`POST /api/qq/login`

```json
{ "access_token": "QQ_ACCESS_TOKEN" }
```

已绑定：

```json
{
  "success": true,
  "message": "Login successful",
  "data": { "token": "...", "user": { "id": 1, "nickname": "...", "is_bound_qq": true } }
}
```

未绑定：

```json
{
  "success": false,
  "message": "User not bound or registered",
  "code": "NEED_BINDING",
  "qq_openid": "...",
  "temp_token": "..."
}
```

封禁：`403`。

### 3.2 验证码绑定并登录（新 QQ）

先 `/trigger_login` → 用户发公众号 → 再调本接口。

`POST /api/qq/bind-register`

```json
{
  "temp_token": "NEED_BINDING 返回的 temp_token",
  "verification_code": "123456"
}
```

成功结构与 QQ 登录成功相同。

### 3.3 已登录用户补绑 QQ

`POST /api/qq/bind`  
`Authorization: Bearer <token>`

```json
{ "access_token": "QQ_ACCESS_TOKEN" }
```

---

## 4. 用户信息（需登录）

Header：`Authorization: Bearer <token>`

### 4.1 资料

`GET /api/user/info`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "nickname": "用户1234",
    "created_at": "...",
    "api_call_count": 200,
    "increase_times": 0,
    "status": "unverified",
    "is_trusted": false,
    "is_bound_qq": false,
    "class_id": null,
    "campus_id": 0,
    "campus_name": null,
    "api_token": "脚本用的长期 token，无时间戳后缀",
    "avatar": ""
  }
}
```

`status`：`unverified` | `verified` | `banned`。  
`is_trusted`：`trust_score > 500`。  
`api_token` 给脚本/题库查询用，和登录 Bearer Token 不是同一串。

### 4.2 重置脚本 Token

`POST /api/user/reset-token`

```json
{ "success": true, "data": { "api_token": "新的长期 token" } }
```

### 4.3 学生证认证（题库站，上传图片）

校园侧还有一套邀请码认证，见 `API_CAMPUS.md`。这里是 zzx 的证件上传。

`POST /api/user/certification`  
`multipart/form-data`

| 字段 | 说明 |
|---|---|
| `name` | 姓名 |
| `student_id` | 学号 |
| `images` | 学生证图，最多 2 张，png/jpg，单张 ≤ 2MB |

须先绑定学校。进行中的申请不能重复提交。

`GET /api/user/certification`：查当前认证状态。

### 4.4 我的反馈

`GET /api/user/feedbacks`

---

## 5. 前端怎么接

题库站 `tiku.zerror.cc` 的登录页：

1. `POST https://app.zaizhexue.top/trigger_login`
2. 展示验证码，引导关注公众号并发送
3. 每秒 `POST /polling`，直到 `logged_in: true`
4. `localStorage.token = user.token`
5. 之后所有需登录接口带 `Authorization: Bearer ${token}`

QQ：授权拿 `access_token` → `/api/qq/login`；若 `NEED_BINDING` 再走验证码 + `/api/qq/bind-register`。
