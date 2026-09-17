# 图谱怎么改

## 工具

`browser_site_graph` 的 `action`：

| action | 作用 |
|--------|------|
| `list` / `get` | 看当前站点整图 |
| `upsert_node` | 增改节点（必须有 `id`、`patterns`） |
| `remove_node` | 删节点，并去掉连着的边 |
| `upsert_edge` | 增改边（`from` / `to` 必须已存在） |
| `remove_edge` | 删边；带 `label` 只删那一条 |
| `set_notes` | 站点备注 |
| `upsert_site` | 新建或改站点（`siteId` / `host` / `name`） |
| `reset` | 从 Skill 的 `site-graph.json` 重新加载 |

`siteId` 学习通用 `chaoxing`。不传则按当前 URL 的 `hostPattern` 找。新站点先 `upsert_site`。`list` 返回内存里全部站点。

## 节点字段

```json
{
  "id": "homework-do",
  "title": "作业作答",
  "path": "/work/dowork",
  "summary": "题卡和网页双向同步。",
  "structure": "题干、选项在页内。",
  "row": 5,
  "col": 1,
  "patterns": ["doHomeWork", "dowork"],
  "parserIds": ["homework"]
}
```

- `patterns`：URL 正则，命中任一即认为当前在此节点。写具体，避免一个地址打中两个节点。带主机名的规则只认真实 host / 路径，不认 `refer=` 查询串里的别的站。
- 页内 iframe 不要单独建节点。把 iframe 的 URL 正则写进宿主页（课程壳写 `studentcourse`，播放页写 `knowledge/cards`）。
- `col`：`-1` 左 / `0` 中 / `1` 右；`row` 从 0 往下排。
- `parserIds`：本站解析包角色，对应 `parsers/<role>/`。学习通仍写 `homework` / `study`。没有就 `[]`。空数组的页不要当成刷课/作业页。
- `path` / `title` / `summary` 给人看，不参与匹配。
- `structure`：页内结构（侧栏、页签、iframe、本页还有哪些框）。每个节点都应写。怎么走、禁点什么写站点 Skill，不要写进图谱。

## 边字段

```json
{ "from": "course", "to": "study", "label": "点章节" }
```

`kind`：`forward`（默认可省略）/ `back`（返回）/ `loop`（原地切页，`from === to`）。

## 持久化

1. `get` 拿到最新 `site`
2. `JSON.stringify(site, null, 2)`（保持 2 空格）
3. 学习通：`write_agent_skill_file`，`skill_id=chaoxing`，`path=site-graph.json`。其它站：`skill_id=site-learn`，`path=sites/<host>/site-graph.json`
4. 用一两句话说明改了哪个节点/边

文件必须含 `id`、`name`、`host`、`hostPattern`、`nodes`、`edges`。
