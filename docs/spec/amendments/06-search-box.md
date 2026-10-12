# Amendment 06：卡片列表加搜索框 + 模糊搜索（用户新增需求，并入未发布的 1.0.1）

- 类型：**新增功能（UI + 新纯逻辑模块）**
- 决策来源：用户直接指令（当前会话）
- 影响版本：**不抬版本**——并入尚未发布的 `1.0.1`（与 amendment 05 同一版）
- 变更范围：`src/search.js`（新增）、`src/App.vue`、`src/components/EmptyState.vue`、
  `src/styles.css`、`test/search.test.js`（新增）、`test/componentSource.test.js`、`README.md`
- 落地状态：**已实现**（四项门槛全绿，见 `docs/evidence/gates-and-probe.md`）

## 1. 需求原文要点

> 给 webapp 卡片列表加搜索框 + 模糊搜索。

用户给出的约束（逐条落地位置）：

| 要求                                              | 落点                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 列表上方一个搜索输入框，输入即**实时过滤**        | `src/App.vue` 的 `.app__search` + `v-model="query"` + `computed`                                                      |
| 无匹配显示"无匹配"空态，**复用 `EmptyState.vue`** | `EmptyState.vue` 参数化（`title`/`hint`/`actionLabel`），`App.vue` 两处复用                                           |
| `Esc` 清空；清空后恢复全部                        | `@keydown.esc="clearQuery"` + 「清空」按钮共用 `clearQuery()`                                                         |
| 匹配语义写成**可测的纯函数**                      | `src/search.js`（零依赖、无 Vue，`test/search.test.js` 直接测）                                                       |
| 大小写不敏感                                      | `parseQuery` 统一小写 + `scoreTerm` 接受已小写字段                                                                    |
| `name`/`url`/`desc` 分别打分**取最优**            | `scoreEntry` 对三字段各跑一次 `scoreTerm`，取 `max`（不相加）                                                         |
| 子序列匹配                                        | `scoreTerm` 的游标扫描（严格按顺序，缺字符/乱序不算）                                                                 |
| 连续片段与前缀命中**加权更高**                    | 分值梯度：`SCORE_PREFIX(1600) > SCORE_WORD_START(1300) > SCORE_SUBSTRING(1000) > SCORE_SUBSEQUENCE(600)` + 紧凑度系数 |
| 多词 **AND**                                      | `scoreEntry` 任一 `term` 得 0 → 整条返回 0（不命中）                                                                  |
| 空查询/纯空白 → 返回全部**且不改顺序**            | `filterAndRank` 在 `terms.length === 0` 时 `rows.slice()` 原序返回                                                    |
| 按分数降序、**同分保持原序**                      | `filterAndRank` 显式用原始索引做次级比较（不依赖 sort 稳定性）                                                        |
| 零自造色值、只用宿主 token、沿用既有输入样式      | 搜索框复用 `.input`；新增 CSS 只用 `--border` 等宿主 token；`test`/人工核查确认 hex/fn/关键字均为 0                   |

## 2. 与 spec 的关系

- **不是对既有需求的修改**，而是**新增能力**：spec §15.2 的字段集、界面规范、消息契约
  （`api.app.onMessage` 的 8 个方法）**一条未动**——搜索是**纯界面行为**，
  不新增 IPC 方法、不新增设置项、不动数据库（`test/ipcSurface.test.js` 的"恰好 8 个方法"
  与双向接线断言照旧保护这一点）。
- **与 §15.1 界面规范一致**：搜索框复用 `.input`（与模态框输入同源）；
  "无匹配"空态复用 §15.1 的 `.empty` 与同一个组件；窄窗（≤520px）下搜索框换行铺满，
  不产生横向滚动（沿用既有断点，未新造）。
- **与 amendment 05 的叠加**：状态栏已删除，因此搜索的"无匹配"是**唯一**还在界面上表达的
  空状态之一（另一个是"还没有网页应用"）——两条 amendment 不冲突。

