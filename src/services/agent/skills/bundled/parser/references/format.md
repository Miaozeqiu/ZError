# 解析器文件格式

每个解析器是一个目录。运行时按 `index.js` 顶部的 `// files:` 拼 `helpers` + `parse` / `locate`，本地 `new Function`。不要写 `function (page)`，不要用 `page(fn)`。

空架子：[template/](template/)。导出契约写在该解析器目录的 `contract.md`。

## 目录

```text
parsers/<role>/
  index.js      ← // files: 清单
  contract.md   ← Handle 与返回值
  helpers.js    ← 认实体（读和做共用）
  parse.js      ← HTML → 卡片（本地跑）
  locate.js     ← Handle → 坐标或页内 API
```

学习通刷课的 parse 文件叫 `catalog.js`。作业还有 `capture.js` 截题盒。

## 分组文件

只写函数声明：

```js
function parse(doc, href) {
  return { ok: true, page: 'list', confidence: 0.9, works: [] }
}

function locate(handle) {
  return { found: true, x: 1, y: 2, text: handle.title }
}
```

ES5。返回可 JSON 的对象；失败带 `ok: false` / `error`。

## index.js

```js
// files: helpers.js, parse.js, locate.js
```

- `// files:` 决定拼装顺序。新文件必须写进去才会生效
- 不要再包 `function (page) { return { inspect: page(inspect) } }`

## 改的时候

- 固定步骤失败两次、确认是页面结构而不是走错页时再改
- 改行为：只动对应分组文件
- 共用逻辑：放 `helpers.js`，不要复制到 parse / locate
- 学习通内容多在 iframe：CDP `eval_all_frames` 会挑目录/题卡帧，不要 `browser_navigate` 打开 iframe `src`

## 和图谱的关系

节点的 `parserIds` 是**本站角色**，对应 `parsers/<role>/`。学习通仍写 `homework` / `study`。`login` / `captcha` 可以只当角色、没有包。空数组表示这页不挂解析器。改匹配规则去 `site-graph`。
