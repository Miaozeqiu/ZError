# 解析器文件格式

每个解析器是一个目录。运行时按 `index.js` 顶部的 `// files:` 把分组文件拼进 `function (page)`，再 `eval`。`page` 就是 `compilePageScript`。

空架子：[template/](template/)。导出契约写在该解析器目录的 `contract.md`。

## 目录

```text
parsers/study/
  index.js      ← 导出键
  contract.md   ← 入参 / 返回值
  frames.js     ← iframe、点击
  catalog.js    ← 目录树
  video.js      ← 播放器、任务点
  chapter.js
  play.js
  watch.js
  captcha.js
```

作业：`parsers/homework/`（`frames.js`、`parse.js`，再加 inspect / live / capture / answer）。

## 分组文件

只写函数声明，不要包 `function (page)`：

```js
function play() {
  return { ok: true }
}
```

ES5。返回可 JSON 的对象；失败带 `ok: false` / `error`。

## index.js

```js
// files: frames.js, catalog.js, video.js, chapter.js, play.js, watch.js, captcha.js
function (page) {
  return {
    inspect: page(inspect),
    play: page(play),
    startImg: function (index) {
      return page(startImgPage, { index: Number(index) || 0 })
    }
  }
}
```

- `// files:` 决定拼装顺序。新文件必须写进去才会生效
- 返回值必须是 `string` 或 `function`
- `page(fn)` 会扫描 `fn` 里用到的同模块函数，连同传递依赖写进页面 IIFE。不必再整袋传入 helpers
- `page(fn, { key: value })`：绑定变量（工厂用）
- 函数有形参且没有 bindings 时，编译结果是「返回该函数」，调用方再 `(args)`
- 仍可显式 `page(fn, extraFn)`，推断不到的再补

## 改的时候

- 固定步骤失败两次、确认是页面结构而不是走错页时再改
- 改行为：只动对应分组文件
- 改导出或返回值：同步改 `index.js` 和 `contract.md`
- 新加一组：新建文件，写进 `// files:` 和 `return`
- 共用逻辑：放 `frames.js` / `catalog.js` / `video.js` / `parse.js`，不要复制到每一组
- 保持导出键名；题号从 1 起（作业传图的 `startImg` 图槽除外，见 `contract.md`）
- 学习通内容多在 iframe：用现有 frame 遍历，不要 `browser_navigate` 打开 iframe `src`

## 和图谱的关系

节点的 `parserIds` 只声明「这页能挂谁」：`login` / `study` / `homework` / `captcha`。解析器文件不写进图谱。改匹配规则去 `site-graph` Skill。