## 3. `src/search.js` 导出签名

```js
export function parseQuery(query)                     // → string[]（小写化、去空段的词）
export function isWordStart(rawField, index)          // → boolean（分隔符/驼峰边界）
export function scoreTerm(field, term, rawField)      // → { matched: boolean, score: number }
export function scoreEntry(entry, terms)              // → number（0 = 不命中；> 0 越高越靠前）
export function filterAndRank(rows, query)            // → Array（过滤 + 分数降序；空查询原序返回）
export function isSearching(query)                    // → boolean（区分两种空态）
```

设计取舍：

- **`scoreTerm` 同时收 `field`（小写）与 `rawField`（原样）**：小写化后无法判断驼峰边界
  （`myGitLab` → `mygitlab`），所以词首判定要用原串。这是"能测"与"打分准"之间的必要参数。
- **分数只用于排序，不对外承诺具体数值**：测试断言的是**相对关系**
  （前缀 > 包含 > 子序列、紧凑 > 离散），而不是魔法数字——这样调权重不会误伤测试。
- **不做拼音/错别字纠错**：子序列已能覆盖"少打几个字母"的常见输入（`gitlb` → `gitlab`），
  但没有引入拼音表（零依赖、零体积增长是用户扩展的硬边界）。

## 4. 界面处置

| 项              | 处置                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| 搜索框位置      | 列表**上方**，与卡片网格同宽（`.app__search`，`margin-bottom: 12px`）                       |
| 是否实时        | 是：`<input v-model="query">`，`displayRows` 是 `computed`，输入即重算                      |
| 空查询          | 不显示「清空」按钮，列表为"新条目在最上面"的原序                                            |
| `Esc`           | 清空 + 把焦点还回搜索框（`nextTick` 后 `focus()`），可以继续输入                            |
| 无匹配          | `<EmptyState title="没有匹配的网页应用" :hint="…「${query}」…" action-label="清空搜索">`    |
| 加载中/加载失败 | **搜索框不显示**（`v-else` 分支外），避免对着空列表搜索                                     |
| 原生清除按钮    | 隐藏 `::-webkit-search-cancel-button`（它在深色主题下不跟随宿主 token），改用自己的「清空」 |

## 5. 测试

`test/search.test.js`（19 条）覆盖用户点名的全部维度：子序列命中/不命中、大小写不敏感、
前缀与连续片段排名更优、中文与 URL、多词 AND、空查询返回全部且保序、空白与首尾空格处理；
另加：三字段取最优、离散命中紧凑度、同分保序、非数组/缺字段不抛错、**不修改条目对象**。

`test/componentSource.test.js` 新增一条源码门禁：搜索框复用 `.input`、占位文案、`Esc` 清空、
过滤必须走 `filterAndRank`、空态**恰好两处且都用 `EmptyState`**、无匹配文案与按钮。

（同一次提交里还收紧了一条主题门禁：状态栏 token 不得在 `theme.js` 的兜底表里残留。
原先我写的"兜底表每一项都必须被消费"被证伪——宿主 25 个 token 里有 6 个本界面从未消费，
那条断言是**假红**，已改为逐项点名删掉的东西。）

## 6. 残余风险

| 风险                 | 说明                                    | 处置                                                                    |
| -------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| 打分权重是主观的     | 具体名次可能不符合某些人的直觉          | 只承诺相对关系（已写进 §3）；权重集中在一处常量，好调                   |
| 无拼音/错字纠错      | 搜"neiwang"不会命中「内网」             | 已明确不做（零依赖边界）；子序列覆盖"少打字母"                          |
| 中文逐字子序列较宽松 | 搜"内平"命中「内网平台」                | 有意为之：与英文子序列语义一致，且分数低、排在连续命中之后              |
| 大列表实时过滤的性能 | 每条目 × 3 字段 × 词数；几十~几百条无感 | 无虚拟滚动需求（目标 ≤50 条，spec §17）；未做防抖（实时过滤是用户要求） |
