# Amendment 08 —— 可配置的 profile 根目录（`--user-data-dir` 根）+ 自动迁移 + 三道数据安全防线

- **Amendment ID / 标题**：`08-profile-root` —— webapp 扩展的 profile 根可配置（`webapp.profileRoot`）、
  改根自动迁移（可中断续做 + 覆盖确认）、三道数据安全防线、卸载语义对照化。
- **日期**：2026-10-13
- **版本**：`1.0.2` → **`1.0.3`**（五处一致：`manifest.json` / `package.json` /
  `package-lock.json` 顶层 / `package-lock.json packages[""]` / `index.js` 的 `EXT_VERSION`）
- **来源**：
  - 需求研究（阶段 1）：`.spec-workflow/webapp-profile-root/requirements.md`（obox 仓库，未跟踪）
  - 实现规格（阶段 2，**v2**）：`.spec-workflow/webapp-profile-root/spec.md`（1101 行；§9 设计主体、§23 票与前沿、§24 v2 修订记录）
  - 用户裁定：spec §17 的 **P0–P5 全部闭合**（P0 = B 改宿主加选目录能力、P1 = B 覆盖不备份、
    P2 = 允许 UNC、P3 = 五字段标记、P3b = 源根允许缺标记、P4 = `uninstall` 不触碰外部根、
    P5 = 设置页静态规则 + 界面动态进度）
  - 宿主侧契约（已合并进 obox master `703d6d0`，未发版）：`api.dialog.showOpenDialog` 支持
    `properties: ['openDirectory']`；本 amendment 按该契约实现降级路径（见 §8）
- **读过的产物**：本文件同目录的 `01`–`07`（不改写历史）、`../spec.md`（2021 行的归档规格）、
  `../requirements.md`、`../../review/review-report.md`、`README.md`、`test/**`、
  obox 侧 `src/api/types.ts` / `src/main/fs.ts` / `src/main/sqliteCore.ts` /
  `skills/obox-ext-dev/references/api-reference.md`
- **更新的 canonical 路径**：
  - `lib/profileRoot.mjs`（**新增**：根校验 / 标记 / 迁移决策 / 完整性判据 / 状态机，单一实现）
  - `helper.cjs`（8 个既有方法加可选 `root`；**4 个新方法**；缺标记门禁；`--selftest` 扩容）
  - `index.js`（第三个设置项；**4 个新界面方法**；迁移编排与唯一写设置点；`uninstall` 文案与禁令）
  - `lib/chromeArgs.mjs`（`--user-data-dir` 的两种形态）、`lib/nameSanitize.mjs`（语义注释）、
    `lib/profileLimit.mjs`（`SETTING_KEYS.profileRoot`）
  - `manifest.json`（第三个设置项 + `version`）、`src/App.vue`、`src/components/ConfirmOverwrite.vue`（**新增**）、
    `src/components/WebappCard.vue`、`src/styles.css`、`scripts/pack.mjs`
  - `test/profileRoot.test.js`（**新增**）、`test/rootMigration.test.js`（**新增**）、
    `test/helper.test.js`、`test/ipcSurface.test.js`、`test/manifest-settings.test.js`、
    `test/settings.test.js`、`test/chromeArgs.test.js`、`test/componentSource.test.js`、`test/pack.test.js`
  - `README.md`（§1/§2/§2.1/§3/§3.1/§4/§6.1/§6.2/§6.3/§6.5/§7）
  - `docs/evidence/profile-root-migration.md`（**新增**）、`docs/evidence/gates-and-probe.md`（追加）
- **实现状态**：**已实现**（本 amendment 与实现同一提交；真机验收 A30–A44 待跑，见证据文件）

---

## 1. 一句话结论

profile 根从"硬编码 `<扩展 data>/chrome`"变成**可在设置里配置的绝对路径**（默认留空 = 现状），
改根时**自动迁移**存量站点目录（逐目录、可中断续做、冲突必须逐条确认后才覆盖），
并用**路径校验 + 标记文件 + 永不删根**三道防线保证"删除 / 清理 / 改名"的能力**不因根可配置而扩大**；
卸载语义改为**对照式**：默认根随卸载永久删除，**外部根保留在磁盘上、需自行清理**。

---

## 2. 被取代 / 修订的既有条款（逐条落位，**行号指 `docs/spec/spec.md` 修订前**）

