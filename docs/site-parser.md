# 站点解析器

解析器同时负责**读**和**做**：同一套页面实体既生成卡片，也生成 locate 句柄。Agent 只调 `browser_homework` / `browser_study_*`，看不到 `protocol.ts`。

```
Agent 工具
    ↓
站点包 parse(doc) → Card + Handle
站点包 locate(handle) / invoke(handle)
    ↓
protocol.ts  read / locate / act
    ↓
Rust CDP
```

## 作业包

```text
parsers/homework/
  helpers.js    认题盒、选项、按钮
  parse.js      HTML → 题卡 / 名单
  locate.js     Handle → 坐标或 addChoice
  capture.js    题盒截图（helpers + capture 拼 IIFE）
```

## 刷课包

```text
parsers/study/
  helpers.js    认节、任务点、播放器
  catalog.js    HTML → 目录卡
  locate.js     Handle → 节 / 任务点 / 播放
```

`index.js` 只写 `// files:`。运行时是 `src/services/parser/runtime.ts`，不再走 Acorn / `page(fn)`。

## 多站槽位

- 学习通：`chaoxing/parsers/<role>/`，图谱 `parserIds` 仍写 `homework` / `study`
- 其它：`site-learn/sites/<host>/parsers/<role>/`，图谱写角色名
- 内部入口：`readSiteCardFromHtml` / `runHandle`（不新增 Agent 工具名）

智慧树课程列表是第二站样例：`sites/zhihuishu.com/parsers/list/`。

## 信任

题卡或目录有数据时，`get_page` / `eval` 返回短拒绝并带上精简卡片。空卡仍可探路。
