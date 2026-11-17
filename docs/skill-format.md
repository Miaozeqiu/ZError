# Skill 文件格式

ZError 的独立 Skill 使用 [Agent Skills 规范](https://agentskills.io/specification)。目录名是稳定 ID，根目录包含 `SKILL.md`，其他文本资源按需读取。

```text
example/
├── SKILL.md
└── references/
    └── workflow.md
```

```yaml
---
name: example
description: 用户需要执行某项任务时使用，说明明确的触发条件。
compatibility: Requires ZError browser tools.
metadata:
  display-name: 中文名称
---
```

分隔符后的 Markdown 编写操作步骤，并通过相对链接指向参考资料。

- `name` 必填，与父目录名一致，1–64 位小写英文字母、数字和连字符，不能以连字符开头/结尾或出现连续连字符。
- `description` 必填，为 1–1024 字的字符串。
- 可选字段：`license`、`compatibility`、`metadata`、`allowed-tools`。`compatibility` 最多 500 字；`metadata` 是字符串到字符串的映射，数字版本号需加引号。
- 中文名称放在 `metadata.display-name`。旧的应用内部范围字段转换为 `metadata.zerror-scope`，普通 Skill 无须填写。
- `allowed-tools` 按规范保存为空格分隔的字符串，仅描述依赖，不会绕过应用权限检查。

应用使用 YAML 解析器，支持引号、注释、多行字符串和嵌套元数据，安装、编辑保存时校验格式。`sites/<主机>/SKILL.md` 等附属文档不作为独立 Skill 发现，无须套用根目录命名规则。

## 兼容与加载

索引只提供 ID、展示名与触发说明；调用 `read_agent_skill` 才读取正文、运行依赖和文件列表，调用 `read_agent_skill_file` 再读取附属文本。文件中的脚本不会因为安装而自动执行；当前安装器只接收支持的文本文件，不导入二进制资源。

旧版中文 `name` 和无 frontmatter 的覆盖文档保持可读，读取时在内存中兼容转换，保存时才写入标准格式，保留正文。已有中文目录 ID 不会自动重命名，以免历史调用失效；此类安装需要重新安装到规范目录后才能按新规则保存根文档。

内置 Skill 的格式可以复用，但浏览器、题库等流程依赖 ZError 工具。迁移到其他 Agent 时需提供对应能力，不能仅凭相同文件格式直接执行。

「网站」设置页按网站展示卡片，每站分别管理账号密码、操作经验与导航图谱。默认包含学习通、智慧树、在浙学，也会发现 `site-learn/sites/<主机>/` 下的站点，支持按域名添加网站。查看经验或图谱时，文件列表限制在本站目录，不能进入内部主说明或其他站点。

凭据仍保存在独立的 `site-accounts.json`，沿用旧站点 ID（`chaoxing`、`zhihuishu`、`zjooc`），自定义站点使用规范化的主机名。域名与站点 ID 关联已有账号，不复制密码到 Skill 或图谱文件；模型只获得当前站点的账号，不回退借用其他网站账号。

网站身份与域名分别管理：`website-identities.json` 保存主网站、名称及关联登录域名。已核实的河南开放大学门户 `menhu.haou.edu.cn` 与 `authserver.open.ha.cn` 共用一个网站身份；只在存在账号或经验时显示该卡片，不为所有用户新增默认网站。其他网站可在「网站设置」中明确配置登录域名，不根据任意 `service`/`redirect` 参数自动合并或共享密码。

账号读取、输入记忆、网站卡片、经验路径、图谱保存和任务收尾均解析同一网站身份。`sites/<关联登录域名>/...` 会归档到 `site-learn/sites/<主网站域名>/...`；误选 `chaoxing` 的外站路径同样纠正到通用站点目录，并继续执行原文检查和权限流程。

旧账号合并前备份原始文件，不把不同用户名与密码拼成一组；按时间和完整性选用完整记录。历史错目录文件先备份、校验目的文件再移除相同副本；内容有差异时保留双方，不覆盖新经验。备份位于 `.local/share/zerror/backups/website-unify-v1/`，迁移可以重复执行。更改域名关联后会再次检查相关经验目录。

内置网站运行资源仅包含 Markdown 经验与 JSON 导航配置。`fixtures`、旧 `parsers`、`see/schema/locators` 文件不再打包、枚举或供 Agent 读取和写入。本机旧覆盖文件保留原位但不参与运行，无须用户手动清理。开发回归样本集中在 `testdata`，不会随网站资源分发；日常任务在真实网页中验证，不生成测试页面或保存整页 HTML。

浏览器手动回归页面也存放在 `testdata/browser/fixtures`，仅由 Vite 开发服务的 `/e2e` 路由提供，不再放入会被复制到正式产物的 `public`。

`site-graph`、`site-learn` 是内部能力，隐藏其主说明的设置入口，Agent 仍可使用图谱工具和站点经验写入流程。其余内置项隐藏并只读，Agent 可按需读取使用；`list_agent_skills` 的 `editable` 字段表示运行时是否允许修改。非网站的用户安装 Skill 不在网站卡片中展示，仍按启用配置参与运行时加载。

GitHub 安装支持直接指定 Skill 目录；整仓库安装依次发现 `.agents/skills`、`.claude/skills`、`skills`。ID 按目录保留，不从展示名生成。不同来源占用相同 ID 时拒绝覆盖。

## 验证

```sh
npx vitest run testdata/agent/skill-format.test.ts testdata/agent/skill-storage.test.ts
```

覆盖全部内置根文档、YAML 解析、命名与字段校验、旧文档转换、安装冲突、保存前校验及按需加载。
