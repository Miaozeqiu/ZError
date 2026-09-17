# 学习通登录

登录本身不调用刷课工具。登录页已知 `#phone` / `#pwd`，不必先 eval 探路；看不清再用 `get_page`。

## 登录

1. 从导航页先开 https://i.chaoxing.com 。已登录会进空间，不要先走登录页。只有落到 `passport2` 才填表。已在 `login?fid=&newversion=true` 就不要再 navigate。必须打开登录页时用 https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com ，不要打开光秃的 https://passport2.chaoxing.com 或 `/login?fid=&refer=`（旧登录页一点登录会整页跳到新版、表单清空）。
2. `browser_type selector=#phone` 填账号，`browser_type selector=#pwd` 填密码，`browser_click selector=#loginBtn`。有【已记账号】直接填。CSS 必须放 `selector`，不要放进 `ref`。type 必须回 `filled:true` 才算填上；`filled:false` 要换办法，不要假装成功。密码快照只显示 `value=已填写`。
3. 点登录后看回执的 `navigated` 和 `url`。`navigated:false` 就是没跳转，还在登录页。空快照不是跳转。有滑块就 `browser_finish(blocked)`。不要在登录页点「我学的课」。
4. 滑块：`browser_finish(blocked)`，等用户完成后点 `selector=#loginBtn`。
5. `page` 是「空间」或网址是 `i.chaoxing.com/base` / `/space` 后再进课。`page` 暂时空着也不要 `site_graph reset`，等 1 秒再 get_state。

## 进课

只 `click_text`，不要搜课名、不要 eval、不要再 navigate 中间页：

1. `我学的课`（不要点顶栏「课程」，空间首页那几门不是课表）
2. 课名，如 `应用高等数学`

页签在 `#frame_content` 里。`spaceTab` 看的是框内 `.tab-item.current` / `#courseType`，不是外壳 `iframe.src`（点完页签 src 也不会变）。直接 `click_text「我学的课」`。不要 eval 找页签、不要点快照里的合成按钮「我教的课 我学的课 体验新版」。切过去后再 `click_text` 课名。禁止 navigate / 改 iframe src / 点 `visit/courses` 链接，不要 reload。

空间首页搜索框搜的是「我教的课」，找不到「应用高等数学」。已经搜过也不要再搜。

进到 `mycourse/stu` 后：刚进课常默认侧栏「任务」页签，等 1–2 秒再点。作业点「作业」后用 `get_page` / `eval` 看名单，或 `browser_homework list`。刷课点「章节」只切目录 iframe，再 `browser_study_chapters`；不要点「第N章」标题。刷课读 `references/study.md`。
