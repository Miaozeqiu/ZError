# 远程模型：用 `hasVision` 代替「文本 / 视觉」分类

客户端已不再把模型拆成两类。`models.json` 里每个模型只发一份，用布尔字段标明**是否有视觉能力**。

地址（测试 / 正式同一份）：

```text
https://webapi.zaizhexue.top/live/models.json
```

数据流仍是：ze-admin → backend → `models.json` → 客户端。

---

## 1. 客户端怎么用

| 设置页 / 选择器 | 显示哪些远程模型 |
|-----------------|------------------|
| 文本 | 全部 |
| 总结 | 全部 |
| agent | 全部 |
| 视觉 | 仅 `hasVision === true` |

本地自定义模型也是同一套规则。远程模型的视觉开关由管理员下发，用户不能在客户端改。

同步时客户端会：

- 把远程模型的 `category` **强制写成 `text`**（本地不再存 `vision`）
- 用下面规则算出 `hasVision`，写入本地

---

## 2. 请改成这样

每个模型加一个布尔字段，**推荐只用 `hasVision`**：

```json
{
  "id": "gpt-4o",
  "modelId": "gpt-4o",
  "displayName": "GPT-4o",
  "hasVision": true,
  "enabled": true,
  "apiProtocol": "openai-chat",
  "enableThinking": false
}
```

没有视觉能力就写 `false`，或省略（省略 = 没有视觉能力，除非还走下面的旧字段兼容）。

不要再为同一个模型发两条（一条 `category: "text"`、一条 `category: "vision"`）。

---

## 3. 客户端认哪些字段（按优先级）

只看**模型对象**，不看平台。

| 优先级 | 字段 | 为真 | 为假 |
|--------|------|------|------|
| 1 | `hasVision` | 有视觉 | 无视觉，后面不再看 |
| 1 | `has_vision` | 同上 | 同上 |
| 1 | `vision` | 同上 | 同上 |
| 2 | `capabilities` 是数组，且含 `"vision"`（大小写不敏感） | 有视觉 | — |
| 2 | `capabilities` 是对象，且 `capabilities.vision === true` | 有视觉 | — |
| 3（兼容旧数据） | `category === "vision"` | 有视觉 | 无视觉 |

注意：

- 只要 `hasVision` / `has_vision` / `vision` **显式为 `true` 或 `false`**，就以它为准，不再看 `category`。
- 字符串 `"true"`、`1` **不算** true，必须是 JSON 布尔值。
- `jsCode`、`pricing`、`name`、`icon`、`description` 远程仍会忽略（和以前一样）。

推荐后台只维护 `hasVision`，不要同时写好几套字段，以免以后对不齐。

---

## 4. 旧客户端怎么办

线上如果还有**旧版** ZError（按 `category === "vision"` 筛视觉列表）：

- 只加 `hasVision: true`、同时把 `category` 改成 `text` → **旧客户端视觉列表会空**
- 过渡期建议：**有视觉的模型同时写**

```json
{
  "hasVision": true,
  "category": "vision"
}
```

新客户端会把本地 `category` 改成 `text`，视觉列表只看 `hasVision`。  
等旧客户端都升上去后，`category` 可以一律发 `text`，或干脆不发。

没有视觉能力的模型：

```json
{
  "hasVision": false,
  "category": "text"
}
```

---

## 5. `models.json` 片段示例

顶层结构不用改，还是 `platforms[].models[]`。只改模型字段。

```json
{
  "providers_list": ["openai", "anthropic"],
  "model_icon_mappings": [],
  "platforms": [
    {
      "id": "openai",
      "name": "openai",
      "displayName": "OpenAI",
      "baseUrl": "https://api.openai.com",
      "enabled": true,
      "models": [
        {
          "id": "gpt-4o",
          "modelId": "gpt-4o",
          "displayName": "GPT-4o",
          "hasVision": true,
          "category": "vision",
          "enabled": true,
          "maxTokens": 4096,
          "temperature": 0.7,
          "topP": 0.9,
          "apiProtocol": "openai-chat",
          "enableThinking": false
        },
        {
          "id": "gpt-4o-mini",
          "modelId": "gpt-4o-mini",
          "displayName": "GPT-4o mini",
          "hasVision": true,
          "category": "vision",
          "enabled": true,
          "apiProtocol": "openai-chat"
        },
        {
          "id": "o3-mini",
          "modelId": "o3-mini",
          "displayName": "o3-mini",
          "hasVision": false,
          "category": "text",
          "enabled": true,
          "apiProtocol": "openai-chat",
          "enableThinking": true,
          "thinkingEffort": "medium"
        }
      ]
    }
  ]
}
```

`category` 在新客户端里不再参与筛选；上面仍写 `vision` 只是为了旧客户端。

---

## 6. 后台（ze-admin）建议怎么改

模型编辑里：

1. 去掉「模型类型 = 文本 / 视觉」这种互斥选项（如果有）。
2. 加一个开关：**视觉能力** → 写入 `hasVision`。
3. 保存 / 发布 `models.json` 时带上该字段。
4. 过渡期：`hasVision === true` 时继续写 `category: "vision"`，否则 `"text"`。
5. 库里如果同一个模型存了两条（文本一条、视觉一条），合并成一条，只保留 `hasVision`。

发布后清一下 EdgeOne 对 `/live/models.json` 和旧路径 `/models.json` 的缓存（和发版文档里一样）。

---

## 7. 改完自检

1. 有视觉的模型：`hasVision: true`（过渡期再加 `category: "vision"`）。
2. 纯文本模型：`hasVision: false` 或省略。
3. 没有重复的「同 id 一条 text、一条 vision」。
4. 客户端同步后：文本 / 总结 / agent 能看到全部；视觉列表只有带视觉能力的。
5. 远程模型点「查看」时，视觉开关是管理员下发的，本地改不了。

相关客户端代码：`src/services/modelConfig.ts` 里的 `resolveRemoteHasVision`。
