> **归档注记**：本文件是同一需求的 **阶段 2（实现规格，`to-spec`）产物**，
> 由 obox 仓库 `.spec-workflow/webapp-profile-root/spec.md` 于 2026-10-13 复制归档，属历史记录，正文按原文保留、不回改。
>
> 实现已随 **webapp 1.0.4** 发布（含后续追加要求：Chrome 孤儿化启动、扩展页面不再显示迁移、迁移状态移到宿主设置页**只读**展示、
> `profileRoot` 改为 `directory` 字段并「**在设置页改根 = 自动开始迁移**」）；决策与取舍见 `docs/spec/amendments/09-chrome-orphan-launch.md`。
>
> 文中若出现 obox 仓库旧路径（`skills/obox-ext-dev/references/*`），已在 obox v1.0.8 迁到 `docs/extension-api/`。

# 实现规格：webapp 扩展——可配置的 profile 根目录（`--user-data-dir` 根）

- 规格 ID：`webapp-profile-root/spec@v2`（v1 → v2 的修订记录见 **§24**）
- 阶段：SpecWorkflow 阶段 2（`to-spec`，**修订模式**）｜v1：2026-10-13｜**v2：2026-10-13（用户逐条裁定 P0–P5 后回灌）**
- 权威需求结论：`.spec-workflow/webapp-profile-root/requirements.md`（阶段 1，已关闭 Q1–Q5、R1–R9、风险 R-1–R-4、延后 P1–P5）
- **v2 已闭合的用户裁定**：P0 = **B（改宿主，加"选目录"能力）**、P1 = **B（覆盖目标、不备份）**、P2 = 允许 UNC（默认）、P3 = `{marker,extId,version,createdAt,root}`（默认）、P3b = **A（源根允许缺标记）**、P4 = **A（uninstall 完全不触碰外部根）**、P5 = 设置页静态规则 + 扩展界面动态进度（默认）
- 目标仓库：`extensions/webapp/`（独立 git 仓库，remote `obox-org/webapp`）
- 请求语言：中文 ⇒ 本文件除代码标识符/路径/API 名外一律中文

## 1. Goal Mode 元数据（本规格版本专用）

| 项 | 值 |
| --- | --- |
| Goal Mode | **disabled** |
| 决策来源 | 本 spec 的 **v2 修订（2026-10-13）**：用户已逐条裁定 P0–P5（§17），**产品/数据/权限/迁移/验收决策全部闭合**；但**本修订未获用户对 Goal Mode 的重新选择**（skill 要求每次 spec 修订都要用户重新选择一次）⇒ 仍记 disabled，**不得**据此自动进入 `spec-do` |
| 授权锚点 | `spec ID = webapp-profile-root/spec@v2`；`Authority: local-spec-workflow`；`artifact root = .spec-workflow/webapp-profile-root/` |
| supersedes / superseded-by | 本文件 **v1（P0–P5 开放版）被 v2 取代**；修订记录见 §24 |
| 目标（若用户开启） | 实现本规格（含宿主侧能力，见 §9.11）→ 通过第 15 节验收 → 终审无 must-fix → 达"可发布"结论 |
| 最大自动修复轮次（若用户开启） | 2（默认建议值） |
| 自动提交（若用户开启） | 未授权（默认不给） |
| 暂停条件 | ① 用户未为 **v2** 选择 Goal Mode ⇒ 当前**不自动续跑**；② 出现本规格未涵盖的新产品或数据决策时；③ 需要 git 分支切换/提交/推送时（宿主补丁版发布属此列，见 §7.6）。**注意**：v1 的"P0–P5 未关闭前不得进入实现"**已解除**（§17 已全部闭合） |
| 运行期轮次计数 | 由实现阶段的 `implementation-report.md` 维护，本节只存授权元数据 |

> **为什么 v2 仍不给 Goal Mode**：Goal Mode 是"每份 spec 版本、每次修订都要用户**重新选择一次**"的自动驾驶授权（skill 硬要求），而本修订只回灌了 P0–P5 的裁定，**没有**收到用户对 v2 的 Goal Mode 选择。**决策已闭合**（v1 的暂停条件已解除）⇒ 规格本身**可直接进入实现**，只是需要用户明确说一句"为 v2 开启/不开启 Goal Mode"（见 §23 的下一步与 §17 末尾）。

## 2. Git 入口（沿用阶段 1 闸门结论，已在本阶段复核）

| 仓库 | 分支 | HEAD | 起始状态 | 说明 |
| --- | --- | --- | --- | --- |
| obox（产物落位） | `master` | `cc506f152c64acef2e405d1cccb5a61a66e4717a` | 脏基线：**2 个未跟踪文件**（`.spec-workflow/rdp-mstsc-detach/requirements.md`、`.spec-workflow/webapp-profile-root/requirements.md`） | 产物写在 `.spec-workflow/`（未跟踪）；**不做任何分支操作、不提交** |
| `extensions/webapp`（实现目标） | `master` | `62df53b910b4e1c5e6618ba79d1a8d2383ce3df0` | **clean**（`git status --porcelain=v1 -uall` 0 行）；最近 tag `v1.0.2` 指向 HEAD | 改动直接落在该仓库 `master`；完成后发 **1.0.3** |

- 分支决策（沿用阶段 1 Q5 选项 A）：**产物在 obox `.spec-workflow/`（未跟踪）；扩展改动在 `extensions/webapp` 的 `master` 上做；完成后发 webapp 1.0.3**（五处版本一致 + tag `v1.0.3` + release 附 `webapp-1.0.3.oix`）。
- **v2 新增（P0 = B 的直接后果）：宿主侧改动走 obox 仓库的 `feat/xxx` 分支 + PR + CI（typecheck / lint / vitest / `security:audit`）**，遵守 obox `AGENTS.md` 的提交流程；**是否发宿主版本由用户决定**（见 §7.6）。本阶段（`to-spec`）**不做任何 git 操作**。
- 本阶段未做任何 git 操作（无分支、无提交、无 stash）；脏基线原样保留。

| 仓库存量事实（v2 复核） | 值 |
| --- | --- |
| 宿主对话框能力的现状 | `properties` **硬编码** `['openFile']`（`src/main/ext.ts:22-31`）；IPC 入参类型**内联**在 `src/shared/types.ts:302-306`（没有独立的 `DialogOpenOptions` 类型）；`src/api/types.ts:273-277` 是扩展可见签名；preload 直通 `src/preload/index.ts:78` |
| 宿主测试现状 | `test/` 下**没有**任何 dialog 相关用例（`ext.ts` 只被源码门禁式测试间接涉及）⇒ 本次需**新增** |
| 扩展侧「浏览…」的落点 | 必须在**扩展入口**调 `api.dialog`（子窗口无 `api`，`test/ipcSurface.test.js:13-15`） |

## 3. 问题陈述（用户视角）

现在每条站点的 Chrome profile **只能**落在 `<扩展 data 目录>/chrome/<名>`（`extensions/webapp/lib/nameSanitize.mjs:47` 的 `PROFILE_ROOT = 'chrome'`，`lib/chromeArgs.mjs:33` 生成 `--user-data-dir=chrome/<净化名>`，助手只接受这一种形态：`extensions/webapp/helper.cjs:409-430`）。带来两个真实痛点：

1. **C 盘被撑爆**：系统盘空间紧张时，用户无法把动辄 GB 级的站点 profile 放到别的盘（例如 `D:\obox-webapp\profiles`），只能眼看着 C 盘涨。
2. **卸载即全灭**：`<userData>/extensions/webapp_chenzhi/` 在卸载时被宿主整目录递归删除（`src/main/capabilities.ts:118`，钩子在 `:96-101` 先跑但不影响删除），因此 `data/chrome/**` 的全部 profile 与登录态**永久消失**（已归档的 spec §14.4(a) 把这条写成硬承诺）。用户没有"把浏览器数据放在扩展之外、从而不被卸载波及"的手段。

同时，任一"放开了路径"的方案都必须回答一个新风险：**一旦路径可配置，"删除连接 / 清理缓存"就可能删掉真实 Chrome profile**（`%LOCALAPPDATA%\Google\Chrome\User Data`）。这条风险在现状下不存在（因为根被硬编码在扩展自己的 data 目录里，且助手做了"只允许相对路径 `chrome/<单层名>`"的强校验）。

## 4. 解决方案（用户视角）

在**扩展设置页**新增一个配置项 **profile 根目录**（`webapp.profileRoot`，`text`，默认空 = 用默认根），并在扩展自己的界面提供配套操作：

1. 用户把根改成绝对路径（如 `D:\obox-webapp\profiles`）；若目录不存在，扩展**自动创建**并在其中写入标记文件 `.obox-webapp-root`。
2. 用户也可点扩展界面的「浏览…」按钮，用**系统目录选择框**挑一个目录（依赖宿主新能力，见 §9.11；老宿主自动退回"手填 + 诚实提示"，见 §7.4）。
3. 若旧根下已有站点 profile，**自动迁移**到新根（逐目录、可中断、可续做）：界面显示"已搬 X/Y"，全部搬完才把新值写入设置。
4. 目标根下已存在同名目录的条目，**迁移前先把这些冲突项逐条列出并要求用户确认**；用户确认后执行 **"先删目标同名目录 → 再把源搬过去"** 的**覆盖**语义（P1 = B：用户已明确接受"目标目录里的登录态永久丢失且无法恢复"）。
5. 安全边界由三道防线构成：**路径校验**（拒绝盘符根、拒绝 obox 程序目录）＋ **标记文件**（缺标记 ⇒ 拒绝删除与清理，只报告；**目标根必须有标记，源根允许缺标记**）＋ **永不删根**（任何动作只作用于根之下的子目录）。
6. 迁移是**可恢复**的：意图文件 `<扩展 data>/.pending-move-root.json` 记录 from/to/逐目录进度与冲突处理结果；中断或断电后**下次启动自动续做**，界面提供「继续 / 放弃」。
7. 卸载语义改写为对照式：**默认根下的 profile 随卸载删除（现状不变）；外部根下的 profile 会保留在磁盘上，需用户自行清理**。

## 5. 背景与目标

### 5.1 背景（本阶段复核过的事实，带证据）

| # | 事实 | 位置 |
| --- | --- | --- |
| B1 | 助手侧 profile 根是**硬编码**常量 `PROFILE_ROOT = 'chrome'` | `extensions/webapp/helper.cjs:53` |
| B2 | 助手根解析 `profileRoot() = join(process.cwd(), PROFILE_ROOT)`；助手 cwd = 扩展 data 目录 | `helper.cjs:94-96`（cwd 见 `helper.cjs:364` 回显、spec §11.2） |
| B3 | 扩展侧 `--user-data-dir` 恒为相对形态 `${PROFILE_ROOT}/${sanitizeName(name)}` | `lib/chromeArgs.mjs:9,32-34`；`lib/nameSanitize.mjs:47` |
| B4 | 助手 `--user-data-dir` 强校验：必须相对、恰好 `chrome/<单层名>`、拒 `..`/盘符/绝对路径（`-32602`） | `helper.cjs:408-430`；校验清单原文见 `docs/spec/spec.md:546`（§11.2 第 4 条） |
| B5 | 助手把相对形态解析为 `profilePath()` 的绝对路径，并用 `relative()` 复核不越界 | `helper.cjs:98-111,429` |
| B6 | 三个删/移数据的动作全部经助手：`removeProfile`（先 rename 进 `.trash` 再删）、`moveProfile`（两阶段 intent）、`cleanCaches`（白名单目录） | `helper.cjs:564-607`、`:613-650`、`:816-880`；白名单 `lib/profileLimit.mjs:171-182`；保留清单 `:191-211` |
| B7 | 体积上限按 `<根>/<名>` 量体积，TTL 60s 内存缓存 | `helper.cjs:741-801`；`lib/profileLimit.mjs:133,143-150` |
| B8 | 卸载删除整个扩展目录（连 `data/chrome/**`） | `src/main/capabilities.ts:96-101`（先跑钩子）、`:118`（`fs.rm(target,{recursive,force})`） |
| B9 | 宿主设置字段类型只有 `text｜number｜boolean｜select`，**无目录选择控件**，且 `text` 渲染成裸 `<input class="text-input">`（无「浏览」按钮） | `src/api/contributions.ts:73`；`src/renderer/src/extensions/settings/SettingsView.vue:641-648`（存值 `:302-304`） |
| B10 | `api.dialog.showOpenDialog` 的宿主实现**只支持 `properties: ['openFile']`**，选项只有 `title/filters/multiSelect` ⇒ **不支持目录选择** | `src/main/ext.ts:9-36`（`properties: ['openFile', …]` 硬编码）、`:22-31`；类型 `src/api/types.ts:273-277`；preload 直通 `src/preload/index.ts:78` |
| B11 | `api.dialog` 选到的外部路径**不能**用 `api.fs` 读写（沙箱只到 data 目录） | `skills/obox-ext-dev/references/api-reference.md:439`（返回 `filePaths`）、`:500`（安全边界原文）；`src/api/types.ts:325-341` |
| B12 | 扩展侧首个设置页只有 2 个 `select` 字段，且有"恰好两个"的门禁 | `extensions/webapp/manifest.json:18-52`；`test/manifest-settings.test.js:32`、`:46-49`、`:107-113` |
| B13 | 子窗口页面**没有** `api` 对象，一切走 `bridge.js` 的 `callExtension`；`api.dialog` 只在扩展入口（宿主渲染上下文）可用 | `extensions/webapp/test/ipcSurface.test.js:13-15`；`extensions/webapp/src/bridge.js`；`src/renderer/src/core/host.ts:484` |
| B14 | 版本号五处必须一致（`manifest.json` / `package.json` / `package-lock.json` 顶层 / `packages[""]` / `index.js` 卡片） | `test/manifest-settings.test.js:131-156`；`manifest.json:3`、`index.js:585` 当前均为 `1.0.2` |
| B15 | 既有归档 spec 把"相对路径"写成了设计红线 | `docs/spec/spec.md:546`（§11.2 第 4 条）、`:663`（② 相对路径在助手侧解析）、`:1295`（能力边界表）、`:1424`（路径防护用例）、`:1892`（S10） |
| B16 | 改名 intent 文件是 `<根>/.pending-move.json`；`profileStatus` 的 `locked` 只是启发式，真正判据是"尝试 rename/删除并捕获失败" | `helper.cjs:56-57`、`:547-558`；`docs/spec/spec.md:931-951`；`lib/profileLimit.mjs:220-230` |

### 5.2 目标

1. 用户能在扩展设置里把 profile 根指到**任意绝对路径**（含盘符、UNC），默认值（空）语义 = 现状（`<扩展 data>/chrome`）。
2. 改根时**存量 profile 自动迁移**，可中断、可续做、不丢数据；设置值**只在全部搬完后**写入（避免"设置说新根、数据还在旧根"的中间态被当成最终态）。
3. "删除条目 / 清理缓存"的能力**不因根可配置而扩大**：缺标记 ⇒ 拒绝；永不删根。
4. 卸载与升级语义在**外部根**场景下被显式改写并写进 README / Release（对照式表述）。
5. 既有能力（体积上限、清理白名单、改名、占用判据、`.trash`）在自定义根下**行为不变**。

### 5.3 非目标

1. **不做每条目独立目录**（用户已否决 B/C 方案）：不新增 DB 列、不做逐条目路径与逐条目标记校验；条目仍是 `<根>/<净化名>`。
2. **不新增"任意路径且无标记校验"**的模式（会让"删除连接"能删真实 Chrome profile）。
3. 不改变条目模型与体积上限机制（只是根变了）；不做跨机同步/云盘语义。
4. 不做根之间的**增量/双向同步**（迁移是一次性、单向、旧根不动地保留直到用户自行删除）。
5. **不提供"合并"同名目录**（P1 = B：只有"覆盖"与"跳过"两条路；合并两份 Chrome profile 会同时破坏两边的登录态，已被否决）。
6. **不扩大宿主改动面**：宿主侧只做一件**加法**——让 `api.dialog.showOpenDialog` 支持 `properties: ['openDirectory']`（§9.11 也是确切清单）。**不做**：在宿主设置页里内嵌"浏览"按钮、宿主侧目录合法性校验、改 `api.fs` 沙箱、改设置存储、改设置字段类型枚举。
7. 不做迁移进度条 / 后台任务队列 / 常驻轮询（进度只在用户打开界面或点按钮时读）。
8. 不做 profile 根的"每站点覆盖"。
9. 不做自动清理旧根残留目录（迁移完成后旧根下剩下的空目录与非条目文件**一律不动**）。

## 6. 用户故事

1. 作为使用者，我想在扩展设置里把 profile 根改成 `D:\obox-webapp\profiles`，这样 GB 级的站点数据不再吃我的 C 盘。
2. 作为使用者，我想根目录不存在时扩展**自动创建**它，这样我不用先手工建目录。
3. 作为使用者，我想改根时**我原有的登录态全部跟着搬过去**，这样改根不等于重登一遍所有站点。
4. 作为使用者，我想迁移**中途关掉 obox / 断电**后下次打开能自动接着搬，这样我不会得到"一半在新根一半在旧根"且无人告知的状态。
5. 作为使用者，我想在迁移没搬完时能看到"已搬 X/Y"并选择「继续」或「放弃」，这样我掌舵而不是被一个静默的后台动作绑住。
6. 作为使用者，我想**设置值只在全部搬完后**才变成新根，这样我不会看到"设置说 D 盘、数据还在 C 盘"。
7. 作为使用者，我想新根下已有同名目录时**跳过并被告知**，这样扩展不会把我的两份数据混在一起。
8. 作为使用者，我想迁移时**正开着的站点**被跳过并标记为待续做（而不是失败中断全部），这样我关掉那个窗口后能继续。
9. 作为使用者，我想把根指到真实 Chrome profile（`%LOCALAPPDATA%\Google\Chrome\User Data`）时，**删除条目的动作被拒绝**，这样我一次误操作不会毁掉日常浏览器的登录态。
10. 作为使用者，我想无论根指到哪里，扩展**永远不删根目录本身**，这样最坏情况也只是根下的一个子目录被删。
11. 作为使用者，我想根被我不小心删掉后再打开条目时，扩展把它当"目录不存在"处理（Chrome 重建）并**重新写标记**，而不是报一个看不懂的错。
12. 作为使用者，我想卸载扩展时**清楚知道**：默认根下的数据随之永久删除，外部根下的 profile 会留在磁盘上等我自行清理（README 要用对照句写清，不得含糊）。
13. 作为使用者，我想体积上限与「清理缓存」在自定义根下**和以前一样准**（按新根量体积、按新根清缓存），这样换根不会让节流失效。
14. 作为使用者，我想在根指向 UNC 网络路径时被**告知性能代价**，这样我知道为什么打开变慢、迁移可能很久。
15. 作为扩展维护者，我想"改根"与"改名"两套 intent 的**处理顺序是确定的**（先改根、后改名），这样两种中断叠加时不会互相污染。
16. 作为扩展维护者，我想"完整性判据"（文件数与字节数 ≥ 源 95% 且关键文件存在）**先校验后删源**，这样跨盘复制被截断时不会丢数据。
17. 作为实现者，我想"根解析"是**一个纯函数 + 一类显式上下文**（默认根 vs 自定义根），这样体积/清理/删除/改名全部复用同一条路径，不会各处各写一份。
18. 作为实现者，我想新增的助手方法**尽量少**（迁移编排放扩展侧），这样 `helper.cjs` 的职责边界（只做文件系统动作）不被撑破。
19. 作为使用者，我想在扩展界面点「浏览…」直接用**系统目录选择框**挑一个目录（而不是手打路径），这样我不会打错盘符或漏掉反斜杠（P0 = B，依赖宿主新能力）。
20. 作为使用者，我想在宿主**还是旧版本**（不支持选目录）时，扩展**不会报错或崩溃**，而是退回"手填路径 + 一句诚实提示"，这样扩展升级不会把老用户卡住。
21. 作为使用者，我想在迁移要**覆盖**目标同名目录前先看到**逐条的冲突清单**并明确确认（确认文案写明"目标目录里的登录态会永久丢失且无法恢复"），这样我不会在不知情的情况下丢掉另一份数据（P1 = B）。
22. 作为使用者，我想在**移动硬盘/网络盘**上把根指到 UNC 时被提示"会明显变慢"，这样我不会以为扩展卡死了（P2 默认允许 UNC）。

