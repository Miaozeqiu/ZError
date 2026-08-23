# 校园题库接口

服务：`https://campuses.zerror.cc`（`zerror-campus-bank-backend`，默认监听 `:3001`）  
登录 Token 与题库 zzx 相同，见 `API_AUTH.md`。本服务不发 Token。

实现：`zerror-campus-bank-backend/main.go` 及 `handlers/`。  
前端路径表：`ze/src/config/api.js`。

---

## 1. 鉴权与权限

```text
Authorization: Bearer {encrypted}|{timestamp}
```

也可 `?token=`。解密得到微信 `openid`，查同一张 `users` 表。Token 按 365 天过期。

| 标记 | 含义 |
|---|---|
| 公开 | 不用登录 |
| 登录 | 有效 Token |
| 认证 | `users.status == verified`，且未封禁 |
| 审核员 | `is_reviewer == true`（部分接口） |
| 绑定学校 | 多数课程/题目接口要求 `campus_id` 对得上 |

未认证用户可以看课、看题；**创建/改删/投票/评价**要认证。答案是否完整由各 handler 再判断。

---

## 2. 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 存活探测 |
| GET | `/health` | 数据库健康 |
| GET | `/campuses` | 学校列表（缓存） |
| GET | `/tags` | 文件夹标签 |
| GET | `/campus/:campus_id/stats` | 该校排名及邻近学校 |
| GET | `/images/:filename` | 课程封面等图片 |

`GET /campuses` 直接返回学校数组（`id` / `ID`、`name` / `Name` 等，看缓存结构）。

---

## 3. 绑定学校与身份

均需登录。

### 3.1 绑定学校

`POST /bind-campus`

```json
{ "campus_id": 1 }
```

成功：

```json
{
  "message": "Campus bound successfully",
  "user": { "id": 1, "openid": "...", "campus_id": 1 }
}
```

学校不存在 404。每人一个 `campus_id`。

### 3.2 当前学校与身份

`GET /user/campus`

未绑定：`{ "message": "...", "campus": null }`

已绑定：

```json
{
  "message": "User campus retrieved successfully",
  "campus": { "ID": 1, "Name": "某大学" },
  "status": "verified",
  "is_trusted": false,
  "enrollment_year": 2024,
  "is_reviewer": false,
  "class_id": 3,
  "class": { "ID": 3, "Name": "计科1班" },
  "avatar": "uuid.webp",
  "reviewers": [
    {
      "id": 2,
      "nickname": "...",
      "name": "...",
      "class_name": "...",
      "reviewer_qq": "...",
      "reviewer_wechat": "...",
      "avatar": "..."
    }
  ]
}
```

`is_trusted`：`trust_score > 500`。`reviewers` 为同学年审核员。

### 3.3 入学年份

`POST /user/enrollment-year`

```json
{ "enrollment_year": 2024 }
```

须先绑定学校。年份范围 2000～今年。

### 3.4 申请当审核员

`POST /user/join-reviewer`

```json
{ "qq": "123456", "wechat": "" }
```

`qq` / `wechat` 至少填一个。须已绑定学校、入学年，且 `status=verified`。同一学校同学年最多 5 个审核员。

### 3.5 校园邀请码认证

与 zzx 上传学生证不同，这里用班级邀请码。

`GET /user/certification/audit`：当前申请状态。

`POST /user/certification/submit`

```json
{
  "invitation_code": "邀请码",
  "name": "张三",
  "student_id": "20240001"
}
```

审核员：

- `POST /user/certification/:id/approve`
- `POST /user/certification/:id/reject`，body 可带 `remark`

---

## 4. 班级

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/user/classes` | 审核员 | 班级列表 |
| POST | `/user/classes` | 审核员 | 创建。`{ "name": "计科1班" }` |
| DELETE | `/user/classes/:id` | 审核员 | 删除 |
| GET | `/user/classes/:id/users` | 登录 | 本班成员；审核员可看任意班 |
| PUT | `/user/classes/users/:user_id` | 审核员 | 给人分班。`{ "class_id": 3 }` |
| POST | `/user/classes/:id/invitation` | 审核员 | 生成邀请码（约 10 分钟） |
| POST | `/user/join-class` | 登录 | `{ "invitation_code": "..." }` |
| POST | `/user/join-class-direct` | 认证 | 已认证用户直接进班 |

---

## 5. 课程

除特别说明外需登录，且已绑定该校。

### 5.1 列表

`GET /campus/:campus_id/courses?name=关键字`

返回已通过课程，外加**当前用户自己待审**的课。每门课带 `folder_count`、`question_count`（按当前用户入学年可见、未归档的试卷统计；题数只计父题）。

### 5.2 创建（认证，multipart）

`POST /courses`  
`Content-Type: multipart/form-data`

| 字段 | 说明 |
|---|---|
| `campus_id` | 学校 ID |
| `name` | 课程名，同校不可重名 |
| `image` | 可选封面 |

默认 `pending`。审核员创建可直接通过。

### 5.3 详情 / 未分类题 / 编辑 / 删除投票

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/courses/:id` | 登录 | 课程、文件夹、题目概要。课程和每个文件夹带 `question_count`，课程另带 `folder_count` |
| GET | `/courses/:id/questions?page=1&page_size=20` | 登录 | 未进文件夹的题 |
| PUT | `/courses/:id` | 认证 | 改名等，可能走待审影子课 |
| POST | `/courses/:id/delete` | 认证 | 发起删课投票，body 可带 `remark` |
| GET | `/courses/:course_id/trash` | 登录 | 未分类回收站 |

