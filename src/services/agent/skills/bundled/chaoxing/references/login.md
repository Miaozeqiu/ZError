# 学习通登录

登录本身不调用刷课工具。不要 get_page / eval 探路。

## 登录

1. 已在 passport2 登录页就不要再 navigate。否则 `browser_navigate` https://passport2.chaoxing.com
2. `browser_type selector=#phone` 填账号，`browser_type selector=#pwd` 填密码，`browser_click selector=#loginBtn`。有【已记账号】直接填。CSS 必须放 `selector`，不要放进 `ref`（`ref` 只能是 e3 这种快照号）。
3. 等跳到 `i.mooc.chaoxing.com` / `i.chaoxing.com`。不要再 get_page。
4. 滑块：`browser_finish(blocked)`，等用户完成后点 `selector=#loginBtn`。

## 进课

只 `click_text`，不要 eval，不要 get_page，不要再 navigate 中间页：

1. `我学的课`（不要点顶栏「课程」）
2. 课名，如 `应用高等数学`

进到 `mycourse/stu` 后改读 `references/study.md`。