## 7. 用户流程

### 7.1 主流程：首次设置自定义根（有存量数据）

```
设置 → 扩展 → 网页应用 → 「浏览器数据根目录」输入框
  → 用户粘贴/输入 D:\obox-webapp\profiles，或点扩展界面「浏览…」用系统目录选择框挑（§7.4）
  → 输入框失焦（change 事件）→ 宿主 stateStore.setSetting('webapp.profileRoot', 值)
  → 扩展收到 api.settings.onChanged('webapp.profileRoot')
  → 扩展做校验（§9.1 V1–V7）
     ├─ 校验失败 → 不写标记、不迁移、不创建目录；把该值视为"无效根"，
     │            运行时继续用**当前生效根**，并在扩展界面显示原因
     └─ 校验通过 → 调 helper profileRootStatus({ root })：
           ├─ 根不存在 → 创建目录 + 写 .obox-webapp-root（§9.3）
           ├─ 根存在且有标记 → 继续
           └─ 根存在但无标记 → 先调 prepareRoot 写标记（目标根**必须有标记**）；
                             写标记失败 ⇒ 迁移不开始并报错（§9.3）
  → 若有需要迁移的条目目录 → 进入迁移：
       ① 写 <扩展 data>/.pending-move-root.json（§9.4，phase = 'pending'）
       ①b **冲突预检**：逐条列出"目标已存在同名目录"的条目 → 弹**覆盖确认框**
           （列名 + 写明不可恢复）→ 用户确认后把该批次的处置记为 overwrite 并写入意图文件；
           用户取消 ⇒ phase = 'abandoned'、删意图文件、设置值保持旧根
           （§9.4「覆盖语义的确认步骤」）
       ② 逐目录迁移（phase = 'running'，每完成一个条目就回写进度）
       ③ 全部完成（无 failed）→ 写设置 webapp.profileRoot = 新根（**唯一写点**）→ 删意图文件
  → 列表页顶部出现一行迁移状态：「正在迁移浏览器数据：已搬 3/5，覆盖 1」
      后端还没搬完时也显示「迁移未完成：已搬 3/5」+「继续」「放弃」
  → 搬完后状态行消失（或显示一次"迁移完成"）
```

### 7.2 主流程：无存量数据（首次配置）

根不存在 → 创建 + 写标记 → 无条目可迁 → **仍写设置**（因为"根已就绪且无迁移"是终态）→ 状态行不出现。

### 7.3 中断与续做

```
迁移中 obox 退出 / 崩溃 / 磁盘满：
  → .pending-move-root.json 保留（phase = 'running'，items 里已完成项标 done）
  → 下次扩展激活（首次 list 时懒执行，与既有 .pending-move.json 对账同一时机）：
       ① 读意图文件 → 若 phase ∈ {pending, running} 且根设置**尚未写入**
       ② 重扫 from/to 两个根（不信上次的扫描结果）
       ③ 逐项判定：
            - to 下已存在同名目录且源已不存在 → 视为已搬完（done）
            - to 下已存在同名目录且源也存在 → 看意图文件里该条目是否已被用户确认覆盖：
                 · 已确认（overwrite）→ 继续执行覆盖（删目标 → 搬源）
                 · 未确认 → 停下来**重新弹覆盖确认框**（续做路径不得跳过确认）
            - 源存在 → 继续搬（copy → verify → delete 或 rename）
            - 源不存在、to 也不存在 → 标 missing（该条目目录本来就没有，不阻塞）
       ④ 全部 done/missing/skipped → 写设置 + 删意图文件
  → 界面在 ① 之后立刻显示「迁移未完成：已搬 X/Y」+「继续」「放弃」
```

### 7.4 「浏览…」选目录（P0 = B：依赖宿主新能力 + 明确的降级路径）

**已核实的两条宿主事实**（决定了"为什么必须改宿主"）：

- `api.dialog.showOpenDialog` 的宿主实现把 `properties` **硬编码**为 `['openFile']`（`src/main/ext.ts:22-31`），IPC 入参类型只有 `title/filters/multiSelect`（`src/shared/types.ts:302-306`），扩展可见签名同（`src/api/types.ts:273-277`），preload 直通（`src/preload/index.ts:78`）⇒ **宿主当前完全不支持选目录**。
- 宿主设置页里**无法**注入「浏览…」按钮：`contributes.settings` 的 schema 只有 `key/label/type/default/options/description`（`src/api/contributions.ts:76-89`），`text` 字段渲染成裸 `<input>`（`SettingsView.vue:641-648`），扩展拿不到设置页的控件树。

**落地形态（v2 裁定）**：

1. **主入口 = 扩展界面的「浏览…」按钮**（位置见 §8.2）。子窗口没有 `api`（`test/ipcSurface.test.js:13-15`）⇒ 走 `callExtension('browseRootDir')` 回到扩展入口，由入口调 `api.dialog.showOpenDialog({ title, properties: ['openDirectory'] })`（`src/renderer/src/core/host.ts:484` 是既有透传点）。
2. **宿主侧必须先具备该能力**（确切清单见 §9.11）。宿主升级后，用户看到的是**系统目录选择框**；选中的目录即候选根，随后仍走 §9.1 的 V1–V7 校验（**宿主的选择框不是校验，校验永远在扩展/助手侧**）。
3. **降级路径（老宿主 / 能力探测失败）——不得报错、不得崩溃**：

   | 触发条件 | 扩展行为 | 界面文案 |
   | --- | --- | --- |
   | 入口检测到宿主的对话框能力**无 `properties` 透传**（探测方式见下） | **跳过目录对话框**，直接把焦点行为改为"手填"：在界面上给出候选根输入框（预填当前生效根），并提示用户手工粘贴路径 | `当前 obox 版本不支持「选择目录」；请在下方粘贴目录路径（例如 D:\obox-webapp\profiles），或升级 obox 后重试` |
   | 能力看似存在、但用户**取消**对话框 | 不改动任何值；控制台记一条 info | （无界面文案；保持现状） |
   | 宿主返回 `{ ok: false, error }` | 不改动任何值；界面提示一次失败原因，并**自动切到手填形态** | `无法打开目录选择框（<原因>）；请手工粘贴目录路径` |
   | 用户选中的目录**未通过 V1–V7** | 不改动任何值；显示具体原因（§9.1 文案） | 该条 V2–V6 的原文 |

4. **能力探测方式（确定性、只探测一次、可解释）**：

   ```
   browseRootDir 的处理顺序（扩展入口内）：
   ① 若本次会话已探测过 → 直接用缓存结论（supported / unsupported），不再重复探测
   ② 调 api.dialog.showOpenDialog({ title, properties: ['openDirectory'] })
   ③ 判定：
        - 返回 { ok:true, canceled:true }            → supported 记为 true（对话框确实开了）
        - 返回 { ok:true, filePaths:[p] } 且 p 通过 **助手侧** isDirectory 判定
                                                     → supported 记为 true，候选根 = p
        - 返回 { ok:true, filePaths:[p] } 且 p 是**文件**
                                                     → 老宿主（忽略 properties）⇒ supported = false；
                                                       候选根 = p 的父目录，并把降级提示一并回给界面
        - 返回 { ok:false }                          → supported 记为 false，reason = 宿主 error
   ④ 结论缓存到本会话内存（**不落库、不写设置**）；扩展重新激活后重新探一次
   ```

   > **为什么要"助手判定 isDirectory"而不是扩展侧 `fs.stat`**：扩展入口没有 `node:fs`（`SKILL.md:48,51`），`api.fs` 只覆盖扩展 data 目录（`api-reference.md:481-500`、`src/api/types.ts:325-341`），而候选根是**扩展目录之外**的路径 ⇒ 判定必须落到助手侧（新增方法 `checkRootCandidate`，见 §9.5.2）。
   > **代价（如实登记）**：老宿主下第一次点「浏览…」会弹出一个**文件**选择框（用户按提示选任一文件），扩展用它的父目录作候选根——体验一般但**不报错**；提示文案必须诚实。`filePaths` 为空但 `canceled !== true` 也按"取消"处理。

5. **不做的事**：不探测宿主的版本号字符串（版本号不可靠且需要新增 API）；不把"宿主是否升级"写进设置；不为老宿主做任何隐藏的重试或静默降级（降级必须**说出来**，见上表的文案）。

### 7.5 卸载 / 升级的对照表述（README、Release、设置项 `description`、迁移状态区四处同一份文案）

| 场景 | 默认根（`webapp.profileRoot` 为空或等于 `<扩展 data>/chrome`） | 外部根（用户配置的绝对路径） |
| --- | --- | --- |
| 升级 / 覆盖安装 | profile 与登录态**保留**（宿主搬回 `data/`，`src/main/oixCore.ts:320-336`） | profile 与登录态**保留**（根本就在扩展目录之外，宿主不接触） |
| 卸载扩展 | profile **永久删除**（`src/main/capabilities.ts:118`） | **保留在磁盘上**（宿主的递归删除只作用于 `<userData>/extensions/webapp_chenzhi/`）→ 需用户自行清理 |

**必须落地的四句话（P4 = A）**：

- README：`默认根（<扩展 data>/chrome）随卸载永久删除；外部根下的 profile 会保留在磁盘上，需自行清理`（并给一条清理命令模板）。
- **设置项 `description`**（§9.1）必须包含：`卸载时只有默认目录下的数据会被删除；指向外部目录时数据会保留，需你自行清理`。
- **迁移状态区**（§8.2）在迁移完成时给出一次同义提示（例如 `数据已迁到 D:\…；该目录不在扩展内，卸载扩展时不会删除它`）。
- **`uninstall(ctx)` 钩子**：仍只打日志，**完全不触碰外部根**（§9.7）。

### 7.6 宿主能力与发布顺序建议（P0 = B 的交付面）

| 交付物 | 仓库/路径 | 通道 |
| --- | --- | --- |
| **宿主能力**（`openDirectory` 透传） | obox `src/main/ext.ts`、`src/shared/types.ts`、`src/api/types.ts`、`README`/skill 文档 | obox 仓库的 `feat/xxx` 分支 → PR → CI（typecheck + lint + vitest + `security:audit`）→ 合并（`AGENTS.md` 的提交流程） |
| **宿主版本发布** | — | **由用户决定**（本规格不假定宿主必须发版；但如果要"用户开箱即用选目录"，就必须发一个宿主补丁版） |
| **扩展侧**（改根/迁移/浏览入口/降级） | `extensions/webapp`（`master`） | 独立仓库 `master` → tag `v1.0.3` → release 附 `webapp-1.0.3.oix`（阶段 1 Q5） |

**建议的发布顺序：先发宿主补丁版，再发扩展（推荐），理由**：

1. 扩展的「浏览…」体验完全依赖宿主透传 `openDirectory`；**宿主先上**能让绝大多数用户在扩展发布当天就用上系统目录选择框，而不是先看到降级文案。
2. 宿主改动是**纯加法**（多接受一个可选字段并透传），不改变既有 `openFile` 行为 ⇒ 先发宿主对**所有**扩展是零风险的（含 rdp 等其他扩展的 `showOpenDialog` 调用）。
3. 反过来（扩展先发）虽然**不会崩**（§7.4 的降级路径已覆盖老宿主），但会让"新功能刚发布就是降级形态"成为第一印象，且用户报告"选不了目录"的噪音会集中出现。
4. **若时间紧、必须并行**：两者**可以独立发布**——扩展不 `peerDependency` 宿主版本、不做版本号探测（§7.4 第 5 条），宿主也不依赖扩展。此时建议 README/Release 明写"目录选择需要 obox ≥ 具备该补丁的版本；旧版本请手工粘贴路径"。
5. 宿主是否**真的发版**由用户定（例如只想让 dev 构建具备该能力也能自测）；**但扩展的验收 A44（选目录）必须在具备该能力的宿主上跑**，否则只能验降级路径（A42）。

## 8. 前端变更

### 8.1 宿主设置页（**扩展侧无需改宿主设置页代码**；宿主侧的对话框能力见 §9.11）

`manifest.json` 的 `contributes.settings.fields` 追加第三个字段（`text`），宿主自动渲染成 `<input class="text-input">`（`SettingsView.vue:641-648`），失焦即 `stateStore.setSetting`（`:302-304`）。**扩展不控制这个控件**，只能通过 `description` 写清语义与风险（文案见 §9.1）；**「浏览…」按钮放不进宿主设置页**（`contributes.settings` 的 schema 没有扩展可注入的控件位，`src/api/contributions.ts:76-89`），因此它落在 §8.2 的扩展界面里。

### 8.2 扩展界面（`extensions/webapp/src/**`）

| 元素 | 位置 | 行为 |
| --- | --- | --- |
| 迁移状态行 | `App.vue` 列表区顶部（`app__main` 内、搜索框之上） | 仅在 `rootStatus` 返回 `migration != null` 时出现：`正在迁移浏览器数据：已搬 X/Y`（有覆盖时追加 `，覆盖 Z`）；`phase != 'done'` 时给出「继续」「放弃」两个按钮 |
| 跳过/失败清单 | 同上，状态行下一行灰字 | 逐条列出 `跳过：<名>（未确认覆盖）` / `覆盖：<名>` / `失败：<名>（窗口正开着，待续做）`；超过 5 条折叠成"等 N 项" |
| **覆盖确认框** | 模态框（复用 `DeleteConfirm.vue` 的形态：**只能按钮关闭**，`componentSource.test.js:35-51` 的门禁必须继续通过） | 标题 `有 N 个站点在目标目录里已经有数据，迁移会覆盖它们`；正文**逐条列出**将被覆盖的目录名；必须写明 `目标目录里已有的浏览器数据（含登录态）会被永久删除且无法恢复`；按钮 `取消` / `覆盖并继续`（危险样式）；**不做**"备份目标"选项（P1 = B） |
| 「浏览…」按钮 | 列表页 header（「环境检查」旁） | 调 `browseRootDir`；支持时弹**系统目录选择框**；不支持时按 §7.4 的降级文案把手填入口露出来 |
| 手填路径输入框（降级形态） | 「浏览…」旁，仅在 `browseRootDir` 返回 `supported:false` 时显示 | 预填当前生效根；提交走与设置页同一个校验/迁移入口（`startRootMigration`） |
| 卡片 `title` 文案 | `src/components/WebappCard.vue:37` | 由 `数据目录：chrome/${profileDir}；体积可能达到 GB 级` 改为**动态**：默认根显示 `数据目录：chrome/<名>`，自定义根显示 `数据目录：<根>\<名>`（根过长时用中间省略，保留盘符与末两级） |
| 未受管目录提示 | 迁移状态行同处的警示行 | 根指向的目录**缺标记**时显示：`该目录不是本扩展管理的目录：删除与清理已被拒绝` |
| 卸载提示（P4） | 迁移完成时状态行显示一次 | `数据已迁到 <根>；该目录不在扩展内，卸载扩展时不会删除它` |

> 界面纪律不变：**不新增底部状态栏**（`docs/spec/amendments/05-remove-status-bar.md`）；除**三处例外**外文案一律只进控制台（`src/App.vue:90-106`）：① 迁移状态行（必须让用户看到并决策"继续/放弃"）；② 未受管目录警示行（R3 要求"提示该目录不是本扩展管理的目录"）；③ **覆盖确认框**（P1 = B 的唯一闸门，必须用户显式点按钮）。其余（成功/失败/降级细节）仍只写控制台。

## 9. 后端变更

### 9.1 设置项契约

| 项 | 值 |
| --- | --- |
| 键名 | `webapp.profileRoot` |
| 类型 | `text`（`src/api/contributions.ts:73` 允许的四类之一） |
| 默认值 | `""`（空串 = 用默认根） |
| `label` | `浏览器数据根目录` |
| `description`（一行，必须包含的语义；**这段文字要原样进 `manifest.json`，因此里面不得出现 Markdown 标记**） | `站点浏览器数据的存放根目录（绝对路径）。留空 = 用默认目录（扩展数据目录下的 chrome）。改这里会把已有数据自动迁移到新目录；迁移未完成时不会生效。卸载时只有默认目录下的数据会被删除；指向外部目录时数据会保留，需你自行清理。` |

**校验清单（纯函数，`lib/profileRoot.mjs`）**：