### 5.4 收藏

`POST /courses/:id/favorite`  
`DELETE /courses/:id/favorite`  
`GET /user/favorites`：我收藏的校园课

---

## 6. 文件夹（题库）

创建/改/删/归档需认证。

| 方法 | 路径 | Body / Query |
|---|---|---|
| POST | `/courses/:course_id/folders` | `{ "name", "tag_id?" }` |
| PUT | `/folders/:folder_id` | `{ "name?", "year?" }` |
| POST | `/folders/:folder_id/delete` | 可带 `remark`；创建者或直接删，否则投票 |
| POST | `/folders/:folder_id/archive` | 可带 `remark` |
| POST | `/folders/:folder_id/unarchive` | 可带 `remark` |
| GET | `/folders/:folder_id/questions` | 题目列表 |
| POST | `/folders/:folder_id/reorder` | `{ "ids": [题ID…] }` 仅创建者 |
| GET | `/folders/:folder_id/trash` | 该夹回收站 |

新建文件夹会带上用户的入学年份。

---

## 7. 题目

写操作需认证。

### 7.1 创建

`POST /courses/:course_id/questions`

```json
{
  "type": "single_choice",
  "content": "题干",
  "options": "[\"A\",\"B\",\"C\",\"D\"]",
  "answer": "A",
  "question_bank_id": 12,
  "add_to_top": false,
  "parent_id": null
}
```

`type`：`single_choice` `multiple_choice` `true_false` `fill_blank` `short_answer` `essay` `calculation` `definition` `listening` `cloze` `reading`。

`options` 是 JSON 字符串。`question_bank_id` 不传则进课程未分类。`parent_id` 表示子题。

### 7.2 改 / 删 / 恢复 / 移动 / 排序 / 评价

| 方法 | 路径 | 说明 |
|---|---|---|
| PUT | `/questions/:id` | 改题干、答案、移动文件夹等 |
| DELETE | `/questions/:id` | 进回收站（或投票，视实现） |
| DELETE | `/sub-questions/:id` | 子题直接删 |
| POST | `/questions/:id/restore` | 从回收站恢复 |
| PUT | `/questions/:id/move` | `{ "question_bank_id": 12 }` |
| POST | `/questions/:parent_id/reorder` | `{ "ids": [子题ID…] }` |
| POST | `/questions/:id/react` | `{ "type": "approve" \| "confuse" \| "none" }` |

### 7.3 搜索

`GET /search?q=关键字&page=1&page_size=20`

只搜当前用户所在学校、未删除题目。全文检索。

---

## 8. 投票

删课、删文件夹等会生成投票。需登录；投票本身需认证。

`GET /campus/:campus_id/votes`：本校投票列表。

`POST /votes/:id/cast`

```json
{ "decision": "approve" }
```

`decision`：`approve` | `reject`。每人每票一次，只能投本校。服务端每小时处理过期票。

---

## 9. 审核员审课

登录即可访问组，具体是否信任用户由 handler 再判。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/review/courses/pending` | 本校待审课 |
| POST | `/review/courses/:id/approve` | 通过 |
| POST | `/review/courses/:id/reject` | 拒绝 |
| GET | `/user/reviewer/actions?page=1&page_size=20` | 操作日志，可筛 `action_type` `target_type` |
| GET | `/user/reviewer/daily-stats` | 每日统计，可带 `start_date` `end_date` `reviewer_id` |
| POST | `/user/reviewer/contact` | `{ "qq", "wechat" }` |
| POST | `/user/reviewer/avatar` | 上传头像（登录用户，`multipart` 字段 `image`） |

---

## 10. 超管（校园库）

组前缀 `/admin`，登录 + 指定管理员 openid。

| 方法 | 路径 |
|---|---|
| GET | `/admin/pending-courses` |
| POST | `/admin/courses/:id/approve` |
| POST | `/admin/courses/:id/reject` |
| GET | `/admin/users/search?q=` |
| PUT | `/admin/users/:id` |
| POST | `/admin/campuses` `{ "name" }` |
| PUT | `/admin/campuses/:id` |
| DELETE | `/admin/campuses/:id` |
| POST | `/admin/tags` `{ "name" }` |
| PUT | `/admin/tags/:id` |
| DELETE | `/admin/tags/:id` |

日常审课用 `/review/*`，不要走这组。

---

## 11. 典型前端流程

1. 用 zzx Token 调 `GET /user/campus`。
2. `campus == null` → `GET /campuses` → `POST /bind-campus`。
3. 未填入学年 → `POST /user/enrollment-year`。
4. `GET /campus/:id/courses` 进课。
5. `GET /courses/:id` 或 `GET /folders/:id/questions` 看题。
6. 认证后才能建课、建夹、出题、投票。
7. 收藏：`POST/DELETE /courses/:id/favorite`，个人中心 `GET /user/favorites`。
