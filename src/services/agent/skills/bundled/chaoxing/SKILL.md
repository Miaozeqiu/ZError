---
name: chaoxing
description: 登录学习通，自动刷章节/视频，完成作业与章节测验。执行时先读这个 Skill，细则按任务再读 files 里一份 references。
compatibility: Requires ZError browser tools and a signed-in Chaoxing browser session.
metadata:
  display-name: 学习通
---

# 学习通

这份 Skill 只维护学习通通用流程。其他网站的操作经验统一写入 `site-learn` 的 `sites/<主网站域名>/SKILL.md`，不要保存到本 Skill。

系统会按当前页注入【当前步骤】。默认先照着做；要对齐细则时再按下表读一份，不要一上来读完所有 references。

登录学习通时，优先调用 `browser_login_chaoxing()`。已登录或成功进入空间时返回 `loggedIn=true`；验证码和滑块需要用户处理。

从课表进入前先确认选中「我学的课」，不要直接打开空间首页的同名课程。进入后核对学生课程落点；`/mycourse/tch` 是教师课程壳，章节编辑、发布等控件也说明角色不符。刷课或作业任务遇到教师视角应返回「我学的课」重新定位，不能继续试点目录或改 URL 猜学生入口。

| 任务 | 文件 |
|------|------|
| 登录、打开课表 | [references/login.md](references/login.md) |
| 刷课、播视频、章节任务点 | [references/study.md](references/study.md) |
| 课程作业、章节测验 | [references/homework.md](references/homework.md) |

## 本地快捷入口

按通用网站经验 `site-learn` 的「快捷入口」规则操作。本站笔记位于 `sites/chaoxing.com/SKILL.md` 的本地经验，所属范围填写课程名，目标填写节号及名称或作业全名。只使用学生端章节或课程作业的顶层地址。核对不到目标时回到「我学的课」，从章节目录或作业列表重新定位。