| # | 规则 | 判定与文案 | 依据 |
| --- | --- | --- | --- |
| V1 | 空串 / 纯空白 = **默认根**，不算错误 | `kind = 'default'` | 需求 R1 |
| V2 | 必须**绝对路径**（`path.isAbsolute`）；拒绝相对路径 | `根目录必须是绝对路径（例如 D:\obox-webapp\profiles）` | 需求业务规则 |
| V3 | 规范化（去尾部分隔符、统一 `\`），拒绝**纯盘符根**（`C:\`、`D:/`、`\\server\share\` 为 UNC 根另见 V4） | `不能把磁盘根目录（C:\）当作浏览器数据根` | 需求业务规则 |
| V4 | **UNC 允许**（P2 = 允许，已按推荐默认闭合，用户可随时改）；判定 `kind = 'absolute-unc'` 并**必须**给性能警告文案 | `警告：网络路径上的浏览器数据会明显变慢，迁移可能很慢；断网或移动盘拔出会导致打开失败` | 需求 P2（本轮裁定：允许 UNC） |
| V5 | 拒绝指向 **obox 程序目录**（`process.execPath` 所在目录及其祖先中的 `obox` 安装目录） | `不能指向 obox 自己的安装目录` | 需求业务规则 |
| V6 | 拒绝与**扩展 data 目录自身**相同或互相包含的祖先（避免"根 = data 目录"把库文件当条目） | `不能指向扩展的数据目录（webapp.db 所在目录）` | 本规格新增（防止条目枚举把 `webapp.db`/`.obox-meta-*` 当条目） |
| V7 | 根不存在 ⇒ **允许创建**（并写标记）；创建失败（权限/盘不存在/UNC 不可达）⇒ 报错且**不写设置** | `无法创建根目录 <路径>：<errno>` | 需求业务规则 |

**保存时机与状态表示**：

- 用户改设置后，宿主**立刻**把值写进设置存储（扩展无法阻止，`SettingsView.vue:302-304`）。因此扩展必须把"设置值 ≠ 生效根"做成**显式状态**：
  - `effectiveRoot` = 生效根：取 `webapp.profileRoot` 的归一值，**但**当存在未完成的迁移意图（意图文件 `phase != 'done'` 且 `to` ≠ 当前设置值）时，`effectiveRoot` = 意图里的 `from`（**旧根**）。
  - 迁移全部完成后，扩展才把 `api.settings.set('webapp.profileRoot', newRoot)` 写一次——这是**唯一**由扩展写入该键的时机（`src/api/types.ts:182`）。
  - 归一失败（V2–V6 任一）⇒ `effectiveRoot` 保持**上一次成功的值**（内存里缓存；进程重启后回落到默认根），并在 `rootStatus` 里回 `invalid: { value, reason }` 供界面显示。
- **"迁移未完成时不写入"** 的准确含义：扩展**不主动覆盖**用户刚写的值（写不写由宿主决定），但**绝不**在迁移未完成时把该值当作生效根，也**不删**意图文件。

### 9.2 根解析改造点（改前 → 改后）

> 统一引入一个**显式上下文**：助手每个与 profile 有关的方法都接受可选入参 `root`（绝对路径字符串）。`root` 缺省 ⇒ 默认根 `join(process.cwd(), 'chrome')`（`helper.cjs:94-96` 现状不变）。这样**既有 8 个方法在不传 `root` 时行为一字不变**。

| # | 位置（改前） | 改后 | 备注 |
| --- | --- | --- | --- |
| R-1 | `lib/nameSanitize.mjs:47` `PROFILE_ROOT = 'chrome'` | **保留**，但语义收窄为"**默认根的目录名**"（注释改写）；长度预算函数 `assertNameLength` / `truncateToBudget`（`:115-144`）的 `profileRoot` 入参继续可用 | 既有单测 `test/nameSanitize.test.js:76,86-95` 不动 |
| R-2 | `lib/chromeArgs.mjs:32-34` `userDataDirArg(name)` = `--user-data-dir=${PROFILE_ROOT}/${sanitizeName(name)}` | **签名扩为 `userDataDirArg(name, options)`**：`options.rootMode` 缺省 `'relative'`（产出 `chrome/<名>`，一字不变）；`'absolute'` 时产出 `<绝对根>\<名>` | **形态判定见下"相对形态是否保留"** |
| R-3 | `helper.cjs:53` `PROFILE_ROOT = 'chrome'`（常量） | 保留为 `DEFAULT_PROFILE_ROOT`（语义 = 目录名），新增 `defaultRootDir() = join(process.cwd(), DEFAULT_PROFILE_ROOT)` | 纯改名，不改行为 |
| R-4 | `helper.cjs:94-96` `profileRoot()` 零入参 | `resolveRoot(params)`：`params.root` 非空 ⇒ 校验为绝对路径 + 规范化 + 拒绝盘符根（`[profile-root-invalid]`，`-32602`）；否则返回默认根 | 校验在助手侧**再查一遍**（双保险，与 `--user-data-dir` 同一口径，spec §11.2 第 4 条的"两层校验"精神） |
| R-5 | `helper.cjs:102-111` `profilePath(value)` | `profilePath(value, root)`：`assertProfileName` 不变；`relative(root, target)` 的双保险复核**保留**（这条是"越界防护"的核心，不得弱化） | 既有断言 `test/helper.test.js:353` 的路径防护用例继续成立 |
| R-6 | `helper.cjs:408-430` `resolveUserDataDir(value)`：只接受相对 `chrome/<名>` | 改为 `resolveUserDataDir(value, root)`：**接受两种形态**——① 相对 `chrome/<单层名>`（默认根语义，逐字保留现有分支）；② **绝对路径且等于 `join(root, <单层名>)`**（自定义根语义）。③ 其它绝对路径一律 `-32602` | **这是被本需求取代的既有条款的核心**（见 §16 取代清单） |
| R-7 | `helper.cjs:437-497` `validateLaunchArgs(rawArgs)` | 增补 `root` 入参并透传给 `resolveUserDataDir`；`launch(params)`（`:505-533`）从 `params.root` 取根 | 返回体的 `profileDir` 已是绝对路径（`:529`），无需改 |
| R-8 | `helper.cjs:539-545` `profileStatus`；`:547-558` `readPendingMove`（读 `<根>/.pending-move.json`） | 两者都接 `root`；`readPendingMove(root)` | intent 文件**跟着根走**（改名只发生在一个根之内） |
| R-9 | `helper.cjs:564-607` `moveProfile({from,to})` | 加 `root`；`mkdirSync(root)` + intent 写入 `<root>/.pending-move.json`；**新增**"目标根必须是当前生效根"的隐含前提（不做跨根 rename） | 跨根改名不在本需求范围（改根本身就是迁移） |
| R-10 | `helper.cjs:613-650` `removeProfile({name})` | 加 `root`；**前置新增**：读 `<root>/.obox-webapp-root`，**缺标记且不是默认根 ⇒ 抛 `[profile-root-unmarked]`（`-32603`），不执行任何 rename/rm**；`.trash` 仍落在 `<root>/.trash/` | 安全边界 R3/R4 的落点 |
| R-11 | `helper.cjs:656-687` `cleanTrash` | 加 `root` | — |
| R-12 | `helper.cjs:704-723` `scanCacheDirs(dir)`；`:741-801` `profileSize`；`:816-880` `cleanCaches` | 三者加 `root`；`cleanCaches` 的"省略 name = 遍历根下全部条目"改为**遍历生效根**；**新增**：缺标记且非默认根 ⇒ 整体拒绝（返回 `{ cleaned: [], totalFreedBytes: 0, skipped: [], refused: '[profile-root-unmarked] …' }`，**不抛错**，与既有"单目录失败进 skipped"同口径） | 保留清单/白名单/深度逻辑**一行不改** |
| R-13 | `helper.cjs:887-895` `METHODS` 表 | 追加 `profileRootStatus`、`prepareRoot`、`migrateRootDir`（§9.6） | `test/ipcSurface.test.js:115-124` 的反向门禁会要求 `index.js` 有调用点 |
| R-14 | `helper.cjs:902-922` `isInvalidParamsMessage` | 追加新前缀判定：`profile-root-invalid`、`profile-root-invalid` 相关的文案关键词（`根目录`）⇒ `-32602`；`[profile-root-unmarked]` / `[migrate-*]` ⇒ `-32603` | 判定是"错误种类"而不是"消息里恰好出现某词"，沿用既有注释口径（`:905-906`） |
| R-15 | `helper.cjs:1019-1254` `--selftest` | 追加：默认根不变的行为断言 + 自定义根（临时目录）下的 `profileSize`/`cleanCaches`/缺标记拒删 三条 | 与其既有 5 组断言并列 |
| R-16 | `index.js:57-65` `TIMEOUTS` | 追加 `profileRootStatus: 30_000`、`prepareRoot: 60_000`、`checkRootCandidate: 30_000`、`migrateRootDir: 600_000` | 迁移单位是**单个目录**，5 分钟足够；整体迁移由扩展侧循环，不受单次超时限制 |
| R-17 | `index.js:234-254` `readSettings()` | 返回体追加 `profileRoot`（原始串）与归一结果 `{ effectiveRoot, kind, invalid? }` | 归一失败**回落**而非崩溃（与两个 select 的 `fellBack` 同口径） |
| R-18 | `index.js:278-285` `profileExists(name)` | 改为 `profileExists(name, root)`，`callHelper('profileStatus', { name, root })` | — |
| R-19 | `index.js:344-361` 改名段（`save`） | `moveProfile` / `profileStatus` 调用带上生效根；**新增前置检查**：生效根缺标记 ⇒ 改名也拒绝（改名会动数据） | 与 R-10 一致 |
| R-20 | `index.js:397-426` `remove` | `removeProfile` 带根；捕获 `[profile-root-unmarked]` 并归一为界面文案（§9.7 E5） | — |
| R-21 | `index.js:438-473` `open` / `:479-519` `precheckSize` / `:530-554` `profileSize` / `:563-578` `cleanCaches` | 全部带根；`buildChromeArgs` 传 `rootMode`（§9.2 形态判定） | — |
| R-22 | `index.js:582-595` 卡片注册 `version: '1.0.2'` | 随发布改为 `'1.0.3'`（五处一致，`test/manifest-settings.test.js:131-156` 是门禁） | — |
| R-23 | `manifest.json:18-52` settings.fields | 追加 `webapp.profileRoot` 字段（§9.1）；`version` 改 `1.0.3` | — |
| R-24 | `src/components/WebappCard.vue:37` | `cardTitle` 改为动态（§8.2） | — |
| R-25 | `src/App.vue`（头部/空态） | 新增「浏览…」按钮（+ 降级时的手填输入框）、迁移状态行、**覆盖确认框**、未受管警示行；新增 `rootStatus`/`startRootMigration`/`resolveRootMigration`/`browseRootDir` 的调用点 | `test/componentSource.test.js` 需同步（§14） |
| R-26 | `src/bridge.js` | **无需改**（`callExtension` 是通用的） | 待实现时复核 |
| R-27 | **宿主**（obox 仓库，不在本扩展内） | 见 §9.11 的宿主改动清单（`src/main/ext.ts` / `src/shared/types.ts` / `src/api/types.ts` / `test/` / skill 文档） | 走 obox 仓库分支 + PR + CI（§7.6）；**本规格的实现票 00 专门承载它** |

#### 「相对路径 `chrome/<名>` 的参数形态是否保留」——**裁定：保留，并新增绝对形态作为并列分支**

**理由**：

1. `--user-data-dir` 对 Chrome 只是一个字符串；相对形态之所以可行，是因为**助手**在 spawn 前把它解析成绝对路径（`helper.cjs:429`）。自定义根下，助手同样能解析——所以"保留相对形态"在技术上没有代价。
2. 保留相对形态 ⇒ `lib/chromeArgs.mjs` 的**纯函数性质**（`chromeArgs.mjs:9-10` 的设计约束）与既有单测（`test/chromeArgs.test.js:43,55,78,107,325-327` 逐项断言 `chrome/<名>`）**不需要推倒重来**；默认根用户（绝大多数）路径一字不变，风险最小。
3. 绝对形态是必需的：只有当根是绝对路径时，`chrome/<名>` 这个相对写法**无法表达**该根（助手的 cwd 永远是扩展 data 目录，`helper.cjs:95`）。因此形态由**根的类别**决定，而不是由用户书写决定：
   - 生效根 == 默认根 ⇒ `rootMode = 'relative'` ⇒ `--user-data-dir=chrome/<名>`；
   - 生效根 != 默认根 ⇒ `rootMode = 'absolute'` ⇒ `--user-data-dir=<根>\<名>`。
4. 助手侧**两种形态都收**，且都做同样的"必须在生效根之内"复核（R-6 + R-5 的 `relative()` 双保险）——放宽的只是"字面形态"，**没有放宽**"只能操作生效根之下的子目录"这条边界。
5. 代价（明确记录）：`describeLaunch`（`chromeArgs.mjs:327-334`）的日志摘要会从 `profile=chrome/内网` 变成 `profile=D:\obox-webapp\profiles\内网`。这不是风险，反而是排查时更有用的信息（且它**只记摘要、不打印完整命令行**的口径不变）。

### 9.3 标记文件

| 项 | 裁定 |
| --- | --- |
| 路径 | `<根>/.obox-webapp-root`（与既有 `<根>/.pending-move.json`、`<根>/.trash/` 同级） |
| 内容（JSON，UTF-8） | `{ "marker": "obox-webapp-root", "extId": "webapp_chenzhi", "version": "1.0.3", "createdAt": "<ISO>", "root": "<规范化后的绝对根>" }`（**P3 已按推荐默认闭合 = 本形状**，用户可随时改；见 §17） |
| 创建时机 | ① 用户在设置里第一次保存一个**新**的自定义根且校验通过 ⇒ 创建目录 + 写标记；② 「打开」时发现根目录不存在（被用户手工删除）⇒ 重建目录 + **重写标记**（需求异常场景 5）；③ 迁移的**目标根**在迁移开始前确保存在且有标记；④ **默认根**：`install`/首次使用时创建目录，**也写标记**（便于统一判定），但判定逻辑对默认根豁免（下条） |
| 缺标记时的各操作 | 见下表 |

| 操作 | 缺标记 + **默认根** | 缺标记 + **自定义根** |
| --- | --- | --- |
| 打开条目（`launch`） | 放行（默认根天然可信） | **放行**（打开是"写"，不是"删"；拒绝会造成"根被手工动过就再也打不开"的死局）。但 `rootStatus` 回 `unmanaged: true`，界面显示 R3 的警示行 |
| 量体积（`profileSize`） | 放行 | 放行（只读；但 `rootStatus` 仍标记未受管） |
| **删除条目**（`removeProfile`） | 放行 | **拒绝**：`[profile-root-unmarked] 目录 <根> 缺少标记文件 .obox-webapp-root，本扩展不删除该目录下的数据` |
| **清理缓存**（`cleanCaches`） | 放行 | **拒绝**（整体拒绝，返回 `refused` 字段；不抛错） |
| **改名**（`moveProfile`） | 放行 | **拒绝**（改名会移动数据，与删除同等级） |
| **迁移的目标根** | 不适用（默认根不做目标） | 迁移前**写标记**（幂等，经 `prepareRoot`）；若写标记失败 ⇒ 迁移不开始并报错。**目标根必须有标记**是硬前提 |
| **迁移的源根** | 放行（默认根天然可信） | **放行**（**P3b = A 已闭合**）：迁移只"读源 + 删源"，删源**必须先通过 C1–C5 完整性判据**（§9.4），不因源根缺标记而拒绝——否则用户手工拷贝出来的旧根永远搬不动 |
| **候选根探测**（`checkRootCandidate`） | 放行 | 放行（纯只读：只判"是不是目录""通不通过 V1–V7"），不写不删 |

- **默认根天然可信的例外**：默认根 = `join(dataDir, 'chrome')`，由宿主/扩展自己创建（`install`、首次使用），且它**永远位于扩展目录之内**（卸载会整体删除，不存在"删到别人数据"的可能）。因此默认根**豁免标记校验**；标记文件仍会写（保持一致），但不作为判据。

### 9.4 迁移状态机

#### 意图文件 `<扩展 data>/.pending-move-root.json` 的完整 schema

```jsonc
{
  "schema": 1,                        // 固定 1；读到 != 1 视为不合法（不迁移，只报错）
  "kind": "profile-root-move",        // 固定值，防与其他 intent 混淆
  "phase": "pending",                 // pending | running | done | abandoned
  "from": "C:\\Users\\me\\AppData\\Roaming\\obox\\extensions\\webapp_chenzhi\\data\\chrome",
  "to": "D:\\obox-webapp\\profiles",
  "extId": "webapp_chenzhi",
  "version": "1.0.3",
  "startedAt": "2026-10-13T10:15:00.000Z",
  "updatedAt": "2026-10-13T10:17:31.412Z",
  "conflicts": {                      // ★ P1 = B（覆盖）所需的确认记录
    "confirmedAt": "2026-10-13T10:15:40.000Z",  // 用户点「覆盖并继续」的时刻；null = 尚未确认
    "confirmedBy": "user",                      // 固定 'user'（不做程序自动确认）
    "names": ["Intranet"]                       // ★ 用户在确认框里看到的**逐条**冲突目录名（快照）
  },
  "items": [
    {
      "name": "内网-运维平台",         // 目录名（= 条目的净化名）
      "status": "pending",            // pending | copying | verifying | done | overwritten | skipped | failed | missing
      "reason": "",                   // skipped/failed 的原因（如 "未确认覆盖"、"目录被占用"）
      "overwrite": false,             // ★ 该条目是否需要覆盖目标同名目录（冲突预检时置 true）
      "backup": null,                 // ★ 固定为 null：P1 = B **不做任何备份**
      "files": 1234,                  // 源的实测文件数（进入 copying 前记录）
      "bytes": 536870912,             // 源的实测总字节
      "copiedFiles": 0,               // 目标侧实测（verifying 之后）
      "copiedBytes": 0,
      "attempts": 0,                  // 尝试次数（诊断用；不做重试上限逻辑）
      "at": "2026-10-13T10:15:02.100Z" // 该条目最后一次状态变更时刻
    }
  ],
  "summary": { "total": 5, "done": 3, "overwritten": 1, "skipped": 0, "failed": 0, "missing": 1 }
}
```

- `status: 'overwritten'` 与 `done` **分开计数**：界面必须能单独告诉用户"有 Z 个站点的旧数据被覆盖删除了"（可审计性要求，与 `cleanCaches.removedDirs` 同一精神）。
- 写入方式：**临时文件 + rename**（`<data>/.pending-move-root.json.tmp` → 目标文件名）保证读到的永远是完整 JSON；读不到/不合法 ⇒ 视为"无迁移"（与 `readPendingMove` 的容错口径一致，`helper.cjs:548-558`）。⚠️ **该文件写在扩展 data 目录（不是根里）**，因为它要在"根的切换过程中"被两个根之外的中立位置读到。

#### 状态流转

```
[无意图]
  │ 用户保存了一个校验通过的新根，且旧根下有可迁移的条目目录
  ▼
pending ──(冲突预检 + 用户确认覆盖)──► pending.conflicts.confirmedAt != null
  │                                        │
  │                                        └─(用户取消)──► abandoned ──► 删意图文件；设置值保持旧根
  ▼
pending ──(扩展开始逐目录处理)──► running
                                     │
                                     ├─ 每完成一个条目 → 回写 items + summary（updatedAt 刷新）
                                     ├─ 全部条目 ∈ {done, overwritten, skipped, failed, missing}
                                     ▼
                                  done ──► 写设置 webapp.profileRoot = to ──► 删意图文件 ──► [无意图]
  │
  ├─(用户点「放弃」)──► abandoned ──► 删意图文件；**设置值保持旧根**（若宿主已写入新值 ⇒ 扩展把它写回旧值一次，见 §9.4 放弃语义）
  └─(进程退出/崩溃)──► 文件保留在 pending/running ──► 下次扩展激活时**续做**
```

- **触发点**：`index.js` 首次 `list`（懒执行**一次**，与既有 `.pending-move.json` 对账同处）；界面也可显式调 `rootStatus` 触发一次对账。**不做定时器、不做后台轮询**。
- **"全部完成"的判据**：`items` 里不存在 `pending` / `copying` / `verifying`（即只剩 `done / overwritten / skipped / failed / missing`）。
- **`failed` 是否阻塞"全部完成"？** 阻塞写设置——**但**：只要有 `failed`（完整性判据不通过、权限错误、目标盘不可写），**不删源、不写设置**，整体停在 `running` 并把失败项留在 `items`，界面显示 `迁移未完成：已搬 X/Y，失败 Z（<原因>）`+「继续」「放弃」。理由：`failed` 意味着"源还在、目标不完整"，此时切换生效根会让用户在新根下看不到那些数据。

#### 覆盖语义的确认步骤（P1 = B，**不可跳过**）

**语义定义（用户已裁定并接受其后果）**：目标已存在同名目录时，处置 = **先递归删除目标同名目录 → 再把源搬过去**。目标目录里原有的浏览器数据（含登录态、Cookie、书签、IndexedDB）**永久丢失且无法恢复**；**不做备份、不做"改名保留"、不做合并**（`items[].backup` 恒为 `null`）。

**确认步骤（三步，缺一不可）**：

```
1. 冲突预检（用户提交新根之后、任何删除发生之前）
   - 调 helper migrateRootDir({ from, to, name, action: 'probe' }) 逐条探测
   - 得到 conflicts = [name …]（target.exists === true 且 source.exists === true 的条目）
2. 逐条列出 + 弹确认框（界面 §8.2 的「覆盖确认框」）
   - 标题：有 N 个站点在目标目录里已经有数据，迁移会覆盖它们
   - 正文：逐条列出 conflicts 的**目录名**（完整列出，不截断、不折叠）
   - 必须写明：目标目录里已有的浏览器数据（含登录态）会被永久删除且无法恢复
   - 按钮：取消 / 覆盖并继续（危险样式）
3. 只有用户点「覆盖并继续」才允许动手
   - 确认后把 { confirmedAt, confirmedBy:'user', names:[…] } 写入意图文件，并把对应 items[].overwrite = true
   - 用户取消 ⇒ phase = 'abandoned'、删意图文件、设置值保持旧根；**一个字都没删**
   - 无冲突（conflicts 为空）⇒ 不弹框，直接进入 running