| #   | 既有条款                          | 行号                                                                                                              | 原文要点                                                                                                        | 本 amendment 的取代/修订                                                                                                                                                                                                                                      | 落点                                                                                  |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | §11.2 校验第 4 条                 | `:546`                                                                                                            | "`--user-data-dir=` 必须是**相对路径**……只允许单层目录名 `chrome/<净化名>`，禁止 `..`、盘符、绝对路径"          | **被取代**：自定义根下允许"**绝对路径且位于生效根之内**"；相对单层 `chrome/<名>` 分支**逐字保留**。**不变**：助手只操作**生效根之内**的子目录、禁止 `..`                                                                                                      | `helper.cjs` 的 `resolveUserDataDir(value, root)`；`test/helper.test.js` 的两形态用例 |
| 2   | §11.2 契约表：`probe` 返回        | `:529`                                                                                                            | `probe` 返回 `{ cwd, node, …, chromeCandidates }`                                                               | **修订**：`profileRoot` 字段值改为**生效根的绝对路径**（字段名与形状不变），另加 `profileRootIsDefault`                                                                                                                                                       | `helper.cjs` 的 `probe(params)`                                                       |
| 3   | §11.2 契约表：`cleanCaches` 返回  | `:533`                                                                                                            | `{ cleaned, totalFreedBytes, skipped }`                                                                         | **追加可选** `refused?: string`（缺标记时整体拒绝，**不抛错**）                                                                                                                                                                                               | `helper.cjs` 的 `cleanCaches`                                                         |
| 4   | §11.2 错误码表                    | `:584-595`                                                                                                        | 5 个自定义前缀                                                                                                  | **追加 8 个**：`[profile-root-invalid]` / `[profile-root-create-failed]` / `[profile-root-unmarked]` / `[migrate-failed]` / `[migrate-verify-failed]` / `[migrate-overwrite-unconfirmed]` / `[migrate-overwrite-failed]` / `[profile-root-candidate-invalid]` | `helper.cjs` 的 `isInvalidParamsMessage` + 各方法消息                                 |
| 5   | §10.4 设置页 schema               | `:453-458`、`:468`                                                                                                | "本扩展使用的**两个**设置项（R17 全部所需，不多不少）"                                                          | **被取代**：变为**三个**设置项（新增 `webapp.profileRoot`，`text`，默认空串）                                                                                                                                                                                 | `manifest.json`、`test/manifest-settings.test.js`                                     |
| 6   | §10.2 贡献点                      | `:342-347`                                                                                                        | "只贡献一个 App 卡片 + 一个扩展设置页"                                                                          | **修订**：贡献点仍只有这两项，设置页字段 2 → 3（`contributes` 的键集合不变）                                                                                                                                                                                  | `test/manifest-settings.test.js` 的"contributes 只允许多这一个设置页"                 |
| 7   | §12.1 ② 与 §12.2                  | `:650`、`:663`                                                                                                    | "② `--user-data-dir=chrome/<净化后的目录名>` ← 相对助手 cwd"；"扩展侧生成的 args 里**只放相对形式**"            | **被修订**：默认根下**一字不变**；自定义根下 args 放**绝对形式**（形态由根的类别决定）                                                                                                                                                                        | `lib/chromeArgs.mjs` 的 `userDataDirArg(name, { rootMode, root })`                    |
| 8   | §14.1 目录布局                    | `:852-863`                                                                                                        | `data/chrome/` 是 profile 根                                                                                    | **修订**：默认根不变；新增"根可由 `webapp.profileRoot` 指向扩展目录之外"与标记文件 `.obox-webapp-root`                                                                                                                                                        | `lib/profileRoot.mjs`、README §3.1                                                    |
| 9   | §14.2 创建与改名                  | `:886-913`                                                                                                        | 改名两阶段 intent `<根>/.pending-move.json`                                                                     | **修订**：新增"迁移期间**禁止改名**；根迁移 intent 在**扩展 data 目录**；**先根后改名**"                                                                                                                                                                      | `index.js` 的 `migrationBlocksRename` / `list` 的对账顺序                             |
| 10  | §14.3 删除                        | `:915-951`                                                                                                        | 删除流程 5 步                                                                                                   | **修订**：第 **0** 步新增"自定义根缺标记 ⇒ 拒绝，不执行任何 rename/rm"                                                                                                                                                                                        | `helper.cjs` 的 `removeProfile` → `assertManagedRoot`                                 |
| 11  | §14.5 只清缓存                    | `:953-992`                                                                                                        | 白名单 + 保留清单 + 三道防线                                                                                    | **修订**：新增第 **0** 道"缺标记 ⇒ 整体拒绝"；白名单 / 保留清单 / 深度**逐项不变**                                                                                                                                                                            | `helper.cjs` 的 `cleanCaches`                                                         |
| 12  | §14.4 卸载行为                    | `:1058-1121`                                                                                                      | "(a) 卸载 = 永久删除**所有**站点浏览器数据"；"(b) README 必须写一句话对比结论"                                  | **被取代（限定范围）**：卸载 = 永久删除**默认根**下的数据；**外部根**下的 profile **保留在磁盘上，需自行清理**。`install` 禁令**加强**（新增"不得触碰外部根"）                                                                                                | `index.js` 的 `install` / `uninstall`、README §2.1                                    |
| 13  | §15.2 第 5 条「数据体积提示」     | `:1267-1271`                                                                                                      | 条目卡片 `title` 里带 `数据目录：<相对路径>`                                                                    | **修订**：按**生效根**渲染——默认根显示 `chrome/<名>`，自定义根显示 `<根>\<名>`（根过长时**中间省略**，保留盘符与末两级）                                                                                                                                      | `lib/profileRoot.mjs` 的 `formatCardDataDir`、`src/components/WebappCard.vue`         |
| 14  | §16 权限与安全                    | `:1295`                                                                                                           | "不接受任意路径（只允许 `chrome/<单层目录名>`）"                                                                | **被取代**：改为"只接受**生效根之内的单层目录**；生效根 ∈ {默认根, 用户配置的绝对根}"；能力边界新增"读写用户指定的扩展目录之外路径（**限该根及其直接子目录**）"                                                                                               | `helper.cjs` 的三道防线 + README §7                                                   |
| 15  | §16 权限与安全「数据删除边界」    | `:1301`                                                                                                           | "本扩展会删用户数据的动作**只有三个**……**没有第四个**"                                                          | **被取代**：变为**四个**——追加"④ **改根迁移**（完整性判据通过后删除**旧根下已搬完的条目目录**；**覆盖模式下还会先删除目标根下的同名目录**）"。"不做自动清理"的边界**不变**                                                                                    | README §7、`lib/profileRoot.mjs` 的 `decideMigrationItem` / `verifyMigration`         |
| 16  | §17 性能与规模约束「磁盘位置」    | `:1313`                                                                                                           | "profile 落在 `%APPDATA%`（通常在 C: 盘）→ README 必须说明……并给出'手动搬迁'的说明（**不做**界面内的搬迁功能）" | **被取代**：本条需求**正是**"界面内的搬迁功能"（改根 = 自动迁移）；"占 C 盘空间"的表述改写为"默认占 C 盘，**可在设置里改到其它盘**"                                                                                                                           | README §3.1、`index.js` 的 `startRootMigration`                                       |
| 17  | §18.1 测试计划（路径防护）        | `:1424`                                                                                                           | "`chrome/../x`、`chrome/a/b`、绝对路径、盘符 → 全部 `-32602`"                                                   | **修订**：绝对路径**不再一律** `-32602`——**恰好等于 `join(生效根, 单层名)` 的绝对路径被接受**；其余绝对路径、`..`、`a/b` 仍 `-32602`                                                                                                                          | `helper.cjs` 的 `resolveUserDataDir`、`test/helper.test.js`                           |
| 18  | §21.7 S9 / S10                    | `:1891-1892`                                                                                                      | "改名 intent = `chrome/.pending-move.json`"；"扩展侧只生成相对 `chrome/<名>`"                                   | **修订**：S9 追加**根迁移 intent**（在 data 目录，另一文件）；S10 追加"自定义根下改为绝对形态，默认根不变"                                                                                                                                                    | `index.js` 的 `intentPath()`、`lib/chromeArgs.mjs`                                    |
| 19  | §23 验收标准（AC18 类卸载对比）   | `:1948`                                                                                                           | "卸载后扩展目录与 `chrome/**` 永久消失"                                                                         | **修订**：追加"外部根场景下 `chrome/**` 的等价物**保留在自定义根**"的对照验收                                                                                                                                                                                 | `docs/evidence/profile-root-migration.md` 的 A36                                      |
| 20  | **宿主 `src/main/ext.ts` 硬编码** | `src/main/ext.ts:22-31`（另见 `src/shared/types.ts:302-306`、`src/api/types.ts:273-277`、`api-reference.md:439`） | 对话框"只有选文件"（这不是归档 spec 的条款，而是**宿主既有实现事实**）                                          | **被取代（v2，P0 = B）**：改为支持可选 `properties: ['openDirectory']`，默认仍 `['openFile']`。宿主改动**已合并进 obox master `703d6d0`（未发版）**；本扩展按行为探测 + 降级实现，**不依赖**宿主版本                                                          | `index.js` 的 `browseRootDir`、本文件 §8                                              |

> **不重写历史**：`docs/spec/amendments/01`–`07` 一字未动；本表是唯一的条款取代记录。

---

## 3. 新的规格章节（实现口径）

### 3.1 设置项契约

| 项            | 值                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 键名          | `webapp.profileRoot`                                                                                                                                                                                                                                                                 |
| 类型          | `text`（宿主设置字段的四类之一；**没有**目录选择控件）                                                                                                                                                                                                                               |
| 默认值        | `""`（空串 = 用默认根 `<扩展 data>/chrome`）                                                                                                                                                                                                                                         |
| `label`       | `浏览器数据根目录`                                                                                                                                                                                                                                                                   |
| `description` | `站点浏览器数据的存放根目录（绝对路径）。留空 = 用默认目录（扩展数据目录下的 chrome）。改这里会把已有数据自动迁移到新目录；迁移未完成时不会生效。卸载时只有默认目录下的数据会被删除；指向外部目录时数据会保留，需你自行清理。`（**原样进 `manifest.json`**，因此不含 Markdown 标记） |