```

**续做路径的强制复确认**：断电/崩溃后重新激活时，若某条目的 `overwrite === true` 但意图文件里的 `conflicts.confirmedAt` 为 `null`（或 `names` 与该条目不匹配），**必须重新弹确认框**——续做**不得**继承一个不存在的确认。

**执行顺序（不可颠倒）**：`prepareRoot(to)`（有标记）→ 删除目标同名目录（`clearReadonly` + `removeDir`，`helper.cjs:152-191` 的既有手法）→ 复制/移动源 → C1–C5 校验 → 删源。若"删除目标"或"复制"失败 ⇒ `status='failed'`、`reason` 带真实 errno，**源保留**（此时目标可能已被删掉，必须在界面与日志里如实说明"目标上的旧数据已删除，但新数据未搬入"这一中间态）。

**风险登记**：本条是**用户已接受的不可逆风险**（见 §20 R-9 与 §17 P1 的裁定记录），README 必须用醒目段落写明；验收 A43 用"确认框列出过它们"证明确认步骤真的存在。

#### 完整性判据（**先校验、后删源**）

对每个条目，复制/移动完成后必须同时满足：

| # | 判据 | 阈值 | 理由 |
| --- | --- | --- | --- |
| C1 | 目标目录存在且是目录 | 必须 | 基本前提 |
| C2 | `targetFiles >= floor(sourceFiles * 0.95)` | **≥ 源 95%** | 需求业务规则；Chrome 在复制期间可能自己增删少量文件（如 `BrowserMetrics`），允许 5% 抖动 |
| C3 | `targetBytes >= floor(sourceBytes * 0.95)` | **≥ 源 95%** | 同上；字节数比文件数更能反映"大文件是否搬全" |
| C4 | `<target>/Default/Preferences` 存在 | 必须 | 需求业务规则点名的"关键文件"（profile 的配置；缺失说明复制被截断） |
| C5 | `<target>/Default/Network/Cookies` 存在 | 必须 | 需求业务规则点名的"关键文件"（登录态） |

- 任一不满足 ⇒ 该条目 `status = 'failed'`、`reason = '完整性校验不通过（文件数 X/Y、字节 A/B、关键文件缺失：…）'`，**保留源目录**（不删）。
- 通过 ⇒ 源目录才允许删除：**同卷**用 `fs.rename`（失败即视为被占用，见下）；**跨卷**用"复制 → C1–C5 校验 → 递归删除源"（删除前仍走 `clearReadonly` + `removeDir`，`helper.cjs:152-191`）。
- 判定所需的两组数字由助手实测（复用 `measureDir`，`helper.cjs:120-150`），**不信任**迁移前的旧快照。

#### 冲突策略（目标已存在同名目录）——**P1 = B：覆盖，但不备份**

| 情形 | 处置 | `status` |
| --- | --- | --- |
| 目标存在、源存在，且用户**已确认覆盖** | **先删目标同名目录 → 再搬源**（§9.4「覆盖语义的确认步骤」） | `overwritten` |
| 目标存在、源存在，用户**未确认**（或续做时发现确认记录缺失） | **停下来重新弹确认框**；用户拒绝 ⇒ 该条目跳过 | `skipped`（`reason='未确认覆盖'`） |
| 目标存在、源**已不存在** | 视为已搬完（断电续做的常见形态） | `done`（`reason='已搬完（源已不存在）'`） |
| 目标存在但**为空目录** | **同样按覆盖处理**（也需要确认；空目录被删无损失，但策略保持一致，避免"空/非空"两套分支） | `overwritten`（确认后） |
| 目标不存在 | 正常迁移 | `done` |

- **不做**"覆盖前把目标改名留一份"（用户裁定：不备份）；`items[].backup` 恒为 `null`，代码里**不得**出现任何 `backup` / `.bak` / `.old` / `copy → 保留` 的实现路径（`test/rootMigration.test.js` 用源码门禁钉住）。
- 迁移结束后把全部 `overwritten` 与 `skipped` **逐条列出**（界面 + 日志 + 意图文件的 `items[].reason`），README 写明"覆盖是不可逆的"。
- **顺序保证**：删除目标必须先于复制源；若删除失败（被占用/权限）⇒ `failed` 且**不复制**（避免"目标没删干净又往里拷"导致两份数据混杂）。

#### 占用处理（复用既有判据）

- **判据不新增**：一律"尝试整目录 rename / 递归删除并捕获失败"（`docs/spec/spec.md:944` 的裁定；`lib/profileLimit.mjs:220-230` 的注释同源）。**禁止**引入任何锁文件探测。
- 命中 `EBUSY / EPERM / EACCES / ENOTEMPTY` 或 Windows 的 `Access to the path … is denied` / `IOException` ⇒ 该条目 `status = 'failed'`、`reason = '窗口正开着（待续做）'`，**不阻塞其他条目**（需求 R7）。
- 错误前缀沿用既有风格：迁移相关统一 `[migrate-failed] <条目名>：<真实错误>`（不硬编码文件名，沿用 `helper.cjs:628-637` 的口径）；占用单独标注 `[profile-busy]` 前缀以便扩展侧归一为"请先关闭该站点的浏览器窗口"。

#### 与既有 `.pending-move.json`（改名意图）并存时的顺序与互斥

| 情形 | 裁定 |
| --- | --- |
| 两者**同时存在** | **顺序：先处理"改根"迁移（`.pending-move-root.json`），再处理"改名"对账（`<生效根>/.pending-move.json`）**。理由：根迁移是"更大的一次搬迁"，它的完成会决定后续一切路径解析的基础；先改根后改名与需求「以先改根、后改名顺序处理」一致 |
| 改名 intent 落在哪个根 | **生效根**（迁移进行中 = `from` 根；迁移完成 = `to` 根）。迁移期间**不接受**新的改名请求（`save` 检测到未完成迁移 ⇒ 直接返回"浏览器数据正在迁移，请先完成或放弃后再改名"），避免"两个 intent 指向不同的根"这种无法对账的组合 |
| 互斥 | 迁移 `phase ∈ {pending, running}` 时：① 禁止发起新的根变更（再改一次必须等当前迁移结束）；② 禁止改名；③ 「打开 / 删除 / 清理」**仍允许**（它们只读/只动当前生效根下的单个条目目录）。迁移中删除某条目 ⇒ 该条目在 `items` 里标 `missing`（源已不存在）并继续 |
| 文件位置 | 改名 intent 在**根里**（跟着根走，`helper.cjs:549`）；改根 intent 在**扩展 data 目录**（中立位置，§9.4）——两者不冲突 |

#### 逐目录结果的记录与展示

- 记录：`items[].status/reason/overwrite/at`（助手回包）+ `summary`（扩展侧计算并回写，含独立的 `overwritten` 计数）。
- 展示：界面状态行 `已搬 X/Y`（Y = `total`，X = `done`，另报 `覆盖 Z`）、跳过数、失败数；点开/悬浮看逐条（名 + 状态 + 原因）；**覆盖过的条目必须单独可见**（可审计）。

### 9.5 方法契约变更

#### 9.5.1 既有方法的**入参扩展**（不新增方法、不改返回形状）

| 方法 | 入参（改后） | 返回 | 错误码 | 为什么能复用 |
| --- | --- | --- | --- | --- |
| `probe` | `{}`（不变；`profileRoot` 字段的值改为**生效根的绝对路径**，`helper.cjs:369`） | 不变 | 不变 | 只加信息 |
| `launch` | `{ args, root? }` | 不变 | 新增 `-32602`（`root` 非法 / `--user-data-dir` 不在根内） | 根只影响路径解析 |
| `profileStatus` | `{ name, root? }` | 不变 | 不变 | — |
| `moveProfile` | `{ from, to, root? }` | 不变 | 新增 `-32603 [profile-root-unmarked]` | — |
| `removeProfile` | `{ name, root? }` | 不变 | 新增 `-32603 [profile-root-unmarked]` | — |
| `profileSize` | `{ name, ttlMs?, force?, root? }` | 不变 | 不变 | 只换根 |
| `cleanCaches` | `{ name?, root? }` | 追加可选 `refused?: string`（缺标记时整体拒绝） | 不变（拒绝**不抛错**） | 与"单目录失败进 skipped"同口径 |

> **关键取舍**：`profileSize` / `cleanCaches` **不新增**"根专属"方法，而是**加一个可选入参**。理由：根是它们的隐含前提，凭空多一套 `rootProfileSize` 会让 `test/ipcSurface.test.js:74-85` 的"恰好 8 个方法"门禁与两处实现分叉；加可选入参对既有调用者（不传 `root`）**零行为变化**。

#### 9.5.2 新增助手方法（4 个，全部是"文件系统动作"，不含业务编排）

| 方法 | 入参 | 返回 | 错误码 |
| --- | --- | --- | --- |
| `profileRootStatus` | `{ root? }` | `{ root, isDefault, exists, marked, unmanaged, isDirectory, marker: {…} \| null, legacyPendingMove: object \| null, entries: string[] }`（`entries` = 根下的**目录名**列表，排除 `.trash`，排序后返回） | `-32602`（root 非法） |
| `prepareRoot` | `{ root }` | `{ root, created: boolean, marked: boolean }`（幂等：建目录 + 写/刷新标记 + 建 `.trash` 目录） | `-32602`；`-32603 [profile-root-create-failed]` |
| `checkRootCandidate` | `{ candidate }` | `{ candidate, kind: 'default' \| 'absolute' \| 'absolute-unc', isDirectory: boolean, parent: string \| null, invalid: { reason } \| null, warning: string \| null }` —— **纯只读**：判"是不是目录"、跑一遍 V1–V7、给出 UNC 警告；**不创建、不写标记、不删任何东西**（供 §7.4 的能力探测与降级路径使用） | `-32602`（入参形状非法） |
| `migrateRootDir` | `{ from, to, name, action: 'probe' \| 'move', overwrite?: boolean }` | `action='probe'` ⇒ `{ name, source: {exists, files, bytes}, target: {exists, files, bytes}, sameVolume, conflict: boolean }`；`action='move'` ⇒ `{ name, status: 'done' \| 'overwritten' \| 'skipped' \| 'failed' \| 'missing', reason, overwritten: boolean, targetRemoved: boolean, files, bytes, copiedFiles, copiedBytes, crossVolume }` | `-32602`（from/to/name 非法）；**失败不抛错**，走 `status:'failed'`（与 `cleanCaches` 的单目录失败同口径，便于扩展侧逐条记录并继续） |

- `action='move'` 的 `overwrite` **必须由扩展侧显式传入**（来自意图文件里 `items[].overwrite` 且已由用户确认）；助手**不得**自行决定覆盖——`overwrite !== true` 且目标存在 ⇒ 返回 `status:'skipped', reason:'未确认覆盖'`，**一个字节都不删**。
- `targetRemoved` 回显"目标的旧目录是否已被删除"，用于如实报告 §9.4 的中间态（目标已删、新数据未搬入）。

> **为什么是"逐目录"而不是"一次迁全部"**：① 断电/崩溃时进度可精确到目录（可续做）；② 单次调用可在 5 分钟内完成，不受宿主超时限制；③ 扩展侧能逐条回写意图文件与刷新界面进度。代价是扩展侧要做循环与状态机——这部分本来就在扩展侧（业务编排），助手只做文件系统动作。

#### 9.5.3 扩展侧（`api.app.onMessage`）的新方法

| 方法 | 入参 | 返回 `data` | 失败 `error` |
| --- | --- | --- | --- |
| `rootStatus` | `{}` | `{ effectiveRoot, isDefault, configuredValue, invalid: {value, reason} \| null, unmanaged: boolean, migration: null \| { phase, total, done, overwritten, skipped, failed, missing, conflicts: {confirmed: boolean, names: string[]}, items: [{name, status, reason, overwrite}], to, from } }` | 底层 message |
| `startRootMigration` | `{ root, confirmOverwrite?: boolean }` | `{ started: true, to, total, needsConfirm: false }` / `{ started: false, needsConfirm: true, conflicts: [name…] }`（**有冲突且未确认 ⇒ 不开始、不动手，把冲突清单回给界面弹确认框**） / `{ started: false, reason }`（无存量条目时 `reason:'无需迁移'` 且**已写设置**） | 校验失败文案（§9.1 V2–V7 的原文） |
| `resolveRootMigration` | `{ action: 'continue' \| 'abandon' \| 'confirm-overwrite' }` | `{ action, phase, total, done, overwritten, skipped, failed, missing, wroteSetting: boolean }`；`action='confirm-overwrite'` = 用户已看过冲突清单并点「覆盖并继续」⇒ 把确认写入意图文件后再继续 | 底层 message |
| `browseRootDir` | `{}` | 见下方字段表（`{ supported, candidate, canceled, degraded, note, invalid }`） | 宿主对话框失败时的 message（**不抛错**，返回 `supported:false` + `note`） |

- 方法集合从 **8 个**变为 **12 个**。`test/ipcSurface.test.js:74-85` 的"恰好 8 个"断言必须同步（§14）。
- **为什么 `browseRootDir` 也要做成方法**：子窗口没有 `api`（B13），对话框只能在扩展入口调；同时它必须能在"宿主不支持"时**优雅降级**为一个说明性返回，而不是抛错。
- **`browseRootDir` 的返回形状（v2，随 P0 = B 修订）**：

  | 字段 | 含义 |
  | --- | --- |
  | `supported` | 宿主是否真的支持选目录（§7.4 的探测结论，本会话缓存） |
  | `candidate` | 通过 V1–V7 且 `isDirectory === true` 的候选根（绝对路径）；没有则为 `null` |
  | `canceled` | 用户取消（含 `filePaths` 为空且未报错） |
  | `degraded` | `true` = 走的是"老宿主/选到文件"的降级路径（此时 `candidate` 是**父目录**，且必须把提示文案回给界面） |
  | `note` | 面向用户的一句提示（支持/降级/失败三种措辞，见 §7.4 的表） |
  | `invalid` | `{ reason }`（候选路径没过校验时；此时 `candidate: null`） |

- **为什么"放弃"不删已经搬过去的数据**：`abandon` 只删意图文件并把设置值恢复到 `from`；已经复制到 `to` 的目录**保留**（它们可能是用户想要的），由用户自行删除。这条写进界面文案与 README。
- **注意**：`browseRootDir` 与 `checkRootCandidate` 是**只读/探测**方法，不写意图文件、不改设置、不删任何数据；唯一的副作用是本会话的能力探测缓存。

### 9.6 数据语义

| 项 | 裁定 |
| --- | --- |
| 根**不入库** | 根是设置项（`webapp.profileRoot`），**不新增 DB 列、不在 `webapp` 表里存根**。理由：① 两处真相必然漂移（改根是设置动作，条目数是 N；把根写进 N 行会让"改根"变成改 N 条记录，与 §21.7 S15"上限放全局设置"的裁定同源）；② 迁移的"未完成态"是**临时**状态，属于意图文件而不是数据库；③ `profileDir` 列的语义（"净化后的目录名"）在自定义根下**完全不变**，行数据零迁移。 |
| `profileDir` 列语义 | **不变**：仍是"净化后的目录名"，不含根、不含分隔符。既有数据零改动。 |
| 迁移中条目列表的可用性 | `list` 照常返回全部条目（列表读的是库，不读盘）。卡片上的"数据目录"提示按**生效根**渲染。若某条目在迁移中处于"尚未搬到新根"，其数据仍在旧根下且**照常可用**（生效根在迁移完成前一直是旧根）。 |
| 迁移中的 `profileInfo` / 体积 | `profileInfo` / `profileSize` 按**生效根**解析（= 旧根），因此迁移进行中用户看到的数字仍是"当前真正在用的那份数据"。 |
| 迁移完成后的对账 | 生效根切到新根后，若某条目在 `to` 下缺失（例如被 `skipped` 后用户手工删了源），`profileInfo.exists === false` ⇒ 卡片沿用既有"数据目录缺失，下次打开会新建"的提示（spec §19.2 R-W5 的既有语义），**不自动改名、不自动重建**。 |
| `.trash` | 每个根**各自**有一个 `<根>/.trash/`，不跨根共享；迁移一个条目时**不迁移** `.trash`（它是删除中转区，不是用户数据）。旧根的 `.trash` 由用户自行清理。 |
| `.pending-move.json`（改名 intent） | 仍在根里；迁移完成后旧根里的残留改名 intent 由既有的对账逻辑按"源/目标都不在 ⇒ 删除该文件"处理（`docs/spec/spec.md:907-911`）。 |

### 9.7 权限与安全

| 防线 | 内容 | 落点 |
| --- | --- | --- |
| ① 路径校验 | 绝对路径、拒盘符根、拒 obox 程序目录、拒 data 目录自身（§9.1 V2–V6）；助手侧**再查一遍**（R-4） | `lib/profileRoot.mjs`（纯函数，可单测）+ `helper.cjs:resolveRoot` |
| ② 标记文件 | 缺标记 ⇒ **拒绝删除、拒绝清理、拒绝改名**（§9.3）；默认根豁免 | `helper.cjs:removeProfile/cleanCaches/moveProfile` 的前置检查；`profileRootStatus` 报告 |
| ③ 永不删根 | 所有删/移动作只作用于 `join(root, <已校验的单层目录名>)`，且 `relative()` 复核不越界（`helper.cjs:98-111` 保留）；`cleanTrash` 只遍历 `<根>/.trash/*` | `helper.cjs` 三处入口 |

**新增能力面（必须在 README/spec 明示）**：本扩展在自定义根下**会读写用户指定的扩展目录之外路径**——范围**严格限制**为该根及其直接子目录；不做递归扫描根之外的任何位置；不使用 `api.fs`（沙箱只到 data 目录，B11）。

**审计**：所有删/移动作沿用"只记摘要"口径（`chromeArgs.mjs:320-334`），迁移过程**逐目录**记录结果（`items[]` + stderr 一行摘要：`[webapp-helper] 迁移 <名>：<status>（files=X bytes=Y）`）。**stdout 只放协议帧**（不得在 stdout 打迁移日志，`helper.cjs:15`）。

**卸载钩子的边界（R1 相关，新增一条禁令）**：`uninstall(ctx)` 仍**不得**搬运/备份/删除 profile（既有硬约束，`index.js:659-675`），并且**不得**删除外部根下的任何东西。新增的"允许动作"只到：删 `<dataDir>/.pending-move-root.json`（避免重装后误判）与记日志。**不得**因为"外部根不会被卸载删除"而给用户"卸载安全"的错觉——README 必须对照写清。

### 9.8 性能与规模约束

| 项 | 约束 |
| --- | --- |
| 迁移耗时 | 与总字节成正比；同卷 rename 是毫秒级，跨卷复制是分钟~小时级。**不设总时限**（逐目录循环，每次调用 5 分钟预算，`index.js:63` 的 `migrateRootDir: 600_000`） |
| 迁移的并发 | **串行**（逐目录），不并行复制（避免磁盘抖动 + 让进度可解释）。迁移期间不作废体积缓存中的其他条目 |
| UNC / 可移动盘 | **允许（P2 已按推荐默认闭合）**；不可达 ⇒ `prepareRoot` / `migrateRootDir` 报错且不写设置；打开条目报错（需求异常场景 2）。界面在根为 UNC 时显示性能警告（§9.1 V4 的文案） |
| 覆盖删除的成本 | 覆盖路径比常规迁移多一次**递归删除**（目标同名目录），可能含数万文件 ⇒ 计入 `migrateRootDir` 的 5 分钟预算；超时由宿主报 `[timeout]`，该条目停在 `verifying`/`pending`，续做时按"未确认/已确认"规则重试（**不会**因为超时而误删源） |
| 体积扫描 | 迁移完成后**清空整个体积缓存 Map**（复用 `sizeCache.clear()`，`helper.cjs:867`），因为所有条目的 `dir` 都变了 |
| 列表加载 | `rootStatus` **只在**界面挂载时调一次 + 迁移未完成时用户点按钮；**禁止**在 `list` 的渲染路径里常驻轮询（与既有"体积按需查询"纪律一致，`componentSource.test.js:90-98`） |
| 条目数规模 | 根下的条目目录数 = 条目数（典型 < 50）；迁移逐条串行可接受 |

### 9.9 错误处理

| 码（message 前缀） | 产生方 | message 形态 | 界面/文档处置 |
| --- | --- | --- | --- |
| `[profile-root-invalid]` | 助手 `resolveRoot` / 扩展侧 `lib/profileRoot.mjs` | `[profile-root-invalid] 根目录必须是绝对路径: <值>` | 设置视为无效，运行时用上一次成功的根；界面显示原因 |
| `[profile-root-create-failed]` | 助手 `prepareRoot` | `[profile-root-create-failed] 无法创建根目录 <路径>：<errno>` | 报错、**不写设置**、不写意图文件 |
| `[profile-root-unmarked]` | 助手 `removeProfile` / `cleanCaches` / `moveProfile` | `[profile-root-unmarked] 目录 <根> 不是本扩展管理的目录（缺少 .obox-webapp-root），已拒绝删除/清理` | 「该目录不是本扩展管理的目录：删除与清理已被拒绝」 |
| `[migrate-failed]` | 助手 `migrateRootDir` | `[migrate-failed] <条目名>：<真实错误>` | 逐条列出；整体停在"迁移未完成"，给「继续」「放弃」 |
| `[migrate-verify-failed]` | 助手 `migrateRootDir`（完整性判据不通过） | `[migrate-verify-failed] <条目名>：完整性校验不通过（文件数 1200/1400、字节 …、关键文件缺失：Default/Network/Cookies）` | 同 `[migrate-failed]`；**源保留** |
| `[migrate-overwrite-unconfirmed]` | 助手 `migrateRootDir`（目标存在但 `overwrite !== true`） | `[migrate-overwrite-unconfirmed] <条目名>：目标目录已存在且未确认覆盖，已跳过（未删除任何数据）` | 界面：该条目留在冲突清单里，等用户确认后再「继续」 |
| `[migrate-overwrite-failed]` | 助手 `migrateRootDir`（删除目标同名目录失败） | `[migrate-overwrite-failed] <条目名>：无法删除目标同名目录 <路径>（<真实错误>）` | 界面如实报告"目标旧数据未删净、新数据未搬入"（`targetRemoved:false`） |
| `[profile-root-candidate-invalid]` | 助手 `checkRootCandidate` | `[profile-root-candidate-invalid] <候选路径>：<V2–V6 的具体原因>` | 界面显示原因（不改动任何值） |
| `[profile-busy]`（沿用） | 助手 `removeProfile` / `moveProfile` / `migrateRootDir` | 既有形态（`docs/spec/spec.md:948-949`） | 「请先关闭该站点的浏览器窗口后重试」 |
| `[profile-size-failed]`（沿用） | 助手 `profileSize` | 既有形态 | **降级放行**，新根下同样如此 |

**降级原则（沿用既有口径）**：体积检查不是安全边界 ⇒ 量不出来就放行（`index.js:492-496`）。**删除/清理是安全边界** ⇒ 标记缺失就拒绝，绝不降级。

### 9.10 边界条件

1. 根 = 默认根（设置留空）⇒ 全链路走 `rootMode='relative'`，**行为与 1.0.2 逐字一致**（零迁移、零提示）。
2. 用户在设置里把值改回空串 ⇒ 等价于"改回默认根"⇒ 触发一次**反向**迁移（从当前自定义根搬回默认根）——**裁定：允许，且复用同一状态机**（`from` = 当前自定义根，`to` = 默认根）。⚠️ 这条与"永不删根"不冲突（只删根下子目录）。
3. 根指向一个**已存在且有标记的、装着别的 obox 实例/上一次迁移残留**的目录 ⇒ 目标已存在的条目**逐条列出并需用户确认覆盖**（P1 = B），确认后按"先删目标、再搬源"处理（§9.4）。
4. 根是 UNC 且不可达 ⇒ §9.1 V7 的失败路径。
5. 根被用户手工删除 ⇒ §9.3 的"打开时重建 + 重写标记"；`rootStatus` 报 `exists:false`。
6. 名称为 Windows 保留名 / 含非法字符 / 超长 ⇒ 沿用既有净化与长度预算（`lib/nameSanitize.mjs`）；长度预算的 `profileRoot` 入参在自定义根下取**生效根的字符串长度**（这会让长根下的名称预算变小，属预期；`assertNameLength` 已支持该入参）。
7. 迁移时磁盘满 ⇒ `copyFile` / `writeFileSync` 抛 `ENOSPC` ⇒ 该条目 `failed`、`reason` 带 errno、源保留、整体停在 running。
8. 两个条目**净化后同名**（理论上被库层 `COLLATE NOCASE` 唯一索引挡住，`index.js:183-185`）⇒ 迁移按目录名逐条处理，不受影响。
9. 根下存在**非条目目录**（用户自己放的文件夹）⇒ 迁移时**不动**它们（只迁移"在 `webapp` 表里存在对应 `profileDir`"的目录；不迁移孤儿目录）。⚠️ 这是"宁可不搬，也不搬错"的保守选择，写进 README。
10. `.obox-webapp-root` 与 `.pending-move.json` 是根里的**文件**，条目枚举需过滤（既有 `cleanCaches` 已过滤非目录与 `.trash`，`helper.cjs:819-828`；`profileRootStatus.entries` 同样只回目录）。
11. **覆盖把目标删掉、但新数据没搬进去**（复制失败/断电）⇒ 该条目 `failed` 且 `targetRemoved:true`；续做时目标已不存在 ⇒ 走正常搬运（`done`）。界面与日志必须如实报告这个中间态（不得只说"失败"）。
12. 目标同名目录**被 Chrome 占用**（另一个条目正开着同一目录）⇒ 删除失败 ⇒ `[migrate-overwrite-failed]`，`failed`，**绝不**强行继续复制。
13. 用户在**老宿主**上点「浏览…」⇒ 弹的是**文件**选择框；若用户选中的是文件而扩展需要目录 ⇒ 按 §7.4 的降级路径取父目录并**明确提示**，不改动设置值（用户仍需显式提交）。

### 9.11 宿主侧改动清单（P0 = B；**obox 仓库**，不在 `extensions/webapp` 内）

> 这是 v2 新增的能力面。**唯一目的**：让 `api.dialog.showOpenDialog` 能请求"选目录"。所有改动都是**加法**，对既有调用者（不传 `properties` / 传 `openFile`）行为**零变化**。走 obox 仓库的 `feat/xxx` 分支 + PR + CI（typecheck / lint / vitest / `security:audit`），发布与否由用户定（§7.6）。**实现票 00 独立承载本清单**（§19）。

| # | 文件:行（改前） | 改前 | 改后 | 关键约束 |
| --- | --- | --- | --- | --- |
| H-1 | `src/main/ext.ts:9-36`（`ipcMain.handle('dialog:open', …)`） | `opts` 只有 `{title, filters, multiSelect}`；`properties` **硬编码** `['openFile', ...(multiSelect ? ['multiSelections'] : [])]`（`:22-31`），且 `win`/无 `win` 两个分支各写一遍 | ① `opts` 增加 `properties?: Array<'openFile' \| 'openDirectory' \| 'multiSelections'>`；② 新增一个**纯函数**做归一（建议 `normalizeDialogProperties(opts)`，落在同文件或 `src/shared/`）：默认 `['openFile']`；`openDirectory` 与 `openFile` **互斥**（同时传按 `openDirectory` 归一，只保留 `openDirectory` + 可选 `multiSelections`）；`filters` 在目录模式下**丢弃**（Electron 对目录不应用 filters）；③ 两个 `win`/无 `win` 分支改用同一个归一结果（顺手消掉重复） | **默认行为逐字不变**（不传 `properties` ⇒ `['openFile']`）；非法值不得抛错（忽略未知项）；`multiSelect` 旧字段继续兼容 |
| H-2 | `src/shared/types.ts:302-306`（`window.api.dialogOpen` 的**内联**签名） | `opts: { title?, filters?, multiSelect? }` | 抽出并新增类型（例如 `src/api/contributions.ts` 或新建 `src/shared/dialog.ts`）：`export type DialogProperty = 'openFile' \| 'openDirectory' \| 'multiSelections'`；`export interface DialogOpenOptions { title?: string; filters?: DialogFilter[]; multiSelect?: boolean; properties?: DialogProperty[] }`；`dialogOpen(opts: DialogOpenOptions)` 用它 | 抽出类型是为了**三处共用**（main / preload 类型 / 扩展 API），避免签名各写一份漂移 |
| H-3 | `src/api/types.ts:273-277`（扩展可见的 `showOpenDialog` 签名） | `opts?: { title?, filters?, multiSelect? }` | `opts?: DialogOpenOptions`（与 H-2 同一类型）；**返回形状不变**（`{ ok, filePaths?, canceled?, error? }`） | 目录选择与文件选择**共用 `filePaths`**（不新增返回字段），保证老扩展零感知 |
| H-4 | `src/preload/index.ts:78` | `dialogOpen: (opts) => ipcRenderer.invoke('dialog:open', opts)`（**已是直通**） | **无需改代码**；只把类型换成 H-2 的类型 | 若实现时发现 `opts` 被结构化克隆裁掉未知字段（Electron IPC 用结构化克隆，**对象字段会保留**）⇒ 需在此显式挑字段；实现时用宿主测试钉住 |
| H-5 | `src/renderer/src/core/host.ts:484` | `showOpenDialog: (opts) => window.api.dialogOpen(opts ?? {})`（**已是直通**） | **无需改** | 同上 |
| H-6 | **宿主测试（新增）** | `test/` 下**没有**任何 dialog 用例（已核实） | 新增 `test/ext-dialog.test.ts`（或等价）：① `normalizeDialogProperties` 的**表驱动**单测——不传 ⇒ `['openFile']`；`['openDirectory']` ⇒ `['openDirectory']`；`['openFile','openDirectory']` ⇒ 只 `openDirectory`；`['openDirectory','multiSelections']` ⇒ 两者都在；未知字符串被忽略；② **源码门禁**（照 `test/settings-view-wiring.test.ts:1-11` 的手法）：断言 `src/main/ext.ts` 的 handler 里**不再**出现硬编码的 `properties: ['openFile'`，而是引用归一函数；③ 断言 `filters` 在目录模式下被丢弃 | 仓库 vitest 是 `environment:'node'`（无 jsdom、不 mock Electron）⇒ **不要**尝试真正弹框；用纯函数 + 源码门禁覆盖，这与既有测试风格一致 |
| H-7 | `skills/obox-ext-dev/references/api-reference.md:439` 附近（`### dialog / shell / clipboard` 段） | `const { ok, filePaths, canceled } = await api.dialog.showOpenDialog({ filters: […], multiSelect: false })`；上下文只有"文件选择" | 追加一小节/几行：**目录选择**用法与注意点——`properties: ['openDirectory']`、**与 `openFile` 互斥**、目录模式下 `filters` 无效、返回值仍是 `filePaths`、**拿到的是外部路径 ⇒ 不能配合 `api.fs`**（与 `:500` 的既有安全边界说明一致）、**老宿主会忽略该字段（降级为文件选择）⇒ 扩展必须自证"选到的是目录"（例如交给自己的助手判定）** | AGENTS.md 强制：改宿主 `src/main/*` 与扩展 API 必须同步该文件 |
| H-8 | `skills/obox-ext-dev/references/troubleshooting.md`（现有 31 节，末节 `:424`） | 无相关条目 | **新增第 32 节**（建议标题：`扩展要选文件夹，但弹出的却是选文件框`）：症状、原因（宿主 `properties` 未透传 / obox 版本旧）、**确定性的自查方式"（看返回值是不是文件）"**、修法（升级 obox；或在扩展里做能力探测 + 降级）、以及"不要用版本号字符串判断能力"的建议 | AGENTS.md 强制：发现/修复新坑要追加该文件 |
| H-9 | obox `README.md` 的 API/能力相关段落 | 未列对话框的目录能力 | 若 README 有"扩展 API 能力"清单，则补一行"`api.dialog.showOpenDialog` 支持 `properties:['openDirectory']`" | AGENTS.md 的 README 更新要求（架构/IPC 能力变化） |

**宿主侧的验收（手工，一条命令内完成）**：

```powershell
# 装一个最小测试扩展（或在 webapp 扩展里）调用：
#   api.dialog.showOpenDialog({ title: '选目录', properties: ['openDirectory'] })
# 1) 期望：弹出的是**文件夹**选择框（不是文件框），选中后 filePaths[0] 是一个目录
# 2) 回归：不传 properties 的调用仍是**文件**框（既有行为未变）
# 3) 回归：properties: ['openFile'] + filters 仍按 filters 过滤
```

> **边界**：宿主的 `openDirectory` 只影响"弹什么框"，**不做任何路径合法性校验**；根路径的校验与安全边界**永远在扩展/助手侧**（§9.1 V1–V7、§9.7）。这条必须写进 H-7 的文档，避免后来者把宿主当校验层。

## 10. API 设计（汇总）

- **宿主侧**：**新增一个可选入参**（P0 = B）——`api.dialog.showOpenDialog({ properties: ['openDirectory'] })`；确切改动清单见 §9.11（H-1..H-9）。其余仍用既有 `api.settings.get/set/onChanged`（`src/api/types.ts:176-185`）。
- **扩展 ↔ 子窗口**：12 个方法（§9.5.3），信封与错误约定不变（`{ok,data|error}`，不抛错）。
- **扩展 ↔ 助手**：8 个既有方法各加可选 `root`（§9.5.1）+ **4 个**新方法（§9.5.2），共 12 个 RPC 方法 + `--selftest`。
- **错误码口径**：新增 **8 个** message 前缀（§9.9），`-32602` 与 `-32603` 的分派沿用 `helper.cjs:902-922` 的"按错误种类判定"方式（追加关键词）。
- **超时**：`index.js:57-65` 追加四行（R-16）。
- **兼容性契约（重要）**：扩展**不要求**宿主具备目录能力，也不做版本号判断；能力探测在扩展入口按 §7.4 进行，失败即降级。宿主侧改动是纯加法，**不需要**扩展声明任何 peer 依赖。

## 11. 数据模型与数据库变更

- **无 DDL 变更**：不新增表、不新增列、不改索引（`index.js:161-193` 的建表/索引语句**一字不改**）。
- **无数据迁移脚本**：`profileDir` 语义不变 ⇒ 存量行不需要改写。
- **新增的磁盘状态**：`<根>/.obox-webapp-root`（标记）与 `<dataDir>/.pending-move-root.json`（意图）。两者的生命周期与 schema 见 §9.3 / §9.4。

## 12. 错误处理 / 边界 / 权限（已在上文分节）

见 §9.1（校验）、§9.3（标记与各操作）、§9.7（权限与安全）、§9.9（错误码）、§9.10（边界）。

## 13. 实现决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | 根作为**可选入参**贯穿既有助手方法，**不新增**"根专属"方法族 | 避免方法分叉；不传 `root` 时行为与 1.0.2 完全一致（最小回归面） |
| D2 | `--user-data-dir` **保留相对形态**，仅在自定义根下改用绝对形态（§9.2 末） | 保住 `buildChromeArgs` 的纯函数性质与既有单测；默认根路径零变化 |
| D3 | 迁移编排放**扩展侧**（`index.js`），助手只提供"逐目录 probe/move"原语 | 助手职责是文件系统动作；编排需要读库（"哪些目录是条目"）与写意图文件（在 data 目录），这些只有扩展侧能做 |
| D4 | 意图文件放**扩展 data 目录**（`.pending-move-root.json`），不放根里 | 它必须在一个"根的切换过程中不随之移动"的中立位置 |
| D5 | 设置值**只在全部搬完后**写入（扩展侧唯一写点），且生效根在迁移未完成时恒为 `from` | 需求 R5/Q3 的硬要求；否则出现"设置说新根、数据在旧根" |
| D6 | 标记文件用于**删除/清理/改名**的门禁，**不用于**打开与量体积 | 打开是写、量体积是读；把它们也拒掉会造成"根被手工动过就永久不可用"的死局。删除才是不可逆动作 |
| D7 | 默认根**豁免**标记校验，但仍写标记 | 默认根由扩展自建且位于扩展目录内，不存在删别人数据的可能 |
| D8 | 迁移的**源根允许缺标记**（源是"只读 + 通过完整性判据后删"） | 否则"手工拷贝出来的旧根"永远搬不动；删源由 C1–C5 的完整性判据保护，风险低于"允许无标记删除" |
| D9 | 冲突策略 = **覆盖**（先删目标同名目录 → 再搬源），**但必须先经用户逐条确认**；**不备份、不合并** | **P1 = B（用户裁定）**：用户明确接受"目标目录里的登录态永久丢失且无法恢复"；确认步骤是这条不可逆动作的唯一闸门，因此**不得**做成默认/静默行为 |
| D10 | 迁移**串行逐目录**，不并行 | 进度可解释、断电可续做、磁盘不抖动 |
| D11 | `failed` 阻塞"写设置 + 删意图"，但**不阻塞**其他条目的继续尝试 | "源还在、目标不完整"时切换生效根会让用户看不到数据 |
| D12 | 放弃迁移**不删**已复制到目标的数据 | 那些目录可能正是用户想要的；删它们是不可逆动作 |
| D13 | **改宿主**：只做加法，让 `api.dialog.showOpenDialog` 支持 `properties: ['openDirectory']`（清单见 §9.11）；宿主**不做**任何根路径校验 | **P0 = B（用户裁定）**：不给用户"选目录"就会有手打路径的错漏；而校验必须留在扩展/助手侧（宿主不是安全边界） |
| D14 | 迁移中禁止改名与再次改根 | 两个 intent 指向不同根时无法对账（§9.4 互斥表） |
| D15 | 旧的"只能相对路径"条款被**取代**（§16），但助手侧"必须在生效根之内"的越界防护**不得弱化** | 放宽的是字面形态，不是边界 |
| D16 | 覆盖的**确认记录进意图文件**（`conflicts.confirmedAt/names`），续做时缺记录则**重新弹确认** | 断电续做不得继承一个不存在的用户确认（P1 = B 的唯一闸门必须每次都真实存在） |
| D17 | 覆盖只删**目标根下的同名子目录**，永不删根 | 与 §9.7 防线③一致；即使路径算错，最坏也只影响一个子目录 |
| D18 | 扩展**不做宿主版本探测**，只做"行为探测"（返回值是不是目录） | 版本号需要新增宿主 API 且不可靠；行为探测对所有宿主版本都成立（§7.4） |

## 14. 测试计划

> 测试分层沿既有三档（`docs/spec/spec.md` §18.1/§18.2/§18.3）：纯逻辑单测（`node --test`）→ helper 真子进程集成测 → 真机验收清单。**门禁（gate）类测试必须同步**，否则会出现"新方法没接线"或"版本漂移"。

### 14.1 纯函数单测（新增 `test/profileRoot.test.js`）

| # | 用例 | 断言 |
| --- | --- | --- |
| P-1 | `normalizeRoot('')` / `'   '` | `{ kind:'default', root:null }` |
| P-2 | 相对路径（`chrome`、`.\profiles`、`profiles\x`） | `kind:'invalid'` + 文案含"绝对路径" |
| P-3 | 盘符根（`C:\`、`D:/`） | `kind:'invalid'` + 文案含"磁盘根目录" |
| P-4 | obox 程序目录（以 `process.execPath` 的目录构造） | `kind:'invalid'` + 文案含"obox" |
| P-5 | 扩展 data 目录自身及其祖先 | `kind:'invalid'` + 文案含"数据目录" |
| P-6 | 正常绝对路径（含中文、含空格） | `kind:'absolute'`，尾部分隔符被去掉且结果稳定（幂等） |
| P-7 | UNC（`\\server\share\profiles`） | **P2 已闭合 = 允许** ⇒ 断言 `kind:'absolute-unc'` + 警告文案非空（用户可随时改） |
| P-8 | 标记内容生成/解析 | `createMarker()` 的字段集合**恰好**为 `{marker,extId,version,createdAt,root}`（P3 已闭合）与 `readMarker()` 的容错（非法 JSON / 缺字段 ⇒ `null`） |
| P-9 | 迁移决策纯函数 `decideMigrationItem(sourceInfo, targetInfo, from, to, confirmed)` | 覆盖输入组合 ⇒ `done` / `overwritten`（已确认覆盖）/ `skipped(未确认覆盖)` / `missing` / `move` |
| P-10 | 完整性判据 `verifyMigration(源, 目标)` | 95% 边界：`files` 恰好 95% / 94.99% / 100%；`bytes` 同；`Preferences` 或 `Cookies` 缺失 ⇒ `ok:false` + 具体原因 |
| P-11 | 状态机 `advanceMigrationState(intent, itemResult)` | 逐条推进：`pending→running→done/overwritten`；`failed` 时整体不 `done`；`abandoned` 的终态 |
| P-12 | 进度汇总 `summarize(intent)` | `total/done/overwritten/skipped/failed/missing` 与 `items` 逐条一致（`total === 各项之和`；`overwritten` **单独计数**） |
| P-13 | 路径预算 | 生效根很长时 `assertNameLength(name, { profileRoot: 长根 })` 会拒绝（复用既有函数，`test/nameSanitize.test.js:86-87` 的形态） |
| P-14 | **反向断言** | `lib/` 下不得出现第二份根解析实现（照 `test/settings.test.js:233-246` 的"防分叉"手法） |
| P-15 | **覆盖确认的纯逻辑** | `conflicts.confirmedAt === null` 或 `names` 与当前冲突集不一致 ⇒ 判定为"未确认"，`decideMigrationItem` 必须返回 `skipped`（续做复确认的纯函数落点，D16） |
| P-16 | **无备份的反向断言** | `lib/profileRoot.mjs` 里不得出现 `backup` / `.bak` / `.old` 之类"覆盖前保留一份"的实现（P1 = B） |

### 14.2 助手集成测（扩既有 `test/helper.test.js`）

| # | 用例 | 断言 |
| --- | --- | --- |
| H-1 | **默认根零变化** | 不传 `root` 时：`profileStatus`/`profileSize`/`cleanCaches`/`moveProfile`/`removeProfile` 的返回值与目录落点与 1.0.2 一致（既有 6 个用例应**全绿且不需修改**） |
| H-2 | 自定义根下的体积 | 在临时目录建自定义根 + 假 profile → `profileSize({ name, root })` 的 `bytes`/`cacheBytes` 正确、`dir` 指向自定义根 |
| H-3 | 自定义根下的清理 | `cleanCaches({ name, root })` 只删白名单目录；`Cookies` 逐字节不变（复用既有 `makeProfile` 与 `sha256` 手法，`helper.test.js:187-217`） |
| H-4 | **缺标记拒删** | 自定义根下**不写标记** → `removeProfile({ name, root })` 报 `[profile-root-unmarked]`，且目录**仍存在**（逐字节未变） |
| H-5 | **缺标记拒清理** | 同上 → `cleanCaches({ name, root })` 返回 `refused`，且 `Cache/` 目录**仍存在** |
| H-6 | **缺标记拒改名** | 同上 → `moveProfile` 报 `[profile-root-unmarked]`，源/目标都未变 |
| H-7 | 默认根豁免 | 默认根下**删除标记文件**后 → 三个动作仍**放行**（证明豁免生效） |
| H-8 | 「永不删根」 | 对根目录本身发起删除（用 `name: ''` / `name: '..'` / 一个不存在的名字）→ 全部被 `assertProfileName` / `relative()` 挡住；根目录仍在（`test/helper.test.js:353` 的既有路径防护用例扩展） |
| H-9 | `prepareRoot` 幂等 | 连续两次：第一次 `created:true, marked:true`；第二次 `created:false, marked:true`；标记内容被刷新但文件仍是一个 |
| H-10 | `migrateRootDir` 同卷（rename） | 源目录消失、目标存在且内容一致、返回值 `status:'done'` |
| H-11 | `migrateRootDir` 跨卷（模拟） | 用 `probe` + 显式 `action:'move'` 走复制路径（同卷下也可用注入的 `forceCopy` 或直接测 `verifyMigration` + 复制分支）；断言"先校验后删源"：**刻意让目标缺 `Default/Network/Cookies`** ⇒ `status:'failed'`、`reason` 含 `[migrate-verify-failed]`、**源仍在** |
| H-12 | **冲突：未确认 ⇒ 拒绝动手** | 目标已存在同名目录且 `overwrite !== true` ⇒ `status:'skipped'`、`reason` 含 `[migrate-overwrite-unconfirmed]`、**两侧内容都逐字节未变**（先记 sha256 清单） |
| H-12b | **冲突：已确认 ⇒ 覆盖** | 同上但传 `overwrite:true` ⇒ 返回 `status:'overwritten'`、`overwritten:true`、`targetRemoved:true`；目标的**旧内容已消失**、目标现在是源的内容（抽一个标记文件比对）；源目录已删 |
| H-12c | **覆盖删除失败不复制** | 让目标同名目录含只读文件（或占用）使删除失败 ⇒ `status:'failed'`、`reason` 含 `[migrate-overwrite-failed]`、`targetRemoved:false`；**源完整保留**、目标未被写入新内容（不得出现"两份混在一起"） |
| H-13 | 占用 | 目标/源含只读文件（沿用既有 `[profile-busy]` 归一手法，`docs/spec/spec.md:951`）⇒ `status:'failed'` 且不抛错（RPC 层仍 `result` 而非 `error`） |
| H-14 | `profileRootStatus` | 默认根：`isDefault:true, marked:true`；自定义根未标记：`unmanaged:true`；`entries` 只含目录、不含 `.trash` / 两个点文件 |
| H-14b | `checkRootCandidate` **纯只读** | 传一个目录 ⇒ `isDirectory:true` 且 `invalid:null`；传一个**文件** ⇒ `isDirectory:false` 且 `parent` = 其父目录；传相对路径/盘符根 ⇒ `invalid.reason` 非空；**跑完后磁盘上没有任何新增文件**（尤其**不得**写出标记文件） |
| H-15 | `--selftest` | 追加的自定义根断言全绿（退出码 0） |
| H-16 | stdout 纯净性 | 迁移日志全部在 stderr（既有 `helper.test.js:404` 的用例扩展到迁移过程） |

### 14.3 `index.js` 层（新增 `test/rootMigration.test.js`，**读源码 + 纯函数驱动**）

> 扩展入口依赖宿主 `api`，既有测试对 `index.js` 一律用"**读源码断言接线**"（`test/ipcSurface.test.js`、`test/componentSource.test.js`），本需求沿用这一手法，**不引入**宿主 mock 框架。

| # | 用例 | 断言 |
| --- | --- | --- |
| I-1 | 设置读取 | `index.js` 出现 `webapp.profileRoot`（或 `SETTING_KEYS.profileRoot`）与 `api.settings`；归一失败时**不抛错** |
| I-2 | 迁移编排 | 出现 `startRootMigration` / `resolveRootMigration` 的方法分支；出现 `.pending-move-root.json` 字面量；出现 `api.settings.set` 的**唯一写点**（写设置必须在"全部完成"分支内） |
| I-3 | 顺序与互斥 | 源码里"先处理根迁移、后处理改名 intent"的顺序可断言（对账函数的调用顺序）；迁移中改名被拒（文案字面量存在） |
| I-4 | 持久化位置 | 意图文件路径由 `api.fs`（data 目录，`D4`）写入的调用点存在；**不得**把意图文件写到根里 |
| I-5 | 卡片文案 | `WebappCard.vue` 的 `title` 已动态化（不再硬编码 `数据目录：chrome/`） |
| I-6 | **覆盖确认不可绕过** | 源码里"有冲突且未确认 ⇒ 不进入逐目录搬运"的分支可断言；`confirm-overwrite` 分支写入 `conflicts.confirmedAt` 后才允许 `overwrite:true`；**不得**出现"默认 `overwrite:true`"的写法 |
| I-7 | **无备份**（反向门禁） | `index.js` 里不得出现 `backup` / `.bak` / `copyFile` 之类"覆盖前先留一份"的路径（P1 = B） |
| I-8 | **浏览…的降级接线** | 源码里出现 `properties: ['openDirectory']`；`supported:false` 时露出手填入口（文案字面量存在）；宿主 `{ok:false}` 时**不抛错**（有 catch 或结果判定） |
| I-9 | **卸载提示文案**（P4） | 源码里存在 `卸载扩展时不会删除它`（或同义句）与 `需你自行清理` 两处字面量 |

### 14.4 门禁同步（**必须改的既有测试**）

| 文件 | 需同步的内容 | 原因 |
| --- | --- | --- |
| `test/ipcSurface.test.js:74-85` | "恰好 8 个方法"改为"恰好 12 个"（新增 4 个） | 新方法必须被分发表覆盖（正向/反向两条门禁都会红） |
| `test/ipcSurface.test.js:115-124` | `METHODS` 表静态解析新增 **4** 行后仍要求 `index.js` 都有调用点 | 新助手方法必须被接线 |
| **宿主 `test/`（obox 仓库新增）** | 见 §9.11 H-6：`test/ext-dialog.test.ts`（`normalizeDialogProperties` 表驱动 + 源码门禁断言 `ext.ts` 不再硬编码 `properties: ['openFile'`） | P0 = B 的宿主侧唯一自动化守卫；宿主 `test/` 当前无 dialog 用例 |
| `test/manifest-settings.test.js:32` | `fields.length` 从 2 改为 3 | 新增设置项 |
| `test/manifest-settings.test.js:46-49` | 键名集合加入 `webapp.profileRoot` | 同上 |
| `test/manifest-settings.test.js:55-67` | "两项都是 select"改为"两项 select + 一项 text（且 text 必须有非空 default）" | 新字段是 `text` |
| `test/manifest-settings.test.js:107-113` | `contributes` 仍只允许 `ipcChannels` + `settings` | 不得顺手加其他贡献点 |
| `test/manifest-settings.test.js:131-156` | 五处版本 → 全部 `1.0.3` | 发布门禁 |
| `test/settings.test.js:148-157` | `SETTING_KEYS` 深度相等断言加入 `profileRoot` | 键名单一来源 |
| `test/componentSource.test.js` | 新增：迁移状态行存在、**覆盖确认框**存在且文案含"永久删除且无法恢复"与逐条列名的绑定、`browseRootDir` 的降级文案存在、卡片 `title` 已动态、不得出现底部状态栏（既有断言继续） | 界面门禁 |
| `test/nameSanitize.test.js` | 无需改（`PROFILE_ROOT` 语义收窄但值不变） | — |
| `test/chromeArgs.test.js:325-327` | 既有断言保留；**新增**：`userDataDirArg(name, { rootMode:'absolute', root })` 产出绝对形态 | 两种形态都要钉住 |
| `test/helper.test.js` | 既有用例应**零修改**通过（H-1 是它的守护） | 证明默认根零回归 |

### 14.5 测试决策（seams）

| 决策 | 内容 | 理由 |
| --- | --- | --- |
| 测试 seam 选择 | ① 纯函数 seam：`lib/profileRoot.mjs`（校验/标记/迁移决策/完整性判据/状态机）；② 进程 seam：`helper.cjs` 的 RPC（真子进程，既有手法）；③ 源码 seam：`index.js` 的接线（既有手法） | 全部是**既有** seam，不新造；迁移的不可逆部分（删源）落在纯函数判据 + 进程级集成测两层 |
| 为什么不给 `index.js` 引入宿主 mock | 既有仓库对 `index.js` 一律读源码断言（`test/ipcSurface.test.js:1-16` 记录了原因），引入 mock 会与既有门禁风格分裂 | 一致性优先 |
| 真机验收的必要性 | "卸载后外部根保留"、"跨盘迁移中断续做"、"指向真实 Chrome profile 时删除被拒"、"覆盖后旧登录态真的没了"四条**必须在安装态真机**跑（调试态 id/数据目录不同，`manifest-settings.test.js` 与 README §1 都记录过这个坑） | 四条都涉及不可逆数据与真实宿主行为 |
| 宿主侧改动怎么测 | 纯函数（`normalizeDialogProperties`）+ **源码门禁**；**不**尝试在 vitest 里 mock Electron 弹框（仓库 `environment:'node'`，无 jsdom/mock 先例） | 与仓库既有测试风格一致（`test/settings-view-wiring.test.ts:1-11` 同款手法） |
| 先写的测试 | D2 形态判定（`chromeArgs`）、§9.4 完整性判据 + **覆盖确认判据**（纯函数）——它们决定了不可逆动作的守卫 | 先钉安全边界，再写编排 |

## 15. 验收标准

> 全部条目在**安装态**（`extId = webapp_chenzhi`）执行；证据写入 `extensions/webapp/docs/evidence/`（新增 `profile-root-migration.md`）。A 编号延续既有 spec 的 A1–A29，本需求从 **A30** 起。

| 编号 | 验收项 | 步骤要点 | 判据 |
| --- | --- | --- | --- |
| **A30** | **默认根零迁移（存量用户不受影响）** | 装 1.0.3，设置留空 → 打开某站点并登录 → 检查 | 目录仍在 `<data>/chrome/<名>`；**没有**出现 `.pending-move-root.json`；`probe.profileRoot` 指向默认根；界面无迁移状态行 |
| **A31** | 改根自动迁移成功（同卷） | 在 `D:\` 建空目录 → 设置 `webapp.profileRoot=D:\obox-webapp\profiles` → 等迁移完成 | `D:\obox-webapp\profiles\<名>` 存在、`Default/Network/Cookies` 存在、**再次打开仍是已登录状态**；旧根下该条目目录**已消失**；设置值 = 新根；意图文件已删除；`.obox-webapp-root` 存在 |
| **A32** | 迁移中断后续做 | 迁移进行中**杀掉 obox 进程**（或迁移前把目标盘写保护制造 `failed`）→ 重新启动 obox → 打开扩展 | 界面显示「迁移未完成：已搬 X/Y」+「继续」「放弃」；点「继续」后接着搬完；**不重复搬已完成项**（已搬目录内容未被二次覆盖） |
| **A33** | **取消覆盖 ⇒ 跳过且零改动**（P1 = B 的"另一条腿"） | 在目标根里**预先手工建**一个与某条目同名的非空目录 → 发起迁移 → 在覆盖确认框里点「取消」（或让某条目留在未确认态） | 该条目进 `skipped`（`reason='未确认覆盖'`）；目标内容**逐字节未变**（sha256 清单一致）；源仍完整；其他无冲突条目正常搬完（若用户选择继续） |
| **A34** | 缺标记拒删（核心安全用例） | 把根指向 `%LOCALAPPDATA%\Google\Chrome\User Data`（真实 Chrome profile，**无** `.obox-webapp-root`）→ 新建一条同名的 webapp 条目 → 点「删除」 | 删除**被拒绝**，提示"该目录不是本扩展管理的目录"；该目录**逐字节未变**（先记 sha256 清单再比对）；库行**不删**（因为删库行会连带目录语义，按 §9.7 的拒绝路径） |
| **A35** | 永不删根 | 在自定义根下有哪些内容都行 → 删除**全部**条目 + 清理全部缓存 | 根目录本身仍存在；`.obox-webapp-root` 仍在；根下的非条目目录与文件**未被触碰** |
| **A36** | **卸载后外部根保留**（与 A20 的默认根形成对照） | 根设为 `D:\obox-webapp\profiles` → 卸载扩展 | `<userData>/extensions/webapp_chenzhi/` 消失（含 `webapp.db`）；`D:\obox-webapp\profiles\**` **完整保留**（文件数与字节一致）；README/Release 的对照段与"外部根需自行清理"文案都在 |
| **A37** | 体积上限在自定义根下仍正确 | 根指向自定义目录 → 往 `<根>/<名>` 塞一个 > 上限的大文件 → 点「打开」 | 被拦截，模态框数字与 `du` 实测一致；「清理缓存并打开」后 Cookie 的 sha256 **不变**、白名单缓存目录消失（等价于既有 A26/A27，但根不同） |
| **A38** | 清理全部缓存（自定义根） | 在自定义根下点「清理全部缓存」 | 遍历的是**自定义根**下的条目（不是默认根）；返回 `cleaned` 与实际删除集合一致；默认根（若仍有残留目录）**未被触碰** |
| **A39** | 同名改名在自定义根下仍可用 | 在自定义根下改某条目名 | 目录在**新根内**被改名；内容一致；再次打开仍是同一登录态；`.pending-move.json` 正常创建/清理 |
| **A40** | 跨盘迁移的真实耗时与完整性 | 从 C 盘（默认根）迁到 D 盘（自定义根），用一个 GB 级 profile | 完成后文件数与字节 ≥ 源 95%、`Preferences`/`Cookies` 存在、可正常打开且登录态在；记录耗时到证据文件 |
| **A41** | 设置值只在全部搬完后写入 | 制造一个必然 `failed` 的条目（目标盘只读/磁盘满）→ 迁移 | 设置值**仍是旧根**；意图文件仍在；界面显示"迁移未完成/失败"；旧根数据完整 |
| **A42** | 「浏览…」的**降级**行为（老宿主） | 在**没有**该能力的宿主上点「浏览…」 | 弹出的是**文件**选择框；选中一个文件后候选根 = 其父目录且界面出现降级提示；取消/无返回 ⇒ **不改动任何值**；**不报错、不崩溃**；文案与实际行为一致（无夸张承诺） |
| **A43** | **冲突覆盖 + 确认框列出过它们**（P1 = B） | 在目标根预先手工建一个与条目**同名**的目录，里面放一个可识别的文件（记下内容/sha256）→ 发起改根迁移 | ① 迁移**先弹确认框**，框内**逐条列出**该目录名，且文案含"永久删除且无法恢复"；② 点「取消」⇒ **什么都没删**（目标内容 sha256 不变）、设置值仍是旧根；③ 重新发起并点「覆盖并继续」⇒ 目标里的旧文件**消失**、目标内容 = 源内容、源目录已删、`items[].status = 'overwritten'` 且界面报"覆盖 1" |
| **A44** | **改宿主后的「选目录」正路径**（P0 = B） | 在**具备 `openDirectory` 能力**的宿主上点「浏览…」→ 选 `D:\obox-webapp\profiles` | 弹出的是**文件夹**选择框；选中后候选根 = 该目录；提交后正常创建标记并迁移；宿主**回归**：不传 `properties` 的既有调用仍是文件框 |

## 16. 被本需求**取代 / 修订**的既有 spec 条款（必须显式记录）

> 归档 spec = `extensions/webapp/docs/spec/spec.md`（2021 行）。**不重写历史 amendment**；改动以**新增 amendment 文件**（`docs/spec/amendments/08-profile-root.md`）承载（§18）。

| 既有条款 | 行号 | 原文要点 | 本需求的取代/修订 |
| --- | --- | --- | --- |
| §11.2 校验第 4 条 | `docs/spec/spec.md:546` | "`--user-data-dir=` 的值必须是**相对路径**……只允许单层目录名 `chrome/<净化名>`，禁止 `..`、盘符、绝对路径（助手只允许操作自己的 profile 根）" | **被取代**：在**自定义根**下允许"绝对路径且位于生效根之内"的形态；"相对单层 `chrome/<名>`"分支**保留**。**不变的是**"助手只允许操作生效根之内的子目录"与"禁止 `..`"（§9.2 R-6、D15） |
| §11.2 契约表：`probe` 返回 | `:529` | `probe` 返回 `{ cwd, node, …, chromeCandidates }` | **修订**：`probe` 的 `profileRoot` 字段值改为**生效根的绝对路径**（字段名与形状不变，`helper.cjs:369`） |
| §11.2 契约表：`cleanCaches` 返回 | `:533` | `{ cleaned, totalFreedBytes, skipped }` | **追加可选** `refused?: string`（缺标记时的整体拒绝，不抛错） |
| §11.2 错误码表 | `:584-595` | 5 个自定义前缀 | **追加** 5 个（§9.9：`[profile-root-invalid]` / `[profile-root-create-failed]` / `[profile-root-unmarked]` / `[migrate-failed]` / `[migrate-verify-failed]`） |
| §10.4 设置页 schema | `:453-458`、`:468` | "本扩展使用的**两个**设置项（R17 全部所需，不多不少）" | **被取代**：变为**三个**设置项（新增 `webapp.profileRoot`，`text`） |
| §10.2 贡献点 | `:342-347` | "只贡献一个 App 卡片 + 一个扩展设置页" | **修订**：仍只有这两项贡献点，但设置页字段由 2 → 3 |
| §12.1 ② 与 §12.2 | `:650`、`:663` | "② `--user-data-dir=chrome/<净化后的目录名>` ← 相对助手 cwd；助手再解析成绝对路径"；"扩展侧生成的 args 里**只放相对形式**" | **被修订**：默认根下**不变**；自定义根下 args 里放**绝对形式**（§9.2 末的裁定与理由） |
| §14.1 目录布局 | `:852-863` | `data/chrome/` 是 profile 根 | **修订**：默认根不变；新增"根可由 `webapp.profileRoot` 指向扩展目录之外"的说明与标记文件 `.obox-webapp-root` |
| §14.2 创建与改名 | `:886-913` | 改名两阶段 intent `<根>/.pending-move.json` | **修订**：新增"迁移期间禁止改名；根迁移 intent 在 data 目录；先根后改名"的顺序（§9.4 互斥表） |
| §14.3 删除 | `:915-951` | 删除流程 5 步 | **修订**：第 0 步新增"缺标记且非默认根 ⇒ 拒绝"；其余步骤不变 |
| §14.5 只清缓存 | `:953-992` | 白名单 + 保留清单 + 三道防线 | **修订**：新增第 0 道"缺标记 ⇒ 整体拒绝"；白名单/保留清单/深度**逐项不变** |
| §14.4 卸载行为 | `:1058-1121` | "(a) 卸载 = 永久删除所有站点浏览器数据"；"(b) README 必须写一句话对比结论" | **被取代（限定范围）**：卸载 = 永久删除**默认根**下的数据；**外部根**下的 profile **保留在磁盘上**。§14.4(a) 的"全部 site 数据永久消失"表述必须改为**对照式**；§14.4(g-1) 的 `install` 禁令**加强**（新增"不得触碰外部根"） |
| §16 权限与安全 | `:1295` | "不接受任意路径（只允许 `chrome/<单层目录名>`）" | **被取代**：改为"只接受**生效根之内的单层目录**；生效根 ∈ {默认根, 用户配置的绝对根}"；能力边界新增"读写用户指定的扩展目录之外路径（限该根及其直接子目录）" |
| §18.1 测试计划（路径防护） | `:1424` | "`chrome/../x`、`chrome/a/b`、绝对路径、盘符 → 全部 `-32602`" | **修订**：绝对路径不再是"一律 `-32602`"——**等于 `join(生效根, 单层名)` 的绝对路径被接受**；其余绝对路径、`..`、`a/b` 仍 `-32602`（§14.2 H-8 覆盖） |
| §21.7 S9 / S10 | `:1891-1892` | "改名 intent = `chrome/.pending-move.json`"；"扩展侧只生成相对 `chrome/<名>`；助手解析为绝对路径" | **修订**：S9 追加根迁移 intent（data 目录，另一文件）；S10 追加"自定义根下改为绝对形态，默认根不变" |
| §23 验收标准（AC20 类卸载对比） | `:1948`（AC18） | "卸载后扩展目录与 `chrome/**` 永久消失" | **修订**：追加"外部根场景下 `chrome/**` 等价物保留在自定义根"的对照验收（本规格 A36） |
| §17 性能与规模约束「磁盘位置」 | `docs/spec/spec.md:1313` | "profile 落在 `%APPDATA%`（通常在 C: 盘）→ README 必须说明……并给出'手动搬迁'的说明（**不做**界面内的搬迁功能）" | **被取代**：本需求**正是**"界面内的搬迁功能"（改根 = 自动迁移）。该行的"不做界面内搬迁"必须改为"改根时自动迁移（见 amendment 08）"；"README 必须说明占 C 盘空间"的表述同时改写为"默认占 C 盘，可在设置里改到其它盘" |
| §15.2 第 5 条「数据体积提示」 | `docs/spec/spec.md:1267-1271` | "条目卡片的 `title`（悬浮）里带 `数据目录：<相对路径>`" | **修订**：改为"按生效根渲染：默认根显示相对形态 `chrome/<名>`；自定义根显示 `<根>\<名>`（根过长时中间省略）"（`src/components/WebappCard.vue:37`） |
| §16 权限与安全「数据删除边界」 | `docs/spec/spec.md:1301` | "本扩展会删用户数据的动作**只有三个**……**没有第四个**" | **被取代**：变为**四个**——追加"④ 改根迁移（`migrateRootDir` 在完整性判据通过后删除**旧根下已搬完的条目目录**）"；同时"不做自动清理"的边界**不变**（迁移只在用户改设置时发生，不是后台自动清理） |
| **宿主 `src/main/ext.ts` 的硬编码 `properties: ['openFile']`** | `src/main/ext.ts:22-31`（另见 `src/shared/types.ts:302-306`、`src/api/types.ts:273-277`、`skills/obox-ext-dev/references/api-reference.md:439`） | 对话框能力"只有选文件"（不是归档 spec 的条款，而是**宿主既有实现事实**） | **被取代（v2，P0 = B）**：改为支持可选 `properties: ['openDirectory']`，默认仍 `['openFile']`（§9.11 H-1..H-9）。这不是扩展文档条款，而是**宿主能力**的变更，必须同步 `api-reference.md:439` 附近与 `troubleshooting.md`（新增一节） |
| README §2.1 / §3 / §6.1 / §6.3 / §7 | `README.md:61-84`、`:88-96`、`:151-159`（`index.js`/`helper.cjs` 方法清单）、`:179-182`、`:203-207` | "卸载 = 永久删除"（单句）、"设置只有两项"、方法清单 8 个、"绝不动 data/"、"会删除数据的动作只有三个" | **必须改写**（§18）：卸载语义**对照化**（+ 四处文案）、新增设置项说明、方法清单加入 4 个界面方法与"「浏览…」依赖宿主选目录能力/老宿主降级"一句、新增"外部根不在 data 内，因此同步纪律不适用但也不要动它"、数据动作清单加入"迁移"（迁移会删源目录，**覆盖模式下还会删目标同名目录**） |

## 17. 用户裁定记录（**v2 已全部闭合，无待决策**）

> **本节在 v1 里是"待决策（未闭合）"清单；v2 已把用户的逐条裁定回灌如下。**所有条目现在都是**已闭合决策 + 其后果**，规格的其余章节都按它们写成。原选项集合保留（便于回看当时的取舍），**推荐列已被最终裁定覆盖**。
>
> 裁定来源：用户在本会话对 v1 的 P0–P5 逐条回答（`decision source = user-confirmed-in-current-conversation`，日期 2026-10-13）。三条"按推荐默认采纳"的条目（P2/P3/P5）**用户可随时改**——改它们只影响 §9.1 V4 / §9.3 标记内容 / §8.1–§8.2 的展示分工，不动状态机与安全边界。

### P0 = **B：改宿主，加"选目录"能力**（已闭合）

**事实（v2 复核）**：宿主的 `api.dialog.showOpenDialog` **只支持选文件**（`src/main/ext.ts:22-31` 硬编码 `properties: ['openFile']`），设置页的 `text` 字段也没有「浏览」按钮（`SettingsView.vue:641-648`）。

| 选项 | 当时的取舍 |
| --- | --- |
| A：不改宿主，用"选文件取父目录"+诚实文案 | 改动面最小，但体验一般 |
| **B（用户裁定 = B）：改宿主，为 `api.dialog.showOpenDialog` 增加 `properties: ['openDirectory']`** | 真正的目录选择；代价是改 `src/main/ext.ts` + `src/shared/types.ts` + `src/api/types.ts` + 宿主测试 + 同步 `skills/obox-ext-dev/references/*`，并走 obox 仓库分支 + PR + CI |
| C：不做任何「浏览…」 | 最小面，但需求 R8 要这个入口 |

**后果落点**：§9.11（宿主改动清单 H-1..H-9）、§7.4（正路径 + 老宿主降级 + 能力探测）、§7.6（发布顺序建议）、§16（新增"宿主 `ext.ts` 硬编码 openFile"被取代一行）、§19 票 00、验收 A42/A44。**注意**：宿主**只负责弹对框**，根的合法性校验与安全边界**仍然只在扩展/助手侧**（§9.7）。

### P1 = **B：覆盖目标、不备份**（已闭合）

| 选项 | 当时的取舍 |
| --- | --- |
| A：跳过 + 逐条列出，由用户手工处理 | 无覆盖风险，但要手工搬 |
| **B（用户裁定 = B）：覆盖目标同名目录，不备份** | 一键解决冲突；**用户明确接受"目标目录里的登录态永久丢失且无法恢复"** |
| C：合并（源内容拷进目标） | 两份 Chrome profile 合并会破坏两边登录态 |

**后果落点**：§9.4「覆盖语义的确认步骤」（**先删目标 → 再搬源**、**迁移前逐条列出冲突并要求确认**、确认文案写明不可恢复、确认记录进意图文件、续做缺记录则**重新确认**）、§9.4「冲突策略」、§9.5.2（`migrateRootDir` 的 `overwrite` 由扩展侧显式传入）、§9.9（`[migrate-overwrite-*]`）、§11 D9/D16/D17、§20 **R-9（用户已接受的风险）**、§14.1 P-9/P-15/P-16、§14.2 H-12/H-12b/H-12c、§14.3 I-6/I-7、验收 **A43**、§18（README 醒目段）。

### P2 = **允许 UNC**（已闭合，按推荐默认采纳）

| 选项 | 当时的取舍 |
| --- | --- |
| **A1（推荐，用户采纳）：允许，且照常对 UNC 发起自动迁移** | 语义统一；代价是跨网络复制可能极慢 |
| A2：允许作运行根，但拒绝对 UNC 自动迁移 | 避免最慢路径，多一条特例 |
| B：一律拒绝 UNC | 最简单，但剥夺网络盘用法 |

**后果落点**：§9.1 **V4**（`kind:'absolute-unc'` + 性能警告文案）、§9.8（UNC 行）、§21 U-4（UNC 行为未核实）、§14.1 P-7。**用户可随时改成 A2/B**（只改 V4 与文案）。

### P3 = **标记内容 `{marker,extId,version,createdAt,root}`**（已闭合，按推荐默认采纳）

| 选项 | 当时的取舍 |
| --- | --- |
| **A（推荐，用户采纳）：五字段** | 可用于识别 + 版本演进 + 排查 |
| B：只写 `{marker}` | 最小面，无演进信息 |
| C：`{marker,extId}` | 折中 |

**后果落点**：§9.3（内容行）、§14.1 P-8（字段集合**恰好**这五个）。**用户可随时改**（改内容只需同时改 `createMarker`/`readMarker` 与 P-8）。

### P3b = **A：迁移的源根允许缺标记**（已闭合）

| 选项 | 当时的取舍 |
| --- | --- |
| **A（用户裁定 = A）：源根允许缺标记**（目标根仍必须有标记）；删源由 C1–C5 完整性判据保护 | 手工拷贝出来的旧根也能搬；风险由完整性判据兜住 |
| B：源根也要求标记 | 更保守，但"手工搬过的旧根"会永久卡住 |

**后果落点**：§9.3 缺标记矩阵的「迁移的源根」行、§11 **D8**、§9.4 完整性判据 C1–C5（这是删源的唯一守卫）。

### P4 = **A：`uninstall(ctx)` 完全不触碰外部根**（已闭合）

| 选项 | 当时的取舍 |
| --- | --- |
| **A（推荐，用户裁定 = A）：钩子完全不碰外部根；README 明确"外部根下的 profile 会保留，需自行清理"** | 与宿主架构事实一致；不制造错觉 |
| B：钩子里尝试删除/搬移外部根数据 | **不可行且危险**（10s 预算 `hookBridge.ts:16`；失败后宿主照样全删 `capabilities.ts:113-118`；钩子无 `node:fs`） |
| C：卸载时询问用户 | 钩子无交互通道，不可实现 |

**后果落点**：§7.5（**四处**必须落地的文案：README / 设置项 `description` / 迁移状态区 / `uninstall` 钩子）、§9.1（`description` 已含卸载语义）、§8.2（迁移完成提示行）、§9.7（卸载禁令）、§14.3 I-9、验收 A36、§18.1 README 改写。

### P5 = **设置页静态规则 + 扩展界面动态进度**（已闭合，按推荐默认采纳）

| 选项 | 当时的取舍 |
| --- | --- |
| **A（推荐，用户采纳）：设置项 `description` 写静态规则 + 扩展界面动态显示 X/Y 与「继续/放弃」** | 设置页讲规则、界面讲状态；动态部分只有扩展界面能做 |
| B：只放扩展界面 | 用户在设置页改完根后可能完全不知情 |
| C：只放设置页 | **做不到**（静态字符串拿不到 X/Y，也没有按钮落点） |

**后果落点**：§8.1（`description` 文案）、§8.2（状态行/清单/按钮/**覆盖确认框**）、§14.4（`componentSource.test.js` 同步）。**用户可随时改**展示分工。

### 其余"待决策"的最终状态

| v1 里的项 | v2 状态 |
| --- | --- |
| 测试 seams（§14.5） | **沿用 v1 提议的三个既有 seam**（纯函数 / helper 真子进程 / `index.js` 读源码接线）+ 新增"宿主侧纯函数 + 源码门禁"；**无待决策** |
| Goal Mode | **仍 disabled**——本修订未收到用户对 v2 的重新选择；这是进入 `spec-do` 前**唯一**剩下的流程动作（不是产品决策），见 §1 与 §23 |
| 票拆分 | 见 §19：v2 增加**票 00（宿主侧）**；其余顺序不变 |

## 18. 文档同步

### 18.1 `README.md`（`extensions/webapp/README.md`，207 行）必须改写的段落

| 位置 | 现状 | 改为 |
| --- | --- | --- |
| 第 4 行（能力介绍） | "每个连接使用**独立的 Chrome profile**，并可限制单个站点的浏览器数据体积" | 追加"**profile 存放位置可配置**（默认在扩展数据目录内；可指向其它磁盘，改位置时自动迁移已有数据）" |
| `:39`（使用表「打开」行） | `profile 落在 <扩展目录>/data/chrome/<name 净化后>` | 改为"默认落在 `<扩展目录>/data/chrome/<名>`；若在设置里配置了根目录，则落在 `<根>\<名>`" |
| `:61-68`（§2.1 升级/卸载对照表） | 卸载 = "❌ **永久删除**（整个扩展目录被递归删除，含所有站点 profile 与登录态）" | **改为对照式**：卸载 → 默认根下的数据**永久删除**；**自定义根下的 profile 保留在磁盘上，需自行清理**（附清理命令模板）。保留"为什么卸载无法保留（宿主递归删除扩展目录）"的机制说明 |
| `:70-84`（卸载前备份） | 备份整个 `data` 目录 | 追加一句：**若使用自定义根，`data/` 里没有 profile**，备份必须**同时**覆盖 `data/`（条目库）与**自定义根**（两者缺一不可）；并给一条把两个位置一起备份/校验的可复制命令 |
| `:88-96`（§3 设置） | 两个 `select` | 追加第三行 `webapp.profileRoot`（类型 text、默认空、语义、校验拒绝情形、"迁移未完成时不生效"） |
| `:99-110`（§4 已知行为） | 6 条 | 追加：⑦ 改根会**自动迁移**存量数据，逐目录进行、可中断续做、冲突跳过；⑧ 根缺标记时**删除/清理/改名被拒**（打开与查体积仍可用）；⑨ 迁移期间**改名与再次改根被拒**；⑩ UNC/移动盘上打开变慢或失败属预期 |
| `:151-159`（§6.1 目录结构） | `index.js` 的方法清单写的是 `list/save/remove/open/probe/profileSize/cleanCaches`；`helper.cjs` 的方法描述 | 更新为 12 个界面方法（+ `rootStatus`/`startRootMigration`/`resolveRootMigration`/`browseRootDir`）与 11 个助手方法（+ `profileRootStatus`/`prepareRoot`/`migrateRootDir`）；`lib/` 下新增 `profileRoot.mjs` 一行说明 |
| `:179-182`（§6.3 同步纪律） | "只覆盖五类分发文件；**绝不动 `data/`**" | 追加：**同样不要动你在设置里配置的自定义根**（它不在扩展目录内，因此同步命令不会碰到它，但用户手工 `robocopy /MIR` 之类会波及） |
| `:203-207`（§7 安全说明） | "会删除数据的动作只有三个：删除连接、清理缓存、卸载扩展" | **改为四个**：追加"**改根迁移**（迁移成功后会删除**旧根下已搬完的条目目录**；**覆盖模式下还会先删除目标根下的同名目录**（删源与删目标都需用户先确认、删源前经过完整性校验））"；并新增一条"**新增能力面**：自定义根下会读写扩展目录之外的路径（限该根及其直接子目录）；根缺少标记文件时删除/清理被拒绝；**任何情况下不删除根目录本身**" |
| 新增小节（建议放 §2 之后，标题含"迁移"） | 无 | "配置浏览器数据根目录（迁移语义）"：如何配置（可用「浏览…」选目录，**依赖 obox 的选目录能力**；老版本请手工粘贴路径）、迁移是自动的、**冲突时会被逐条列出并要求确认（确认后目标里的旧登录态永久丢失）**、中断续做、如何放弃、以及"外部根需自行清理"的对照句 |
| 新增一行（§1 安装/依赖 或 §4 已知行为） | 无 | "**选目录需要 obox 具备对话框目录能力**；没有该能力的版本上，「浏览…」会退回'选择任意文件、用其上级目录'并给出提示——这是预期行为，不是故障"（与 §9.11 H-8 的 troubleshooting 条目互相呼应） |

### 18.2 `docs/spec/spec.md` 的追加/修订方式

- **不重写历史 amendment**（`docs/spec/amendments/01–07` 一律不动）。
- **新增** `docs/spec/amendments/08-profile-root.md`（本需求在 webapp 仓库内的 amendment 记录），内容至少：
  - Amendment ID/标题、日期、来源（本 spec 的路径 + 阶段 1 requirements 路径）、读过的产物路径、更新的 canonical 路径；
  - **§16 的取代/修订清单逐条落位**（含被取代条款的行号；除 §16 表格里的行号外，还须覆盖 `docs/spec/spec.md:1267-1271`（§15.2 第 5 条卡片 `title`）、`:1301`（§16 数据删除边界由三个变四个）、`:1313`（§17 磁盘位置"不做界面内搬迁"被取代））；
  - 新的规格章节：设置项契约（§9.1）、根解析改造点（§9.2）、标记文件（§9.3）、迁移状态机（§9.4，**含覆盖语义的确认步骤**）、方法契约变更（§9.5，**4 个新助手方法**）、数据语义（§9.6）、权限与安全（§9.7）、错误码（§9.9，**8 个前缀**）、**宿主侧改动清单（§9.11）**；
  - 新增验收 **A30–A44** 与新增测试清单（§14，含宿主 `test/ext-dialog.test.ts`）；
  - 票/依赖变更（见 §19，**新增宿主侧票 00**）；
  - 实现状态影响：**未开始**（本需求尚无实现）；Goal Mode：**disabled**（本修订未获用户对 v2 的重新选择）；
  - 开放问题：**无产品/数据级开放项**（P0–P5 已闭合，§17）；剩下的是 §21 的**未核实项**（尤其 U-5 `api.fs` 点文件，实施前必须核实）。
- `docs/spec/spec.md` **本身**：按 amendment 的落位在对应章节追加"见 amendment 08"的指引行（最小侵入），**不**大段改写正文——保持"最新 canonical + 只追加 amendment 日志"的既有约定（`docs/spec/amendments/01–07` 已是这个模式）。
- `docs/spec/requirements.md`（归档的旧需求文档）**不改写**：它是历史产物，新需求的权威结论在 obox 的 `.spec-workflow/webapp-profile-root/requirements.md`。

### 18.3 `docs/evidence/` 需要补的证据

| 文件 | 内容 |
| --- | --- |
| `docs/evidence/profile-root-migration.md`（新增） | **A30–A44** 的逐条证据：命令、输出、sha256 摘要、耗时、截图要点；尤其：**A34 的"真实 Chrome profile 逐字节未变"**、**A36 的"卸载后外部根完整保留"**、**A43 的"覆盖前确认框列出过冲突项 + 取消时零删除 + 确认后旧数据确实消失"**、**A44 的"宿主选目录正路径 + 既有文件框未回归"**；另需记录 **U-5 的三步探测结果**（`api.fs` 能否写点文件） |
| `docs/evidence/gates-and-probe.md`（既有） | 追加一行：新增的 `test/profileRoot.test.js` / `rootMigration.test.js` 的门禁运行输出；**宿主侧**另记 `test/ext-dialog.test.ts` 的输出（若宿主补丁已合并） |
| `docs/evidence/` 其他 | 若迁移在真机上有"跨盘耗时"数据，单独附一张耗时表（A40）；覆盖路径（A43）的删除耗时也一并记（可能数万文件） |

## 19. 推荐实施顺序

> **票拆分未持久化**（skill 要求"呈现后再落盘"，需用户确认拆分）。**§17 的 P0–P5 已全部闭合**，因此拆分本身已无产品阻塞；确认拆分后按 `.spec-workflow/webapp-profile-root/issues/NN-<slug>.md` 逐个落盘。

| 票 | 标题 | Blocked by | 交付物（可独立验证） |
| --- | --- | --- | --- |
| **00（v2 新增，宿主侧）** | **宿主：`api.dialog.showOpenDialog` 支持 `properties: ['openDirectory']`** | —（可立即开始） | §9.11 的 H-1..H-9：`src/main/ext.ts` 的归一函数 + 类型抽取 + 宿主新测试 `test/ext-dialog.test.ts` + `api-reference.md`/`troubleshooting.md` 同步。**仓库 = obox**，走 `feat/xxx` 分支 + PR + CI + `security:audit`；**是否发宿主版由用户定**（§7.6） |
| **01** | 根解析纯模块与形态判定（prefactor） | —（可立即开始） | `lib/profileRoot.mjs`（校验/归一/标记/**迁移决策与完整性判据**/路径预算）+ `lib/chromeArgs.mjs` 的 `rootMode` + `test/profileRoot.test.js` P-1..P-16；`test/chromeArgs.test.js` 两种形态断言 |
| **02** | 助手接受生效根 + 标记门禁 | 01 | `helper.cjs` 的 `resolveRoot`/`profilePath(root)`/8 个方法的可选 `root` + 三处缺标记拒绝；`test/helper.test.js` H-1..H-9（默认根零回归是硬门槛） |
| **03** | 迁移原语（逐目录 probe/move + **覆盖删除** + 完整性判据 + 候选根判定） | 01, 02 | `helper.cjs` 的 `profileRootStatus`/`prepareRoot`/`checkRootCandidate`/`migrateRootDir` + H-10..H-16（含 H-12/H-12b/H-12c 覆盖三态、H-14b 只读性） |
| **04** | 扩展侧设置读取与迁移编排（含**覆盖确认**闸门） | 03 | `index.js` 的 `readSettings` 扩展、`rootStatus`/`startRootMigration`/`resolveRootMigration`/`browseRootDir` 四个方法、意图文件读写（含 `conflicts` 确认记录）、设置唯一写点、顺序与互斥；`test/rootMigration.test.js` I-1..I-9；门禁同步（`ipcSurface`） |
| **05** | 界面（设置项、状态行、**覆盖确认框**、浏览按钮+降级、卡片文案） | 04（「浏览…」的**正路径**验还需票 00 已合并进宿主构建） | `manifest.json` 第三个字段；`App.vue` 状态行/按钮/确认框/手填降级入口；`WebappCard.vue` 动态 `title`；`test/componentSource.test.js` 新断言；`manifest-settings.test.js` 同步 |
| **06** | 文档与发布 1.0.3 | 05（宿主是否发版见 §7.6） | README 改写（§18.1）；`docs/spec/amendments/08-profile-root.md`；`docs/evidence/profile-root-migration.md`（A30–A44 真机）；五处版本 → 1.0.3；tag `v1.0.3` + release 附 `webapp-1.0.3.oix` |

**无阻塞前沿（当前）**：**票 00** 与 **票 01** 可**并行立即开始**（分属两个仓库、无依赖）。票 05 的「浏览…」正路径验收（A44）需要票 00 已合并进宿主构建；**除此之外**扩展侧全部工作不依赖宿主改动（老宿主走降级路径，A42 覆盖）。

## 20. 风险与回退

| 风险 | 缓解 | 回退 |
| --- | --- | --- |
| R-1 指向真实 Chrome profile 后误删 | 标记文件 + 缺标记拒删 + 永不删根（三道防线，§9.7）；验收 A34 用**逐字节比对**证明未动 | 无自动回退（删了就没了）⇒ 因此默认**拒绝**，宁可少一个功能 |
| R-2 跨盘迁移慢/中断 | 逐目录 + 可恢复 intent + 完整性判据（先校验后删源）；A32/A41 | 放弃迁移（`abandon`）；已复制到目标的数据**保留**，源**不删**（只有通过完整性判据的条目才删源） |
| R-3 卸载语义文档冲突 | README/Release **对照式**改写（§18.1）；验收 A36 | 文档回退（把对照句改回单句"永久删除"）——但这会与外部根事实矛盾，因此不允许 |
| R-4 ~~`api.dialog` 无目录选择~~（v2 已解决） | **P0 = B 已闭合**：宿主加 `openDirectory` 透传（§9.11）；扩展侧**仍有**老宿主降级路径（§7.4）与只读探测（A42） | 降级路径本身就是回退：老宿主/失败 ⇒ 手填路径。若宿主补丁因故不发（用户决定），扩展仍可用（A42），只是没有系统目录选择框 |
| **R-9（实现层，★用户已接受的不可逆风险）** | **覆盖目标同名目录会永久删除那里的浏览器数据（含登录态），不可恢复** | **唯一闸门**是迁移前的**逐条确认框**（§9.4）；确认记录进意图文件、续做缺记录则重新确认（D16）；只删**目标根下的同名子目录**、永不删根（D17）；`overwritten` 单独计数并逐条展示；README 醒目段 + §18.1 | **无技术回退**（删了就没了）。可做的只有：`abandon`（保留旧根与已复制到目标的数据）；**不得**提供"默认覆盖"或"跳过确认"的开关（P1 = B 明确不备份，但**没有**授权静默覆盖） |
| R-10（实现层，宿主侧）宿主 `properties` 归一写错 ⇒ **既有文件选择行为回归** | 默认值 `['openFile']` 写成常量；表驱动单测 + 源码门禁（§9.11 H-6）；`openFile`/`openDirectory` 互斥规则单测 | 宿主侧改动是**独立提交**（票 00），出问题可单独 revert，不影响扩展发布 |
| R-5（实现层）迁移期间用户继续打开站点 → 源侧文件被 Chrome 改动 → 完整性判据抖动 | 阈值 95%（C2/C3）容忍少量抖动；被占用条目走"待续做"（R7）；文档建议迁移前关闭该站点的窗口 | 该条目 `failed`，源保留，`abandon` 或关窗后「继续」 |
| R-6（实现层）两处 intent 同时存在导致对账错乱 | 顺序（先根后改名）+ 互斥（迁移中禁止改名/再次改根）（D14） | 人工删除 `<dataDir>/.pending-move-root.json`（文档给出路径与后果） |
| R-7（实现层）默认根回归 | 票 02 的 H-1 把"默认根行为逐项不变"做成硬门槛；`root` 是**可选**入参 | 回退 `helper.cjs` 至 `v1.0.2` 的实现 |
| R-8（实现层）长根路径触及 Windows `MAX_PATH` | 名称预算按生效根长度计算（§9.10 第 6 条）；REJECT 过长根时给明确文案 | 缩短根路径 |