**校验清单（纯函数 `lib/profileRoot.mjs` 的 `normalizeRoot`）**：

| #   | 规则                                                                                                                          | kind / 文案                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| V1  | 空串 / 纯空白 = 默认根，不算错误                                                                                              | `kind='default'`                                                  |
| V2  | 必须绝对路径                                                                                                                  | `根目录必须是绝对路径（例如 D:\obox-webapp\profiles）`            |
| V3  | 拒绝**纯盘符根**（`C:\` / `D:/` / `C:`）                                                                                      | `不能把磁盘根目录（C:\）当作浏览器数据根`                         |
| V4  | **UNC 允许**，但必须给性能警告                                                                                                | `kind='absolute-unc'` + `警告：网络路径上的浏览器数据会明显变慢…` |
| V5  | 拒绝 obox 程序目录（`execPath` 所在目录**及其下**）——**1.0.6 收紧**：不再因"路径段里出现名为 `obox` 的目录"而拒绝（只给提示） | `不能指向 obox 自己的安装目录`                                    |
| V6  | 拒绝扩展 data 目录自身**及其祖先**（`checkNotDataDir`）                                                                       | `不能指向扩展的数据目录（webapp.db 所在目录）`                    |
| V7  | 根不存在 ⇒ 允许创建（`prepareRoot` 建目录 + 写标记）；创建失败 ⇒ `[profile-root-create-failed]` 且**不写设置**                | —                                                                 |

> ⚠️ **V5 的边界（实现裁定，需知情）**：spec §9.1 V5 的字面是"`process.execPath` 所在目录**及其祖先**中的
> `obox` 安装目录"。**实现只拒绝"落在 obox 安装目录里"**，**不**拒绝"根是安装目录的**祖先**"——
> 否则 `C:\Users`、`C:\Program Files` 这类系统目录会被一刀切拒掉（过宽），而用户手建的
> `D:\obox-webapp\profiles`（前缀含 `obox` 但不是 `obox` 目录）也会被误伤。
> 理由：V5 的目的是"别和程序文件混放"，**落在程序目录里**才是真正危险的形态；祖先目录的危险性由 V6（data 目录）
> 与运行期校验兜住。这条已在 `test/profileRoot.test.js` 的 P-4 里显式钉住（含"不做祖先判定"的反向断言）。
>
> ⚠️ **1.0.6 再收紧一次（现场事故驱动）**：1.0.3–1.0.5 还额外拒绝"**任何**路径段里恰好有一个目录名叫 `obox`"
> 的路径（当时的理由：渲染进程拿不到 `execPath`，用路径形态兜底）。那条启发式把**与 obox 毫无关系的用户目录**
> 一起拒了（`D:\obox\profiles` 这类），而且**拒绝是静默的**（只留一行控制台日志）——用户看到设置里存着自己的
> 值、实际却一直用默认根。1.0.6 起：**只保留 `execPath` 判据**（渲染进程拿不到 `execPath` 时**跳过**该检查，
> 真正的判定由助手侧完成）；"路径段里有 `obox` 目录"降级为**非阻塞提示**（进状态项的 `设置提示：…`）。
> 两个方向都有断言（安装目录仍被拒 / `D:\obox\profiles` 现在被接受），见 `test/profileRoot.test.js` 的 P-4
> 与 amendment 09 §10.5。

**生效根（`resolveEffectiveRoot`，本需求最容易写错的数据安全点）**：

- 存在未完成迁移意图（`phase ∈ {pending, running}`）时，**生效根恒为意图里的 `from`（旧根）**——
  哪怕宿主里的设置值已经变成新根。这样"设置说 D 盘、数据还在 C 盘"的中间态**永远不会被当成最终态**。
- 归一失败（V2–V6）⇒ 用**上一次成功的值**（内存缓存；进程重启后回落到默认根），并在 `rootStatus` 回 `invalid`。
- 设置值的**唯一**写入点是迁移全部完成后的那一次 `api.settings.set('webapp.profileRoot', to)`
  （另有"放弃时写回旧根"与"无存量条目时直接写"两处，共 3 处，由 `test/ipcSurface.test.js` 钉住次数与顺序）。

### 3.2 根解析改造点（助手侧）

统一引入**显式上下文**：助手每个与 profile 有关的方法都接受可选入参 `root`（绝对路径字符串）。
`root` 缺省 ⇒ 默认根 `<cwd>/chrome`（**既有 8 个方法在不传 `root` 时行为逐字不变**）。

| #    | 位置                                                              | 改后                                                                                                                                                                                               |
| ---- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | `lib/nameSanitize.mjs` 的 `PROFILE_ROOT`                          | **保留**，语义收窄为"**默认根的目录名**"（注释改写；值不变）                                                                                                                                       |
| R-2  | `lib/chromeArgs.mjs` 的 `userDataDirArg`                          | 签名扩为 `(name, options)`：`rootMode` 缺省 `'relative'`（`chrome/<名>`，一字不变）；`'absolute'` 时产出 `<绝对根>\<名>`                                                                           |
| R-3  | `helper.cjs` 的 `PROFILE_ROOT`                                    | 改名 `DEFAULT_PROFILE_ROOT`（语义 = 目录名），新增 `defaultRootDir()`                                                                                                                              |
| R-4  | `helper.cjs` 的 `profileRoot()`                                   | 改为 **`resolveRoot(params)`**（异步：惰性 import `lib/profileRoot.mjs`）：非空 ⇒ 绝对路径 + 规范化 + 拒盘符根/UNC 根（`[profile-root-invalid]`，`-32602`）                                        |
| R-5  | `profilePath(value)`                                              | `profilePath(value, root)`：`assertProfileName` 不变；`relative(root, target)` 的**越界双保险保留**（**第三道防线**）                                                                              |
| R-6  | `resolveUserDataDir(value)`                                       | 接受两种形态：① 相对 `chrome/<单层名>`；② 绝对且**恰好等于** `join(生效根, <单层名>)`；③ 其它绝对路径一律 `-32602`                                                                                 |
| R-7  | `validateLaunchArgs` / `launch`                                   | 增补 `root` 入参并透传                                                                                                                                                                             |
| R-8  | `profileStatus` / `readPendingMove`                               | 两者都接 `root`（改名 intent **跟着生效根走**）                                                                                                                                                    |
| R-9  | `moveProfile`                                                     | 加 `root`；**前置新增缺标记拒绝**（改名会移动数据）                                                                                                                                                |
| R-10 | `removeProfile`                                                   | 加 `root` + 第 0 步缺标记拒绝（**第二道防线**的核心）                                                                                                                                              |
| R-11 | `cleanTrash`                                                      | 加 `root`                                                                                                                                                                                          |
| R-12 | `profileSize` / `cleanCaches`                                     | 加 `root`；`cleanCaches` 的全局遍历改为**遍历生效根**，缺标记整体拒绝并回 `refused`（不抛错）                                                                                                      |
| R-13 | `METHODS` 表                                                      | 追加 `profileRootStatus` / `prepareRoot` / `checkRootCandidate` / `migrateRootDir`（4 个 ⇒ 共 **11 个**方法）                                                                                      |
| R-14 | `isInvalidParamsMessage`                                          | 追加 `[profile-root-invalid]` / `[profile-root-candidate-invalid]` / `根目录` / `migrateRootDir` ⇒ `-32602`；`[profile-root-unmarked]` / `[profile-root-create-failed]` / `[migrate-*]` ⇒ `-32603` |
| R-15 | `--selftest`                                                      | 追加 ⑩ 组：自定义根下的体积/清理/缺标记拒删、`prepareRoot` 幂等、`checkRootCandidate` 只读、`migrateRootDir` 的 probe/move（同卷与 `forceCopy`）、冲突未确认/已确认两态、续做形态                  |
| R-16 | `TIMEOUTS`                                                        | 追加 `profileRootStatus: 30s` / `prepareRoot: 60s` / `checkRootCandidate: 30s` / `migrateRootDir: 600s`                                                                                            |
| R-17 | `readSettings()`                                                  | 返回体追加 `profileRoot`（原始串）与归一结果 `rootVerdict`；归一失败**回落**而非崩溃                                                                                                               |
| R-18 | `profileExists(name, scope)`                                      | 调用 `profileStatus` 时带上生效根                                                                                                                                                                  |
| R-19 | 改名段（`save`）                                                  | 带生效根；**新增前置**：迁移未完成 ⇒ 拒绝改名                                                                                                                                                      |
| R-20 | `remove`                                                          | 带根；捕获 `[profile-root-unmarked]` 归一为界面文案，且**库行也不删**                                                                                                                              |
| R-21 | `open` / `precheckSize` / `profileSize` / `cleanCaches` / `probe` | 全部带根；`buildChromeArgs` 传 `rootMode`                                                                                                                                                          |
| R-22 | 卡片注册版本                                                      | 抽成常量 `EXT_VERSION = '1.0.3'`（同一次迁移意图文件也用同一个常量）                                                                                                                               |
| R-23 | `manifest.json`                                                   | 追加 `webapp.profileRoot` 字段；`version` → `1.0.3`                                                                                                                                                |
| R-24 | `WebappCard.vue`                                                  | `title` 改为动态（`dataDir` prop；**界面不自己拼路径**——子窗口是浏览器环境，不能 import `lib/*.mjs`）                                                                                              |
| R-25 | `App.vue`                                                         | 新增迁移状态行、未受管警示行、覆盖确认框、手填降级入口、「浏览…」按钮，以及四个新方法的调用点                                                                                                      |
| R-26 | `src/bridge.js`                                                   | **无需改**（`callExtension` 通用；已复核）                                                                                                                                                         |
| R-27 | **宿主**（obox 仓库）                                             | `api.dialog.showOpenDialog` 的 `properties` 透传（**已合并进 obox master `703d6d0`，未发版**）                                                                                                     |

### 3.3 标记文件 `.obox-webapp-root`

| 项                  | 值                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径                | `<根>/.obox-webapp-root`（与 `<根>/.pending-move.json`、`<根>/.trash/` 同级）                                                                                                         |
| 内容（JSON，UTF-8） | `{ "marker": "obox-webapp-root", "extId": "webapp_chenzhi", "version": "1.0.3", "createdAt": "<ISO>", "root": "<规范化后的绝对根>" }`（**恰好五字段**，P3 已闭合）                    |
| 创建时机            | ① 第一次保存一个校验通过的新自定义根；② 打开条目时发现根被手工删除 ⇒ 重建 + 重写标记；③ 迁移目标根在迁移开始前（`prepareRoot`）；④ 默认根也写（保持一致），但判定逻辑对默认根**豁免** |

| 操作                               | 缺标记 + **默认根** | 缺标记 + **自定义根**                                                                                                        |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 打开（`launch`）                   | 放行                | **放行**（打开是"写"不是"删"；拒绝会造成"根被手工动过就再也打不开"的死局），但 `rootStatus.unmanaged = true`，界面显示警示行 |
| 量体积（`profileSize`）            | 放行                | 放行（只读）                                                                                                                 |
| **删除**（`removeProfile`）        | 放行                | **拒绝**：`[profile-root-unmarked]`（`-32603`），一个字节不动、**库行也不删**                                                |
| **清理**（`cleanCaches`）          | 放行                | **整体拒绝**：回 `refused` 字段（**不抛错**）                                                                                |
| **改名**（`moveProfile`）          | 放行                | **拒绝**（移动数据与删除同等级）                                                                                             |
| 迁移的**目标根**                   | 不适用              | **必须有标记**（`prepareRoot` 幂等写入）；写标记失败 ⇒ 迁移不开始并报错                                                      |
| 迁移的**源根**                     | 放行                | **放行**（P3b = A）：删源由完整性判据 C1–C5 保护，否则"手工拷出来的旧根"永远搬不动                                           |
| 候选根探测（`checkRootCandidate`） | 放行                | 放行（纯只读）                                                                                                               |

### 3.4 迁移状态机与意图文件

意图文件 `<扩展 data>/.pending-move-root.json`（**放在 data 目录**，不随根移动；见 §7 的 U-5）：

```jsonc
{
  "schema": 1,
  "kind": "profile-root-move",
  "phase": "pending | running | done | abandoned",
  "from": "<旧根绝对路径>",
  "to": "<新根绝对路径>",
  "extId": "webapp_chenzhi",
  "version": "1.0.3",
  "startedAt": "<ISO>",
  "updatedAt": "<ISO>",
  "conflicts": { "confirmedAt": null, "confirmedBy": "user", "names": [] },
  "items": [
    {
      "name": "<条目目录名>",
      "status": "pending|copying|verifying|done|overwritten|skipped|failed|missing",
      "reason": "",
      "overwrite": false,
      "backup": null,
      "files": 0,
      "bytes": 0,
      "copiedFiles": 0,
      "copiedBytes": 0,
      "attempts": 0,
      "at": ""
    }
  ],
  "summary": { "total": 0, "done": 0, "overwritten": 0, "skipped": 0, "failed": 0, "missing": 0 }
}
```

- `items[].backup` **恒为 `null`**（P1 = B：不做任何备份）；`test/profileRoot.test.js` 的 P-16 是"不得出现备份路径"的反向门禁。
- `status: 'overwritten'` 与 `done` **分开计数**（可审计：界面单独报"覆盖 Z"）。
- **写入方式**：先写 `<…>.tmp`、再写正式文件（`api.fs` **没有 rename**），读侧对不完整 JSON 容错（`JSON.parse` 失败 ⇒ 视为"无迁移"）。
- **全部完成的判据**：`items` 里不存在 `pending` / `copying` / `verifying`，**且没有 `failed`**
  （`failed` 意味着"源还在、目标不完整"，此时切换生效根会让用户在新根下看不到那些数据 ⇒ 阻塞写设置）。
- **续做**：下次扩展激活时**重扫** from/to 两个根（不信上次的扫描结果），逐项判定；
  **未确认的覆盖必须重新确认**（续做**不得**继承一个不存在的用户确认，D16）。

#### 覆盖语义（P1 = B：**覆盖、不备份**，用户明确接受其后果）

目标已存在同名目录时，处置 = **先递归删除目标同名目录 → 再把源搬过去**。
目标里原有的浏览器数据（含登录态、Cookie、书签、IndexedDB）**永久丢失且无法恢复**。

**确认步骤（三步，缺一不可）**：

1. **冲突预检**（用户提交新根之后、任何删除发生之前）：逐条 `migrateRootDir({ action: 'probe' })`，
   得到 `conflicts`（`target.exists && source.exists` 的条目）；
2. **逐条列出 + 弹确认框**（`src/components/ConfirmOverwrite.vue`）：标题给出 N、正文**完整列出**冲突目录名、
   必须写明"目标目录里已有的浏览器数据（含登录态）会被永久删除且无法恢复"、按钮 `取消` / `覆盖并继续`（危险样式）；
   **不做**"备份目标"选项；
3. **只有用户点「覆盖并继续」才允许动手**：确认后把 `{ confirmedAt, confirmedBy: 'user', names: [...冲突快照] }`
   写入意图文件，并把对应 `items[].overwrite = true`；点「取消」⇒ 删意图文件、`phase = 'abandoned'`、
   设置值保持旧根，**一个字都没删**。无冲突 ⇒ 不弹框，直接进入 `running`。

**执行顺序（不可颠倒）**：目标根写标记（`prepareRoot`）→ 删除目标同名目录（`clearReadonly` + `removeDir`）
→ 复制/移动源 → **C1–C5 校验** → 删源。删除目标失败 ⇒ **绝不继续复制**（`[migrate-overwrite-failed]`，
避免"目标没删干净又往里拷"导致两份数据混杂）。

#### 完整性判据（**先校验、后删源**）

| #   | 判据                                                                                      | 阈值                         |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------- |
| C1  | 目标存在且是目录                                                                          | 必须                         |
| C2  | `targetFiles >= floor(sourceFiles * 0.95)`                                                | **硬门槛 ≥ 源的 95%**        |
| C3  | `targetBytes >= floor(sourceBytes * 0.95)`                                                | 同上                         |
| C4  | `Default/Preferences`（或 `Preferences`）在目标内                                         | **仅当源确实有该文件时要求** |
| C5  | `Default/Network/Cookies`（或 `Default/Cookies` / `Network/Cookies` / `Cookies`）在目标内 | 同上                         |

- 任一不满足 ⇒ 该条目 `status='failed'` + `[migrate-verify-failed]`，**保留源**，整体停在 `running`。
- 通过 ⇒ 才允许删源：**同卷**用 `fs.rename`（失败即视为被占用）；**跨卷/`EXDEV`/`forceCopy`** 用
  "复制 → 校验 → 递归删除源"。
- **阈值口径（实现裁定，需知情）**："95%"实现为**不随源大小浮动的整数门槛 `floor(源 × 0.95)`**
  （源 100 文件 ⇒ 至少 95；源 10 ⇒ 至少 9；源 1 ⇒ 门槛 0）。小样本下偏严，但方向是**保守**的
  （宁可让该条目留在 `failed` 让用户关窗重试，也不把截断的 profile 当成功然后删源），
  与 spec §9.4 "宁可该条目失败也不丢数据"的取舍一致。已在 `test/profileRoot.test.js` 的 P-10 显式钉住。
- **C4/C5 的"源没有就不要求"（实现裁定，需知情）**：Chrome profile 未必都有 `Default/Preferences` 与
  `Default/Network/Cookies`（例如刚建的 profile、或用户自己拷了一半的目录）。若**无条件**要求目标必须有，
  会造出"**永远搬不动的条目**"，与 P3b（源根允许缺标记，让手工拷出来的旧根能搬）的意图直接冲突。
  因此判据是"**源有 ⇒ 目标必须有；源没有 ⇒ 不要求**"，且**位置按 Chrome 的真实布局**取候选
  （`Default/Preferences` 或 `Preferences`；`Default/Network/Cookies` / `Default/Cookies` /
  `Network/Cookies` / `Cookies`）。已在同一条测试里覆盖"源本来就没有 ⇒ 不因此判失败"。

### 3.5 方法契约变更

**既有 8 个方法**（不新增方法、不改返回形状，只加可选 `root`）：
`probe` / `launch` / `profileStatus` / `moveProfile` / `removeProfile` / `profileSize` / `cleanCaches`
（`cleanCaches` 追加可选 `refused`）。**新增 4 个助手方法**：

| 方法                 | 入参                                                 | 返回                                                                                                                                                                 | 错误码                                           |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `profileRootStatus`  | `{ root? }`                                          | `{ root, isDefault, exists, isDirectory, marked, unmanaged, marker, legacyPendingMove, entries[] }`                                                                  | `-32602`（root 非法）                            |
| `prepareRoot`        | `{ root, dataDir? }`                                 | `{ root, created, marked }`（**幂等**）                                                                                                                              | `-32602`；`-32603 [profile-root-create-failed]`  |
| `checkRootCandidate` | `{ candidate, dataDir? }`                            | `{ candidate, kind, isDirectory, parent, exists, invalid, warning }` —— **纯只读**                                                                                   | `-32602`（入参形状）                             |
| `migrateRootDir`     | `{ from, to, name, action, overwrite?, forceCopy? }` | `probe` ⇒ `{ source, target, sameVolume, conflict }`；`move` ⇒ `{ status, reason, overwritten, targetRemoved, files, bytes, copiedFiles, copiedBytes, crossVolume }` | `-32602`；**失败不抛错**（回 `status:'failed'`） |

- `action='move'` 的 `overwrite` **必须由扩展侧显式传入**（来自意图文件里已由用户确认的 `items[].overwrite`）；
  助手**不得**自行决定覆盖 —— `overwrite !== true` 且目标存在 ⇒ `status:'skipped'` + `reason:'未确认覆盖'`，**一个字节都不删**。
- `forceCopy`（可选，默认 `false`）：强制走"复制 → 校验 → 删源"路径（而不是同卷 `rename`）。
  用途：**自测与真机验收覆盖那条更危险的代码路径**（`test/helper.test.js` 与 `--selftest` 都用它）；
  生产路径不传它，同卷走毫秒级 rename。

**扩展侧（`api.app.onMessage`）从 8 个方法变为 12 个**，新增：
`rootStatus` / `startRootMigration` / `resolveRootMigration` / `browseRootDir`。

### 3.6 权限与安全（三道防线 = 三条数据安全线）

| 防线           | 内容                                                                                | 落点（可核对的代码位置）                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① **路径校验** | 绝对路径、拒盘符根、拒 obox 程序目录、拒 data 目录自身（V2–V6）；**助手侧再查一遍** | `lib/profileRoot.mjs` 的 `normalizeRoot`（纯函数，可单测）+ `helper.cjs` 的 `resolveRoot`                                                                            |
| ② **标记文件** | 自定义根缺 `.obox-webapp-root` ⇒ **拒绝删除、拒绝清理、拒绝改名**；默认根豁免       | `helper.cjs` 的 `assertManagedRoot(root, action)`，被 `removeProfile` / `cleanCaches` / `moveProfile` 三处调用；`index.js` 的 `remove` / `save` 把错误归一为界面文案 |
| ③ **永不删根** | 一切删/移只作用于 `join(root, <已校验的单层目录名>)`，且 `relative()` 复核不越界    | `helper.cjs` 的 `assertProfileName` + `profilePath(value, root)`（`relative()` 双保险）；`migrateRootDir` 只以"根之下的一层子目录"为单元                             |

**新增能力面（必须在 README/spec 明示）**：自定义根下本扩展会**读写扩展目录之外的路径**，范围**严格限制**为
**该根及其直接子目录**；不做递归扫描根之外的任何位置；**不使用 `api.fs`** 去碰外部路径（沙箱只到 data 目录）。

**卸载钩子的边界**：`uninstall(ctx)` 不得搬运/备份/删除 profile，且**不得删除外部根下的任何东西**；
新增的"允许动作"只到：删 `<dataDir>/.pending-move-root.json`（避免重装后误判）与记日志。

### 3.7 数据语义

- **根不入库**：不新增 DB 列、不改表结构（`CREATE TABLE` / 索引语句一字未改）；`profileDir` 列语义
  （"净化后的目录名"）**完全不变** ⇒ 存量行零迁移。
- **`.trash` 每个根各自一个**，迁移**不迁移** `.trash`（它是删除中转区，不是用户数据）。
- **迁移只搬"在条目库里有对应条目"的目录**：根下用户自己放的文件夹、孤儿目录**一律不动**（宁可不搬，也不搬错）。
- 体积缓存的键从"条目名"改为 **`<根>\0条目名`**（同一个名字在不同根下是两份数据，只用条目名会让"改根后立刻查体积"命中旧根的旧值）。

---

## 4. 新增／修订的测试与验收

### 4.1 测试（`node --test`，131 → **194** 例）

| 文件                                            | 内容                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/profileRoot.test.js`（**新增**，26 例）   | P-1..P-16 全覆盖：V1–V7 校验、UNC、标记五字段与容错、迁移决策五态、**95% 边界与硬门槛**、C4/C5（含"源没有不要求"）、状态机推进、`failed` 阻塞、进度汇总（`overwritten` 单独计数）、生效根（迁移未完成恒为 `from`）、路径预算、**反向门禁**（lib 下只有一份根解析 / 无备份路径）、卡片文案与中间省略                    |
| `test/rootMigration.test.js`（**新增**，10 例） | I-1..I-9：设置读取不抛错、四个新方法实现、**唯一写点及其顺序**、意图文件位置与 `.tmp` 过渡、**先根后改名**、迁移中的互斥（打开/删除/清理**不**被拒）、**覆盖确认不可绕过**（含"确认必须逐条按名字置位"）、**无备份反向门禁**、浏览降级（禁版本号）、卸载文案；外加编排状态机的纯逻辑串跑                               |
| `test/helper.test.js`（+7 例）                  | 自定义根下的体积/清理（Cookies 逐字节不变）、**缺标记拒删/拒清理/拒改名**（且逐字节未变）、**默认根豁免**、**永不删根**（七种越界名 + 根下非条目内容不动）、`prepareRoot` 幂等 + `checkRootCandidate` 只读 + `migrateRootDir` 三态、跨卷 `forceCopy`（源根缺标记也放行）、`root` 入参校验、两种 `--user-data-dir` 形态 |
| `test/ipcSurface.test.js`（同步）               | 方法集合 8 → **12**；新增四条数据安全门禁（唯一写点、意图文件位置、顺序与互斥、卸载语义）                                                                                                                                                                                                                              |
| `test/manifest-settings.test.js`（同步）        | 字段 2 → **3**；键名集合；两项 select + 一项 text；`description` 必须含卸载语义且无 Markdown 标记；五处版本 = `1.0.3`（`index.js` 侧解析 `EXT_VERSION` 常量）                                                                                                                                                          |
| `test/settings.test.js`（同步）                 | `SETTING_KEYS` 深度相等加入 `profileRoot`                                                                                                                                                                                                                                                                              |
| `test/chromeArgs.test.js`（+4 例）              | `userDataDirArg` 的两种形态（相对一字不变 / 绝对含 UNC / 名仍净化）；`buildChromeArgs` 的 `absolute` 模式与"根非法 ⇒ 字段级错误而非静默回落"；`describeLaunch` 摘要                                                                                                                                                    |
| `test/componentSource.test.js`（+8 例）         | 覆盖确认框也走"只能按钮关闭"；迁移状态行（在搜索框之上、无定时器、只在挂载时查一次）；覆盖确认框逐条列出 + 不可恢复文案 + 无备份选项；未受管警示行；「浏览…」+ 降级文案；卡片 `title` 动态化且界面不拼路径；卸载对照提示；新样式零色彩字面量                                                                           |
| `test/pack.test.js`（同步）                     | `REQUIRED_LIB` 加入 `lib/profileRoot.mjs`                                                                                                                                                                                                                                                                              |

### 4.2 验收（A30–A44）

逐条的真机步骤与证据见 `docs/evidence/profile-root-migration.md`。摘要：

| 编号 | 验收项                            | 状态                                                                                 |
| ---- | --------------------------------- | ------------------------------------------------------------------------------------ |
| A30  | 默认根零迁移（存量用户不受影响）  | 待真机（自动化侧由 `helper.test.js` 的默认根用例 + `chromeArgs` 的相对形态断言守护） |
| A31  | 改根自动迁移成功（同卷）          | 自动化覆盖迁移原语；**端到端待真机**                                                 |
| A32  | 迁移中断后续做                    | **待真机**（自动化覆盖"目标在、源不在 ⇒ done"的续做形态）                            |
| A33  | 取消覆盖 ⇒ 跳过且零改动           | 自动化覆盖（`helper.test.js` 的 skipped 用例：两侧逐字节未变）；**界面确认框待真机** |
| A34  | 缺标记拒删（核心安全用例）        | 自动化覆盖判断与"逐字节未变"；**指向真实 Chrome profile 的端到端待真机**             |
| A35  | 永不删根                          | 自动化覆盖（七种越界名 + 根下非条目内容不动）                                        |
| A36  | 卸载后外部根保留                  | **待真机**（涉及宿主卸载行为）                                                       |
| A37  | 体积上限在自定义根下仍正确        | 自动化覆盖体积统计；**界面拦截待真机**                                               |
| A38  | 清理全部缓存（自定义根）          | 自动化覆盖（`cleanCaches` 遍历生效根）                                               |
| A39  | 同名改名在自定义根下仍可用        | **待真机**                                                                           |
| A40  | 跨盘迁移的真实耗时与完整性        | **待真机**（`forceCopy` 已自动化覆盖同一条代码路径的正确性）                         |
| A41  | 设置值只在全部搬完后写入          | 自动化覆盖唯一写点与 `failed` 阻塞；**端到端待真机**                                 |
| A42  | 「浏览…」的**降级**行为（老宿主） | 按宿主契约实现 + 源码门禁；**待真机**（需老版本 obox）                               |
| A43  | 冲突覆盖 + 确认框列出过它们       | 自动化覆盖覆盖两态与"未确认一个字节都没删"；**界面确认框待真机**                     |
| A44  | 改宿主后的「选目录」正路径        | **待真机**（需具备 `openDirectory` 能力的宿主构建；宿主改动已合并未发版）            |

---

## 5. 票 / 依赖变更

| 票     | 标题                                                                   | Blocked by | 状态                                                                                |
| ------ | ---------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| **00** | 宿主：`api.dialog.showOpenDialog` 支持 `properties: ['openDirectory']` | —          | **已完成**（obox 仓库，master `703d6d0`，未发版；本扩展**不依赖**它，老宿主走降级） |
| 01     | 根解析纯模块与形态判定（prefactor）                                    | —          | 已完成（`lib/profileRoot.mjs` + `test/profileRoot.test.js`）                        |
| 02     | 助手接受生效根 + 标记门禁                                              | 01         | 已完成                                                                              |
| 03     | 迁移原语（逐目录 probe/move + 覆盖删除 + 完整性判据 + 候选根判定）     | 01, 02     | 已完成                                                                              |
| 04     | 扩展侧设置读取与迁移编排（含覆盖确认闸门）                             | 03         | 已完成                                                                              |
| 05     | 界面（设置项、状态行、覆盖确认框、浏览按钮 + 降级、卡片文案）          | 04         | 已完成（A44 的正路径验收仍需具备能力的宿主）                                        |
| 06     | 文档与发布 1.0.3                                                       | 05         | 本 amendment + README + 证据；tag `v1.0.3` 与 release 由发布步骤执行                |

**依赖变更**：无外部依赖；跨仓库协作仅影响 A44 的正路径验收（其余扩展侧工作不依赖宿主改动）。

---

## 6. 风险与回退

| 风险                                                                                                    | 缓解                                                                                                                                                                          | 回退                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-9（用户已接受的不可逆风险）**：覆盖目标同名目录会**永久删除**那里的浏览器数据（含登录态），不可恢复 | **唯一闸门**是迁移前的**逐条确认框**（确认记录进意图文件、续做缺记录则**重新确认**）；只删目标根下的同名子目录、**永不删根**；`overwritten` 单独计数并逐条展示；README 醒目段 | **无技术回退**（删了就没了）。可做的只有 `abandon`（保留旧根与已复制到目标的数据）；**不得**提供"默认覆盖"或"跳过确认"的开关（P1 = B 不备份，但**没有**授权静默覆盖） |
| R-1：指向真实 Chrome profile 后误删                                                                     | 三道防线；验收 A34 用逐字节比对证明未动                                                                                                                                       | 无自动回退 ⇒ 因此**默认拒绝**                                                                                                                                         |
| R-2：跨盘迁移慢/中断                                                                                    | 逐目录 + 可恢复意图 + 完整性判据（先校验后删源）                                                                                                                              | `abandon`；已复制到目标的数据保留、源不删                                                                                                                             |
| R-5：迁移中用户继续打开站点 ⇒ 源侧文件被改动                                                            | 95% 阈值容忍少量抖动；被占用条目走"待续做"                                                                                                                                    | 该条目 `failed`、源保留；关窗后「继续」                                                                                                                               |
| R-6：两处 intent 同时存在导致对账错乱                                                                   | 顺序（先根后改名）+ 互斥（迁移中禁止改名与再次改根）                                                                                                                          | 人工删除 `<dataDir>/.pending-move-root.json`（README 给出路径与后果）                                                                                                 |
| R-7：默认根回归                                                                                         | `root` 是**可选**入参；`test/helper.test.js` 的默认根用例是硬门槛（既有用例零修改通过）                                                                                       | 回退 `helper.cjs` 至 `v1.0.2`                                                                                                                                         |
| R-8：长根路径触及 Windows `MAX_PATH`                                                                    | 名称预算按生效根长度计算（复用 `assertNameLength` 的 `profileRoot` 入参）                                                                                                     | 缩短根路径                                                                                                                                                            |
| R-10（宿主侧）：`properties` 归一写错 ⇒ 既有文件选择行为回归                                            | 宿主侧表驱动单测 + 源码门禁（已随 `703d6d0` 合并）；扩展侧**按行为探测**，不依赖版本号                                                                                        | 宿主侧改动是独立提交，可单独 revert，不影响扩展发布                                                                                                                   |

---

## 7. U-5：`api.fs` 能否在 data 目录写**点文件**？—— **能**（已核实，一条命令内）

规格 §21 U-5 要求"实施前必须核实"，**结论：支持**，因此**意图文件仍由扩展侧经 `api.fs` 读写**，
**不追加 amendment 09、不新增助手侧的 `readRootIntent` / `writeRootIntent` / `clearRootIntent`**。

**查法（不安装到 `%APPDATA%`）**：用一个最小脚本 import **宿主真实的** `validateRelPath`
（`src/main/sqliteCore.ts`）并在模拟的 data 目录里跑 `writeFile → rename → readFile → remove` 往返：

```js
// ① 路径规则：点文件是否被排除
import { validateRelPath } from 'file:///…/obox/src/main/sqliteCore.ts'
validateRelPath('.pending-move-root.json') // → ".pending-move-root.json"（未被排除）
// ② 真实文件系统往返（复刻 src/main/fs.ts 的 resolvePath + 三个 handler 语义）
const p = join(dataDir, validateRelPath('.pending-move-root.json.tmp'))
mkdirSync(dirname(p), { recursive: true })
writeFileSync(p, '{"schema":1}', 'utf8')
renameSync(p, join(dataDir, '.pending-move-root.json'))
readFileSync(join(dataDir, '.pending-move-root.json'), 'utf8') // → 读回一致
```

**结论与依据（三层都放行）**：

1. `src/main/sqliteCore.ts:26-33` 的 `validateRelPath` 只拒绝**绝对路径 / 盘符 / `..` / 空路径段**，
   **对文件名是否以 `.` 开头没有任何规则**；
2. `src/main/fs.ts:17-19` 的 `resolvePath = join(dataDir, validateRelPath(rel))`，
   `fs:write-file` 还会 `mkdir(dirname(p), { recursive: true })` ⇒ **点文件与普通文件同路径处理**；
3. `src/renderer/src/core/host.ts:586-595` 的 `buildFsApi` 只是把 `{ok}` 转成 throw，**没有额外白名单**。

**证据**：完整输出见 `docs/evidence/profile-root-migration.md` 的「U-5」小节（含被拒样例
`../x` / `C:\x` / `a/../b` 的对照，证明"规则是精确的，不是把所有东西都放过"）。

> ⚠️ **如实登记的唯一缺口**：`api.fs` **没有 `rename`** ⇒ 意图文件无法用"临时文件 + 原子 rename"写入。
> 实现改为"先写 `.tmp` 再写正式文件"，并让读侧对不完整 JSON 容错（`JSON.parse` 失败 ⇒ 视为"无迁移"）。
> 这**不改变**意图文件的语义（读到的永远是完整 JSON 或什么都不读到），只是原子性由"rename"降级为
> "两次写 + 容错读"——已在 `lib/profileRoot.mjs` 与 `index.js` 的 `writeRootIntent` 注释里写明。

---

## 8. 宿主侧能力与降级路径（P0 = B；按宿主确切契约实现）

宿主改动**已合并进 obox master `703d6d0`（未发版）**，契约比 spec §7.4 的假设更具体。实现按该契约执行，
与 spec 的差异逐条列在下面。

**探测实现（`index.js` 的 `browseRootDir`，行为探测、不看版本号、只缓存本会话内存）**：

```js
// ① 无对话框能力（更老的宿主/精简环境）⇒ 直接给降级结论，不报错
if (!api.dialog || typeof api.dialog.showOpenDialog !== 'function') { browseSupported = false; return ok({ supported:false, degraded:true, note: DEGRADED_NOTE, … }) }
// ② 请求目录选择
replied = await api.dialog.showOpenDialog({ title: '选择浏览器数据根目录', properties: ['openDirectory'] })
// ③ ok:false 只在 Electron 抛错时出现 ⇒ 失败提示 + 切手填（不崩）
if (replied?.ok === false) { browseSupported = false; return ok({ supported:false, degraded:true, note:`无法打开目录选择框（${replied.error}）；请手工粘贴目录路径` }) }
// ④ 取消（宿主保证 canceled:true）⇒ 不改动任何值
if (replied?.canceled === true) { return ok({ supported:true, candidate:null, canceled:true }) }
// ⑤ 空路径但没报 canceled ⇒ **不替用户下"取消"结论**，走降级
if (!first) { browseSupported = false; return ok({ supported:false, degraded:true, note: DEGRADED_NOTE }) }
// ⑥ 唯一可信凭据：交给**助手**判定"拿到的路径是不是目录"（外部路径 api.fs 碰不到）
verdict = await callHelper('checkRootCandidate', { candidate: first, dataDir })
if (verdict.isDirectory === true) { browseSupported = true; return ok({ supported:true, candidate: verdict.candidate, … }) }
// ⑦ 拿到的是**文件** ⇒ 老宿主忽略了 properties ⇒ 降级：候选根 = 父目录（**父目录也要过一遍校验**）
browseSupported = false
return ok({ supported:false, candidate: parent, degraded:true, note: FILE_SELECTED_NOTE })
```

**降级时界面说了什么**（三处文案都在 `index.js` 的常量里，`test/componentSource.test.js` 钉住）：

| 触发                       | 文案                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 老宿主 / 无能力 / 探测失败 | `当前 obox 版本不支持「选择目录」；请在下方粘贴目录路径（例如 D:\obox-webapp\profiles），或升级 obox 后重试`                     |
| 选到的是**文件**           | `当前 obox 版本不支持「选择目录」，弹出的是文件选择框；已把所选文件所在的文件夹当作候选目录，请确认后再提交，或升级 obox 后重试` |
| 宿主 `{ok:false}`          | `无法打开目录选择框（<原因>）；请手工粘贴目录路径`                                                                               |
| 候选路径没过 V1–V7         | 该条校验的原文（`invalid.reason`）                                                                                               |

界面上**手填输入框任何时候都在**（不是"不支持时才出现"）：降级时它是主入口，支持时它是可编辑的确认值。
候选值**永远不自动提交**——必须用户点「迁移到此目录」，且仍走同一套校验与迁移入口（`startRootMigration`）。

**与 spec §7.4 的差异（逐条，均以宿主契约为准）**：

| #   | spec §7.4 的说法                                                                | 宿主契约                                                                                                                  | 实现取哪边 / 为什么                                                                                               |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | "入口检测到宿主的对话框能力**无 `properties` 透传**（探测方式见下）"            | 老宿主**会**原样收到 `properties`（结构化克隆保留），只是**不读它** ⇒ 弹文件框、返回文件路径、`ok:true`、`canceled:false` | **宿主契约**：不存在"探测到没透传"这个信号，**唯一可信凭据是"拿到的路径是不是目录"**                              |
| 2   | 取消 ⇒ `{ ok:true, canceled:true }`                                             | 同                                                                                                                        | 一致，保留                                                                                                        |
| 3   | `filePaths` 为空但 `canceled !== true` ⇒ 按"取消"处理                           | 宿主保证"取消一定带 `canceled:true`"；空路径 + 无 canceled 是**异常形态**                                                 | **宿主契约**：不当"取消"（不替用户下结论），改走**降级 + 诚实提示**。这是更保守的一侧（不会静默丢一次用户操作）   |
| 4   | 待探测：`supported` 是否落库                                                    | 宿主契约明确"**不要**把 supported 落库，只缓存在会话内存"                                                                 | **宿主契约**：`let browseSupported = null`（内存变量），并有源码门禁断言它不进设置                                |
| 5   | `properties: ['openDirectory']` 与 `openFile` 互斥、目录模式下 `filters` 被丢弃 | 宿主归一函数保证                                                                                                          | 扩展侧**只发** `['openDirectory']`、**不发** `filters`，因此这些宿主侧规则不构成扩展的分支                        |
| 6   | 待探测：`multiSelections` 在目录模式下是否生效                                  | 宿主契约：`multiSelect: true` 与 `multiSelections` 等价，目录模式下同样生效                                               | 本需求的根是**单个**目录 ⇒ **不请求多选**，只取 `filePaths[0]`（额外元素忽略并如实交给助手判定第一个）            |
| 7   | 探测失败/老宿主"不得报错、不得崩溃"                                             | 一致                                                                                                                      | `browseRootDir` 的每个分支都 `return ok(...)`，`test/rootMigration.test.js` 的 I-8 断言该函数体内**没有 `throw`** |

---

## 9. 实现状态影响 / Goal Mode / 开放问题

- **实现状态**：**已完成**（本 amendment 与代码/测试同一提交；`node --test` 194 例全绿、`prettier --check .` exit 0、
  `npm run build` 成功、`node scripts/pack.mjs` 产出 `out/webapp-1.0.3.oix`）。
- **Goal Mode**：本扩展的实现按用户在本会话的明确指令执行；Goal Mode 在 obox 侧的 spec 元数据里仍记 `disabled`（流程属性，不影响技术完备性）。
- **开放产品/数据决策**：**无**（spec §17 的 P0–P5 全部闭合，本 amendment 未推翻任何一条）。
- **已接受的风险**：**R-9**（覆盖会永久删除目标目录里的登录态，**用户明确接受、无备份**）、
  **R-1**（指向真实 Chrome profile 的误删风险，由三道防线兜住）。
- **未核实项**（承自 spec §21，如实登记，**勿当已核实**）：
  - U-1：子窗口聚焦时对话框的归属窗口（`BrowserWindow.getFocusedWindow()`）——待真机；
  - U-2：跨卷 `fs.rename` 的 `EXDEV` 与 Node 行为——代码已处理 `EXDEV` 退回复制，真机未抓日志；
  - U-3：95% 阈值在真实 Chrome 会话下的抖动幅度——A40 真机；
  - U-4：UNC 下 `mkdirSync` / `copyFile` 的行为与失败码——真机；
  - U-5b：宿主 IPC 结构化克隆是否保留 `opts.properties`——**宿主侧已确认保留**（合并进 `703d6d0` 的测试）；
  - U-6：`api.settings.get` 对 `text` 字段返回类型——实现按"可能是任意类型"写（`String(v ?? '')`）；
  - U-7：迁移期间「打开」导致源侧被写入的抖动幅度——设计上已承认（95% 阈值兜底）。