## 21. 需要进一步核实 / 未核实清单

| # | 项 | 状态 | 查法 |
| --- | --- | --- | --- |
| U-1 | `api.dialog.showOpenDialog` 在**子窗口聚焦时**弹框的归属窗口（`BrowserWindow.getFocusedWindow()`，`src/main/ext.ts:20`） | **未核实**（只核到"只支持 openFile"） | 真机：在 webapp 子窗口点「浏览…」，观察对话框是否正常弹出/是否挂到主窗口 |
| U-2 | 迁移中 `fs.rename` 跨卷时的具体 errno（`EXDEV`）与 Node 版本行为 | **未核实**（`helper.cjs` 现有代码只处理同卷 rename 的失败） | 真机：C→D 迁移时抓 `migrateRootDir` 的失败分支日志；单测可用"同卷 + 人为让 rename 失败"覆盖判据 |
| U-3 | 95% 阈值在真实 Chrome 会话下的抖动幅度 | **未核实**（阈值来自需求，未实测） | A40 真机：记录 `sourceFiles/Bytes` 与 `targetFiles/Bytes` 的实际差异 |
| U-4 | UNC 路径下 `mkdirSync`/`copyFile` 的行为与失败码 | **未核实** | 真机：指一个可用的 `\\server\share\...`，跑 `prepareRoot` + 一次小条目迁移 |
| U-5 | 宿主 `api.fs` 能否写 `<dataDir>/.pending-move-root.json`（相对路径 `.pending-move-root.json`） | **实施前必须核实**（`api.fs` 明确限定在 data 目录内，`api-reference.md:481-500`；**点文件是否被规则排除未查**） | **查法（票 04 的第一步，一条命令内）**：在扩展入口执行 `await api.fs.writeFile('.pending-move-root.json.tmp-probe', '{}')` → 再 `api.fs.exists(…)` → 再 `api.fs.remove(…)`，把三步结果记进 `docs/evidence/profile-root-migration.md`；同时用 `api.fs.readFile` 回读确认内容可读。**若不支持（抛错/被拒）的应对**：把"读写意图文件"下沉到**助手侧**——新增 `readRootIntent` / `writeRootIntent` / `clearRootIntent` 三个方法（写入仍限 `<dataDir>` 内，路径由助手用 `join(process.cwd(), …)` 拼），扩展侧改为经 `api.ipc` 调用；此时必须**追加一条 amendment**（`docs/spec/amendments/09-root-intent-in-helper.md` 之类）并同步 §9.5.2 的方法表、§14 的测试与 §19 的票 04 范围。**禁止**的替代做法：把意图文件写到根里（根会移动 ⇒ 中立性丢失）、写到设置项里（设置存储不适合放结构化状态）、或干脆不做续做 |
| U-5b | 宿主 IPC 的结构化克隆是否会保留 `opts.properties` 数组（`src/preload/index.ts:78` 直通） | **未核实**（理论上对象字段会保留） | 票 00 的宿主测试：断言 `dialog:open` handler 收到的 `opts.properties` 与传入一致（纯函数层即可，不必真弹框） |
| U-6 | `webapp.profileRoot` 被宿主写入后，`api.settings.get` 返回的是否为字符串（text 字段） | **部分核实**：`onFieldChange` 传的是 `HTMLInputElement.value`（字符串，`SettingsView.vue:647`） | 实现时打一条日志确认；归一逻辑已按"可能是任意类型"写（`String(v ?? '')`） |
| U-7 | 迁移期间「打开」被允许会导致源侧被写入（R-5） | **设计上已承认**，未实测抖动幅度 | A32/A40 的实操观察 |

## 22. 覆盖对照（需求 → 本规格落点）

| 需求/规则 | 落点 |
| --- | --- |
| **R1 设置项** | §9.1（键名/类型/默认/描述文案）、§8.1、§18.1 README §3 |
| **R2 路径解析** | §9.2（R-1..R-27 改造点 + 形态裁定）、§9.5.1（入参加 `root`） |
| **R3 安全标记** | §9.3（路径/内容/时机/各操作矩阵/默认根豁免/**源根豁免（P3b）**）、§9.9（`[profile-root-unmarked]`） |
| **R4 永不删根** | §9.3（只删根下子目录）、§9.7 防线③、§11 D17、§14.2 H-8、A35 |
| **R5 自动迁移** | §9.4（schema/流转/完整性判据/续做/放弃/覆盖确认）、§9.5.2（四个助手方法）、A31/A32/A41 |
| **R6 冲突策略** | §9.4「冲突策略」（**P1 = B：覆盖 + 逐条确认**）、§9.4「覆盖语义的确认步骤」、A33/A43 |
| **R7 占用处理** | §9.4「占用处理」（复用既有 rename/删除失败判据）、A32 |
| **R8 界面** | §7.4（浏览…正路径 + 降级）、§8.2（状态行/清单/按钮/**覆盖确认框**/卡片 title）、A42/A44 |
| **R9 文档** | §18（README/spec amendment/evidence） |
| **P0 = B（改宿主）** | §9.11（H-1..H-9 宿主改动清单）、§7.4（正路径+降级+探测）、§7.6（发布顺序）、§11 D13/D18、§16（宿主 `openFile` 硬编码被取代）、§19 票 00、A44 |
| **P1 = B（覆盖、不备份）** | §9.4「覆盖语义的确认步骤」、§9.5.2（`overwrite` 由扩展侧传）、§9.9（`[migrate-overwrite-*]`）、§11 D9/D16/D17、§20 R-9、§14 P-9/P-15/P-16、H-12/H-12b/H-12c、I-6/I-7、A43 |
| **P2 = 允许 UNC**（默认，可改） | §9.1 V4、§9.8、§14 P-7、§21 U-4 |
| **P3 = 五字段标记**（默认，可改） | §9.3 内容行、§14 P-8 |
| **P3b = A（源根允许缺标记）** | §9.3 缺标记矩阵「迁移的源根」、§11 D8、§9.4 C1–C5 |
| **P4 = A（不碰外部根）** | §7.5（四处文案）、§9.1 `description`、§8.2 迁移完成提示、§9.7 卸载禁令、I-9、A36 |
| **P5 = 静态规则 + 动态进度**（默认，可改） | §8.1、§8.2、§14.4 |
| 业务规则：绝对路径 | §9.1 V2 |
| 业务规则：拒盘符根/obox 目录 | §9.1 V3/V5 |
| 业务规则：根不存在可创建 | §9.1 V7、§9.3 |
| 业务规则：完整性判据 | §9.4 C1–C5 |
| 业务规则：默认根缺标记视为受管 | §9.3「默认根天然可信的例外」 |
| 业务规则：**迁移源根缺标记也放行** | §9.3 矩阵、§11 D8、§17 P3b |
| 业务规则：**目标根必须有标记** | §9.3 矩阵、§9.4 执行顺序 |
| 覆盖语义：**先删目标 → 再搬源，且必须先确认** | §9.4「覆盖语义的确认步骤」、A43 |
| 数据语义：根不入库 | §9.6 |
| 数据语义：两 intent 顺序 | §9.4「互斥」 |
| 权限/安全：新增能力面 | §9.7 |
| 权限/安全：**宿主不做校验，校验只在扩展/助手侧** | §9.11 末尾、§9.7 |
| 异常1 指向真实 Chrome profile | §9.3 缺标记矩阵、A34 |
| 异常2 可移动盘/UNC 不可用 | §9.10 第 4 条、§9.8、P2 |
| 异常3 迁移中途磁盘满/断电 | §9.4 续做、§9.10 第 7 条 |
| 异常4 迁移时 Chrome 开着 | §9.4 占用处理、§9.10 第 12 条 |
| 异常5 根被手工删除 | §9.3 创建时机②、§9.10 第 5 条 |
| 异常6 **老宿主点「浏览…」**（P0 = B 的新边界） | §7.4 降级表、§9.10 第 13 条、A42 |
| 风险 R-1 | §9.7 三道防线、§20 R-1、A34 |
| 风险 R-2 | §9.4 完整性判据、§20 R-2 |
| 风险 R-3 | §7.5、§18.1、A36 |
| 风险 R-4（v2 转为"降级+回退"） | §7.4、§9.11、§20 R-4 |
| 风险 R-9（**用户已接受**：覆盖不可逆） | §9.4、§20 R-9、A43、§18.1 README 醒目段 |
| 风险 R-10（宿主文件框回归） | §9.11 H-6、§20 R-10 |

## 23. 参考与后续

- 阶段 1（权威需求）：`.spec-workflow/webapp-profile-root/requirements.md`
- 归档规格与历史决策：`extensions/webapp/docs/spec/spec.md`（§10.2/§10.4/§11.1/§11.2/§12.1/§14.1–§14.6/§15/§16/§17/§18/§21.7/§23）、`docs/spec/amendments/01–07`
- 评审报告（数据安全相关结论的来源）：`extensions/webapp/docs/review/review-report.md`（DR-017 的备份命令缺陷）
- 扩展侧宿主事实：`src/api/contributions.ts:73-89`、`src/api/types.ts:176-185`、`src/renderer/src/extensions/settings/SettingsView.vue:302-304,641-648`、`src/main/capabilities.ts:96-118`、`src/main/hookBridge.ts:16`
- **宿主侧（P0 = B）事实与落点**：`src/main/ext.ts:9-36`（硬编码 `properties`）、`src/shared/types.ts:302-306`（内联签名）、`src/api/types.ts:273-277`（扩展可见签名）、`src/preload/index.ts:78`（直通）、`src/renderer/src/core/host.ts:484`（直通）、`test/` 无 dialog 用例、`skills/obox-ext-dev/references/api-reference.md:439`、`skills/obox-ext-dev/references/troubleshooting.md`（现有 31 节）
- **下一步（唯一动作）**：请用户为 **本 v2 修订**选择 Goal Mode（启用/不启用）。**这是流程动作，不是产品决策**——§17 的 P0–P5 已全部闭合，规格本身**已具备进入 `spec-do` 的条件**。
- `spec-do` 的入口顺序建议：**票 00（宿主，obox 仓库）与票 01（扩展，webapp 仓库）并行**；票 00 是否发宿主版本由用户定（§7.6）。本轮**不生成** `issues/` 文件（票拆分待用户确认后再逐个落盘）。

## 24. v2 修订记录（append-only）

| 项 | 内容 |
| --- | --- |
| Amendment ID / 标题 | **v2 —— 用户逐条裁定 P0–P5 后回灌（含 P0 = B 的宿主能力）** |
| 日期 | 2026-10-13 |
| 来源 | 用户在本会话对 v1 §17 的逐条回答（`decision source = user-confirmed-in-current-conversation`） |
| 修订类型 | ① **契约变更**（P0 = B：新增宿主能力 + 4 个助手方法 + 方法入参）；② **行为变更**（P1 = B：冲突策略由"跳过"改为"确认后覆盖"）；③ **范围微调**（P3b/P4 的闭合把"待决策"变成硬规则）；④ 记录性（P2/P3/P5 按推荐默认采纳） |
| 读过的产物 | v1（本文件）、`.spec-workflow/webapp-profile-root/requirements.md`、`extensions/webapp/docs/spec/spec.md`（§10.2/§10.4/§11.2/§12.1/§14/§15.2/§16/§17/§21.7/§23）、`docs/spec/amendments/01–07`、宿主侧 `src/main/ext.ts` / `src/shared/types.ts` / `src/api/types.ts` / `src/preload/index.ts` / `src/renderer/src/core/host.ts` / `test/`、`skills/obox-ext-dev/references/{api-reference.md,troubleshooting.md}`、`extensions/webapp/README.md` |
| 更新的 canonical 产物 | **仅** `.spec-workflow/webapp-profile-root/spec.md`（本文件）。**未**创建/修改 `issues/`（票拆分待确认）、**未**写 `extensions/**`、**未**做任何 git 操作 |
| 规格变更摘要 | ① §1 Goal Mode 元数据（v2 锚点 + 暂停条件改写）；② §5.3 非目标（"不改宿主"改为"只做 `openDirectory` 加法"、"不做合并"）；③ §4 解决方案、§6 用户故事（+19–22）、§7.1/§7.3 流程图（覆盖确认 + 续做复确认）；④ **§7.4 重写**（宿主选目录正路径 + 老宿主降级表 + 能力探测 + 为什么落到助手判定）；⑤ **§7.6 新增**（宿主能力与发布顺序建议）；⑥ §7.5 卸载文案扩为四处；⑦ §8.1 `description` 增卸载语义；⑧ §8.2 新增覆盖确认框/手填降级入口/卸载提示行；⑨ §9.1 V4（UNC 允许）、`description`；⑩ §9.3 矩阵（P3b、`checkRootCandidate`）；⑪ **§9.4 覆盖语义确认步骤 + schema 增 `conflicts`/`overwrite`/`overwritten` + 状态流转 + 冲突策略表 + 展示**；⑫ **§9.5.2 增第 4 个方法 `checkRootCandidate`**、`migrateRootDir` 增 `overwrite`；⑬ §9.5.3 四方法的入参/返回（覆盖确认、降级字段）；⑭ §9.8 增覆盖删除成本；⑮ §9.9 增 3 个前缀（共 8 个）；⑯ §9.10 增边界 11–13；⑰ **§9.11 新增（H-1..H-9 宿主改动清单）**；⑱ §10 API 汇总（宿主新增入参、12 个助手方法）；⑲ §11 决策表（D9/D13 改判 + D16/D17/D18 新增）；⑳ §14 测试（P-15/P-16、H-12/H-12b/H-12c、H-14b、I-6..I-9、宿主 `test/ext-dialog.test.ts`、seams 增宿主层）；㉑ §15 验收增 **A43/A44**（A42 改为"老宿主降级"）；㉒ §16 取代清单增"宿主 `openFile` 硬编码 + README 行"；㉓ **§17 由"待决策"改为"用户裁定记录"（全部闭合）**；㉔ §18.1/§18.2/§18.3 同步；㉕ §19 增票 00、frontier 改为票 00/01 并行；㉖ §20 增 R-9（用户已接受）/R-10，R-4 改判；㉗ §21 增 U-5b，U-5 补三件套；㉘ §22 覆盖对照增 P0–P5 行与异常 6 |
| 票变更 | **新增票 00（宿主侧，obox 仓库）**，与票 01 并行；票 03 范围含覆盖删除与 `checkRootCandidate`；票 04 范围含覆盖确认闸门与意图文件 `conflicts`；票 05 依赖票 00 才能验 A44 正路径；票 06 的验收范围扩到 A44。**未落盘**（待用户确认拆分） |
| 依赖变更 | 无外部依赖；**新增跨仓库协作**：票 05 的 A44 依赖票 00 合并进宿主构建（其余扩展侧工作不依赖） |
| 测试决策变更 | 新增第 4 个 seam：**宿主侧纯函数 + 源码门禁**（`test/ext-dialog.test.ts`），因为宿主 `test/` 原本没有 dialog 用例；其余三个既有 seam 不变 |
| 实现状态影响 | **未开始** ⇒ 票 00/01 可直接开始（无阻塞） |
| Goal Mode 影响 | **disabled**（本修订**未**收到用户对 v2 的重新选择）。按 skill 要求，每次修订都要用户重新选择一次；**这是进入 `spec-do` 前唯一剩下的流程动作**，不影响规格的技术完备性 |
| 开放问题与已接受风险 | 开放产品/数据决策：**无**。已接受风险：**R-9（覆盖会永久删除目标目录里的登录态，用户明确接受、无备份）**、R-1（指向真实 Chrome profile 的误删风险，由三道防线兜住）。未核实项见 §21（U-1..U-7、U-5b），其中 **U-5 必须在实施前核实** |
