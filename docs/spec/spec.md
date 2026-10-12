# 实现规格：webapp 扩展（Chrome App 模式网页应用）

- 规格 ID：`spec-webapp-extension-v1`
- 阶段：SpecWorkflow 阶段 2（`to-spec`）｜日期：2026-10-12
- **最新修订：amendment 03（`amendments/03-probe-stage1-feedback.md`）——回灌真机探针阶段一结论（8 条已核实）+ 新增 §18.4 环境注意事项与探针结论**；前序修订为 amendment 02（`amendments/02-profile-size-limit.md`，新增 R17「profile 体积上限」/ D-5）与 amendment 01（`amendments/01-close-four-decisions.md`，关闭 D-1–D-4 + 新增 R16）
- 上游权威输入：`.spec-workflow/webapp-extension/requirements.md`（阶段 1 `to-grill` 产物，含 R1–R15、Q1–Q10、R-1–R-5、P1–P5）；本文件另含两条阶段 1 之后的新增需求 **R16（升级保留）** 与 **R17（体积上限）**，以及待微调项 **P6**（语言下拉清单）与 **P7**（上限档位）
- 参考实现：`extensions/rdp/`（用户明确指定的模仿对象）
- 清单/API 权威：`skills/obox-ext-dev/SKILL.md` + `references/*`、`src/api/types.ts`、`src/api/contributions.ts`、`src/shared/ipcDeclaration.ts`、`src/main/*`
- 状态：**实现规格已完稿，D-1–D-5 全部关闭，可进入 `spec-do`**（Goal Mode 已启用、auto-commit 关闭；P6/P7 为待微调项，不阻塞实现——按本规格登记的清单/档位先行实现）
- 本阶段未写任何代码、未改动 `requirements.md`、未创建 `extensions/webapp/`、未提交 git

---

## 1. Goal Mode 元数据（本规格版本专用）

- **Goal mode: enabled for this spec only（用户已确认，2026-10-12）**
- **auto-commit: 关闭** —— 提交与 PR 仍须在会话中**显式执行**并留下证据；本授权**不**赋予自动提交权。
- goal target：「实现本 spec、通过约定验证（§23 的 AC1–AC21）、完成最终审查且无 must-fix 发现、达到 Ship Decision: can ship」
- 最大自动修复轮次：`2`
- 必需的暂停条件（命中任一条即停下来问用户，不得自动继续）：
  1. 出现本 spec 未覆盖的产品/数据/权限/迁移/验收决策（含 **P6 语言下拉清单**的最终确认）；
  2. 实现范围要超出本 spec 或 amendment 01；
  3. 需要切换分支、stash、reset、clean、rebase、push 或任何破坏性历史操作；
  4. 出现不在已记录基线内的新脏文件且无法安全分类；
  5. 验证失败且继续需要接受风险或改变期望；
  6. 审查发现要求**改变范围**而非范围内的修复；
  7. 子代理不可恢复且剩余工作无法安全串行化或替换；
  8. 环境是生产或未知，且所需验证具有破坏性或外部可见；
  9. 达到最大自动修复轮次 `2`；
  10. 需要执行本 spec 明令禁止的动作（例如在 `uninstall(ctx)` 里尝试搬运 profile，见 §14.4；或在后台自动清理缓存，见 §6 非目标 13）；
  11. **R17 的设置项档位或缓存白名单需要增减、或需要"按条目覆盖上限"**（都属本 spec 未覆盖的产品决策，须暂停确认）。
- **授权锚点**：spec ID `spec-webapp-extension-v1`；amendment ID `01-close-four-decisions`；artifact root `.spec-workflow/webapp-extension/`；authority `local-spec-workflow`；decision source `user-confirmed-in-current-conversation`；decision timestamp `2026-10-12`；supersedes 上一版授权（该版本的 Goal Mode 为 disabled）；superseded-by：无（后续修订产生时须更新本行）。
- 运行期自动修复轮次计数由后续 `implementation-report.md` 维护，本授权元数据不记录运行态。
- 授权范围的唯一来源 = 本文件的本节 + `amendments/01-close-four-decisions.md`；后续实现/审查报告只能记录运行态，**不得**启用、重新启用、扩大或延长 Goal Mode。

## 2. Git 入口（沿用阶段 1 的闸门结论，已复核一致）

- 仓库路径：`C:\Users\chenzhi\Documents\workspace\web\obox`
- 分支决策：**继续在当前分支**（阶段 1 Q1 用户选择 B）
- 起始分支 / `HEAD`：`master` / `831832e`（阶段 1 记录值）
- 脏工作区决策：阶段 1 记录「干净（porcelain 0 行）」；本流程产物（`.spec-workflow/**`）按原决定留作未跟踪文件，不提交
- 本阶段未创建分支、未切换、未 stash、未提交、未 push
- 注意：本规格产出的实现会落在**独立仓库** `extensions/webapp/`（`extensions/` 已被仓库根 `.gitignore` 忽略 —— 依据：`.gitignore` 的 `/extensions/` 条目），因此 obox 仓库本身不会出现实现代码

---

## 3. 问题陈述（用户视角）

内部系统、自签证书站点、只能通过 IP+端口访问的管理后台，只能"开浏览器 → 找书签/敲地址 → 忽略证书警告"地使用。浏览器被一堆标签页和无关会话污染，证书警告每次都要点，多个站点的登录态互相干扰。用户想要的是：**在 obox 里把每个内部站点登记成一个条目，点一下就用 Chrome 的应用窗口（无地址栏、独立进程）打开，并且这个站点有自己独立的浏览器数据目录。**

## 4. 解决方案（用户视角）

obox 的 App 卡片里出现一张"网页应用"卡片。卡片里是条目列表（名称 + 网址 + 一行说明）。右上「新建」填名称、网址、说明，勾选「忽略证书问题」（默认勾选），保存后条目立刻出现在列表里。点条目上的「打开」→ 弹出一个独立的 Chrome 应用窗口，直接显示该站点，没有地址栏、没有标签页。每个条目用自己的 profile 目录，所以 A 站点的登录态不会串到 B 站点。「编辑」可以改名（同时把 profile 目录搬过去）、改网址、改说明、开关证书忽略，以及从下拉里挑窗口尺寸/位置/最大化/语言/缩放/禁用 GPU。「删除」会二次确认，并明确告知**该站点的浏览器数据一起删除、不可恢复**。扩展本身卸载时，**所有**站点的浏览器数据同样会被永久删除——这一点在 README 与 Release 说明里用醒目段落写明，并附"卸载前备份"的可复制命令。

## 5. 背景与目标

### 5.1 背景（事实，带证据）

| 事实 | 证据 |
|---|---|
| obox 已有"用户扩展 + App 卡片 + `api.ipc` stdio 助手拉外部进程"的成熟形态（`rdp` 拉 `mstsc.exe`） | `extensions/rdp/manifest.json:9-18`、`extensions/rdp/index.js:356-367`、`extensions/rdp/helper.cjs:178` |
| 宿主**没有**"带参数启动任意进程"的 API；执行外部进程只有两条路：`api.ipc` stdio 助手 / `api.python.run` | `src/api/types.ts:420-535`（ipc）、`src/api/types.ts:553-559`（python）；无 spawn/exec 能力 |
| 用户扩展入口是**纯 ESM JavaScript**，在宿主渲染进程 `import`，无 `node:fs` / `child_process` | `skills/obox-ext-dev/references/guides-user.md:10`、`SKILL.md:48,51` |
| stdio 助手由宿主用 Electron 二进制以 `ELECTRON_RUN_AS_NODE=1` 拉起，`cwd = <扩展目录>/data` | `src/main/ipcCore.ts:612-627`、`src/main/ipc.ts:452-471`、`skills/obox-ext-dev/references/manifest-reference.md:277` |
| 宿主强制 JSON-RPC 2.0（缺 `jsonrpc:"2.0"` 即刻 `protocol-error` 关通道） | `src/main/ipcCore.ts:229-236`（助手侧镜像）、`extensions/rdp/helper.cjs:11-14` 记录的真机结论 |
| `api.ipc` 请求默认超时 30s，可逐请求覆盖 | `src/main/ipcCore.ts:25,340-348`、`src/api/types.ts:452,462-463` |
| App 卡片的 `multiOpen:false` = 重复点击**聚焦已有窗口**（不新建） | `src/main/appWindow.ts:48-59`、`src/api/registration.ts:27-28` |
| App 子窗口加载 `app://extensions/<安装目录名>/…`，与父文档**跨源**；主题 token 只能靠 `obox-theme` postMessage 下发 | `src/renderer/src/core/appTheme.ts:4-9,28-54`、`src/renderer/src/AppWindow.vue:78-88,204-213` |
| 安装目录名 = `<manifest.name>_<清洗后 author>`，**就是宿主眼里的扩展 id**，也是数据目录名 | `src/main/oixCore.ts:56-60`、`src/renderer/src/core/loader.ts:104-120` |
| 卸载扩展会 `fs.rm(扩展目录, {recursive:true, force:true})`，**整个目录连 `data/` 一起删** | `src/main/capabilities.ts:82-121`（第 118 行是删除） |
| 入口 `uninstall(ctx)` 钩子在删除**之前**执行，超时 **10s** | `src/main/hookBridge.ts:16`、`src/renderer/src/core/hooks.ts:25-38` |
| `api.fs` 只能操作扩展自己的 data 目录（相对路径），有 `remove`（递归删除）但**没有 rename** | `src/api/types.ts:325-341`、`src/main/fs.ts:133-136` |
| `api.sqlite.open(name)` 的库落在 `<userData>/extensions/<扩展id>/data/<name>` | `src/main/sqlite.ts:34-37`、`src/main/sqliteCore.ts:216-224` |
| 覆盖安装时宿主把旧 `data/` 搬回新目录（升级保留）；包内**不得**含 `data/` | `src/main/oixCore.ts:320-336`、`src/main/oixCore.ts:168-178` |
| `node:sqlite` 支持 `CREATE UNIQUE INDEX … (name COLLATE NOCASE)`，大小写不敏感唯一**可在库层强制** | 本机实测：`node -e` 用 `DatabaseSync` 建 `webapp_name_nocase`，插入 `intranet` 在已有 `Intranet` 时抛 `ERR_SQLITE_ERROR`（Node v24.14.0） |
| `assertSafeSql` 只禁 `attach/detach/vacuum/pragma/load_extension`，`CREATE TABLE` / `CREATE UNIQUE INDEX` 允许 | `src/main/sqliteCore.ts:93-110` |
| `fs.rm(recursive:true, force:true)` 在 Windows 上**不会**删除只读文件，Chrome profile 常含只读文件 | `src/main/fs.ts:136`（同样的调用形态）；Windows 已知行为 |
| `new URL(u).origin` 精确给出 `协议//主机[:非默认端口]`，丢弃 userinfo/路径/查询 | 本机实测：`https://10.0.0.5:8443/app/x?y=1` → `https://10.0.0.5:8443`；`http://intranet/` → `http://intranet`；`https://[::1]:9443/a` → `https://[::1]:9443` |
| 本机 Chrome 装在 `%ProgramFiles%\Google\Chrome\Application\chrome.exe`，注册表 `App Paths\chrome.exe` 同样指向它；`%ProgramFiles(x86)%` 与 `%LOCALAPPDATA%` 两处不存在 | 本机实测（`Test-Path` 三处 + `Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe`） |
| 本机当前有 11 个 chrome 进程在跑（用户日常浏览器） | 本机实测 `Get-Process chrome` |
| 已安装的 `rdp` 扩展数据目录实况可作为数据语义样本：`%APPDATA%\obox\extensions\rdp_chenzhi\data\` 下有 `rdp.db`、`.obox-meta-rdp.json`、`rdp/` | 本机实测目录列举 |
| **`--app=<url>` 生效**：窗口 class `Chrome_WidgetWin_1`、标题 = 页面标题（无 " - Google Chrome" 后缀 ⇒ 无地址栏/工具栏） | **真机实测（探针阶段一）**：起实例后读窗口 class 与标题；WMI 回显完整命令行 |
| **`--window-size=W,H` / `--window-position=X,Y` 精确生效**（`GetWindowRect` = `120,140,720,540`，即 600×400 @ 120,140）；**`--start-maximized` 生效**（`zoomed=True`） | **真机实测（探针阶段一）**：`GetWindowRect` / `zoomed` 对照传入值 |
| **`--ignore-certificate-errors` 确实能过证书错误**；而 **`--unsafely-treat-insecure-origin-as-secure` 单独使用对证书错误无效** | **真机实测（探针阶段一）**：Chrome DevTools HTTP `/json/list` 中自签/过期站点的标题由"[隐私设置错误]"变为正常标题（前者），后者仍是错误页 |
| **同 profile 二次启动：进程级参数一律无效**（第二个进程 ≤1s exit 0 并转交既有实例；`--app` 转发并新开窗口，但 `--window-size`/`--window-position`/`--lang` 沿用首个实例）⇒ **每条目独立 `--user-data-dir` 是设计必然性，不是偏好** | **真机实测（探针阶段一）**：起实例 A（一组参数）后再起实例 B（不同参数），观测 B 的退出码/时长、新窗口实际矩形与 `navigator.language` |
| **Windows 上没有 `SingletonLock`/`SingletonCookie`/`SingletonSocket`**（POSIX 专有）；实际占用 = 顶层 `lockfile`（0 B、独占）+ 约 30 个 LevelDB `LOCK` + 隐藏消息窗口。运行期**整目录删除失败**、**改名失败**、**删目录内单文件成功**；停进程后整体删除成功 | **真机实测（探针阶段一）**：列目录 + 尝试打开 `lockfile` + 运行期分别尝试 `Remove-Item -Recurse`/`Rename-Item`/删单文件 |
| **本 DSH 会话的 `pwsh` 工具会在每条命令结束时回收子进程**（`Start-Process` 起的 Chrome 会在命令结束后被杀）⇒ 真机实验必须"启动→观测→清理"写在**同一条命令**内 | 真机探针踩到的坑（§18.4.1 给了自包含命令模板） |

### 5.2 目标

在 obox 里提供 **webapp 用户扩展**（独立仓库 `obox-org/webapp`，`.oix` 分发）：

1. 只贡献**一张 App 卡片**，卡片子窗口内管理多条"网页应用"条目（R1、R2）。
2. 每条目：`name`（必填、大小写不敏感唯一）、`url`（必填、仅 http/https）、`desc`（可选单行）、`ignoreCert`（默认 true）、6 个白名单窗口开关（R3、R11）。
3. 「打开」= 用 `api.ipc` → `helper.cjs` → `spawn(chrome.exe, args)` 以 **`--app=<url>`** 打开，使用**该条目独占的 profile 目录**（R4、R7、R9）。
4. `ignoreCert=true` 时追加 `--ignore-certificate-errors` 与 `--unsafely-treat-insecure-origin-as-secure=<origin>`；`false` 时都不传（R10）。
5. 「删除」连 profile 目录一起删（不可恢复、二次确认）；目录被占用则报错不删数据（R13）。
6. 界面沿用 `rdp` 既有规范：宿主主题 token、每项一行 + 一行灰说明、下拉说明写在选项内、标签列固定宽左对齐、窄窗堆叠、模态框只能按钮关闭（R14）；额外显示"TLS 已降级"标记（R15）。
7. **profile 体积节流（R17）**：全局设置项定义"单站点数据上限"（默认 2 GB，可关闭）；「打开」前由助手量目录体积（带时间戳缓存）并在超限时拦截，给「清理缓存（保留登录态）」与「仍然打开」两个动作；提供全局「一键清理全部缓存」；卡片可按需显示当前体积。固定参数新增 `--disk-cache-size=<bytes>`（**缓存上限**，与目录上限是两回事）。
8. **升级保留（R16）**：覆盖安装/升级时 `chrome/**` 与登录态原样保留（宿主把 `data/` 搬回）；卸载才永久删除。

## 6. 非目标

**沿用阶段 1 的非目标 + 本次修订新增项（不得实现）**：

1. 不做浏览器选择：只用 Chrome，不自动回退 Edge，不支持自定义 exe 路径。
2. **不做 profile 目录的硬配额**（R17 已确认：Chrome 无此参数、NTFS 目录配额不采用）——只做"体积预检 + 拦截 + 只清缓存"的**节流**，且不自动删除任何非缓存数据。
3. 不开放任意 Chrome 参数：只有 §10 的固定集合 + 6 个白名单开关 + `--disk-cache-size`（R17）。
4. 不做 Chrome 进程跟踪/管理：无"运行中"状态、无"关闭"按钮、不杀进程。
5. 不做书签/历史/下载管理，不接管默认浏览器，不做站点内容注入。
6. 不复用系统默认 profile —— **这不是偏好，而是设计必然性**：真机已核实，同 profile 已有实例时第二个进程会把请求转交既有实例并**忽略自身全部进程级参数**（`--window-size`/`--window-position`/`--lang` 实测全被忽略）；只有每条目独立 `--user-data-dir`，本扩展的固定参数与白名单开关才可能生效（§12.1 末尾、§14.6）。
7. 不使用 `api.secrets`：本扩展不接触任何密码/凭据。
8. 不做多窗口/多 profile 分组管理（阶段 1 P5）。
9. 不做"在默认浏览器打开该 url"辅助动作（P3 待确认，本规格按"不做"写）。
10. 不做条目导入/导出（P4 待确认，本规格按"不做"写）。
11. 不做双语界面：与 `rdp` 一致只中文（`guides-user.md:10` 记录的 rdp 形态；`SKILL.md:45` 记录用户扩展的 `titleKey` 无效）。
12. **不做"按条目覆盖上限"**（R17 明确：上限是全局设置，不做每连接覆盖）。
13. **不做自动清理**（不在后台定时清缓存、不在超限时替用户清）：清理必须是**用户点出来的动作**，因为"删数据"必须可见、可控。
14. **不做体积历史曲线/统计报表**（只显示当前值）。

## 7. 用户故事

> **需求编号对照（本修订后）**：R1–R15 来自阶段 1 `requirements.md`；**R16 = 升级/覆盖安装必须保留 profile 与登录态**（用户 2026-10-12 指令"更新 webapp 扩展的时候，不要把 profile 删除掉"）；**R17 = profile 体积上限（目录级节流）**（用户 2026-10-12 指令"能不能限制每个 profile 目录的大小，别把磁盘撑爆了"，选择方案 1 = 目录级节流，且**上限由用户在设置里定义**）。本文件用 R16/R17 指代这两条新增需求，**未改动 `requirements.md`**（按本次任务约定）。

**R16 覆盖对照（新增需求的规格落点）**：

| 需求 | 规格落点 |
|---|---|
| **R16（新增）升级/覆盖安装保留 profile 与登录态** | §13.4（升级保留表 + "升级保留 vs 卸载永久删除"两条语义对比）、§14.4(b)（README/Release 醒目对比段）、§14.4(g-1)（`install(ctx)` 不得触碰 profile）、§14.4(g-2)（开发者同步纪律）、§18.1、§18.3 A14/A15/A16/A17/A18/A24、§19.2 R-W12/R-W13、§19.3 第 2 条、§20.1 硬闸门 5（`data/` 排除的三层钉法）、§20.4（Release 模板）、§21.6 S14、§23 AC16–AC18/AC24、§24 票 01/03/07/09/10 |

**R17 覆盖对照（新增需求的规格落点）**：

| R17 要求 | 规格落点 |
|---|---|
| ① 上限是**全局设置项**（`contributes.settings`，默认 2 GB，可调、可关闭），不做每连接覆盖 | §10.2、**§10.4**（确切 schema：键名/类型/默认值/可选值/单位 + 已核实的能力缺口）、§6 非目标 12、§13.2（表不新增列） |
| ② 固定参数新增 `--disk-cache-size=536870912`，并注明与"目录上限"是两回事 | §12.1 ⑥ + 紧随其后的**两回事对照表**、§11.2 白名单校验第 5 条 |
| ③ 「打开」前预检（助手量体积 + 时间戳缓存 + 超限拦截 + 两个动作） | **§14.6**（预检规则 5 步、缓存 TTL/失效条件表）、§11.1 `open`/`profileSize`、§15.2 第 6 条（拦截模态框文案与按钮） |
| ④ 全局「一键清理全部缓存」（保留登录态） | §14.5（白名单 + 保留清单 + 三道防线）、§11.1 `cleanCaches`、§15.2 第 7 条 |
| ⑤ 卡片/详情显示当前体积（按需，不常驻轮询） | §14.6 末尾「卡片上的体积展示」、§15.2 第 5 条 |
| ⑥ 助手新方法 `profileSize` / `cleanCaches` 的入参/返回/错误码/超时写进 §11.2 契约表 | §11.2 契约表两行 + 超时表两行 + 错误码表三行（`[profile-size-failed]` / `[clean-cache-failed]` / 单目录失败走 `skipped[]`） |
| ⑦ 验收（超限拦截 / 清理只删缓存且 Cookie 保留 / 设置读写 / 缓存失效） | §18.1（`settings` 归一与失效单测）、§18.2（`helperCache` 逐字节保留断言）、§18.3 **A25–A29**、§23 **AC25–AC28** |
| 新增票承载 | §24 新增 **票 11**（与票 06 串行：同一 `helper.cjs`） |

1. 作为内部系统使用者，我想在 obox 里登记一个站点，这样不用每次开浏览器敲地址。
2. 作为使用者，我想给条目起一个中文名称，这样列表里能一眼认出是哪个系统。
3. 作为使用者，我想给条目写一行说明（如"生产环境，别乱点"），这样过两周还能想起它是干什么的。
4. 作为使用者，我想点一下就弹出独立的应用窗口（无地址栏），这样它看起来像一个桌面应用。
5. 作为使用者，我想让每个站点有独立的浏览器数据，这样 A 站点的登录态不会串到 B 站点。
6. 作为使用者，我想默认就忽略证书错误，这样自签证书站点不会每次都弹警告。
7. 作为使用者，我想对**个别**站点关掉证书忽略，这样对安全敏感的站点不被降级。
8. 作为使用者，我想在列表上直接看到哪些条目开着证书忽略，这样不会忘记自己放低了安全门槛。
9. 作为使用者，我想能改条目名，并且浏览器数据跟着搬过去，这样改名不会丢登录态。
10. 作为使用者，我想能改网址，这样站点迁移后不用删了重建。
11. 作为使用者，我想删除条目时被明确告知"浏览器数据一起删且不可恢复"，这样我不会误点。
12. 作为使用者，我想删除时若该站点的窗口还开着，被明确要求先关闭，而不是留下半删的坏数据。
13. 作为使用者，我想指定窗口尺寸/位置/是否最大化，这样能把它摆到习惯的位置。
14. 作为使用者，我想指定界面语言，这样内嵌的老系统界面语言正确。
15. 作为使用者，我想调缩放比例，这样高 DPI 屏上字不至于太大。
16. 作为使用者，我想在显卡驱动有问题时禁用 GPU，这样窗口不会花屏。
17. 作为使用者，在本机没装 Chrome 时，我想看到明确的"没找到 Chrome"提示（最好带上找过哪些路径），而不是静默失败或打开别的浏览器。
18. 作为使用者，我想同一站点重复点「打开」时不会报错（并入既有实例、新开一个应用窗口即可）。
19. 作为扩展维护者，我想同一名称（不分大小写）不能建两条，这样不会两条条目共用一个 profile 目录。
20. 作为扩展维护者，我想名称里的非法字符被拒并给出建议名，这样不会创建出 Windows 打不开的目录。
21. 作为扩展维护者，我想升级扩展（覆盖安装）后条目列表与 profile 都还在。
22. 作为扩展维护者，我想卸载扩展时清楚知道浏览器数据会一起永久消失，这样我能在卸载前自行备份（D-1 结论 = A：接受现状 + 文档醒目声明）。
22b. 作为扩展维护者，我想从 README 里直接复制到一条"卸载前备份 profile"的命令，这样不必自己拼路径。
22c. 作为扩展维护者，我想确认卸载钩子**不会**去做搬运 profile 这种注定失败且会造成"以为备份了"错觉的事（D-1 明令禁止）。
26. 作为使用者，我想在设置里定一个"单站点数据上限"（默认 2 GB），这样个别站点不会把 C 盘悄悄撑爆（R17）。
27. 作为使用者，我想这个上限**能关掉**（设为"不限制"），这样某些大站点不必被反复打扰。
28. 作为使用者，我想在打开一个超限站点时先被**拦住**并看到"当前占多少、上限多少、缓存能省多少"，而不是被静默拒绝或静默放行。
29. 作为使用者，我想在超限时能选「清理缓存并打开」——**清掉的是网页缓存，我的登录状态必须还在**。
30. 作为使用者，我想在超限时也能选「仍然打开」，这样我清楚风险、但今天就想用它。
31. 作为使用者，我想有一个「清理全部缓存」按钮，一次性把各站点的缓存清掉（登录态都保留），这样磁盘紧张时不用逐条点。
32. 作为使用者，我想在卡片上**按需**看到某个站点当前占多少（有个「查看体积」入口），而不是列表一打开就卡住。
33. 作为使用者，我想知道"缓存上限"（`--disk-cache-size`）和"目录上限"是两件不同的事，否则我会以为设了缓存上限就不会撑爆磁盘。
34. 作为使用者，我不想让扩展自动删我的东西——清理必须是我点出来的、告诉我删了什么的（返回可审计）。
23. 作为扩展维护者，我想 `.oix` 包里不含运行期数据，这样安装器不会拒绝、也不会覆盖用户数据。
24. 作为实现者，我想参数拼装是纯函数、可单测，这样"Chrome 参数对不对"不依赖真机手工点。
25. 作为实现者，我想助手只接受固定方法名与参数结构，不接受任意命令行透传，这样扩展不成为任意命令执行通道。

## 8. 用户流程

### 8.1 主流程

```
打开 obox → App（应用）卡片视图 → 点「网页应用」卡片
  → 子窗口（1024×720，无地址栏，标题「网页应用」）
     ├─ 加载中：列表骨架
     ├─ 空态：「还没有网页应用」+「＋ 新建」
     └─ 列表（每项一张卡片）：
          [名称]                          [TLS 已降级 ⚠]   ← R15 标记（仅 ignoreCert=true）
          [网址]（单行，超长省略号）
          [说明]（单行灰字，可空）
          [打开] [编辑] [删除]
「＋ 新建」→ 模态框：名称* / 网址* / 说明 / ☑忽略证书问题（默认勾选）
          + 「▸ 高级选项」折叠区（6 个白名单开关，全部可留空）
  → 保存 → 校验通过 → 条目立刻出现在列表顶部 + 底部状态栏「已新建网页应用 X」
「打开」→ 状态栏「正在打开 X…」→ 成功：「已打开 X」；失败：「打开 X 失败：<原因>」
「编辑」→ 同模态框（名称预填当前值）→ 保存（改名时先搬 profile 再落库）
「删除」→ 确认框（写明不可恢复）→ 确认 → 删条目 + 删 profile
```

### 8.2 失败路径

| 场景 | 用户看到 |
|---|---|
| 未装 Chrome | 状态栏红字：「未找到 Chrome（已查找：<路径1>；<路径2>；…），请安装 Google Chrome 后重试」。条目不进任何"运行中"状态 |
| profile 目录被占用（删除时） | 状态栏红字：「无法删除 X 的浏览器数据（可能窗口正开着），请先关闭该站点的浏览器窗口后重试」。**条目不删、数据不变** |
| 改名时目录移动失败 | 保存失败，模态框内红字：「无法把浏览器数据目录从 A 改名为 B（<底层原因>），条目名称未修改」 |
| `name` 非法字符/保留名/超长 | 字段级红字（名称列下方）：「名称包含不能用于目录的字符，建议改为：`内网-运维平台`」 |
| `name` 重复（大小写不敏感） | 字段级红字：「名称「Intranet」已存在，请换一个」 |
| `url` 非法协议 | 字段级红字：「网址只能是 http:// 或 https:// 开头」 |
| 白名单开关取值非法 | 字段级红字，如：「窗口宽度必须是 320–7680 的整数」 |
| 开关未生效（同一 profile 已有实例） | 状态栏提示（成功文案后缀）：「已打开 X（若窗口开关未生效，请先关闭该站点的浏览器窗口再打开）」 |
| 扩展侧超时 | 状态栏红字：「打开 X 失败：请求 launch 超时（60000ms）」 |

## 9. 模块与文件清单

### 9.1 与 `rdp` 的对应关系（哪些照搬、哪些必须不同）

| `rdp` 文件 | webapp 对应 | 处置 | 理由 |
|---|---|---|---|
| `manifest.json` | `manifest.json` | **照搬结构**，改 name/displayName/description/channel id | 通道声明形态完全同构 |
| `index.js` | `index.js` | **照搬骨架**（懒连通道、`ok/fail` 信封、`resolveRequest`、`toId`、cleanup、`uninstall` 导出），**换方法集与业务** | 消息契约、错误信封、重连语义已验证 |
| `helper.cjs` | `helper.cjs` | **照搬协议外壳**（JSON-RPC 2.0 + ndjson + stderr 日志 + `--selftest`），**换方法集**：探测 Chrome、启动、profile 维护 | 协议外壳是被宿主强制的（`ipcCore.ts:229-236`） |
| `lib/rdpFile.mjs` | `lib/chromeArgs.mjs` | **必须不同**：一个生成 `.rdp` 文本，一个生成 Chrome 参数数组 | 参数拼装是本扩展的核心纯逻辑 |
| `lib/connection.mjs` | `lib/webapp.mjs` | **必须不同**：字段/校验/净化规则完全不同 | — |
| `lib/cmdkeyArgs.mjs` | `lib/nameSanitize.mjs` | **必须不同**：一个拼 cmdkey 参数，一个做 Windows 目录名净化与保留名判断 | — |
| `src/` Vue 子应用 | `src/` Vue 子应用 | **照搬结构**（`App.vue` + `components/*` + `bridge.js` + `styles.css` + `theme.js` + `index.html` + `main.js`），**换 fields/文案/字段集**，新增 `TlsBadge` 语义（可并进卡片） | 界面规范 R14 是"沿用"，最省事且不易漂移 |
| `src/fields.js` | `src/fields.js` | **必须重写**：字段表完全不同（webapp 只有 4 + 6 个字段） | — |
| `ui/`、`vite.config.mjs`、`package.json` | 同名 | **照搬**（`base:'./'`、`format:'iife'`、`outDir: ui/`、`target: chrome120`） | `app://` 下必须相对路径 + 单文件产物 |
| `scripts/pack.mjs` | `scripts/pack.mjs` | **照搬**（零依赖 stored zip、白名单收集、`data/` 硬闸门、自检），改 `INCLUDE` 去掉不需要项 | 已验证且零依赖 |
| `test/**` | `test/**` | **照搬组织方式**（`node --test`、纯逻辑单测 + helper 子进程集成测 + 源码门禁），**换用例** | — |
| `README.md`、`docs/` | 同名 | **必须新写**：webapp 特有的 TLS 降级风险、profile 占用、打包与发布 | — |
| `docs/adr/*` | `docs/adr/*` | **按 obox 流程**在实现阶段产出（`skills/obox-ext-dev/references/workflow.md:84-92`） | 本阶段不写 ADR |

### 9.2 目标结构（`extensions/webapp/`，独立仓库）

```
extensions/webapp/
├── manifest.json                  # 扩展清单（见 §10）
├── index.js                       # 扩展入口（纯 ESM）：注册 App 卡片 + onMessage 方法集 + uninstall 钩子
├── helper.cjs                     # stdio 助手（纯 Node / CJS）：探测 Chrome、spawn Chrome、profile 维护
├── lib/
│   ├── chromeArgs.mjs             # 【纯】参数数组构造 + origin 推导 + 白名单校验（R9–R11）
│   ├── nameSanitize.mjs           # 【纯】名称净化、保留名判断、长度预算（R5）
│   └── webapp.mjs                 # 【纯】归一/校验/DB 行互转/字段白名单（R3、R6）
├── src/                           # Vue 3 子应用源码（构建期依赖，不进 .oix）
│   ├── index.html
│   ├── main.js
│   ├── App.vue
│   ├── bridge.js                  # 子窗口 ↔ 宿主消息桥（照搬 rdp）
│   ├── theme.js                   # 宿主主题 token 兜底表 + obox-theme 监听（照搬）
│   ├── styles.css                 # 只消费宿主 token（照搬 + 按 webapp 字段裁剪）
│   ├── fields.js                  # 字段表：COMMON_GROUPS / ADVANCED_GROUPS / validate / buildSavePayload
│   └── components/
│       ├── WebappCard.vue         # 每项一行标题 + 一行灰说明 + TLS 降级标记 + 三个按钮
│       ├── WebappField.vue        # 字段控件（照搬 ConnectionField.vue 的落位规则）
│       ├── WebappModal.vue        # 新建/编辑模态框（只能按钮关闭）
│       ├── DeleteConfirm.vue      # 删除二次确认（含不可恢复提示）
│       ├── OverLimitModal.vue     # 【R17】体积超限拦截模态框（当前占用/上限/可清缓存 + 三个按钮）
│       ├── EmptyState.vue
│       └── StatusBar.vue
├── test/                          # node --test（零依赖）
│   ├── chromeArgs.test.js         # 参数数组、origin、白名单边界、两个下拉枚举
│   ├── nameSanitize.test.js       # 净化、保留名、长名、尾部点/空格
│   ├── webapp.test.js             # 归一/校验/DB 行互转/字段白名单/枚举常量
│   ├── fields.test.js             # 表单默认值、buildSavePayload、字段级文案
│   ├── fieldDocs.test.js          # 【D-3】两个下拉的选项内说明门禁（真实断言）
│   ├── settings.test.js           # 【R17】设置归一/回落/换算/变更失效/formatBytes/超限边界
│   ├── manifest-settings.test.js  # 【R17】contributes.settings 形状与键名门禁（脚本不查 settings）
│   ├── helper.test.js             # helper 子进程 ndjson 往返 + --selftest
│   ├── helperProfile.test.js      # probe 探测顺序（真实机器）、move/remove 占用检测
│   ├── helperCache.test.js        # 【R17】只清缓存：保留清单逐字节不变 + 白名单 + 深度 2
│   ├── helperSize.test.js         # 【R17】体积统计与 TTL 失效语义
│   ├── pack.test.js               # 【R16】data/ 排除的三层钉法之一
│   ├── uninstall.test.js          # 【D-1/R16】install/uninstall 不得触碰 profile 的源码门禁
│   └── componentSource.test.js    # 源码门禁：模态框无 Esc/遮罩关闭；零自造色值；TLS 标记；删除确认关键词
├── scripts/pack.mjs               # 零依赖 .oix 打包
├── vite.config.mjs
├── package.json
├── package-lock.json
├── .gitignore                     # node_modules/ out/ ui/ data/
├── .prettierignore
├── README.md
├── LICENSE
├── icon.svg
└── docs/
    ├── spec/                      # 实现完成后从 .spec-workflow 归档
    ├── adr/
    └── evidence/
```

### 9.3 每个文件的职责与预计规模

| 文件 | 职责 | 预计规模 |
|---|---|---|
| `manifest.json` | 清单：`name/version/displayName/author/apiVersion/main/contributes.ipcChannels` | 20 行 |
| `index.js` | 入口：`api.app.register`（一张卡片）、`api.app.onMessage` 方法集（§11.1）、`api.sqlite` 懒开库、`api.ipc` 懒连通道（60s 超时）、返回 cleanup、具名导出 `uninstall(ctx)` | 380–450 行 |
| `helper.cjs` | JSON-RPC 2.0 ndjson 循环；方法 `probe` / `launch` / `profileStatus` / `moveProfile` / `removeProfile`；`--selftest`；stdout 只放协议帧、日志走 stderr | 420–500 行 |
| `lib/chromeArgs.mjs` | `deriveOrigin(url)`、`validateWhitelist(fields)`、`buildChromeArgs(entry, profileDir, opts)`（确定性顺序，含 `--disk-cache-size`）、`describeLaunch()`（脱敏摘要） | 190–250 行 |
| `lib/nameSanitize.mjs` | `sanitizeName(name)`、`isReservedName(base)`、`assertNameLength(name, profileRoot)`、`suggestName(name)` | 120–160 行 |
| `lib/webapp.mjs` | `normalizeWebapp(input)`、`validateWebapp(entry, rows)`、`toDbRow` / `fromDbRow`、列清单与默认值、`WHITELIST_KEYS`、`LANG_VALUES` / `SCALE_VALUES` | 200–280 行 |
| `lib/profileLimit.mjs` | 【R17】纯逻辑：`normalizeProfileLimitMb` / `normalizeDiskCacheMb`（含枚举回落）、`mbToBytes`、`isOverLimit(used, limit)`、`formatBytes`、`CACHE_DIR_NAMES`（白名单常量，被 helper 与测试共用） | 120–160 行 |
| `src/fields.js` | 字段描述表（含每字段一行 `desc`、下拉 `options[].label/desc`）、`defaultForm`、`rowToForm`、`buildSavePayload`、`validate`（与 `lib/webapp.mjs` 同口径） | 220–300 行 |
| `src/App.vue` | 列表页骨架：sticky header（56px）、卡片网格、空态、底部状态栏（40px）、模态框挂载、乐观更新 + 失败回滚 + 对账 | 300–360 行 |
| `src/components/WebappCard.vue` | 单条目卡片：标题行（名称 + TLS 标记）、一行网址、一行灰说明、动作按钮 | 90–120 行 |
| `src/components/WebappModal.vue` | 新建/编辑模态框：字段分组、高级折叠区、实时校验、提交中 spinner | 180–230 行 |
| `src/components/WebappField.vue` | 按 fields.js 渲染控件（text/number/check/select/pair），说明行与错误行落在控件列 | 150–190 行 |
| `src/components/OverLimitModal.vue` | 【R17】体积超限拦截模态框：占用/上限/可清缓存数字 + 三个按钮（清理缓存并打开 / 仍然打开 / 取消），只能按钮关闭 | 110–150 行 |
| `src/settings.js` | 【R17】设置读取与归一（`readProfileLimitMb` / `readDiskCacheMb` / `LANG_VALUES` 式归一 / `formatBytes` / `isOverLimit`）—— 纯函数，便于单测 | 100–140 行 |
| `src/styles.css` | 只消费宿主 token；`:root` 只加 `--radius/--radius-lg/--label-w` 三个布局变量 | 600–780 行 |
| `scripts/pack.mjs` | 白名单打包 + `data/` 硬闸门 + 回读自检 | 200 行 |
| `test/**` | 见 §18 | 合计 1100–1500 行 |
| `README.md` | 安装/使用/数据位置/风险/打包发布 | 250–350 行 |

**规模判据**：`rdp` 的对应文件为 `index.js` 437 行、`helper.cjs` 326 行、`src/App.vue` 349 行、`styles.css` 785 行、`test/` 合计约 12 个文件——上表与之同量级。

## 10. manifest 与身份

### 10.1 身份字段

| 字段 | 取值 | 说明 |
|---|---|---|
| `name` | `webapp` | 必须匹配 `/^[a-z0-9][a-z0-9._-]*$/`（**不含 `i`**，大写即 error）— `src/renderer/src/core/manifest.ts:11`（转述自 `skills/obox-ext-dev/references/manifest-reference.md:287`）、`skills/obox-ext-dev/scripts/validate-manifest.mjs:36` |
| `version` | `1.0.0` | semver（`manifest-reference.md:288`、`validate-manifest.mjs:38`） |
| `displayName` | `网页应用` | App 卡片标题与子窗口标题 |
| `author` | `chenzhi` | 决定安装目录名：`webapp_chenzhi`（`src/main/oixCore.ts:56-60`） |
| `apiVersion` | `1` | 不得高于宿主根 `package.json` 的 `apiVersion`（当前 `1`，`validate-manifest.mjs:240-246`）。**本扩展不需要 `api.ipc.listen` / `autoReconnect` 之类新能力，因此可写 1** |
| `main` | `./index.js` | 入口（纯 ESM，`src/renderer/src/core/loader.ts:118-121`） |
| `description` | `网页应用：把内部站点以 Chrome 应用模式（--app）打开，按条目独立 profile，可按条目忽略证书错误` | 卡片简介 |

**推导出的运行期事实（规格内必须统一口径）**：

- 安装目录名 = **扩展 id** = `webapp_chenzhi`
- 数据目录（`api.sqlite` / `api.fs` / helper 的 `cwd`）= `%APPDATA%\obox\extensions\webapp_chenzhi\data`
- profile 根目录 = `<数据目录>/chrome`
- 开发（`--debug-extension webapp@<本地路径>`）时 id 为 `webapp`，数据目录随之不同（`src/main/extensionDirs.ts:33-39`）。**验收"升级保留数据"必须用安装态跑**（`extensions/rdp/README.md:209` 记录过同类坑）

### 10.2 贡献点

**只贡献一个 App 卡片 + 一个扩展设置页**（后者是 R17 的新增需求，见 §10.4）：

- 清单 `contributes` 有**两项**：
  1. `ipcChannels`（一条）：`{ id: "webapp.helper", transport: "stdio", program: "./helper.cjs", framing: "ndjson" }`
  2. `settings`（一页）：见 §10.4 的确切 schema
- **不**贡献 `navItems` / `statusBarItems` / `commands` / `views` / `themes` / `keybindings` / `menus` / `i18n` / `updater`（R1 的"只一张 App 卡片" + R17 的"一个设置页"；多一个都算越界）
- App 卡片经 `api.app.register({...})` 在 `index.js` 里注册（`src/api/registration.ts:8-33`）；字段取值见 §11.3
- 通道 id 必须匹配 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` 且不含 `..`（`src/shared/ipcDeclaration.ts:71-78`）
- 通道声明只需 `program` 相对扩展目录，禁止绝对路径/盘符/`..`（`src/shared/ipcDeclaration.ts:108-129`）
- `framing: "ndjson"` 必须显式声明（默认是 `content-length`，`src/shared/ipcDeclaration.ts:11,101-106`）
- 声明后代码里只写 `api.ipc.connect('webapp.helper')`；**不自动连接**（`manifest-reference.md:274`）

### 10.3 最小可通过清单示例

以下清单是 `node skills/obox-ext-dev/scripts/validate-manifest.mjs <path>` 能通过的**最小形态**（通过 = 0 error；warning 允许）：

```json
{
  "name": "webapp",
  "version": "1.0.0",
  "displayName": "网页应用",
  "author": "chenzhi",
  "apiVersion": 1,
  "description": "网页应用：以 Chrome 应用模式打开内部站点，按条目独立 profile，可按条目忽略证书错误",
  "main": "./index.js",
  "contributes": {
    "ipcChannels": [
      {
        "id": "webapp.helper",
        "transport": "stdio",
        "program": "./helper.cjs",
        "framing": "ndjson"
      }
    ],
    "settings": {
      "id": "webapp.settings",
      "title": "网页应用",
      "fields": [
        {
          "key": "webapp.profileLimitMb",
          "label": "单站点数据上限",
          "type": "select",
          "default": "2048",
          "options": [
            { "value": "0", "label": "不限制（不推荐）" },
            { "value": "512", "label": "512 MB（缓存上限 512 MB）" },
            { "value": "1024", "label": "1 GB（缓存上限 512 MB）" },
            { "value": "2048", "label": "2 GB（缓存上限 512 MB）— 默认" },
            { "value": "4096", "label": "4 GB（缓存上限 512 MB）" },
            { "value": "8192", "label": "8 GB（缓存上限 512 MB）" }
          ],
          "description": "单个站点的浏览器数据目录超过该值后，打开前会拦截并提示清理缓存（保留登录态）。0 = 不检查、不拦截。"
        },
        {
          "key": "webapp.diskCacheMb",
          "label": "HTTP 缓存上限",
          "type": "select",
          "default": "512",
          "options": [
            { "value": "0", "label": "用 Chrome 默认" },
            { "value": "128", "label": "128 MB" },
            { "value": "512", "label": "512 MB — 默认" },
            { "value": "1024", "label": "1 GB" }
          ],
          "description": "传给 Chrome 的 --disk-cache-size；只限制 HTTP 缓存，不影响 Cookie 与登录态，也不等于上面的“单站点数据上限”。"
        }
      ]
    }
  }
}
```

**校验命令与期望**（与 `rdp` 同一套）：

```
node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json
# → [validate-manifest] ✓ …: 通过 ；共 1 个 manifest：0 个 error、0 个 warning
# 退出码 0
```

**为什么这个形态能过**（逐条对应校验规则）：

- `name` 全小写匹配 `NAME_RE`（`validate-manifest.mjs:36,230-232`）
- `version` 匹配 `SEMVER_RE`（`:38,233-235`）
- `apiVersion: 1` 未超过宿主 `package.json` 的 `apiVersion`（`:236-246`）
- `main` 非空字符串（`:247-249`）
- `contributes` 是对象，`ipcChannels` 是数组、逐项合法、id 唯一（`:250-259`、`:129-141`）
- `program: "./helper.cjs"` 归一化后是 `helper.cjs`，不含前导 `/`、盘符或 `..`（`:103-113`）
- **`settings` 只做"`contributes` 必须是对象"这一层校验**：`validate-manifest.mjs` **不检查** `settings` 的形状（`:250-252`），宿主侧同样只做 `if (c.settings)` 真值判断（`src/renderer/src/core/host.ts:179`）→ 因此 §10.4 的 schema 必须由本规格自己钉住（字段名拼错不会报错，只会静默不显示）
- 不声明其它数组键 → 不触发形状 error，也不触发 warning

### 10.4 扩展设置页 schema（R17，`contributes.settings`）

> **可行性已核实**：用户扩展**可以**声明 `contributes.settings`，宿主在注册贡献点时把它塞进 `extensionSettingsStore`（`src/renderer/src/core/host.ts:179`），设置视图渲染在"设置 → 扩展 → <扩展名>"节点下，支持 `text` / `number` / `boolean` / `select` 四种字段（`src/renderer/src/extensions/settings/SettingsView.vue:544-581`）。存储走宿主统一设置存储（`api.settings.get/set` 落在 `stateStore`，`host.ts:432-440`），扩展侧读取用 `api.settings.get(key, default)`（`src/api/types.ts:176-185`）。

**字段定义**（`SettingField`，`src/api/contributions.ts:76-89`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | ✅ | 设置存储的键；**必须含扩展前缀**（本扩展用 `webapp.`） |
| `label` | string | ✅ | 设置项显示名 |
| `type` | `'text' \| 'number' \| 'boolean' \| 'select'` | ✅ | — |
| `default` | unknown | ❌ | 默认值 |
| `options` | `Array<{ value: string; label: string }>` | ❌ | 仅 `select` |
| `description` | string | ❌ | 字段下方一行说明（宿主渲染 `.config-desc`，`SettingsView.vue:580`） |

**⚠️ 已核实的能力缺口（决定了两处设计取舍）**：

1. **`SettingField` 没有 `min` / `max` / `step` / `unit` 字段**（`src/api/contributions.ts:76-89`），且宿主的 `number` 输入框**不设 `min`/`max` 属性**（`SettingsView.vue:552-560`）→ **无法用 `number` 类型做"最小/最大值"约束**。因此本规格的"上限"一律用 **`select` 枚举**表达（枚举本身就完成了取值约束），单位写进 `label` 与 `description`。
2. **`contributes.settings` 的形状不被任何校验覆盖**（见 §10.3 最后一条）→ 键名/类型写错只会静默不显示；因此必须由 `test/manifest-settings.test.js` 单测钉住（见 §18.1）。

**本扩展使用的两个设置项（R17 全部所需，不多不少）**：

| 键 | 类型 | 默认 | 可选值（`value` 是字符串） | 语义 |
|---|---|---|---|---|
| `webapp.profileLimitMb` | `select` | `"2048"`（**2 GB**） | `0`（不限制） / `512` / `1024` / `2048` / `4096` / `8192` | **单站点 profile 目录上限（MB）**。`0` = 不做体积预检、不拦截（用户显式关闭） |
| `webapp.diskCacheMb` | `select` | `"512"` | `0`（用 Chrome 默认） / `128` / `512` / `1024` | 传给 Chrome 的 `--disk-cache-size`（MB）。`0` = **不传该参数**，用 Chrome 默认 |

**规范化与容错（实现口径）**：

- 读取：`api.settings.get('webapp.profileLimitMb', '2048')`；`api.settings.get('webapp.diskCacheMb', '512')`
- 归一：`Number.parseInt(String(v), 10)`；非有限数、负数、**不在枚举清单内** → 回落到默认值（`2048` / `512`），并 `console.warn` 一次
- 单位换算：`limitBytes = profileLimitMb * 1024 * 1024`；`--disk-cache-size` 用**字节**（R17 要求固定 512 MB ⇒ `536870912`）
- 变更响应：`api.settings.onChanged((key) => …)`（`src/api/types.ts:184`）——收到任一 `webapp.*` 变更就**作废体积缓存**（§14.6），使下一次「打开」用新上限判定
- **不做每连接覆盖**（用户明确要求"上限由用户在设置里定义"）：§13.2 的表**不新增**任何"上限"列

**注意：这是本扩展唯一的"贡献点清单"变化**：R1 原本限制"只一张 App 卡片"，R17 追加"一个设置页"；两者合起来仍不贡献导航项/状态栏/命令/树/主题/快捷键/菜单。

## 11. `api.ipc` 消息契约

### 11.1 子窗口 ↔ 扩展（`api.app.onMessage`，与 `rdp` 完全同构）

**信封（子窗口 → 宿主 → 扩展）**：

```js
// 子窗口（src/bridge.js）→ 宿主（AppWindow.vue:121-151）
{ source: 'obox-app', action: 'obox-extension', appId: 'webapp.main',
  channel: 'webapp', requestId: 'webapp-<ts>-<seq>',
  payload: { method: '<方法名>', payload: <入参> } }

// 宿主 → 子窗口（AppWindow.vue:126-136）
{ source: 'obox-app', action: 'obox-extension-reply', requestId,
  result: { ok: true, data } | { ok: false, error } }
```

- 扩展开关的 handler 返回值就是 `result` 里的 `data`（`src/api/types.ts:156-162`、`extensions/rdp/src/bridge.js:56-73`）
- 桥的**请求/响应超时 = 60s**，由宿主主进程计时（`src/main/appWindow.ts:163-167`）；`src/bridge.js` 本地也设 60s 兜底（照搬 `extensions/rdp/src/bridge.js:17,37-40`）
- handler 抛错 → 宿主把 `error` 原样回给页面（`src/main/appWindow.ts:181-187`）；本扩展**不抛错**，一律返回 `{ ok:false, error }`（与 `rdp` 一致，`extensions/rdp/index.js:71-74`）

**方法集（`index.js` 侧）**：

| 方法 | 入参 | 返回 `data` | 失败 `error` 文案（示例） |
|---|---|---|---|
| `list` | `{}` | `Array<Entry>`，按 `createdAt` 升序（界面自行倒序展示） | 读库失败 → 底层 message |
| `save` | `Entry`（或 `{ entry }`） | 保存后的 `Entry`（含 `id`） | 字段级错误用 `；` 连接；改名移动失败时给专门文案（§14.2） |
| `remove` | `{ id }` | `{ id, warnings: string[] }` | `[profile-busy] …请先关闭该站点的浏览器窗口`；`remove 需要合法的 id` |
| `open` | `{ id }` | `{ pid: number, warnings: string[] }` | `[chrome-not-found] …`；`未能拉起 Chrome（helper 回复：…）` |
| **`profileSize`** | `{ id, force?: boolean }` | `{ bytes, scannedAt, cached, limitBytes, overLimit: boolean, cacheBytes }` | 条目不存在时 `网页应用不存在（可能已被删除），请刷新列表` |
| **`cleanCaches`** | `{ id? }`（省略 = 全部条目） | `{ totalFreedBytes, cleaned: [...], skipped: [...] }` | `[clean-cache-failed] …` |
| `probe` | `{}` | `{ cwd, node, electron, runAsNode, chrome: { path, source, version }, chromeCandidates: [...] }` | 通道失败时把 `[code] message` 透出 |
| `profileInfo` | `{ id }` | `{ profileDir, exists, locked: boolean, sizeBytes?: number }` | 条目不存在时 `网页应用不存在（可能已被删除），请刷新列表` |

> **`profileSize` / `cleanCaches` 与 `profileInfo` 的分工（R17）**：
> - `profileInfo` = **磁盘状态**（目录在不在、是否被占用），用于删除/改名预检与卡片提示；**不返回体积**（体积查询走 `profileSize`，因为它可能很慢，必须能带缓存语义被单独调用）。
> - `profileSize` = **体积**（带时间戳缓存），用于「打开」前预检与卡片上的"按需"体积展示。
> - `cleanCaches` = **只清缓存**（保留 Cookie/登录态），用于超限拦截后的两个动作之一与全局一键清理。

> **`profileInfo` 的用途**：删除前预检占用、编辑时展示将要移动的目录、以及"条目在库但目录已手工删除"的对账。它属于"读"，不改变任何状态。
> **不提供** `openInDefaultBrowser`、`close`、`rename`（改名走 `save`）、`import/export`（§6 非目标）。

### 11.2 扩展 ↔ 助手（`api.ipc` + `helper.cjs`）

**传输与分帧（宿主强制）**：

- `transport: "stdio"`，`framing: "ndjson"`（一行一条 JSON）
- 请求必须是 JSON-RPC 2.0：`{"jsonrpc":"2.0","id":<number>,"method":"<m>","params":{…}}`
- 缺 `jsonrpc: "2.0"` → 宿主立刻以 `protocol-error` 关通道（`src/main/ipcCore.ts:229-236`；`extensions/rdp/helper.cjs:11-14` 记录过真机后果）
- 响应：`{"jsonrpc":"2.0","id":<same>,"result":{…}}` 或 `{"jsonrpc":"2.0","id":<same>,"error":{"code":<int>,"message":"…"}}`
- **stdout 只放协议帧**；所有日志走 stderr（宿主经 `api.ipc.onStderr` 转发，`src/api/types.ts:503-504`）
- 助手进程由宿主用 Electron 二进制 + `ELECTRON_RUN_AS_NODE=1` 拉起（`src/main/ipcCore.ts:612-627`），`cwd = <扩展目录>/data`（`src/main/ipc.ts:453`）→ **助手可以直接用相对路径 `chrome/<name>` 操作 profile**
- 通道 id `webapp.helper`；额度：每扩展最多 4 条通道（`src/main/ipc.ts:43`，转述自 `skills/obox-ext-dev/references/api-reference.md:672`），本扩展只用 1 条

**助手方法集与契约对照表（与 `rdp` 对照）**：

| webapp 方法 | 入参 | 返回 | rdp 对应方法 | 差异与理由 |
|---|---|---|---|---|
| `probe` | `{}`（**零入参语义；任何额外键都被静默忽略 —— D-2 = C：不做测试专用注入**） | `{ cwd, node, electron, runAsNode, chrome: { path, source, version } \| null, chromeCandidates: [{ path, exists }] }`（`chromeCandidates` 恒为 **4 项、顺序固定**） | `probe`（`helper.cjs:188-195`） | rdp 只回环境；webapp 必须**额外回 Chrome 探测结果**（R8）以便界面「环境检查」与错误自解释。**D-2 = C**：签名里**不得**出现 `chromeProbePaths` / `skipRegistry` / `OBOX_WEBAPP_CHROME` 或任何仅测试用的键/环境变量；探测顺位与"全不命中"两条分支改由 §18.3.1 手工真机验收覆盖（已接受的风险 R-W11） |
| `launch` | `{ args: string[], exe?: string, detached?: true }` | `{ pid: number, exe: string, summary: string }` | `launch`（`helper.cjs:164-185`） | **关键差异**：rdp 由助手生成 `.rdp` 文件内容再 spawn；webapp 的**参数由扩展侧纯函数生成**（可单测），助手只做"探测 exe + spawn + 回 pid"。助手**不接受任意参数透传**：必须校验 `args[0]` 以 `--app=` 开头，且 `args` 只允许 §12 的白名单前缀（见下） |
| `profileStatus` | `{ name: string }` | `{ dir: string, exists: boolean, locked: boolean }` | 无 | 新增：删除/改名前的占用预检（R13 / R4） |
| **`profileSize`** | `{ name: string, ttlMs?: number, force?: boolean }` | `{ dir: string, exists: boolean, bytes: number \| null, scannedAt: string, cached: boolean, expiresAt: string, entries: number, cacheBytes: number \| null }` | 无 | **新增（R17）**：量 profile 目录体积。`bytes: null` = 目录不存在（未首次打开）。`cached: true` = 命中时间戳缓存（§14.6）。`cacheBytes` = 可清理的缓存类子目录体积合计 |
| **`cleanCaches`** | `{ name?: string }`（省略 = **全部条目**的 profile 根） | `{ cleaned: Array<{ name: string, freedBytes: number, removedDirs: string[] }>, totalFreedBytes: number, skipped: Array<{ name: string, reason: string }> }` | 无 | **新增（R17）**：**只删缓存类子目录**（白名单见 §14.5），保留 Cookie/登录态。按目录逐个删，被占用/权限失败只记入 `skipped`，**不抛错**（与 `deleteCredential` 的"缺条目不算失败"同口径） |
| `moveProfile` | `{ from: string, to: string }` | `{ moved: true, from, to }` | 无 | 新增：改名搬目录（R4）。失败抛 `-32603`，message 带 `[profile-move-failed]` 前缀 |
| `removeProfile` | `{ name: string }` | `{ removed: boolean, dir: string }` | `deleteCredential`（近似：都不是致命失败） | 新增：删 profile 目录（R13）。占用时抛 `-32603`，message 带 `[profile-busy]` 前缀 |
| `--selftest`（CLI 参数，非 RPC 方法） | — | 退出码 0/1 | `--selftest`（`helper.cjs:285-316`） | 照搬形态：不真的启动 Chrome，只验证参数校验与目录操作 |

**`launch` 的参数校验（助手侧，硬白名单）**：

助手依次校验，任一不满足即以 `-32602` 拒绝：

1. `params.args` 必须是数组、长度 1–16、每项是字符串、单项长度 ≤ 512。
2. `args[0]` 必须以 `--app=` 开头，且 `--app=` 后面必须是 `http://` 或 `https://` 开头的 URL（**不信任扩展侧已校验**）。
3. 其余每一项的去参数名前缀（到第一个 `=` 为止）必须落在固定集合内：
   `--user-data-dir`、`--disable-features`、`--ignore-certificate-errors`、`--unsafely-treat-insecure-origin-as-secure`、`--window-size`、`--window-position`、`--start-maximized`、`--lang`、`--force-device-scale-factor`、`--disable-gpu`、**`--disk-cache-size`**（R17）。
4. `--user-data-dir=` 的值必须是**相对路径**（相对于助手 cwd），只允许单层目录名 `chrome/<净化名>`，禁止 `..`、盘符、绝对路径（助手只允许操作自己的 profile 根）。
5. **`--disk-cache-size=` 的值必须是纯十进制正整数**（`/^\d+$/`），且 `1 ≤ n ≤ 17179869184`（16 GB）；不满足 → `-32602`。
6. 不允许出现 `--`、`--remote-debugging-port`、`--load-extension`、`--proxy-server`、任一参数出现两次等。

> 这条白名单是"不成为任意命令执行通道"的实现落点（阶段 1「权限、安全与审计」）。**扩展侧与助手侧各校验一次**（双保险）。
>
> **D-3 后的不变项**：`--lang` 与 `--force-device-scale-factor` 仍是白名单里的两个前缀，取值集的收紧发生在**扩展侧**（枚举校验）；**助手侧仍只校验前缀与一般形状**（单项 ≤ 512 字符、不重复、不是 `--`），不重复实现枚举清单——助手不承担业务校验，只承担"不得透传任意参数"的边界。

**超时口径**：

| 调用 | 宿主 `request` 的 `timeoutMs` | 理由 |
|---|---|---|
| `connect('webapp.helper')` | 不适用（`connect` 无超时参数） | 首次连接失败会抛 `[connect-failed] …`（`src/renderer/src/core/host.ts:1233-1246`） |
| `probe` | `60_000` | 探测要跑若干 `fs.access` + 注册表读取，正常 < 1s，给足余量 |
| `launch` | `60_000` | Chrome 冷启动 + 大 profile 初始化可能十几秒；`rdp` 也显式放宽到 60s（`extensions/rdp/index.js:155-157`） |
| `profileStatus` | `30_000` | 默认值即可（`src/main/ipcCore.ts:25`） |
| `moveProfile` | `300_000` | 同卷 rename 正常是毫秒级；给 5 分钟只为覆盖异常慢的磁盘，超时属异常 |
| `removeProfile` | `300_000` | profile 可能 GB 级（R-5），删除耗时与体积成正比 |
| **`profileSize`** | `120_000` | 首次全量扫盘：GB 级目录、数万文件的递归 `stat` 在机械盘上可能数十秒；命中缓存时 < 10ms。给 2 分钟覆盖冷盘 |
| **`cleanCaches`** | `300_000` | 只删缓存类子目录，但一个 `Cache/` 可能有数万个小文件；"清理全部"要遍历所有条目 |

> 宿主默认 30s（`src/main/ipcCore.ts:25,340-348`）；**不显式放宽就会由宿主先报 `[timeout] 请求 launch 超时（30000ms）`**，而助手仍在启动 Chrome——这正是 `rdp` 注释里记录过的坑（`extensions/rdp/index.js:154-156`）。

**错误码口径**：

宿主 `api.ipc` 的稳定错误码（`src/main/ipcCore.ts:32-47`，`src/api/types.ts:415-417`），扩展侧按 `err.code` 分支、不解析 message 文本。`IpcCoreError` 的 message 形如 `[timeout] 请求 launch 超时（30000ms）`（`src/main/ipcCore.ts:49-56`）：

| 宿主码 | 触发 | webapp 侧的处置 |
|---|---|---|
| `invalid-declaration` | 清单没声明 `webapp.helper` → `[invalid-declaration] 清单里没有声明通道 webapp.helper（contributes.ipcChannels）`（`src/renderer/src/core/host.ts:1239-1243`） | 说明 manifest 写错，界面报该文案；不重试 |
| `connect-failed` | 助手起不来（`helper.cjs` 缺失/Node 启动失败） | 界面「无法启动扩展助手（<message>）」，提示重装 `.oix` |
| `not-connected` | 尚未连接 / 重连窗口期 | 重连一次后重试该请求（本扩展不声明 `autoReconnect`，走 `onClose` 手动重置） |
| `timeout` | 见上表 | 界面「请求 <method> 超时（<n>ms）」；不重试（避免重复启动 Chrome） |
| `protocol-error` | 助手输出的帧不合 JSON-RPC 2.0 / stdout 混入非协议内容 | 视为实现缺陷，界面报文案并 `console.error` |
| `peer-crashed` | 助手进程异常退出 | 清 `connecting`，下次调用重连（照搬 `extensions/rdp/index.js:166-172`） |
| `channel-closed` | 通道被关闭 | 同上 |
| `message-too-large` / `too-many-requests` | 单条 > 8MB / 并发 > 64 | 当前方法体量远达不到；出现即缺陷 |

**扩展自定义错误码（message 前缀，便于界面区分与排查）**：

| 码 | 产生方 | message 形态 | 界面文案 |
|---|---|---|---|
| `[chrome-not-found]` | 助手 `launch`/`probe`，或扩展侧归一 | `[chrome-not-found] 未找到 Chrome（已查找：<p1>；<p2>；<p3>；注册表 App Paths\chrome.exe）` | 原样展示（**绝不回退 Edge**，R8） |
| `[profile-busy]` | 助手 `removeProfile`/`profileStatus` | `[profile-busy] profile 目录被占用：<dir>` | 「无法删除 X 的浏览器数据（可能窗口正开着），请先关闭该站点的浏览器窗口后重试」 |
| `[profile-move-failed]` | 助手 `moveProfile` | `[profile-move-failed] 无法把 <from> 改名为 <to>（<底层 errno/message>）` | 「无法把浏览器数据目录从 A 改名为 B（<原因>），条目名称未修改」 |
| `[profile-missing]` | 助手 `moveProfile`（源不存在） | `[profile-move-failed] 源目录不存在…`（同一码，附 `missing: true`） | 非错误路径：源不存在按"无需移动"处理，直接落库 |
| `[spawn-failed]` | 助手 `launch` | `[spawn-failed] 启动 Chrome 失败：<errno>` | 「启动 Chrome 失败：<原因>」 |
| `[profile-size-failed]` | 助手 `profileSize` 顶层失败（目录既不可读也不存在之外的异常，如 EACCES） | `[profile-size-failed] 无法统计 <dir>：<errno>` | 「无法读取 X 的数据目录大小（<原因>），本次不做体积拦截」——**降级放行**（体积检查不是安全边界，不能挡住打开） |
| `[clean-cache-failed]` | 助手 `cleanCaches` **整体**失败（连 `chrome/` 都读不到） | `[clean-cache-failed] 无法清理缓存：<errno>` | 「清理缓存失败：<原因>」 |
| （无独立码） | 助手 `cleanCaches` 的**单目录**失败 | 记入返回值的 `skipped[]`（带 `reason`），**不抛错** | 状态栏提示「已清理 N 项，M 项被跳过（可能窗口正开着）」 |

**Chrome 探测顺序（R8，确定性，助手侧唯一实现）**：

```
1. %ProgramFiles%\Google\Chrome\Application\chrome.exe
2. %ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
3. %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
4. 注册表 HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe 的默认值
   （并兼容 HKCU 同名键，仅当 HKLM 缺失时读）
→ 全部失败：抛 [chrome-not-found]，message 里按顺序列出 1–4 的最终绝对路径
```

- 每一处用 `fs.access(exe, fs.constants.X_OK)` 判存在性
- `probe.chrome.source` 取值：`programfiles` / `programfiles-x86` / `localappdata` / `registry` / `null`
- 注册表读取用 `reg.exe query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve`（纯 Node 无原生依赖；**不引入 npm 包**，见 §18.4）
- 探测结果**每次调用都重新算**，不缓存（避免用户安装 Chrome 后必须重启 obox）。开销：3 次 `fs.access` + 1 次 `reg query`（约 10–30ms）

### 11.3 App 卡片注册（`api.app.register`）

```js
api.app.register({
  id: 'webapp.main',
  name: '网页应用',
  version: '1.0.0',
  author: 'chenzhi',
  description: '网页应用：以 Chrome 应用模式打开内部站点',
  icon: CARD_ICON,                                   // 内联 SVG 字符串（单色，随主题）
  url: new URL('./ui/index.html', new URL('.', import.meta.url)).href,  // 必须用 import.meta.url 推导
  multiOpen: false,                                  // 重复点击聚焦已有窗口
  width: 1024,
  height: 720
})
```

- `id` 建议含扩展名前缀（`src/api/registration.ts:9-10`）；`rdp` 用 `rdp.main`，本扩展用 `webapp.main`
- **`url` 必须经 `import.meta.url` 推导，不得硬编码 `app://extensions/webapp/`**：安装目录名是 `webapp_chenzhi`，硬编码会 404（`skills/obox-ext-dev/references/guides-user.md:86`）
- `multiOpen:false` 的语义：`openChildWindow` 发现该 appId 已有窗口即聚焦返回（`src/main/appWindow.ts:48-59`）
- `icon` 是卡片图标（子窗口标题栏也用，`src/renderer/src/AppWindow.vue:36`）；`iconUrl` 仅用于任务栏图标，本扩展不提供
- 子窗口尺寸与 `rdp` 一致（1024×720，R1）
- 注册返回 `{ dispose() }`；扩展停用时宿主自动清理，同时 `index.js` 的 cleanup 里显式 `dispose()`（照搬 `extensions/rdp/index.js:356-402`）

## 12. 参数构造（R9–R11 的确定性规则）

### 12.1 总体形式

```
exe  = <探测到的 chrome.exe 绝对路径>          ← 单独作为 spawn 的 program，不放进 args
args = [ ...按下面的固定顺序拼装... ]           ← 数组形态交给 spawn，由 Node 处理引号
```

**顺序固定**（固化的目的是让单测断言整个数组逐一相等）：

```
① --app=<url 归一后的值>
② --user-data-dir=chrome/<净化后的目录名>        ← 相对助手 cwd；助手再解析成绝对路径传给 Chrome
③ --disable-features=DownloadBubble
④ （仅 ignoreCert=true）--ignore-certificate-errors
⑤ （仅 ignoreCert=true）--unsafely-treat-insecure-origin-as-secure=<origin[,origin2,...]>
⑥ （若 webapp.diskCacheMb > 0）--disk-cache-size=<bytes>     ← R17 新增
⑦ （若 windowSize 非空）--window-size=W,H
⑧ （若 windowPos  非空）--window-position=X,Y
⑨ （若 startMaximized=true）--start-maximized
⑩ （若 lang 已从下拉选中且非空）--lang=<locale>
⑪ （若 scaleFactor 已从下拉选中且非空）--force-device-scale-factor=<n>
⑫ （若 disableGpu=true）--disable-gpu
```

- ② 的相对路径在**助手侧**解析为绝对路径（`path.resolve(process.cwd(), 'chrome/<name>')`）。**扩展侧生成的 args 里只放相对形式**，这样 `buildChromeArgs` 保持纯函数、不依赖运行环境；助手在 spawn 前替换成绝对路径（并在 `probe`/`launch` 的返回里回显最终绝对路径，便于排查）
- ⑤ 的值**不带引号**，多个 origin 用**英文逗号**连接，顺序 = 主 origin 在前 + `extraOrigins` 按用户书写顺序
- **⑥ 的"缓存上限"与 §14.5 的"目录上限"是两回事（R17 必须写清）**：
  | | ⑥ `--disk-cache-size` | §14.5 profile 目录上限 |
  |---|---|---|
  | 谁生效 | **Chrome 自己**在写 HTTP 缓存时执行 | **本扩展**在「打开」前预检并拦截 |
  | 覆盖范围 | **只有 HTTP 缓存**（`Cache/` 一类）；**不覆盖** IndexedDB / Service Worker / Local Storage / Cookie | 整个 `chrome/<名>` 目录的**实际占盘**（含上述全部） |
  | 取值来源 | 全局设置 `webapp.diskCacheMb`（默认 512 MB ⇒ `536870912`） | 全局设置 `webapp.profileLimitMb`（默认 2048 MB ⇒ 2 GB） |
  | 单位 | **字节**（传给 Chrome） | MB（设置里）→ 内部换算成字节比较 |
  | 能否防止撑爆磁盘 | **不能**（缓存之外的数据不受它约束） | **能**（超限拦截 + 提供只清缓存的动作） |
  | 未设置时 | `0` = **不传该参数**（用 Chrome 默认） | `0` = **不预检、不拦截** |
- ⑦⑧ 的 W/H/X/Y 是**去空格后的整数**，用 `,` 连接，不补零、不写单位
- **⑥–⑫ 的参数只在"该 profile 尚无运行实例"时才会被 Chrome 采用** —— 真机已核实（探针阶段一）：同 profile 二次启动时第二个进程在 1s 内 exit 0 并把请求转交既有实例，`--app=<url>` 会被转发并**新开一个窗口**，但新窗口沿用**首个实例**的 `--window-size` / `--window-position` / `--lang`（实测新值全被忽略、`navigator.language` 仍是首个实例的）。这正是"每条目独立 `--user-data-dir`"从"偏好"升格为**设计必然性**的原因（见 §14.6 与 R-W1）
- **⑩⑪ 的"下拉未选中 = 不传"（D-3）**：两个字段都是 `select`，空值项 `value=''` 排在最前、文案 `不指定（用 Chrome 默认）`。当取值为 `''` 时，**该参数整个不出现**（不产生 `--lang=` 或 `--force-device-scale-factor=` 这种空值形式）
- **⑩ 的取值直接来自枚举**（`LANG_VALUES`），不做任何拼接/大小写改写；⑪ 的 `n` 用 `String(n)`，取自 `SCALE_VALUES`（字符串形态已是 `"0.5"`…`"4"`，不出现 `1.50` 这种尾随零）

### 12.2 origin 推导（R10）

```js
function deriveOrigin(url) {
  const u = new URL(url)                       // url 已通过 §12.4 校验，仅 http/https
  return u.origin                              // 精确 = `${protocol}//${host}`，含非默认端口
}
```

实测语义（Node v24.14.0，本机）：

| 输入 | `origin` |
|---|---|
| `https://10.0.0.5:8443/app/x?y=1#z` | `https://10.0.0.5:8443` |
| `http://intranet/` | `http://intranet` |
| `https://[::1]:9443/a` | `https://[::1]:9443` |
| `http://user:pw@h:8080/x` | `http://h:8080`（userinfo 被丢弃） |
| `https://h/` | `https://h`（默认端口不补 `:443`） |

**额外 origin**（R10 的"允许附加额外 origin"）：新增字段 `extraOrigins`（TEXT，可空，**换行分隔**，最多 8 条）。

- 每行归一：`trim()` → 非空才处理 → `new URL(line).origin` → 必须与 `deriveOrigin(url)` 同协议（防手滑把 https 站点配成 http origin）
- 去重（大小写不敏感，主机名大小写不敏感）
- 非法行 → 字段级错误：「额外 origin 第 N 行不是合法的 http/https 地址」
- 与主 origin 合并后再拼进 ⑤，**恒以主 origin 开头**

### 12.3 白名单字段 → 参数映射（R11，**已由 D-3 修订**）

> **R11 措辞修订（D-3）**：原 R11 把 `--lang` 写成"正则校验的文本"、把 `--force-device-scale-factor` 写成"0.5–4 步进 0.25 的数值"。修订后**两者都是下拉枚举**：`--lang` 的合法取值 = 固定清单（P6 待微调，见 §15.2.1），`--force-device-scale-factor` 的合法取值 = 15 项固定清单（0.5 + 0.25k，k=0..14）。**其余 4 个开关形态不变。**

| 字段（DB 列） | 表单类型 | 取值约束（修订后） | 生成的参数 | 空值行为 |
|---|---|---|---|---|
| `windowSize` | `pair`（宽/高） | 宽 `320–7680`、高 `240–4320` 整数 | `--window-size=W,H` | 两者都空 → 不传；只填一个 → 字段级错误「窗口宽高必须同时填写或同时留空」 |
| `windowPos` | `pair`（左/上） | 左 `-10000–10000`、上 `-10000–10000` 整数（允许负值，多显示器场景） | `--window-position=X,Y` | 同上 |
| `startMaximized` | `check` | 布尔 | `--start-maximized` | 未勾选 → 不传 |
| `lang` | **`select`**（D-3） | **枚举**：`''` 或 `LANG_VALUES` 之一（清单见 §15.2.1；P6 待微调） | `--lang=<locale>` | `''`（下拉停在"不指定"）→ **不传** |
| `scaleFactor` | **`select`**（D-3） | **枚举**：`''` 或 `[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4]` 之一 | `--force-device-scale-factor=<n>` | `''`（下拉停在"不指定"）→ **不传** |
| `disableGpu` | `check` | 布尔 | `--disable-gpu` | 未勾选 → 不传 |

**两个枚举值的单一来源**（防漂移）：

- `lib/webapp.mjs` 导出 `LANG_VALUES`（只读数组，含 `''`）与 `SCALE_VALUES`（只读数组，含 `''`）
- `src/fields.js` 的 `options` **由这两个常量生成**（同序、同值），或由 `test/fieldDocs.test.js` 断言两者逐项相等
- `lib/chromeArgs.mjs` 对这两个字段**不再做区间/正则校验**，只做"是否在枚举内"与"是否为空"

**"白名单之外一律拒绝保存"**（R11 的落点）有**三层**：

1. `lib/webapp.mjs` 的 `normalizeWebapp` 只保留已知列（照搬 `extensions/rdp/lib/connection.mjs:27-55` 的白名单归一）→ 未知键被丢弃
2. `validateWebapp` 对**已知列的非法取值**给字段级错误 → `save` 返回 `{ ok:false, error }`，不落库（含"不在枚举内"）
3. 界面 `src/fields.js` 的 `buildSavePayload(form)` 只从表单已知字段构建载荷（照搬 `extensions/rdp/src/fields.js:879`）→ 额外键进不来；下拉字段的取值天然被 `options` 约束

**字段级失败文案**（界面与扩展共用一套口径，两处必须逐字一致）：

| 情况 | 文案 |
|---|---|
| 名称空 | `名称不能为空` |
| 名称含非法字符 | `名称包含不能用于目录的字符，建议改为：<suggest>` |
| 名称是 Windows 保留名 | `名称不能是 Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，不分大小写），建议改为：<suggest>` |
| 名称以点或空格结尾 | `名称不能以点或空格结尾，建议改为：<suggest>` |
| 名称长度超预算 | `名称过长（连路径最多 240 个字符），建议改为：<suggest>` |
| 名称重复 | `名称「<name>」已存在，请换一个` |
| 网址空 | `网址不能为空` |
| 网址协议非法 | `网址只能是 http:// 或 https:// 开头` |
| 网址无法解析 | `网址格式不正确` |
| 说明过长 | `说明最多 120 个字符` |
| 宽高不齐 | `窗口宽高必须同时填写或同时留空` |
| 宽/高越界 | `窗口宽度必须是 320–7680 的整数` / `窗口高度必须是 240–4320 的整数` |
| 位置不齐 | `窗口位置必须同时填写或同时留空` |
| 位置越界 | `窗口左坐标必须是 -10000–10000 的整数` / `窗口上坐标必须是 -10000–10000 的整数` |
| **语言非法（修订）** | `界面语言不在可选清单内（请从下拉中选择）` |
| **缩放非法（修订）** | `缩放比例不在可选清单内（请从下拉中选择）` |
| 额外 origin | `额外 origin 第 N 行不是合法的 http/https 地址` |
| 额外 origin 协议不符 | `额外 origin 第 N 行必须与主网址同协议（<主协议>）` |
| 额外 origin 过多 | `额外 origin 最多 8 条` |

### 12.4 `url` 校验（R3）

```
1. trim 后非空
2. 必须以 `http://` 或 `https://` 开头（大小写不敏感，但归一为小写协议）
3. new URL(text) 必须成功
4. new URL(text).origin 必须非空
5. 协议再确认一次：u.protocol === 'http:' || u.protocol === 'https:'   ← 挡 `file:` / `javascript:` / `chrome:` / `data:`
6. 不做"去掉默认端口""补末尾斜杠"等改写：只 trim，其余原样落库（url 是唯一事实来源，阶段 1 业务规则）
```

**硬性拒绝清单**（给出明确文案，不静默改写）：`file:`、`javascript:`、`data:`、`chrome:`、`chrome-extension:`、`about:`、`ftp:`、相对路径（`/x`、`./x`）、无协议（`intranet.local`）。

## 13. 数据模型与 SQL

### 13.1 存储位置（沿用宿主 data 目录语义）

- 库文件：`<userData>/extensions/webapp_chenzhi/data/webapp.db`
  - 依据：`src/main/sqlite.ts:34-37`（`dataDirFor`）、`src/main/sqliteCore.ts:216-224`（`openSqlite` 把相对路径 join 到 dataDir）
  - 实测样本：`%APPDATA%\obox\extensions\rdp_chenzhi\data\rdp.db` 存在
- 默认表名 = 文件名去扩展名 → **`webapp`**（`src/main/sqliteCore.ts:35-39`）
- 列类型元数据：`<dataDir>/.obox-meta-webapp.json`（`src/main/sqlite.ts:44-49`），由宿主自动维护，扩展不读不写
- 升级保留：覆盖安装时宿主把旧 `data/` 搬到新目录（`src/main/oixCore.ts:320-336`）→ **库与 profile 目录都保留**；包内不得含 `data/`（`src/main/oixCore.ts:168-178`）

### 13.2 表结构

`api.sqlite` 的列类型由**首次 insert 的 JS 类型**推断（`src/main/sqliteCore.ts:125-129,173-197`；`extensions/rdp/lib/connection.mjs:24-26` 记录的教训：**所有列都必须产出具体值**，漏字段会漂成 TEXT）。因此 `normalizeWebapp` 必须对**每一列**给出具体值（空串 / `0` / `false`）。

| 列 | JS 类型 | SQLite 列类型 | 默认值（归一后） | 说明 |
|---|---|---|---|---|
| `id` | number | INTEGER PRIMARY KEY AUTOINCREMENT | 无（insert 时由库生成） | 主键；`db.insert` 返回带 id 的新行（`src/api/types.ts:23-24`） |
| `name` | string | TEXT | `''` | 显示名 + 目录名来源 |
| `url` | string | TEXT | `''` | 仅 http/https |
| `desc` | string | TEXT | `''` | 可选、单行、≤ 120 字符 |
| `ignoreCert` | boolean | INTEGER（0/1） | `true` | R3 默认 true |
| `extraOrigins` | string | TEXT | `''` | 换行分隔，≤ 8 条 |
| `windowSize` | string | TEXT | `''` | 存储形态 `"W,H"` |
| `windowPos` | string | TEXT | `''` | 存储形态 `"X,Y"` |
| `startMaximized` | boolean | INTEGER（0/1） | `false` | — |
| `lang` | string | TEXT | `''` | **D-3 后为枚举**：`''` = 不指定；否则是 `LANG_VALUES` 之一（如 `zh-CN`） |
| `scaleFactor` | **string** | **TEXT** | `''` | **D-3 后为枚举**：`''` = 不指定；否则是 `SCALE_VALUES` 之一（`"0.5"`…`"4"`）。<br>**修订说明**：原设计是 `number` / REAL / `0` 哨兵；改为**字符串枚举**后，`0` 哨兵不再需要（`''` 即"不指定"），且与 `lang`、`windowSize` 等枚举/组合字段的存储形态一致，避免浮点往返（`2.25` 存 REAL 再读出的显示问题）。<br>**兼容性**：本扩展尚未发布，无历史数据，**不需要迁移**（若将来从旧 REAL 版本升级，`normalizeWebapp` 需把数字 `0`/`0.5` 归一为 `''`/`"0.5"`） |
| `disableGpu` | boolean | INTEGER（0/1） | `false` | — |
| `profileDir` | string | TEXT | `''` | **已落地的目录名**（净化后）；见 §14.2 的两阶段提交 |
| `createdAt` | string | TEXT | 写入时 `new Date().toISOString()` | 审计；ISO 字符串可字典序比较（照搬 `extensions/rdp/index.js:109-117`） |
| `updatedAt` | string | TEXT | 同上 | 审计 |

**布尔列的宿主约定**：`api.sqlite` 把 JS `boolean` 映射为 `boolean` 列类型（`src/main/sqliteCore.ts:125-126,131-137,144-155`），读写往返由宿主完成转换（`denormalizeValue`）。因此**归一后一律给真正的 `boolean`**，界面的 `0/1` 由 `lib/webapp.mjs` 的 `toBool` 归一（照搬 `extensions/rdp/index.js:48-51` 的 `isTruthyFlag` 口径：`true`/`1`/`'1'` 都算真）。

### 13.3 唯一约束（大小写不敏感的 `name`）

```sql
CREATE TABLE IF NOT EXISTS webapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  "desc" TEXT,
  ignoreCert INTEGER,
  extraOrigins TEXT,
  windowSize TEXT,
  windowPos TEXT,
  startMaximized INTEGER,
  lang TEXT,
  scaleFactor TEXT,
  disableGpu INTEGER,
  profileDir TEXT,
  createdAt TEXT,
  updatedAt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS webapp_name_nocase ON webapp (name COLLATE NOCASE);
```

- `CREATE TABLE` / `CREATE UNIQUE INDEX` 都通过 `assertSafeSql`（只禁 `attach/detach/vacuum/pragma/load_extension`，`src/main/sqliteCore.ts:93-110`）
- `COLLATE NOCASE` 对 ASCII 大小写不敏感（**对中文/非 ASCII 是字节比较**，中文名天然区分，够用）
- **本机实测证据**：`DatabaseSync` 建表 + 该唯一索引后，已有 `Intranet` 时插入 `intranet` 抛 `ERR_SQLITE_ERROR`（Node v24.14.0）
- **库层约束是兜底，不是唯一校验**：`validateWebapp` 仍做应用层大小写不敏感查重，以便给出**字段级中文文案**（"名称「Intranet」已存在，请换一个"）；库层冲突（理论不可达）由 `save` 的 catch 归一为「名称已存在，请换一个」
- 列名 `desc` 是 SQL 关键字，`ident()` 用双引号包裹（`src/main/sqliteCore.ts:138-142`），可安全使用；**但为降低风险，仍建议把它作为"必须小心"的一条写进实现注意**
- **不加** `CHECK` 约束（宿主 SQL 层与类型推断都不处理 CHECK；校验留在应用层，保证文案可控）

### 13.4 迁移与升级

| 场景 | 行为 | 依据 |
|---|---|---|
| 首次使用（无库） | `openDb()` → `CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` | `src/main/sqliteCore.ts:173-201` 的 `ensureTable` 也会在首次 insert 时建表，但显式 `exec` 能早一步拿到唯一索引 |
| **覆盖安装 / 升级（R16）** | 宿主把旧 `data/` 搬回新目录 → 条目库、`.obox-meta-webapp.json`、**`chrome/**` 与其中的登录态全部原样保留** | `src/main/oixCore.ts:32-35`（`EXT_DATA_DIR = 'data'` 的定义）、`:168-176`（包内含 `data/` 被 `forbidden-entry` 拒绝，文案明写"升级时由宿主保留"）、`:320-336`（**在删备份前把 `backup/data` 搬回新目录**；失败只记日志、不阻断安装） |
| 未来加列（1.1.0） | `exec('ALTER TABLE webapp ADD COLUMN <c> <type>')` + `try/catch` 忽略"duplicate column name"；新列必须同时补进 `normalizeWebapp` 的默认值 | 本规格预留口径；`.obox-meta-webapp.json` 由宿主按实际插入值补类型（`src/main/sqliteCore.ts:173-197`） |
| 库损坏 / 表结构不符 | `openDb()` 失败 → `list` 返回错误文案「读取条目失败：<message>」；**不自动删库**（数据不可恢复操作必须由用户显式触发） | — |
| **卸载**（与升级语义相反） | 卸载会删**整个**扩展目录 → 条目库与**所有** profile 永久消失（见 §14.4 / D-1） | `src/main/capabilities.ts:118` |

> **两条语义必须并列写清、不得混为一谈**（R16 的核心）：
> - **升级/覆盖安装 = 保留**：`data/chrome/**` 与登录态原样留下（宿主搬回 `data/`）。
> - **卸载 = 永久删除**：`data/chrome/**` 与登录态一起消失，不可恢复（D-1 选项 A）。
> README 与 Release 说明必须用同一句话表达这个对比（见 §14.4(b) 与 §20.4）。

## 14. profile 目录生命周期

### 14.1 目录布局

```
<userData>/extensions/webapp_chenzhi/data/          ← 扩展 data 目录（= helper 的 cwd）
├── webapp.db                                       ← api.sqlite 的库
├── .obox-meta-webapp.json                          ← 宿主维护的列类型元数据
└── chrome/                                         ← profile 根（本扩展自建）
    ├── 内网-运维平台/                               ← 每个条目一个目录，目录名 = 净化后的 name
    ├── Intranet/
    └── .trash/                                     ← 删除中转区（见 §14.3）
        └── 20261012T101500-旧站点/
```

> `chrome/` 与 `.obox-meta-*` 同处 data 目录，不冲突；`chrome/` 不会被打进 `.oix`（打包白名单不含 `data/`）。
>
> **`chrome/<名>` 内部（Chrome 自建，本扩展只读其中的目录体积、只删缓存类子目录）**：
>
> ```
> chrome/<名>/
> ├── Default/                  ← 主 profile（含 Cookie、Login Data、History、IndexedDB、Local Storage…）
> │   ├── Cache/                ← 【可清理】HTTP 缓存
> │   ├── Code Cache/           ← 【可清理】JS 字节码缓存
> │   ├── GPUCache/             ← 【可清理】GPU 着色器缓存
> │   ├── DawnGraphiteCache/    ← 【可清理】Dawn/Graphite 缓存
> │   ├── DawnWebGPUCache/      ← 【可清理】
> │   ├── GrShaderCache/        ← 【可清理】
> │   ├── ShaderCache/          ← 【可清理】
> │   ├── Cookies / Login Data  ← 【必须保留】登录态
> │   └── Service Worker/       ← 【必须保留】离线应用与推送凭据
> ├── Profile 1/ …              ← 其它 profile（同样规则）
> ├── ShaderCache/ GPUCache/    ← 【可清理】根级同义缓存目录
> └── Crashpad/                 ← 【可清理】崩溃转储
> ```
>
> **可清理集合是白名单，不是黑名单**（§14.5）——只有出现在白名单里的目录名才可能被删，其余一律不动。

### 14.2 创建与改名移动（R4）

**创建**：`save` 新建条目不创建目录。目录由 Chrome 自己在首次 `--user-data-dir` 时创建（R7 边界场景 7）。`profileDir` 列在建库时写入净化后的目录名，使其成为"意定目录名"。

**改名（`name` 变化）的确定性顺序**——这是"移动失败则报错且不改数据"（R4）的落点：

```
1. 归一 + 校验新 name（含净化、保留名、长度、查重）
2. newDir = sanitizeName(newName)；oldDir = row.profileDir（若为空则用 sanitizeName(row.name)）
3. 若 newDir === oldDir（大小写差异或净化后同形）→ 直接落库改 name（不动磁盘）
4. 调 helper profileStatus({ name: newDir })：
     - 若目标目录已存在且非空 → 失败：「目标浏览器数据目录已存在（<newDir>），请换一个名称」
5. 调 helper moveProfile({ from: oldDir, to: newDir })：
     - 成功 → 继续
     - 源不存在（missing:true）→ 视为成功（无需移动，只改库）
     - 失败 → 返回 { ok:false }，「无法把浏览器数据目录从 A 改名为 B（<原因>），条目名称未修改」；**库不动**
6. 落库：update({ id }, { name: newName, profileDir: newDir, updatedAt: now })
7. 若第 6 步抛错 → 尝试 moveProfile({ from: newDir, to: oldDir }) 回滚；回滚失败只 console.warn，
   并把 profileDir 的真实值写成 newDir（见下方"两阶段 intent"）
```

**两阶段 intent 防半完成（实现层风险应对）**：`moveProfile` 里**先用 `fs.writeFile` 写 `<dataDir>/chrome/.pending-move.json`**（内容 `{ from, to, at }`），再 `fs.rename`，成功后删除该文件。扩展在每次 `list` 时（懒执行，一次）调用 helper `profileStatus` 检查该文件：

- 存在且 `to` 目录存在、`from` 不存在 → 移动其实成功了 → 把 `pending-move.json` 里的 `to` 名称写进对应条目的 `profileDir`（按 `from === sanitizeName(row.name)` 或 `to` 匹配），然后删该文件
- 存在且 `to` 不存在、`from` 存在 → 移动没发生 → 删该文件
- 两者都在 → 报错并**不处理**（留给用户/文档，见 §19 R-W6）

> 这条机制存在的理由：`fs.rename` 与 `db.update` 之间没有事务（`api.sqlite` 不暴露跨进程事务，且目录操作在助手进程）。没有它，"移动成功 + 落库失败"会让 `name` 与目录长期不一致。

### 14.3 删除（R13）

```
1. 预检：helper profileStatus({ name: row.profileDir })
     - 不存在 → 直接第 4 步（只删库行）
     - 存在但 locked → 返回 [profile-busy]，库不动、目录不动
2. 原子移入中转：fs.rename(chrome/<dir>, chrome/.trash/<ts>-<dir>)
     - 失败（占用/权限）→ 返回 [profile-busy] 或 [profile-move-failed]，库不动
3. 删库行：db.del(id)
4. 递归删除中转目录：fs.rm(.trash/<ts>-<dir>, { recursive:true, force:true })
     - 失败 → **不算失败**：返回 warnings: ['浏览器数据未完全清理，下次启动会自动重试']
5. 启动/列表期清理：每次 index.js 激活后（懒）清空 chrome/.trash/ 下超过 1 个会话的残留
```

**为什么用中转区**：`fs.rm(recursive)` 在 Windows 上**不会删除只读文件**（`src/main/fs.ts:136` 用的是同一形态），Chrome profile 里常有只读文件；"先原子改名再删"保证**库行与目录名的一致性在毫秒级窗口内确定**，而"半删目录"的最坏后果被限制在 `.trash/` 里（不占用条目的目录名，也不会被误当作某个条目的 profile）。

**"占用"判定（Windows）—— 已由真机探针核实，取代早前的推测**：

真机实测（探针阶段一，见 §26 第 3 项的新结论）表明：

| 事实 | 实测结果 |
|---|---|
| Windows 上有 `SingletonLock` / `SingletonCookie` / `SingletonSocket` 吗？ | **没有**。这三个是 **POSIX 专有**的；Windows 上不存在这些文件（早前按它们写检测是**错的**，本规格已删除该写法） |
| 实际占用了什么 | ① 顶层 **`lockfile`**（0 字节、**独占**打开，连读都失败）；② 约 **30 个 LevelDB `LOCK`** 文件；③ 一个**隐藏的消息窗口**（Chrome 的进程单例机制） |
| Chrome 运行期间**整目录删除** | **失败**（`IOException: The process cannot access the file 'journal.baj' …`） |
| Chrome 运行期间**改名** | **失败**（`Access to the path … is denied`） |
| Chrome 运行期间删除**目录内的单个文件** | **成功**（不是整目录锁，是具体文件被独占） |
| 停止 Chrome 后整体删除 | **成功** |

⇒ **判据必须是"尝试删除/改名并捕获失败"，不是任何启发式探测。** 具体口径：

1. `profileStatus.locked` **不靠猜**：定义为一个**快速探测**——尝试以可写方式打开顶层 `lockfile`（`fs.openSync(join(dir,'lockfile'), 'r+')`）：成功 → `locked: false`（立刻关闭）；`EBUSY` / `EPERM` / `EACCES` → `locked: true`；**文件不存在** → `locked: false`
2. 这个探测**只用于提前给出更好的文案与在界面上先提示**（"该站点窗口正开着"），**不作为硬闸门**：真正的判定永远是 `rename` / `rm` 的成败
3. 失败时的错误归一：捕获 `EBUSY` / `EPERM` / `EACCES` / `ENOTEMPTY` 以及 Node 在 Windows 上抛出的 `IOException`/`Access to the path … is denied` 文案 → 一律归一为 `[profile-busy]`，对外文案用**真实信息**：
   `[profile-busy] 无法操作 <dir>：文件被占用（通常是该站点的 Chrome 窗口正开着）`
4. **禁止**在探测里递归扫描整个目录找"锁文件"（一次 `open` 就够，递归扫描会在 GB 级目录上变成秒级阻塞）
5. 单测无法可靠复现"Chrome 占用"（纯 Node 下很难造 `FILE_SHARE_NONE` 的独占句柄）→ 因此 §18.2 用**只读文件 + 只读目录属性**覆盖"删除失败 → `[profile-busy]` 归一"这条路径，真实占用由真机 A12 覆盖

### 14.5 只清缓存（R17）——可清理白名单与"必须保留"清单

**这是 R17 里唯一会删除数据的动作，因此用白名单 + 显式保留清单双写。**

**可清理白名单（`CACHE_DIR_NAMES`，助手侧唯一常量；大小写不敏感匹配目录名）**：

```
Cache
Code Cache
GPUCache
GrShaderCache
ShaderCache
DawnGraphiteCache
DawnWebGPUCache
Crashpad
```

**扫描方式**：对 `chrome/<名>` 做**深度 2**的遍历（`chrome/<名>/<profile>/<cacheDir>` 与 `chrome/<名>/<cacheDir>` 两层），命中白名单的目录**整体** `fs.rm(recursive:true, force:true)`。**不递归进更深层去找同名的目录**（避免误删站点自己存的同名目录）。

**必须保留（明确禁止出现在任何删除路径里）**：

```
Cookies  Cookies-journal  Login Data  Login Data For Account  Web Data
Local Storage  Session Storage  IndexedDB  Service Worker  CacheStorage
Preferences  Secure Preferences  History  Bookmarks  Favicons
Extensions  Local Extension Settings  Sync Data  Network
```

**三道防线，保证"只删缓存、保留登录态"**：

1. **白名单**：只有目录名落在 `CACHE_DIR_NAMES` 里才进删除列表；其它一律不动（不按"体积大就删"之类的启发式做判断）
2. **单元测试强制**（§18.2 的 `test/helperCache.test.js`）：造一个假 profile（含 `Default/Cookies`、`Default/Login Data`、`Default/Service Worker/`、`Default/Cache/`、`GPUCache/`、`ShaderCache/`），跑 `cleanCaches` 后断言：**缓存目录消失、保留清单里的目录与文件逐字节未变**（`Cookies` 内容哈希不变）
3. **返回可审计**：`cleanCaches` 返回 `removedDirs[]`（实际删掉的相对路径）与 `skipped[]`，扩展把 `removedDirs` 记进输出通道（`console.info`），用户可核对"到底删了什么"

**不做的事（明确边界）**：

- 不清 `IndexedDB` / `Local Storage` / `Service Worker`（登录态与离线应用凭据就在那里）
- 不清 `History` / `Bookmarks`（不是缓存，是用户数据）
- **不限制**目录大小（Chrome 没有目录配额参数；NTFS 目录配额不采用，见 §14.6 头部）
- 不删整个 profile（那是"删除条目"的动作，见 §14.3）

### 14.6 体积上限与「打开」前预检（R17）

> **为什么"每条目独立 `--user-data-dir`"是设计必然性（真机已核实，探针阶段一）**：同 profile 二次启动时，第二个 Chrome 进程**1s 内 exit 0** 并把请求转交既有实例；`--app=<url>` 会被转发并新开窗口，但该窗口沿用**首个实例**的 `--window-size` / `--window-position` / `--lang`（新值全被忽略）。因此：① 独立 profile 是让"白名单开关生效"的**唯一**手段（不是可选优化）；② 一旦某站点已有窗口，**改设置后必须先在设置里改、再关闭该站点窗口、再打开**——这条要作为"已知行为"写进 README 与界面提示（§15.2 第 3 条）。

**已确认的技术边界（决定了这套设计只能是"节流"而不是"硬配额"）**：

| 手段 | 可行性 | 结论 |
|---|---|---|
| Chrome 自带的"整个 profile 目录配额"参数 | **不存在** | 无法用一次配置就限制住目录 |
| NTFS 目录配额（`fsutil quota`） | 需管理员权限、按**卷**生效、对用户透明性差 | **不采用**（用户已确认方案 1 = 目录级节流） |
| `--disk-cache-size=<bytes>` | 可用，但**只覆盖 HTTP 缓存** | **采用**为"缓存上限"（§12.1 ⑥），并明确它 ≠ 目录上限 |
| helper 量目录体积 | 可用（纯 Node 递归 `stat`） | **采用**为预检数据源 |
| 只清缓存（保留登录态） | 可用（白名单删目录） | **采用**为超限后的唯一"自动减量"动作（§14.5） |

**上限取值（全局设置，R17 要求"由用户在设置里定义"，不做每连接覆盖）**：

- 键 `webapp.profileLimitMb`，默认 `2048`（2 GB），可选 `0`/`512`/`1024`/`2048`/`4096`/`8192`（见 §10.4）
- `0` = **不预检、不拦截**（用户显式关闭）
- **为什么用 `select` 而不是 `number`**：宿主的 `SettingField` 没有 `min`/`max`，`number` 输入框也不带这两个属性（§10.4 的已核实缺口）→ 枚举是唯一能真正约束取值的手段

**预检规则（`open` 方法内，确定性顺序）**：

```
1. limitMb = 读设置 webapp.profileLimitMb（归一失败回落 2048）
2. 若 limitMb === 0 → 跳过预检，直接进入"启动 Chrome"（记录一条 debug 日志）
3. size = helper profileSize({ name })
     - bytes === null（目录不存在 = 首次打开）→ 跳过预检
     - 助手返回错误 → **降级放行**（warnings 里带 [profile-size-failed]，绝不因量不了体积而挡住打开）
4. 若 bytes <= limitBytes → 正常启动
5. 若 bytes > limitBytes → **拦截**：返回
     { ok: false, error: '[profile-over-limit] …', data: { overLimit: true, bytes, limitBytes, cacheBytes, id } }
   （**注意**：这是本规格里唯一用 `ok:false` 承载"需要用户选择"的场景；界面据 `data.overLimit === true` 区分它与真正的错误）
   界面弹一个**只能按钮关闭**的模态框（§15.2 的既有规范），给两个动作：
     A. 「清理缓存（保留登录态）」→ 调 cleanCaches({ id }) → 重新预检 → 通过则继续启动；仍超限则再弹一次（并显示"清理后仍超限"）
     B. 「仍然打开」→ 带 { force: true } 再次调 open → 直接启动（**本次不记入任何持久状态**，下次打开仍会拦截）
   模态框必须显示：当前体积、上限、可清理缓存体积，以及一句"清理缓存会删除该站点的网页缓存，但保留登录状态与 Cookie"
```

**全局「一键清理全部缓存」（R17 要求 4）**：

- 界面：列表页右上「⋯」/或状态栏附近放一个「清理全部缓存」按钮（二次确认，文案写清"保留登录状态"与"清理期间该站点窗口请先关闭"）
- 调用 `cleanCaches({})`（省略 `name` = 全部条目）→ 状态栏回报 `已清理 N 项，释放 X MB`（+ 被跳过项）
- **清理被占用的缓存目录会失败** → 记入 `skipped[]`，提示「M 项被跳过（可能窗口正开着，请先关闭该站点的窗口）」，**不重试、不杀进程**
- 清理完成后**作废所有条目的体积缓存**（§14.6 的缓存失效条件）

**体积读取的时间戳缓存（R17 要求 3 的"避免每次点击都全量扫盘"）**：

| 项 | 规则 |
|---|---|
| 存放位置 | **助手进程内存**（`Map<name, { bytes, cacheBytes, scannedAt: number, entries: number }>`）；不落库、不落文件 |
| 有效期（TTL） | **60_000 ms（60 秒）** |
| 命中行为 | `profileSize` 返回 `cached: true`、`scannedAt`（上次扫描时刻）、`expiresAt`；**不做任何磁盘遍历**（< 10ms） |
| 失效条件（任一命中即作废该条目缓存） | ① TTL 过期；② 显式 `force: true`；③ `cleanCaches` 成功后**清空整个 Map**；④ `moveProfile` / `removeProfile` 成功后清空对应条目；⑤ `launch` 成功后**只作废该条目**（Chrome 会立刻写缓存）；⑥ 用户改设置（`api.settings.onChanged` 收到 `webapp.profileLimitMb` 变更 → 扩展侧把该事件经 `notify` 告知助手，或直接下一次调用带 `force: true`——**实现选后一种，不新增通道方法**） |
| 为什么是 60 秒 | 「打开」是连续动作（点 A、再点 B），60 秒足以覆盖一次会话；同时保证用户"刚清了缓存"后看到的数字不会长期陈旧 |
| 为什么放助手内存而不放扩展侧 | 体积数据的产生方是助手；扩展进程（渲染进程）重启/子窗口重载都会丢缓存，放在产生方能最大化命中率 |
| 扫描成本 | 递归 `fs.readdir(withFileTypes)` + `stat`；GB 级 / 数万文件在机械盘可能数十秒 → 因此**只在「打开」前预检**与**用户显式点"查看体积"**时触发，**不做常驻轮询**（R17 要求 5） |

**卡片上的体积展示（R17 要求 5，"按需查询"）**：

- 卡片默认**不显示体积**（避免 `list` 触发 N 次扫盘）
- 每张卡片有「查看体积」小按钮/或点击卡片上的体积占位符 → 调 `profileSize({ id })`（可命中缓存）→ 在该卡片上就地显示 `1.24 GB / 2 GB`（超限时加一条警示色文字）
- 显示结果**只存在界面内存里**（组件状态），列表刷新即清空
- 「体积」文案统一用**人类可读格式**（`formatBytes`：B / KB / MB / GB，保留 1–2 位小数），上限展示同格式

### 14.4 卸载行为（R2 / P2 —— 见 D-1）

**架构硬事实（决定了 P2 不可能有"保留数据"的实现）**：

- 入口 `uninstall(ctx)` 钩子在删除扩展目录**之前**执行（`src/main/capabilities.ts:92-101`）
- 但随后 `fs.rm(target, { recursive: true, force: true })` 会删掉**整个** `<userData>/extensions/webapp_chenzhi/`，包含 `data/` 与 `chrome/**`（`src/main/capabilities.ts:118`）
- 钩子超时 10s（`src/main/hookBridge.ts:16`），profile 可能 GB 级（R-5）→ **不可能在钩子里搬运数据**
- 钩子跑在渲染进程，扩展入口**没有 `node:fs`**（`SKILL.md:48,51`），只有 `api.fs`（限定在 data 目录内、且**无 rename**，`src/api/types.ts:325-341`）
- 结论：**"卸载时保留 `chrome/**`"在本架构下无法实现**。因此阶段 1 的 P2 初拟"不删"与技术事实冲突，必须由用户重新决策（D-1）

**D-1 决策已关闭 = 选项 A（用户确认，2026-10-12）：接受现状 + 文档醒目声明。以下为不可协商的实现约束。**

**(a) 卸载 = 永久删除所有站点浏览器数据（含登录态）**

卸载扩展时，`<userData>/extensions/webapp_chenzhi/` 整个目录被宿主递归删除，因此 **`data/chrome/**` 下的全部 profile（所有站点）与 `data/webapp.db`（条目列表）一起永久消失，不可恢复**。根因链（已核实）：

| 环节 | 事实 | 证据 |
|---|---|---|
| 1 | 入口 `uninstall(ctx)` 钩子在删除目录**之前**执行 | `src/main/capabilities.ts:96-101` |
| 2 | 随后宿主执行整目录递归删除，连 `data/` 一起删 | `src/main/capabilities.ts:118` |
| 3 | 钩子超时仅 10s（超时只告警，仍继续删目录） | `src/main/hookBridge.ts:16`；`src/main/capabilities.ts:113-118` |
| 4 | 扩展入口无 `node:fs`，且 `api.fs` 限定 data 目录内、**没有 rename** | `skills/obox-ext-dev/SKILL.md:48,51`、`src/api/types.ts:325-341` |

**(b) 交付文档必须用醒目段落写明（硬要求，含 R16 的"升级 vs 卸载"对比）**

`README.md` **必须**包含一个独立小节（标题含"升级""卸载""数据"，位置在"安装/使用"之后、不得埋在文末小字里），内容至少覆盖：

1. **一句话对比结论（加粗，两条并列，R16）**：
   - **升级/覆盖安装：浏览器数据保留** —— 条目、`chrome/**` profile 与其中的登录态原样留下。
   - **卸载：永久删除** —— 所有站点的浏览器数据（登录状态、Cookie、缓存）与条目列表一起消失，不可恢复。
2. 为什么升级能保留：宿主把扩展的运行时数据目录固定为 `data/`（`src/main/oixCore.ts:32-35`），覆盖安装时**在删除备份目录之前**把旧 `data/` 搬回新目录（`:320-336`），并**拒绝**任何含 `data/` 条目的 `.oix` 包（`:168-176`，错误码 `forbidden-entry`，原文案即"升级时由宿主保留"）。
3. 为什么卸载无法保留：卸载钩子只有 10s（`src/main/hookBridge.ts:16`），而单个 profile 可能达到 GB 级；宿主随后递归删除整个扩展目录（`src/main/capabilities.ts:118`）——因此扩展**没有能力**在卸载时保留或搬运数据（D-1）。
4. **卸载前备份**的可复制命令（见 (c)）。
5. 恢复方式：重新安装扩展后，把备份目录拷回该路径（Chrome 下次打开即复用，登录态仍在）。
6. **开发者同步纪律**（见 (g)）——把本地构建产物同步到安装目录时**绝不动 `data/`**。

Release 说明（`v1.0.0` 的 Release 正文）**必须**包含第 1 条的对比结论与第 4 条的备份命令（阶段 1 Q10 的交付形态之一）。

**(c) 卸载前备份：可复制命令（README 与 Release 说明里给同一份）**

```powershell
# 卸载 webapp 扩展前，备份全部站点的浏览器数据（profile）与条目列表
$src = "$env:APPDATA\obox\extensions\webapp_chenzhi\data"
$dst = "$env:USERPROFILE\obox-webapp-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Recurse -Force "$src" $dst
# 校验：条目库与 profile 根都应存在
Test-Path "$dst\data\webapp.db"; Test-Path "$dst\data\chrome"
```

- 备份的是整个 `data`（含 `webapp.db` 条目列表、`.obox-meta-webapp.json`、`chrome/**`），因此恢复后条目与登录态都在
- 恢复命令：`Copy-Item -Recurse -Force "$dst\data" "$env:APPDATA\obox\extensions\webapp_chenzhi\"`（在重新安装扩展并退出 obox 后执行）
- 体积提示：备份大小 ≈ 所有 profile 之和，可能达到 GB 级（R-5）
- **文档里禁止**出现"扩展会帮你保留数据""卸载不会丢数据"之类的表述

**(d) 明令禁止：`uninstall(ctx)` 里不得尝试搬运/备份 profile**

- `uninstall(ctx)` 钩子**不得**调用 `moveProfile` / `removeProfile` / 任何复制、打包、上传 profile 的代码路径，也**不得**为此启动助手进程或写后台任务
- 理由（写进代码注释）：① 10s 钩子预算内搬 GB 级目录必然失败；② 钩子失败/超时后宿主**照样**删光目录，用户会得到"以为备份了其实没有"的错觉，**比不备份更危险**；③ 钩子是进程内调用，没有可靠的"后台继续跑"的语义（`src/main/hookBridge.ts:9` 记录超时机制）
- 钩子唯一允许做的事（尽力而为、失败只 `console.warn`）：
  1. 删除 `<dataDir>/chrome/.pending-move.json`（避免残留导致重装后误判）
  2. 删除 `<dataDir>/chrome/.trash/**`（释放中转区残留）
  3. 记一条日志：`[webapp] 卸载：浏览器数据目录将随扩展目录一并删除（data/chrome）`
- **源码门禁**：`test/componentSource.test.js`（或等价的 `test/uninstall.test.js`）必须断言 `index.js` 的 `uninstall` 函数体内**不出现** `copyFile` / `cp(` / `rename` / `moveProfile` / `removeProfile` / `spawn` 等搬运迹象的字符串

**(e) 界面侧（删除单条条目）的二次确认必须写明不可恢复**

已在 §15.2 第 2 条给出确切文案并要求写入「连同该站点的浏览器数据一起删除、不可恢复」；**本次修订再次确认该文案是硬要求**，`test/componentSource.test.js` 必须断言删除确认组件源码里存在"不可恢复"与"浏览器数据"两个关键词。

**(f) 不新增**"卸载前清理"按钮（§6 非目标，避免越界）

**(g) R16 的配套约束：`install(ctx)` 与开发同步纪律（新增需求，用户确认 2026-10-12）**

**g-1 `install(ctx)` 钩子不得触碰 profile 目录。**

`install(ctx)`（入口具名导出，`.oix` 安装完成后立即执行；覆盖安装会重跑，`ctx.upgraded === true` —— `skills/obox-ext-dev/SKILL.md:44`、`src/renderer/src/core/hooks.ts:25-38`）**只允许**做幂等动作：

| 允许 | 禁止 |
|---|---|
| 打一条日志（版本、`upgraded`） | `remove` / `rm` / `rmdir` 任何 `chrome/**` 下的路径 |
| 建库表 / 建唯一索引（`CREATE TABLE IF NOT EXISTS`、`CREATE UNIQUE INDEX IF NOT EXISTS`） | `rename` / `moveProfile` / 移动或重命名任何 profile 目录 |
| `mkdir -p chrome/`（**确保目录存在**，绝不删除其中内容） | 重建（先删后建）profile 目录、清空 `.trash/` 以外的任何 profile 内容 |
| 清理本扩展自己的临时文件 `chrome/.pending-move.json`（仅当它明显是**上一会话遗留**且与当前库不一致时；默认**不删**） | 任何形式的"数据迁移/整理"（重命名目录以对齐 `name`、删除孤儿目录等） |

- 理由：覆盖安装会重跑 `install`，而 `ctx.upgraded === true` 时 profile 里承载着用户的登录态；任何"顺手整理"都会造成不可恢复的登录态丢失（R16 的核心保护）
- `install` 必须**幂等**（技能硬性要求）：重复执行不产生副作用
- **源码门禁**：`test/uninstall.test.js`（同一文件）必须断言 `index.js` 的 `install` 与 `uninstall` 函数体内**不出现** `rename` / `rm(` / `copyFile` / `cp(` / `moveProfile` / `removeProfile` 字样

**g-2 开发同步纪律（必须写进 README 的开发者小节）**

把本地构建产物同步到已安装目录（`%APPDATA%\obox\extensions\webapp_chenzhi\`）做调试时：

- **只覆盖**这五类分发文件：`manifest.json`、`index.js`、`helper.cjs`、`lib/**`、`ui/**`（与 `scripts/pack.mjs` 的 `INCLUDE` 白名单同源）
- **绝不动** `data/`（含 `data/webapp.db`、`data/chrome/**`）。README 必须给出一条**只覆盖分发文件**的可复制命令（用显式文件清单，禁用 `Copy-Item -Recurse` 整个目录、禁用 `/MIR` 镜像同步）
- 反面示例（README 里写明**禁止**）：`robocopy . "$dst" /MIR`、`Copy-Item <extdir>\* -Recurse -Force` —— 前者会删掉 `data/`，后者行为不可控

```
# README 给出的正确同步命令（只覆盖分发文件，不碰 data/）
$dst = "$env:APPDATA\obox\extensions\webapp_chenzhi"
Copy-Item manifest.json,index.js,helper.cjs -Destination $dst -Force
Copy-Item lib   -Destination $dst -Recurse -Force
Copy-Item ui    -Destination $dst -Recurse -Force
# 校验：data/ 未被改动（能看到条目库与 profile 根）
Test-Path "$dst\data\webapp.db"; Test-Path "$dst\data\chrome"
```

## 15. 界面规格

### 15.1 复用 `rdp` 的规范（R14，逐条照搬）

| 规范 | `rdp` 的实现落点 | webapp 的照搬方式 |
|---|---|---|
| **宿主主题 token、零自造色值** | `extensions/rdp/src/styles.css:1-14`（只消费 token、不写 fallback 字面量）；兜底值集中在 `theme.js` 的 `FALLBACK_TOKENS`；`test/stylesTokens.test.js` 是门禁 | 逐条照搬。`:root` 只允许新增**布局**变量 `--radius` / `--radius-lg` / `--label-w`（宿主 token 清单里没有圆角与栅格宽度，`styles.css:12-13`） |
| **主题下发协议** | 宿主经 `obox-theme` postMessage 推 25 个 token（`src/renderer/src/core/appTheme.ts:28-54,120-131`）；`AppWindow.vue:78-88` 在 iframe `load` 与主题变化时下发；子页可发 `obox-theme-request` 请求重发 | 照搬 `extensions/rdp/src/theme.js`；`bridge.js` 的 `message` 监听里加 `obox-theme` 分支 |
| **每项一行 + 一行灰色说明** | `.card__title`（单行省略，`styles.css:248-258`）+ `.card__subtitle`（`color: var(--fg-dim)`、`font-size: var(--font-size-sm)`、`min-height: 16px`，`styles.css:260-265`） | 照搬；标题行右侧追加 TLS 标记（§15.2） |
| **下拉说明写在选项内（R14，D-3 后正式生效）** | `<option>{{ option.value }} — {{ option.label }}</option>`，更细的一句放该 option 的 `title`（`ConnectionField.vue:141-159`）；`optional` 字段最前面加空值选项 `（留空）`（`:150`） | **正式生效**：webapp 有**两个** select 字段（`lang`、`scaleFactor`，D-3 改），必须逐条遵守：<br>① 每个 `<option>` 的可见文本 = `<值> — <短说明>`（说明写在**选项内**，不另占一行、不放在字段下方）；<br>② 更细的一句放进该 option 的 `title`（悬浮提示）；<br>③ 第一个选项是空值选项，文案 `不指定（用 Chrome 默认）`，其 `value=""`；<br>④ `test/fieldDocs.test.js` 的真实断言（不再是空转门禁）：遍历 `src/fields.js` 里所有 `type === 'select'` 的字段，**每个** `options[]` 项的 `label` 与 `desc` 都必须是非空字符串，且必须存在空值选项 |
| **标签列固定宽度左对齐** | `--label-w: 144px`（`styles.css:37`，含实测依据注释）；`.field` 是**唯一**栅格容器 `grid-template-columns: var(--label-w) minmax(0,1fr)`（`:548-556`）；`.field__label { justify-self:start; text-align:left }`（`:564-570`）；`.field__control { justify-self:stretch; text-align:left }`（`:573-580`）；**禁止**再加 `.field__row` 包裹（`:542-546`，`test/formAlign.test.js` A1⑦ 拦） | 照搬**整个 `.field` 栅格模型**。`--label-w` 重新测量：webapp 最长标签是「忽略证书问题」（6 个全角字）→ 依 `rdp` 的字体上界口径（全角 1.15em，12px ⇒ 13.8px/字）约 82.8px。**规格裁定：仍用 144px**，理由：① 与 rdp 视觉一致（同一产物家族）；② 为"TLS 已降级"等未来标签留余量；③ 免去重新做字体测量证据链的成本。**实现时若实测发现控件列过窄需要收窄，必须补 `docs/evidence/` 测量记录**（照 `rdp` 的 `docs/evidence/align-measure/`） |
| **窄窗堆叠** | `@media (max-width: 568px) { .field { grid-template-columns: minmax(0,1fr) } .field__desc/.field__hint/.field__error { grid-column: 1 } .field__label--empty { display:none } }`（`styles.css:701-721`）；568 由算式反推（`styles.css:688-697`） | **必须重算断点**：`--label-w(144) + 列间距(8) + 控件列下限 + .overlay 左右内边距(32) + .modal__body 左右内边距(40) + 折叠区内边距(24)`。webapp 控件列下限取 **280px**（最长内容：`--lang` 输入框与坐标输入对，均短）⇒ 断点 = **524px**，规格裁定取整为 **520px**。测试沿用 `rdp` 的算式断言方式（`test/formAlign.test.js`） |
| **模态框只能按钮关闭** | `ConnectionModal.vue` 头部注释与实现（`:6-8`）：点遮罩、按 Esc 都**不**关闭；模板里**没有** `@mousedown.self`、**没有** keydown/Esc 分支；关闭路径只有「✕」「取消」「保存成功」三条；`test/componentSource.test.js` 是源码门禁 | **逐条照搬**，门禁断言同样照搬（**webapp 的 `componentSource.test.js` 必须断言：源码里不出现 `@mousedown.self`、不出现 `keydown.esc` / `Escape` 关闭逻辑**） |
| **卡片网格与空态** | `.app__grid { grid-template-columns: repeat(auto-fill, minmax(320px,1fr)) }`（`styles.css:137-142`）、720px 断点降单列（`:166-170`）；`.empty`（`:328-355`） | 照搬 |
| **状态栏** | `.statusbar`（40px，可折叠，`styles.css:359-405`）；成功/错误色用 `--fg-success` / `--fg-error` | 照搬 |
| **构建链** | `vite.config.mjs`：`root: ./src`、`base:'./'`、`outDir: ./ui`、`target:'chrome120'`、`format:'iife'`、`inlineDynamicImports:true`、`cssCodeSplit:false`、`modulePreload:false` | **逐条照搬**（`app://` 下必须相对路径 + 单文件产物，`extensions/rdp/vite.config.mjs` 注释记录的结论） |

### 15.2 webapp 特有的字段与提示

**字段集（`src/fields.js` 的 `COMMON_GROUPS`）**：

| key | 标签 | 类型 | 必填 | 说明行（`desc`，一行） | 校验 |
|---|---|---|---|---|---|
| `name` | 名称 | text | ✅ | `条目的显示名，同时作为浏览器数据目录名。` | §12.3 文案表 |
| `url` | 网址 | text | ✅ | `只能填 http:// 或 https:// 开头的地址。` | §12.4 |
| `desc` | 说明 | text | — | `一句话备注，显示在列表里（最多 120 字）。` | ≤ 120 |
| `ignoreCert` | 忽略证书问题 | check | — | `开启后 Chrome 不再校验该站点的证书（TLS 已降级），且该站点被当作安全上下文。` | 布尔 |
| `extraOrigins` | 额外 origin | textarea（4 行，单列） | — | `每行一个 origin，用于同一个应用窗口要访问多个自签证书站点的场景；最多 8 条。` | §12.2 |

**字段集（`ADVANCED_GROUPS`，放在「▸ 高级选项」折叠区）**：

| key | 标签 | 类型 | 说明行 | 校验 |
|---|---|---|---|---|
| `windowSize` | 窗口尺寸 | pair（宽/高） | `留空即用 Chrome 默认；两者必须同时填。` | 320–7680 / 240–4320 |
| `windowPos` | 窗口位置 | pair（左/上） | `多显示器时可指定；允许负值；两者必须同时填。` | -10000–10000 |
| `startMaximized` | 启动即最大化 | check | `勾选后窗口以最大化打开。` | 布尔 |
| `lang` | 界面语言 | **select**（D-3） | `指定该应用窗口的界面语言；不指定即随系统。` | **枚举**：见下方"语言下拉清单"；未选中（`''`）= 不传该参数 |
| `scaleFactor` | 缩放比例 | **select**（D-3） | `高 DPI 屏上字太大/太小时调整；不指定即随系统 DPI。` | **枚举**：15 项（见下）；未选中（`''`）= 不传该参数 |
| `disableGpu` | 禁用 GPU 加速 | check | `显卡驱动异常导致窗口花屏时勾选。` | 布尔 |

#### 15.2.1 两个下拉字段的选项清单（正式生效，R11 已修订）

**`lang`（界面语言）—— 12 项**（含空值项；具体清单登记为 **P6（待用户微调）**，实现按本清单先行）：

| 顺序 | `<option value>` | 可见文本（`<值> — <短说明>`） | `title`（更细的一句） |
|---|---|---|---|
| 1 | `''` | `不指定（用 Chrome 默认）` | 不加 `--lang`，语言随系统/浏览器设置 |
| 2 | `zh-CN` | `zh-CN — 简体中文（中国大陆）` | 常见企业内网系统的默认语言 |
| 3 | `zh-TW` | `zh-TW — 繁体中文（台湾）` | — |
| 4 | `en-US` | `en-US — 英语（美国）` | — |
| 5 | `en-GB` | `en-GB — 英语（英国）` | — |
| 6 | `ja-JP` | `ja-JP — 日语` | — |
| 7 | `ko-KR` | `ko-KR — 韩语` | — |
| 8 | `de-DE` | `de-DE — 德语` | — |
| 9 | `fr-FR` | `fr-FR — 法语` | — |
| 10 | `es-ES` | `es-ES — 西班牙语` | — |
| 11 | `ru-RU` | `ru-RU — 俄语` | — |
| 12 | `pt-BR` | `pt-BR — 葡萄牙语（巴西）` | — |
| 13 | `it-IT` | `it-IT — 意大利语` | — |

> **P6（待用户微调）**：上表是规格登记的提议清单；用户可增删条目。**实现按本清单先行**，P6 只影响这份枚举的内容，不影响字段形态与参数构造规则。若用户在实现前给出新清单，只改 `src/fields.js` 的 `options` 与 `lib/webapp.mjs` 的 `LANG_VALUES` 两处（以及对应单测的表驱动数据），不需要改任何其它设计。
>
> **校验口径（修订）**：不再使用正则 `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`；改为**枚举成员校验** —— 取值必须是 `LANG_VALUES`（含 `''`）之一，否则字段级错误「界面语言不在可选清单内」。这样杜绝手输非法标签。

**`scaleFactor`（缩放比例）—— 16 项**（15 个数值 + 空值项；值域与步进与 R11 原文一致，只是把"手输数值"改为"下拉枚举"）：

| 顺序 | `<option value>` | 可见文本 | 生成的参数 |
|---|---|---|---|
| 1 | `''` | `不指定（用 Chrome 默认）` | **不传** `--force-device-scale-factor` |
| 2–16 | `0.5` `0.75` `1` `1.25` `1.5` `1.75` `2` `2.25` `2.5` `2.75` `3` `3.25` `3.5` `3.75` `4` | `0.5 — 极小` / `0.75 — 小` / `1 — 100%（默认）` / `1.25 — 125%` / `1.5 — 150%`（推荐，常见笔记本） / `1.75 — 175%` / `2 — 200%` / `2.25 — 225%` / `2.5 — 250%` / `2.75 — 275%` / `3 — 300%` / `3.25 — 325%` / `3.5 — 350%` / `3.75 — 375%` / `4 — 400%（上限）` | 选中 `n` 时传 `--force-device-scale-factor=<n>` |

- 值的字符串形态直接取自 value（`1.5` → `--force-device-scale-factor=1.5`，不出现 `1.50`）
- **校验口径（修订）**：不再做"数值区间 + `(n*4)` 整数"判断；改为**枚举成员校验**（取值必须是 `SCALE_VALUES` 之一）。原区间/步进约束**内化进清单本身**：清单恒等于 `0.5 + 0.25k`（k = 0..14）

#### 15.2.2 两个下拉字段的渲染与门禁（R14 正式生效）

- 渲染规则完全照搬 `rdp` 的 `<select>`（`extensions/rdp/src/components/ConnectionField.vue:141-159`）：`<option :value :title>{{ value }} — {{ label }}</option>`；空值项在最前且 `value=""`
- `test/fieldDocs.test.js` 的真实断言（**不再是空转门禁**）：
  1. 遍历 `src/fields.js` 里全部 `type === 'select'` 字段 → **恰好 2 个**（`lang`、`scaleFactor`）
  2. 每个字段必须有 `optional: true` 且 `options[0].value === ''`（空值项在最前）
  3. 每个字段的**每个** `options[]` 项的 `label` 与 `desc` 都是非空字符串（"说明写在选项内"的机器判据）
  4. `scaleFactor` 的数值项集合**恰好等于** `[0.5, 0.75, 1, …, 4]`（15 项、步进 0.25、无重复、无越界）
  5. `lang` 的取值集合与 `lib/webapp.mjs` 的 `LANG_VALUES` **逐项相等**（防两处漂移）
  6. `lib/chromeArgs.mjs` 的 `buildChromeArgs` 对 `''` 的取值**不产出**对应参数（空值 = 不传，与其它开关同口径）
- `test/componentSource.test.js` 断言 `WebappField.vue` 的 select 分支与 `rdp` 同型（含 `:title="option.desc"`、空值项在最前）

**webapp 特有的界面提示（R15 + 边界场景）**：

1. **TLS 降级标记（R15，必须可见）**
   - 列表卡片标题行右侧：当 `ignoreCert === true` 时渲染 `.tls-badge`，文案 **`TLS 已降级`**，`title`（悬浮）文案：`该条目的证书校验已关闭，流量可能被同网段攻击者读取或改写。`
   - 颜色只用 token：`border-color: var(--fg-warning)`、`color: var(--fg-warning)`、背景 `color-mix(in srgb, var(--fg-warning) 8%, transparent)`（与 `.alert--error` 的 `color-mix` + 透明兜底写法同型，`styles.css:158-164`）
   - 编辑模态框里 `ignoreCert` 字段的说明行**始终可见**（不是只在开启时显示），并在开启时给该字段加一行红/黄提示：`⚠ 已关闭该站点的证书校验（TLS 降级）`
   - `ignoreCert === false` 时不渲染任何标记
   - **门禁**：`test/componentSource.test.js` 断言卡片组件源码里存在 `TLS 已降级` 字面量，且该渲染受 `ignoreCert` 条件控制
2. **删除确认文案（必须写明不可恢复）**
   - 标题：`删除网页应用「<name>」？`
   - 正文（两段）：
     - `这会同时删除该站点的浏览器数据（登录状态、Cookie、缓存），删除后不可恢复。`
     - `若该站点的窗口正开着，请先关闭它，否则删除会失败。`
   - 按钮：`取消` / `删除`（危险样式 `.btn--danger`，`styles.css:214-224`）
3. **开关未生效提示**：`open` 成功文案后缀 `（若窗口开关未生效，请先关闭该站点的浏览器窗口再打开）`
3b. **"已知行为"说明（真机已核实，必须写进 README 与界面 `title`）**：Chrome 的单例机制决定——**同站点窗口已开着时，新设置的窗口尺寸/位置/语言/缩放不会生效**（新进程会把请求转交给已有实例，并忽略自身参数）。因此"改了设置没生效"的标准处置是：**先关闭该站点的窗口，再重新打开**。这句话要同时出现在：① 状态栏成功文案后缀；② 「高级选项」折叠区的说明行；③ README 的「已知行为」小节。
4. **首次打开提示**（可选、非必须）：若 `profileInfo.exists === false`，`open` 成功文案后缀 `（首次打开会初始化浏览器数据目录，可能稍慢）`
5. **数据体积提示（R17 改写）**：
   - 条目卡片的 `title`（悬浮）里带 `数据目录：<相对路径>`；**不再**只说"体积可能 GB 级"，而是给可操作的入口
   - 每张卡片有一个**「查看体积」**动作（小按钮或可点击的占位文本）→ 调 `profileSize({ id })` → 就地显示 `已用 1.24 GB / 上限 2 GB`（超限时该行用 `--fg-warning`）
   - **不做常驻轮询、不在 `list` 时自动扫盘**（§14.6）
   - 上限为 `0`（不限制）时，体积行只显示 `已用 1.24 GB`，不带"上限"部分
6. **体积超限拦截模态框（R17，必须存在）**
   - 触发：`open` 返回 `data.overLimit === true`（§11.1 / §14.6 第 5 步）
   - 标题：`「<name>」的数据目录已超过上限`
   - 正文（三段，必须含数字）：
     - `当前占用 1.24 GB，上限 2 GB，其中可清理的缓存约 860 MB。`
     - `清理缓存会删除该站点的网页缓存（HTTP 缓存、代码缓存、GPU 缓存），但保留登录状态与 Cookie。`
     - `若该站点的窗口正开着，清理可能部分失败，建议先关闭它。`
   - 按钮（**只有按钮能关闭**，遵守 §15.1 的既有规范）：
     - `清理缓存并打开`（主按钮）→ `cleanCaches({ id })` → 重新预检 → 通过则继续打开；仍超限则回到本模态框并多显示一行 `清理后仍为 1.05 GB，仍超过上限`
     - `仍然打开`（次级）→ `open({ id, force: true })`
     - `取消`（次级）→ 什么都不做
   - **不允许**出现"把上限调大"或"删掉该站点"的按钮（前者该去设置页、后者是删除条目的危险动作，不在这里混）
7. **全局「清理全部缓存」入口（R17）**
   - 位置：列表页 header 右侧，「＋ 新建」左边的次级按钮「清理全部缓存」
   - 点击 → 二次确认（`DeleteConfirm.vue` 同型的模态框，按钮关闭）：`清理全部站点的网页缓存？` / `这会删除各站点的 HTTP 缓存、代码缓存与 GPU 缓存，但保留登录状态与 Cookie。若某些站点的窗口正开着，对应项会被跳过。` / 按钮 `取消` + `清理`
   - 执行 → `cleanCaches({})` → 状态栏 `已清理 N 项，释放 X MB`（有跳过时追加 `，M 项被跳过（可能窗口正开着）`）
   - 完成后刷新界面上已显示过的体积（把本地体积状态清空，让用户重新点「查看体积」）

## 16. 权限与安全

| 项 | 规格 |
|---|---|
| TLS 降级（R-1，用户已接受） | `ignoreCert` 默认 `true`；每条目可关；界面上必须有可见标记（R15）。**真机已核实（探针阶段一）**：`--ignore-certificate-errors` **确实能过证书错误**（DevTools `/json/list` 显示自签/过期站点的标题从"[隐私设置错误]"变为正常页面标题）；而 `--unsafely-treat-insecure-origin-as-secure` **单独使用对证书错误无效**（仍是错误页）。⇒ **必须分开陈述**：真正过证书的是前者，后者只把 origin 当安全上下文（解决"被当不安全来源"的问题，如 Service Worker/剪贴板等特性）。README 与界面文案中**禁止**出现"`--unsafely-treat-insecure-origin-as-secure` 能过证书"这类表述 |
| 助手的能力边界 | 只做「探测 Chrome + 按白名单参数 spawn + 在自己的 profile 根内做目录读写」。**不接受任意命令行透传**（§11.2 的 5 条校验），不接受任意路径（只允许 `chrome/<单层目录名>`） |
| 扩展的能力边界 | 扩展是**受信代码、无沙箱**（`SKILL.md:47`、`docs/adr/0015`）。本扩展除注入的 `api` 外零运行期依赖，不碰 `window.api`，不动态加载远程代码 |
| 凭据 | **完全不接触**：不用 `api.secrets`，不读不写任何密码。Chrome profile 里的凭据由 Chrome 自己管理，扩展不解析 profile 内容 |
| 日志 | 只记摘要：`launch` 打印 `method + exe + 参数个数 + profileDir 相对名`，**不打印完整命令行**（当前命令行无凭据，仍保持"只记摘要"的既定口径）。参数值里若含 URL 的 userinfo（`user:pw@host`），**必须在 `describeLaunch()` 里脱敏为 `***`** |
| 网络 | 不使用 `api.net`。界面是 `app://` 本地页；CSP 为宿主渲染进程的 `default-src 'self' app:`，本扩展不 fetch 外部 |
| 审计 | `createdAt` / `updatedAt` 记录在库；profile 的读写不留额外日志（避免噪音）。**R17 的清理动作例外**：`cleanCaches` 的 `removedDirs` 必须经 `console.info` 记进输出通道（"删了什么"必须可审计） |
| **数据删除边界（R17）** | 本扩展会删用户数据的动作**只有三个**，且都能被用户看见：① 删除条目（连 profile，二次确认写明不可恢复）；② 清理缓存（白名单目录，保留登录态，返回可审计）；③ 卸载扩展（宿主删整个目录，README/Release 声明）。**没有第四个**——不做自动清理、不在后台删任何东西（§6 非目标 13） |
| **可清理白名单是安全边界的一部分（R17）** | `CACHE_DIR_NAMES` 是**白名单**：只有 8 个固定目录名可能被删；实现中不得出现"按体积大小选目录删""按名字包含 `cache` 就删"之类的启发式（`test/helperCache.test.js` 用"白名单外同名目录必须仍在"钉住） |
| 平台 | **仅 Windows**：Chrome 探测路径、`reg.exe`、`fs.rename`/`fs.rm` 的占用语义都是 Windows 口径。非 Windows 上 `probe` 返回 `chrome: null` 且 `open` 明确报 `[chrome-not-found]`（不静默） |

## 17. 性能与规模约束

| 约束 | 规格 |
|---|---|
| 条数 | 目标 ≤ 50 条（远超实际使用）。`list` 一次 `get_all()`，无分页（照搬 `rdp`） |
| 扩展激活开销 | **懒**：不在激活时连通道、不开库、不探测 Chrome。首次用户操作才触发（照搬 `extensions/rdp/index.js:137-152` 的懒连接） |
| `open` 延迟 | 探测（10–30ms）+ spawn（< 50ms）+ Chrome 自身冷启动（1–10s，与 profile 体积相关）。扩展侧不做任何同步阻塞 |
| profile 体积 | 单站点可达 GB 级（R-5）。`removeProfile` 的超时给到 300s；`.trash` 残留清理放在激活后的懒执行，不阻塞界面 |
| 磁盘位置 | profile 落在 `%APPDATA%`（通常在 C: 盘）→ README 必须说明"多站点长期使用会占用大量 C 盘空间"，并给出"手动搬迁"的说明（**不做**界面内的搬迁功能）。**R17 补一句**：界面提供"体积上限 + 预检拦截 + 只清缓存"作为**节流**（缓存上限 ≠ 目录上限，见 §12.1） |
| **体积扫描成本（R17）** | 递归 `readdir` + `stat`；GB 级 / 数万文件在机械盘可能 10–60s。约束：① **只**在「打开」前预检与用户点「查看体积」时扫描；② 助手侧 **60s TTL 内存缓存**（§14.6）；③ **绝不常驻轮询**；④ `profileSize` 超时给 120s；⑤ 扫描期间界面给"正在统计大小…"反馈，不阻塞列表渲染 |
| **清理成本（R17）** | 「清理全部缓存」要遍历所有条目 × 各自的缓存目录；`cleanCaches` 超时 300s。逐目录删除，天然可中断（中断只是少清了几个目录，不影响一致性） |
| 并发 | 同一 profile 被重复启动 = Chrome 的并入语义（R12），不算错误。扩展侧对同一 id 的并发 `open` 不做去重（Chrome 自己会并入） |
| 消息体积 | 单条 `api.ipc` 消息上限 8MB（`src/main/ipcCore.ts:22-23`）；`launch` 的 args 数组 < 2KB，完全够 |
| DB 体积 | 50 条 × 约 15 列 ≈ 数十 KB，无索引/查询优化需求（唯一索引已建） |

## 18. 测试计划

### 18.1 纯逻辑单测（`node --test`，零依赖）

**`test/chromeArgs.test.js`**（最高价值：把 R9–R11 钉成可执行断言）

| 用例 | 断言 |
|---|---|
| 最小条目（只有 name/url/ignoreCert=true） | 数组**逐一相等**于 `['--app=https://a/','--user-data-dir=chrome/A','--disable-features=DownloadBubble','--ignore-certificate-errors','--unsafely-treat-insecure-origin-as-secure=https://a']` |
| `ignoreCert=false` | 数组里**不含** `--ignore-certificate-errors` 与 `--unsafely-treat-insecure-origin-as-secure`，其余完全相同 |
| 全部白名单开关都填 | 顺序恰为 §12.1 的 ①–⑪；`--force-device-scale-factor=1.5`（不是 `1.50`）；`--lang=zh-CN` |
| **空值不传（表驱动）** | 每个开关单独留空 → 该参数不出现；**两个下拉停在"不指定"（`''`）→ `--lang` 与 `--force-device-scale-factor` 都不出现**（D-3 的关键断言）；`pair` 只填一半 → 返回字段级错误而非部分参数 |
| origin 推导（表驱动） | 覆盖 §12.2 的 5 条实测样例 + `http://` + 非默认端口 + IPv6 字面量 + userinfo 被丢弃 |
| `extraOrigins` | 多行 → 逗号连接、主 origin 在前、去重、协议不符报错、> 8 条报错、空行被忽略 |
| 白名单边界（表驱动） | `windowSize` 319/7680/7681、`windowPos` -10000/-10001/10000 |
| **枚举边界（表驱动，D-3）** | `scaleFactor`：`''`（不传）、`'0.5'`、`'1.5'`、`'4'` 各生成正确参数；`'0.49'` / `'4.1'` / `'1.3'`（不在清单）/ `1.5`（number 而非 string）/ `'1.50'`（形态不符）→ 全部字段级错误「缩放比例不在可选清单内（请从下拉中选择）」<br>`lang`：`''`（不传）、`'zh-CN'`、`'en-US'`、`'ja-JP'` 生成 `--lang=<值>`；`'xx-YY'`（不在清单）/ `'zh_CN'` / `'ZH-CN'`（大小写不符）→ 字段级错误「界面语言不在可选清单内（请从下拉中选择）」 |
| 非法 url | `file:` / `javascript:` / `chrome:` / `data:` / `about:` / 无协议 / 相对路径 → 全部字段级错误 |
| 未知键被丢弃 | 传入 `{ proxyServer: 'x' }` → 归一结果不含该键，且 args 里不出现 `--proxy-server` |

**`test/settings.test.js`（R17，纯逻辑）**

| 用例 | 断言 |
|---|---|
| 归一：合法值 | `'0'`/`'512'`/`'2048'`/`'8192'` → MB 数字；换算成字节正确（`2048` → `2147483648`） |
| 归一：非法值回落 | `undefined` / `''` / `'abc'` / `'-1'` / `'999999'`（不在清单） / `null` → 回落默认值（`2048` / `512`），且**只 warn 一次** |
| `webapp.profileLimitMb = 0` | 视为"不限制"：预检函数返回 `{ skip: true }`，**永不拦截** |
| `webapp.diskCacheMb = 0` | `buildChromeArgs` **不产出** `--disk-cache-size` |
| `webapp.diskCacheMb = 512` | 产出 `--disk-cache-size=536870912`（**字节**，不是 MB） |
| 设置变更作废缓存 | 模拟 `api.settings.onChanged('webapp.profileLimitMb')` → 下一次 `open` 走 `force: true` 路径（体积缓存不命中） |
| 体积格式化 | `formatBytes(0)`/`1023`/`1024`/`1536`/`2147483648` → `0 B` / `1023 B` / `1.00 KB` / `1.50 KB` / `2.00 GB` |
| 超限判定边界 | `bytes === limitBytes` → **不算超限**（用 `>`）；`limitBytes+1` → 超限 |

**`test/manifest-settings.test.js`（R17，清单形状门禁）**

| 用例 | 断言 |
|---|---|
| `contributes.settings` 存在且形状正确 | `id === 'webapp.settings'`；`fields` 是数组且**恰好 2 项**；每项有非空 `key`/`label`、`type` 在四类枚举内 |
| 两个键名固定 | 恰好是 `webapp.profileLimitMb` 与 `webapp.diskCacheMb`（`validate-manifest.mjs` **不检查** settings 形状 —— 见 §10.3 最后一条 —— 因此这个测试是唯一防线） |
| `select` 的 `options` 完整 | 每个 select 字段 `options` 非空、每项 `value`/`label` 均非空、`value` 无重复、`default` 出现在 `options` 的 `value` 里 |
| 字段说明存在 | 两项都有非空 `description` |
| 清单可被校验脚本接受 | 直接 `JSON.parse` 清单并断言上述结构（不重复跑脚本，脚本由 AC5 覆盖） |

**`test/nameSanitize.test.js`**| 用例 | 断言 |
|---|---|
| 非法字符替换 | `a\b/c:d*e?f"g<h>i|j` → `a-b-c-d-e-f-g-h-i-j`（替换规则：连续非法字符合并成一个 `-`，与 R5 的"替换"口径一致；**规格裁定用 `-`**） |
| 保留名 | `CON`/`con`/`PRN`/`AUX`/`NUL`/`COM1`–`COM9`/`LPT1`–`LPT9`（含带扩展名形式 `CON.txt`）→ 全部判为保留名 |
| 尾部点与空格 | `名.` / `名 ` / `名 . ` → 净化后去掉尾部的点与空格 |
| 长度预算 | 构造超长名使 `profileRoot + '\\' + name` 长度 = 241 → 报错；= 240 → 通过 |
| 空结果 | 全非法字符的名称净化后为空 → 报错 |
| 建议名 | 各错误场景都返回非空 `suggestName`，且建议名本身能通过校验（自身一致性） |

**`test/webapp.test.js`**

| 用例 | 断言 |
|---|---|
| 归一补默认 | 空输入 → 每列都有具体值（`ignoreCert: true`、**`lang: ''`、`scaleFactor: ''`**、其余字符串列 `''`、布尔列 `false`） |
| 大小写不敏感查重 | `Intranet` vs `intranet` vs `INTRANET` → 报重名（编辑时按 id 排除自己） |
| 校验文案 | §12.3 的文案表逐条匹配（含字段名，便于界面定位） |
| `toDbRow` / `fromDbRow` 往返 | 往返后所有列类型不变（布尔仍是布尔、**`lang` 与 `scaleFactor` 仍是 string 且值不变**） |
| **枚举常量单一来源（D-3）** | `LANG_VALUES` 与 `SCALE_VALUES` 导出且为只读；`SCALE_VALUES` 去空值项后**恰好等于** `['0.5','0.75','1',…,'4']`（15 项、步进 0.25、无重复） |
| `0/1/'1'` 归一 | 与 `extensions/rdp/index.js:48-51` 同口径 |
| 未知键 | 归一后不存在未知列 |

**`test/fields.test.js`**

| 用例 | 断言 |
|---|---|
| `defaultForm()` | `ignoreCert === true`、**`lang === ''`、`scaleFactor === ''`**、其余为空 |
| `rowToForm` | 库行 → 表单值（布尔 → 勾选、`"W,H"` → pair 两格、**`lang`/`scaleFactor` 原样回填为下拉当前值**） |
| `buildSavePayload` | 表单 → 载荷（pair 两格 → `"W,H"`、空 → `''`、勾选 → `true`） |
| 扩展侧 vs 界面侧同口径 | 同一条目分别过 `lib/webapp.mjs` 的 `validateWebapp` 与 `src/fields.js` 的 `validate` → **错误键集合完全一致**（防两处漂移，参照 `extensions/rdp/test/formState.test.js` 的做法） |
| 每个字段都有说明行 | 所有字段（含高级区）都有非空 `desc` 或 `hint` |
| **下拉选项门禁（D-3，正式生效）** | 见 §15.2.2 的 6 条真实断言：恰好 2 个 select、空值项在最前、每项 `label`/`desc` 非空、`scaleFactor` 数值集合恰为 15 项步进 0.25、`lang` 集合与 `LANG_VALUES` 逐项相等、`''` 不产出参数 |

### 18.2 helper 集成测（真子进程）

**`test/helper.test.js`**（照搬 `extensions/rdp/test/helper.test.js` 的骨架）

| 用例 | 断言 |
|---|---|
| `--selftest` | 退出码 0；stdout 含"selftest 通过"；**不真的启动 Chrome** |
| `probe` 往返 | `jsonrpc === '2.0'`；`result.cwd` 的 basename 等于传入的临时 cwd；`result.chromeCandidates` 是**长度恰为 4** 的数组且每项形如 `{ path, exists }`；`result.chrome` 为 null 或 `{ path, source, version }`（**D-2 = C：不做测试专用注入**，因此本用例只断言**形状与数量**，不断言具体哪一处命中——命中哪一条由真机验收 A13/A13b 手工覆盖） |
| 未知方法 | `error.code === -32601`，message 含方法名 |
| 缺 `jsonrpc` 的简写形状 | `error.code === -32602`（宿主强制的形状） |
| 非法 JSON | `error.code === -32700`，`id === null` |
| `launch` 参数校验（不真启动） | `args[0]` 非 `--app=` → `-32602`；含 `--proxy-server=x` → `-32602`；`--user-data-dir=..\\evil` → `-32602`；16 项以上 → `-32602` |
| **`probe` 不接受未知入参（D-2）** | 传 `{ chromeProbePaths: [...] }` / `{ skipRegistry: true }` → 这些键被**静默忽略**（`probe` 是只读诊断方法，入参无意义），且返回结果与传 `{}` 时**完全一致**（证明没有"测试后门"在生效） |
| `launch` 真启动（真机验收里跑，单测默认 `skip`） | 用真实 Chrome + 临时 `--user-data-dir` 启动 → 返回 `pid > 0`；随即 `taskkill /pid` 清理 |
| stdin 关闭 | 助手自行退出，退出码 0 |
| stdout 纯净 | 整个会话里 stdout 的每一行都能 `JSON.parse`（协议帧纯净性门禁） |

**`test/helperProfile.test.js`**

| 用例 | 断言 |
|---|---|
| `profileStatus` 不存在 | `exists: false`，不抛错 |
| `profileStatus` 存在未占用 | `exists: true`、`locked: false`（用普通测试目录伪造） |
| `moveProfile` 正常 | 目录被改名；`pending-move.json` 被清理 |
| `moveProfile` 目标已存在且非空 | 抛错，message 含 `[profile-move-failed]`；**源目录未被破坏** |
| `moveProfile` 源不存在 | 返回 `missing: true`，不抛错、不创建空目录 |
| `removeProfile` 正常 | 目录消失 |
| `removeProfile` 占用（模拟：对目录内文件开 `r+` 句柄后再改名） | 抛错，message 含 `[profile-busy]`；目录仍在（或已进 `.trash`） |
| **`profileStatus.locked` 的 `lockfile` 探测（真机结论落点）** | 造 `<dir>/lockfile` 且**不**持句柄 → `locked: false`；造一个**被独占打开**的 `lockfile`（Windows 上用 `FILE_SHARE_NONE` 打开，若造不出来则本用例标 `skip` 并注明）→ `locked: true`；**`lockfile` 不存在** → `locked: false`（且不抛错） |
| **删除失败的错误归一（真实信息文案）** | 把 profile 目录设为**只读**或目录内放只读文件 → `removeProfile`/`moveProfile` 失败 → 归一为 `[profile-busy]`，message 含**"文件被占用（通常是该站点的 Chrome 窗口正开着）"**；**断言 message 里不出现 `SingletonLock` 字样**（该文件在 Windows 上不存在，见 §14.3） |
| 路径防护 | `chrome/../x`、`chrome/a/b`、绝对路径、盘符 → 全部 `-32602` |
| `.trash` 清理 | 造两个残留 → 激活期清理函数只删"旧会话"的，不删本会话刚写的 |

**`test/helperCache.test.js`（R17，最关键的"只删缓存"门禁）**

| 用例 | 断言 |
|---|---|
| **保留清单逐字节不变（核心）** | 造假 profile：`Default/Cookies`（写入已知字节并记 sha256）、`Default/Login Data`、`Default/Web Data`、`Default/Local Storage/lv`、`Default/IndexedDB/x`、`Default/Service Worker/sw`、`Default/Preferences`、`Local State` → 跑 `cleanCaches({ name })` → **这些文件的 sha256 与 mtime 全部不变**、目录仍在 |
| 缓存被删干净 | 同一次调用里 `Default/Cache/`、`Default/Code Cache/`、`Default/GPUCache/`、`GPUCache/`、`ShaderCache/`、`Default/DawnGraphiteCache/`、`Default/DawnWebGPUCache/`、`Default/GrShaderCache/`、`Crashpad/` **全部不存在** |
| 白名单外同名目录不动 | 造 `Default/MyCache/`（不在白名单）→ **仍在**（证明是白名单而非"名字含 Cache"就删） |
| 深度限制 | 造 `Default/IndexedDB/Cache/`（深度 3、名字在白名单）→ **仍在**（只扫深度 2） |
| 大小写不敏感 | 造 `Default/cache/`（小写）→ 被删（白名单大小写不敏感） |
| 返回可审计 | `removedDirs` 列出实际删除的相对路径（与上面断言集合一致）；`totalFreedBytes > 0` |
| 单目录失败不抛错 | 把某个缓存目录设为只读（或对目录内文件持句柄）→ 该目录进 `skipped[]`，**函数返回成功**，其它目录照常删除 |
| 全部条目模式 | 两个假 profile（`chrome/A`、`chrome/B`）→ `cleanCaches({})` 两个都被处理；`cleaned` 长度 2 |
| 空根目录 | `chrome/` 不存在 → 返回 `{ cleaned: [], totalFreedBytes: 0, skipped: [] }`，不抛错 |

**`test/helperSize.test.js`（R17，体积与缓存语义）**

| 用例 | 断言 |
|---|---|
| 目录不存在 | `bytes === null`、`exists: false`、不抛错 |
| 空目录 | `bytes === 0` |
| 已知体积 | 造 `chrome/A/a.bin`（1000B）+ `chrome/A/B/b.bin`（2000B）→ `bytes === 3000`（递归；不含目录自身占用的块） |
| 缓存体积单独回显 | 同时造 `chrome/A/Default/Cache/c.bin`（500B）→ `cacheBytes === 500`，且它**计入** `bytes` |
| **TTL 命中** | 第一次调用 `cached: false`；立即第二次 `cached: true`、`bytes` 相同、`scannedAt` 不变 |
| `force: true` 绕过缓存 | 加文件后 `force: true` → `bytes` 变大、`cached: false` |
| TTL 过期（把 TTL 注入为 0 或 sleep 到过期） | 过期后 `cached: false` 且重新扫描 |
| `cleanCaches` 后失效 | 先扫一次 → `cleanCaches` → 再扫 → `cached: false` 且 `bytes` 变小 |
| `launch` 后失效 | 先扫一次 → 模拟 `launch` 成功 → 再扫 → `cached: false` |
| 路径防护 | `name` 含 `..` / 绝对路径 / 盘符 → `-32602` |

**真实占用测试的可行性说明**：Windows 上对**目录**持有句柄不会阻止 `rename`（目录可以改名），真正阻止的是目录内**文件**被独占打开。因此"占用"用例用"对目录内一个文件开独占句柄（`fs.open(file,'r+')` 不足以独占；需要 `FILE_SHARE_NONE`）"在纯 Node 下不好造。**规格裁定**：集成测里用**只读文件 + 只读目录属性**模拟"删除失败"路径（`fs.rm` 在 Windows 上会因只读文件失败），真实"Chrome 占用"必须在**真机验收**（§18.3）里验证。

### 18.3 真机验收步骤（必须逐条记录证据到 `docs/evidence/`）

| # | 步骤 | 期望 |
|---|---|---|
| A1 | 构建 + 打包：`npm test && npm run build && npm run pack` | 退出码 0；产物 `out/webapp-1.0.0.oix`；`tar -tf` 输出**不含 `data/`**、含 `manifest.json`/`index.js`/`helper.cjs`/`lib/chromeArgs.mjs`/`ui/index.html` |
| A2 | 清单校验：`node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json` | 退出码 0、0 error |
| A3 | 安装：obox → 扩展管理器 → 安装扩展 → 选 `out/webapp-1.0.0.oix` | 安装成功；重启/热生效后 App 里出现「网页应用」卡片 |
| A4 | 新建条目（`https://10.0.0.5:8443`、忽略证书勾选） | 条目立刻出现在列表顶部；状态栏成功文案 |
| A5 | 首次打开 | 出现 Chrome 应用窗口（**无地址栏、无标签页**），页面正常；自签证书**无警告**；`%APPDATA%\obox\extensions\webapp_chenzhi\data\chrome\<名>\` 被 Chrome 创建 |
| A6 | 同一 profile 再点「打开」 | **并入既有实例**、新开一个应用窗口（R12 预期）；状态栏带"开关未生效请先关闭窗口"提示 |
| A7 | 证书开关生效性验证 | 关闭证书忽略的那条 → 打开 → 自签证书**出现警告**（或直接拦截）；用 `--app` 地址栏不可见时以"页面能否加载"为准 |
| A8 | 开关生效性验证（尺寸） | 新建一条带 `windowSize=900,600`、**关闭该站点窗口后**打开 → 窗口尺寸为 900×600；`windowPos` 同理；`startMaximized` 打开即最大化 |
| A9 | 改名移动 | 编辑改名称 → 保存 → `chrome/<旧名>` 消失、`chrome/<新名>` 存在且内容一致；再次打开仍是同一登录态（**未登录新 profile**） |
| A10 | 改名冲突 | 改成一个已存在的名称 → 字段级红字；改成一个"目录已存在但库无此条目"的名称（手工造目录）→ 明确报错且库不变 |
| A11 | 删除（窗口未开） | 二次确认文案含"不可恢复"；确认后条目消失、`chrome/<名>` 消失（或进 `.trash` 后被清理） |
| A12 | 删除（窗口正开着） | 报错「请先关闭该站点的浏览器窗口后重试」；**条目仍在、目录仍在**。**真机判据（探针阶段一已核实）**：Chrome 运行期整目录删除/改名**确实失败**（`IOException: … journal.baj` / `Access to the path … is denied`），且删除目录内**单个文件会成功**——因此错误归一必须捕获这些 errno/文案并映射为 `[profile-busy]` |
| A13 | **Chrome 未安装（手工真机，D-2 = C）** | 见下方 §18.3.1 的**可逆步骤**：把 `C:\Program Files\Google\Chrome\Application` 临时改名为 `...\Application.bak`（必要时先停掉本机 Chrome 进程）**并**临时导出/删除注册表 `App Paths\chrome.exe` 键 → 「打开」报 `[chrome-not-found]` 且列出**按 4 顺位顺序**查找过的路径；**不回退 Edge**；验完**必须还原**并通过 §18.3.1 的还原校验命令确认 |
| A13b | **探测顺位（手工真机，D-2 = C）** | 只屏蔽第 1 顺位（改名 `Program Files` 下那处）而保留注册表键 → 「打开」应**成功**（命中第 4 顺位 = `registry`），且 `probe.chrome.source === 'registry'`；还原后 `source === 'programfiles'`。这条证明"顺位回退"真的按顺序走 |
| A14 | **升级保留（R16 主验收，必须做）** | ① 装 `webapp-1.0.0.oix` → ② 新建一条 webapp 条目并在该站点**完成登录**（能看到需要登录的页面）→ ③ 记下 `data/chrome/<名>` 的文件数与总体积、记下条目列表 → ④ 用**新版本** `.oix` 覆盖安装（同 id）→ ⑤ 确认：条目仍在、`data/chrome/<名>` 仍在且文件数与体积一致（允许 Chrome 自身新增/更新少量文件）、**再次「打开」仍是已登录状态**（不需要重新登录） |
| A15 | 升级保留（库层与落位，R16 补充） | 用安装态（`extId = webapp_chenzhi`）跑；确认 `data/webapp.db`、`data/.obox-meta-webapp.json`、`data/chrome/**` 在覆盖安装后仍存在（参照 `extensions/rdp/README.md:209` 的同类教训：必须用安装态，调试态不经过 `.oix` 安装流程） |
| A16 | 主题与窄窗 | 切换深浅主题 → 界面配色跟随、无自造色值残留；把窗口拉窄到 500px → 字段标签与控件**上下堆叠**、无横向滚动条 |
| A17 | 模态框关闭路径 | 点遮罩、按 Esc → 模态框**不关闭**；只有「✕」「取消」「保存成功」能关 |
| A18 | TLS 标记 | `ignoreCert=true` 的条目卡片上有「TLS 已降级」；关掉后标记消失 |
| A19 | 名称安全 | 依次尝试 `CON`、`a<b`、`名.`、超长名 → 都给出字段级文案 + 建议名 |
| A20 | **升级 vs 卸载 语义对比（R16 + D-1 一条链验完）** | ① 接着 A14 的已登录状态 → **覆盖安装** → profile 与登录态**在**（R16）→ ② 记下 `data/chrome` 的存在 → **卸载扩展** → 扩展目录消失、`chrome/**` 与登录态**永久消失**（D-1 选项 A）→ ③ 重新安装 `.oix` → 条目与 profile **不再存在**（证明卸载确实删了），README 里"升级保留 / 卸载永久删除"的对比段与备份命令是否都已写明 |
| A21 | **下拉字段（D-3）** | 「高级选项」里「界面语言」「缩放比例」都是**下拉框**，且：每一项显示形如 `zh-CN — 简体中文（中国大陆）`（说明在选项内）、悬浮有更细的 `title`、第一项是「不指定（用 Chrome 默认）」；选「不指定」后打开该站点 → 无 `--lang` / `--force-device-scale-factor` 参数（用 `probe` 或任务管理器命令行查看）；选 `zh-CN` + `1.5` 后打开 → `--lang=zh-CN --force-device-scale-factor=1.5` |
| A22 | **开发者同步纪律（R16 g-2）** | 按 README 给出的同步命令覆盖分发文件后 → `data/webapp.db` 与 `data/chrome/**` **未被改动**（mtime 不变、条目仍在）；README 是否给出了"禁止 `robocopy /MIR`/整目录 `Copy-Item -Recurse`"的反面示例 |
| **A25** | **设置项读写（R17）** | obox → 设置 → 扩展 → 「网页应用」下出现一页、两个下拉（`单站点数据上限` / `HTTP 缓存上限`）；把上限从 2 GB 改成 512 MB → 重启 obox 后**仍是 512 MB**（持久化）；改成"不限制"后打开任意条目**不再被拦截** |
| **A26** | **超限拦截（R17）** | 把上限临时设成 512 MB → 用某个已用 > 512 MB 的站点（或往 `data/chrome/<名>` 塞一个大文件伪造）→ 点「打开」→ **被拦截**，模态框显示"当前占用 / 上限 / 可清理缓存约 X"，且**只有三个按钮**（清理缓存并打开 / 仍然打开 / 取消），点遮罩与按 Esc **都不关闭** |
| **A27** | **清理只删缓存且 Cookie 保留（R17，最关键）** | 在执行 A26 的"清理缓存并打开"**之前**记下 `data/chrome/<名>/Default/Cookies` 的 sha256 与文件大小 → 执行清理 → ① 该文件 sha256 **不变**（登录态保留）；② `Cache/`、`Code Cache/`、`GPUCache/` 等缓存目录消失；③ 清理后重新预检通过并**成功打开**；④ 状态栏/日志显示释放了多少（`freedBytes`） |
| **A28** | **登录态确实还在（R17 的端到端判据）** | 承接 A27：清理后打开该站点 → **仍是已登录状态**（不需要重新登录）；对比反面：若手工删掉 `Default/Cookies` 则必然要重新登录（用于确认判据本身有效） |
| **A29** | **`仍然打开` 与全局清理（R17）** | ① 超限时点「仍然打开」→ 正常启动（且**不**修改任何设置）；再次点「打开」→ **仍会被拦截**（不持久化 force）；② 点「清理全部缓存」→ 二次确认文案含"保留登录状态与 Cookie"→ 执行后状态栏报 `已清理 N 项，释放 X MB`；若有窗口正开着，对应项出现在"被跳过"里；③ 卡片上的「查看体积」显示 `已用 X / 上限 Y`，且**列表加载时没有任何扫盘延迟**（对比：不点它就不该有 IO 峰值） |

#### 18.3.1 D-2 的手工真机步骤（可逆、可复现）+ 还原校验

> 背景：D-2 = C（不做测试专用注入），因此"Chrome 未安装"与"4 顺位探测顺序"只有手工覆盖。以下步骤**每一步都可逆**，且末尾必有还原校验。

**前置**：先退出本机所有 Chrome 窗口（否则第 1 步改名会被占用）；记下当前状态作为基线：

```powershell
# 0) 基线快照（记下来，还原时对照）
(Get-Item 'C:\Program Files\Google\Chrome\Application\chrome.exe').VersionInfo.ProductVersion
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' | Select-Object -ExpandProperty '(default)'
Test-Path 'C:\Program Files\Google\Chrome\Application.bak'
```

**步骤 1：屏蔽第 1 顺位（验证 A13b "顺位回退"）**

```powershell
# 需要管理员权限（Program Files 受保护）
Rename-Item 'C:\Program Files\Google\Chrome\Application' 'Application.bak'
```

- 期望：`probe.chrome.source === 'registry'`（命中第 4 顺位），「打开」**仍然成功**
- **还原**：

```powershell
Rename-Item 'C:\Program Files\Google\Chrome\Application.bak' 'Application'
```

**步骤 2：屏蔽第 4 顺位（验证 A13 "未安装"）**（在第 1 步仍生效的状态下做）

```powershell
# 先把键导出备份（恢复用），再删除
reg export "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" "$env:TEMP\chrome-apppath-backup.reg" /y
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /f
```

- 期望：`probe.chrome === null`、「打开」报
  `[chrome-not-found] 未找到 Chrome（已查找：C:\Program Files\Google\Chrome\Application\chrome.exe；C:\Program Files (x86)\Google\Chrome\Application\chrome.exe；C:\Users\<你>\AppData\Local\Google\Chrome\Application\chrome.exe；注册表 App Paths\chrome.exe）`
  —— **四条路径按序都要出现在文案里**；**不得**回退 Edge、不得静默失败
- **还原**（两条都要做）：

```powershell
reg import "$env:TEMP\chrome-apppath-backup.reg"
Rename-Item 'C:\Program Files\Google\Chrome\Application.bak' 'Application'
```

**还原校验（必须执行并记录输出）**

```powershell
# 1) 安装目录已还原
Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe'          # 期望 True
Test-Path 'C:\Program Files\Google\Chrome\Application.bak'                 # 期望 False
# 2) 注册表键已还原且值与基线一致
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' |
  Select-Object -ExpandProperty '(default)'                                 # 期望 C:\Program Files\Google\Chrome\Application\chrome.exe
# 3) 版本号与基线一致
(Get-Item 'C:\Program Files\Google\Chrome\Application\chrome.exe').VersionInfo.ProductVersion
# 4) 探测回到第 1 顺位
#    在扩展的「环境检查」（probe）里确认 chrome.source === 'programfiles'
# 5) 手工打开一次 Chrome，确认用户日常浏览器数据未受影响（不是新 profile）
```

- 全部 5 条通过才算还原成功；任一条不符 → **立即停止后续验收**，先修复环境
- 该步骤的证据（基线快照 + 屏蔽后的 `[chrome-not-found]` 原文 + 还原校验 5 条输出）落到 `docs/evidence/chrome-probe-manual.txt`

### 18.4 环境注意事项与真机探针结论（必读，避免复跑踩坑）

#### 18.4.1 ⚠️ 本 DSH 会话的 pwsh 工具会回收子进程（真机探针踩到的坑）

**事实**：本 DSH 会话的 `pwsh` 工具在每条命令结束时**回收该命令拉起的子进程**。因此用 `Start-Process chrome.exe …` 起的 Chrome **会在该条命令结束时被杀掉**，下一条命令里就观测不到它。

**由此产生的硬性纪律**：所有真机实验必须把「**启动 → 观测 → 清理**」写在**同一条命令**内完成（一次 `pwsh` 调用里做完三件事）。例如验证窗口参数：

```powershell
# 必须一条命令内完成：启动 → 等窗口出现 → 读 GetWindowRect/命令行 → 杀进程
$exe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$dir = Join-Path $env:TEMP ('webapp-probe-' + [guid]::NewGuid().ToString('N'))
$p = Start-Process $exe -ArgumentList @('--app=https://example.com','--user-data-dir='+$dir,'--window-size=600,400','--window-position=120,140') -PassThru
Start-Sleep -Seconds 4
# …此处观测（GetWindowRect / WMI 命令行 / DevTools /json/list）…
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
```

**同理**：`data/chrome/<名>` 的占用/删除实验、`--disk-cache-size` 的体积实验，都必须自包含在一条命令里。

#### 18.4.2 真机探针阶段一：已核实的结论（直接采纳，取代早前推测）

| # | 结论 | 实测方式 |
|---|---|---|
| P-1 | **`--app=<url>` 生效**：窗口 class `Chrome_WidgetWin_1`、标题 = 页面标题（**无 " - Google Chrome" 后缀** ⇒ 无地址栏/工具栏） | 起实例后读窗口 class 与标题；WMI 回显完整命令行 |
| P-2 | **`--window-size=W,H` 与 `--window-position=X,Y` 精确生效**：`GetWindowRect` 实测 `120,140,720,540`（= 600×400 在 120,140） | `GetWindowRect` 对照传入值 |
| P-3 | **`--start-maximized` 生效**（`zoomed=True`） | 读窗口 `zoomed` 状态 |
| P-4 | **`--ignore-certificate-errors` 确实能过证书错误**：DevTools `/json/list` 显示自签/过期站点标题从"[隐私设置错误]"变为正常标题 | Chrome DevTools HTTP `/json/list` |
| P-5 | **`--unsafely-treat-insecure-origin-as-secure` 单独使用对证书错误无效**（仍是错误页） | 同上；与 P-4 对照 |
| P-6 | **同 profile 二次启动：进程级参数一律无效**——第二个进程 **t ≤ 1s 内 exit 0**（转交既有实例）；`--app=<url>` 会转发并**新开窗口**，但新窗口沿用**首个实例**的 `--window-size`/`--window-position`/`--lang`（`navigator.language` 仍是首个实例的 zh-CN） | 先起实例 A（带一组参数），再起实例 B（带不同参数），观测 B 的退出码与时长、新窗口的实际矩形与 `navigator.language` |
| P-7 | **Windows 上没有 `SingletonLock`/`SingletonCookie`/`SingletonSocket`**（POSIX 专有）；实际占用是顶层 `lockfile`（0 B、独占、连读都失败）+ 约 30 个 LevelDB `LOCK` + 一个隐藏消息窗口 | 列目录 + 尝试打开 `lockfile` + 列 `*/LOCK` |
| P-8 | **运行期间整目录删除失败**（`IOException: The process cannot access the file 'journal.baj' …`）、**改名失败**（`Access to the path … is denied`），但**删除目录内单个文件成功**；停止 Chrome 后整体删除成功 | 窗口开着时分别尝试 `Remove-Item -Recurse`、`Rename-Item`、删单个文件；停进程后再试 |

**§18.4.2 的 P-1–P-8 与本节 Q-1–Q-3 就是探针阶段一的结论**（含 18.4.1 的真机实验纪律）。所有依赖真机的验收（A1–A29）都按 §18.4.1 的自包含命令模板执行。

**这些结论对 spec 的影响**（已全部回灌）：

- §5.1 背景表：P-7/P-8 写入"profile 占用语义"行；P-1–P-3 写入"参数精确实效"行（取代原"未核实 #1"）
- §6 非目标 6、§12.1 末尾、§14.6 开头、§15.2 第 3b 条：**独立 profile = 设计必然性**（P-6）
- §14.3："占用"判定改为**尝试删除/改名并捕获失败** + `lockfile` 快速探测（P-7/P-8）；**删除全部 `SingletonLock` 表述**
- §16、§19.1 R-1、§20.4：**分开陈述**两个证书参数的作用（P-4/P-5）
- §19.2 R-W1：改为"真机已核实"的确切行为（P-6）
- §26：第 1、2、3 项从"未核实"改为"已核实（探针阶段一）"

#### 18.4.3 真机探针阶段一：仍未核实的项（探针随后补）

| # | 项 | 为什么重要 |
|---|---|---|
| Q-1 | `--disable-gpu` 是否同属"仅首个进程读取"的进程级开关 | 决定 §15.2 第 3b 条的提示是否要把"禁用 GPU"也列进去（当前按 P-6 的同类假设处理，标为未核实） |
| Q-2 | 关窗后是否残留 Chrome 进程 | 决定"关闭该站点窗口"是否总能解除占用；若有残留，README 要教用户用任务管理器确认 |
| Q-3 | `--disk-cache-size` 是否真的限制 `Cache/` 体积 | R17 的"缓存上限"直接依赖它（§26 第 13 项） |

> 探针阶段一的完整报告（含原始观测输出）应在实现阶段落到 `docs/evidence/chrome-probe-stage1.txt`；Q-1–Q-3 的结论回来后，按 §18.5.2 的同一方式回灌本规格。

### 18.5 测试决策（seams 与既有 prior art）

- **测试缝隙（seams）**：
  1. `lib/chromeArgs.mjs` 的 `buildChromeArgs(entry, profileDir)` —— 纯函数，输入/输出都是值 → **R9–R11 的主战场**
  2. `lib/nameSanitize.mjs` 的 `sanitizeName` / `isReservedName` —— 纯函数 → R5
  3. `lib/webapp.mjs` 的 `normalizeWebapp` / `validateWebapp` / `toDbRow` / `fromDbRow` / `LANG_VALUES` / `SCALE_VALUES` —— 纯函数 → R3、R11（D-3 后含枚举）
  4. `helper.cjs` 的**真子进程 ndjson 边界** —— 进程级接口（照搬 `rdp` 的做法，`extensions/rdp/test/helper.test.js`）
  5. `index.js` 的 `api.app.onMessage` handler —— 用 mock `api` 单测（`guides-user.md:272-311` 记录的做法）
  6. 界面：`src/fields.js` 的纯函数 + `componentSource.test.js` / `fieldDocs.test.js` 的源码与表门禁（`rdp` 的做法，`extensions/rdp/test/componentSource.test.js`、`fieldDocs.test.js`）
- **不测**：Vue 组件的 DOM 渲染细节（沿用 `rdp` 的选择；真实交互放真机验收）
- **不引入测试框架/依赖**：一律 `node --test`（Node 内置）+ 手写断言（`node:assert/strict`），与 `rdp` 一致；**扩展不新增任何 npm 依赖**（`extensions/rdp/package.json` 的 dependencies 只有 `vue`，devDependencies 只用于构建/测试）——这是 obox 的硬边界（`skills/obox-ext-dev/references/workflow.md:47`）
- **不再有测试专用注入（D-2 = C）**：`probe` / `launch` / `profileStatus` / `moveProfile` / `removeProfile` 的入参**只有生产语义**，不得存在 `chromeProbePaths` / `skipRegistry` / `OBOX_WEBAPP_CHROME` 之类仅供测试的键或环境变量。代价是"探测顺位"与"Chrome 未安装"两条分支**没有自动化回归保护**，改为 §18.3.1 的手工可逆步骤 + `docs/evidence/chrome-probe-manual.txt` 证据；该覆盖缺口已作为**用户已接受的风险**登记在 **R-W11**（§19.2）

## 19. 风险与回退

### 19.1 沿用阶段 1 的风险（R-1 – R-5）

| 编号 | 风险 | 本规格的处置 | 回退 |
|---|---|---|---|
| R-1（用户已接受） | `--ignore-certificate-errors` 关闭 TLS 校验（真机已核实可过证书错误）；`--unsafely-treat-insecure-origin-as-secure` **只把 origin 当安全上下文，对证书错误无效、也不修证书**（真机已核实：单独用它仍是错误页） | 默认开 + 每条可关 + 界面可见标记（R15）+ README 风险节写明"流量可能被同网段攻击者读取/改写"，且**分开陈述两个参数的作用**（禁止写成"后者能过证书"） | 用户逐条关闭 `ignoreCert`；或卸载扩展 |
| R-2 | 删除连 profile 一起删属不可恢复 | 二次确认文案写明"删除后不可恢复"（§15.2）；删除走"先原子移入 `.trash` 再删库行"（§14.3） | 无（数据已删）；`.trash` 中转至少让"半删"可控 |
| R-3 | Chrome 升级可能改名/移除这些开关 | 全部参数集中在一个纯函数、单测钉住；`A5`–`A8` 真机验收每次发版前重跑；README 记录"Chromium 版本敏感" | 若某开关失效：从 §12.1 移除该参数并升版本，UI 字段相应隐藏（**不在本规格范围内**，需新 spec） |
| R-4 | 同一 profile 被多窗口共用时开关行为依赖 Chrome 的并入语义 | 明确"不跟踪进程 + 状态栏提示"（R12 / §15.2 第 3 条） | 用户关闭该站点窗口后重开 |
| R-5 | profile 可能 GB 级 | README 说明 C 盘占用；删除/移动超时放宽到 300s；`.trash` 清理不阻塞界面 | 用户手工删除 `%APPDATA%\obox\extensions\webapp_chenzhi\data\chrome\<名>`（README 给出路径） |

### 19.2 实现层风险（本阶段新增）

| 编号 | 风险 | 触发条件 | 处置 | 残余风险 |
|---|---|---|---|---|
| **R-W1** | **Chrome 参数被迫忽略（真机已核实，探针阶段一）** | 同一 `--user-data-dir` 已有实例在跑时，第二个进程 **1s 内 exit 0** 并把请求转交既有实例：`--app=<url>` 会被转发并**新开一个窗口**，但该窗口**沿用首个实例**的 `--window-size` / `--window-position` / `--lang`（实测新值**全被忽略**，`navigator.language` 仍是首个实例的） | 已按"不跟踪进程 + 提示用户先关闭窗口"处理（R-4）。**验收 A8/A10 必须"先关闭该站点窗口"再验**，否则会误判为 bug | 无法程序化检测"参数是否真的生效"（不跟踪进程、不读 Chrome 状态）。**这也是"每条目独立 `--user-data-dir`"是设计必然性的原因**：只有独立 profile 才让本扩展的参数在首个进程上生效（见 §12.1 末尾与 §14.6） |
| **R-W2** | profile 迁移失败（占用/权限/磁盘满） | 改名时目录被占用、或目标卷只读 | `moveProfile` 失败 → **不落库**（§14.2 第 5 步）；文案给出原因 | 若 `rename` 成功但 `db.update` 失败，靠 `.pending-move.json` 对账修复（§14.2 两阶段 intent）；两者都失败时需人工按 README 的路径说明处理 |
| **R-W3** | 半删目录 | `fs.rm(recursive)` 因只读文件/占用中途失败 | 先原子 `rename` 到 `.trash/`（毫秒级、同卷）→ 再删库行 → 再删 `.trash`；`.trash` 删除失败只记 warning，激活期重试 | `.trash` 可能长期占空间（README 说明手工清理路径） |
| **R-W4** | 扩展 id 与数据目录名依赖 `author` | 若 `author` 写成中文/大写/特殊字符，`deriveDirName` 会清洗（`src/main/oixCore.ts:57-59`）→ 数据目录名与文档示例不符 | 规格固定 `author: "chenzhi"`；README 里所有路径示例一律用 `webapp_chenzhi`，并附一句"实际目录名 = `<name>_<清洗后 author>`" | 用户自行改 `author` 后路径变化（文档已解释） |
| **R-W5** | **目录名与库名漂移** | 用户手工改了 `chrome/<名>` 目录名，或从别处拷了 profile 进来 | `list` 时 `profileInfo.exists === false` → 卡片上给"数据目录缺失，下次打开会新建"的提示（**不自动改名**，避免猜错） | 改名后名字与库不符，登录态"看起来丢了"（README 说明手工操作的风险） |
| **R-W6** | `.pending-move.json` 的"两者都在"状态 | 崩溃恰好发生在 `fs.rename` 之后、删 `pending-move.json` 之前，且用户又手工建了同名目录 | 报错并**不自动处理**；README 给出"人工确认哪个目录是新的"的步骤 | 需要人工介入 |
| **R-W7** | `reg.exe` 不可用 / 被策略禁用 | 注册表探测失败 | 前 3 处路径探测已能覆盖绝大多数安装；注册表失败只记 stderr 日志、不致命 | 自定义安装位置的 Chrome 可能探测不到 → 报 `[chrome-not-found]` 并列出查找路径（用户可据此判断） |
| **R-W8** | 界面与扩展的校验口径漂移 | 两处各写一份校验规则 | `test/fields.test.js` 断言"同一条目两边错误键集合完全一致"（§18.1） | 文案措辞仍可能不同 → 门禁比对**错误键**而非文案；文案以 `lib/webapp.mjs` 为唯一来源并在界面复用 |
| **R-W9** | 唯一索引与中文名 | `COLLATE NOCASE` 对非 ASCII 是字节比较 | 中文名的"唯一性"由应用层 trim + 完全匹配判定 | 全角/半角的视觉相似名（`Ｎ` vs `N`）不算重复（可接受） |
| **R-W10** | `--app` 对非 http/https 无效 | 用户填了别的协议 | §12.4 在保存时硬拒；助手侧 `args[0]` 再校验一次 | 无 |
| **R-W11（D-2 的已接受覆盖缺口）** | **"Chrome 未安装（`[chrome-not-found]`）"与"4 顺位探测顺序"两条分支没有自动化回归保护** | 任何改动 `helper.cjs` 探测逻辑的提交 | D-2 = C：**不做**测试专用注入（`chromeProbePaths` / `skipRegistry` / 环境变量一律不加），改为 §18.3.1 的**手工可逆真机步骤**（屏蔽第 1 顺位验"顺位回退"、再屏蔽第 4 顺位验"未安装"，末尾强制还原校验 5 条）+ 证据落 `docs/evidence/chrome-probe-manual.txt`；每次发版前重跑 | **这是用户显式接受的风险**：探测逻辑若被改错，只有真机手工验收能发现（CI 不会红）。缓解：① 探测顺序写在 `helper.cjs` 的一处常量数组里并由 `probe.chromeCandidates` 回显，改动必须是"改常量"这种可见变更；② 该数组有单测断言**长度恰为 4 且顺序固定**（§18.2 首行），因此"顺序被打乱"仍能被自动化发现——只有"某一处命中/全不命中"需要手工验 |
| **R-W12（R16 的升级路径风险）** | **开发者把构建产物同步到安装目录时误删 `data/`** | 用了 `robocopy /MIR`、整目录 `Copy-Item -Recurse`，或把本地 `data/` 一起拷过去 | README 的开发者小节给出**只覆盖分发文件**的命令（显式文件清单），并列出两个**禁止**的反面示例（§14.4 g-2）；验收 A22 核对同步后 `data/**` 未被改动 | 纪律靠文档与验收，**无程序化拦截**（扩展无权监控自己的安装目录）。缓解：同步命令写死在 README 里可直接复制 |
| **R-W13（R16 的第二重风险）** | 覆盖安装的"搬回 `data/`"发生在**删备份之前**，但该步骤失败时**只记日志、不阻断安装**（`src/main/oixCore.ts:322-334`） | 跨卷/权限异常导致 `fs.rename(backup/data, target/data)` 失败 | 无法在扩展侧修复（属宿主行为，命中技能 M7 → 需新增/改宿主 API，**本规格范围外**）。缓解：README 明确"升级前先按备份命令备份一次"（升级与卸载共用同一条备份命令）；验收 A14 每次发版前执行，能在自家环境暴露问题 | 极端情况下"升级成功但数据没搬回"→ 条目与 profile 都像是丢了；此时可用升级前的备份恢复。**该残余风险无法由本扩展消除** |
| **R-W14（D-3 的枚举僵化风险）** | 语言/缩放改为固定枚举后，用户需要清单外的值（例如 `zh-Hans`、`0.9`）时无路可走 | 用户反馈 | **P6** 已把语言清单登记为"待用户微调"；缩放清单的值域与步进与 R11 原文完全一致（0.5–4、步进 0.25），未收紧语义 | 清单外的语言标签（如 `zh-Hans`、`pt-PT`）无法通过界面输入；F12 也不做自定义输入（那会退回"手输 + 正则"，与本决策相悖）。新增语言需改清单 → 属新需求 |
| **R-W15（R17 的核心风险）** | **体积节流挡不住"非缓存数据"的增长** | 站点把大量数据写进 IndexedDB / Local Storage / Service Worker 缓存 / 下载目录 | 这是**已确认的技术边界**（用户接受方案 1）：Chrome 没有目录配额参数，NTFS 配额不采用；本扩展只能"预检 + 拦截 + 只清缓存"。拦截发生时界面必须显示**可清理缓存体积**，让用户看清"清了也不够"的现实 | 用户可能反复看到拦截却清不出空间（缓存已很小而 IndexedDB 很大）→ 此时唯一出路是删除条目（连带数据）或换站点用法。**必须在 README 写清该局限**，界面在"清理后仍超限"时也要如实说明"剩余占用主要不是缓存" |
| **R-W16（R17）** | 体积扫描在机械盘 / 冷缓存上很慢（GB 级、数万文件） | 首次「打开」或点「查看体积」 | TTL 60s 缓存 + 只在预检与显式查询时扫描 + **绝不常驻轮询**（§14.6）；`profileSize` 超时给到 120s | 首次扫描仍可能让用户等十几秒（界面需给"正在统计大小…"的即时反馈）；扫描本身是 IO 密集，可能与 Chrome 抢盘 |
| **R-W17（R17）** | **清理缓存与 Chrome 正在写缓存竞争** | 该站点窗口正开着时清理 | 白名单逐目录删除；失败目录进 `skipped[]` 并如实提示"请先关闭该站点的窗口"（**不杀进程、不重试、不静默**） | 可能出现"清了一半"的中间状态（部分缓存目录已删、部分被跳过）。这不影响数据正确性（缓存可重建），但界面必须如实报告，不能让用户以为清干净了 |
| **R-W18（R17）** | 上限设得比当前占用低（例如把 2 GB 改成 512 MB 而站点已用 1.5 GB） | 用户改设置 | 设置页文案与拦截模态框都说明"超限只是打开前拦截，不删除任何数据"；不自动清理（§6 非目标 13） | 用户每次打开都被拦一次（除非点"仍然打开"）；这是**设计意图**（让占用可见），但需在设置项 `description` 里写明 |
| **R-W19（R17）** | `SettingField` 无 `min`/`max`，宿主 number 输入不设约束 | 若有人把上限从 `select` 改回 `number` | 本规格**强制用 `select`**，并在 §10.4 记录该已核实缺口；`test/manifest-settings.test.js` 断言两项都是 `select` 且 `options` 完整 | 可选的档位是固定的（`0/512/1024/2048/4096/8192` MB）——需要 3 GB 这类档位时只能加进清单（类似 P6 的微调路径） |

### 19.3 回退计划

1. **功能级回退**：删除条目 = 删数据。没有单个开关能"撤销删除"。
2. **版本级回退（R16 保证）**：`.oix` 覆盖安装会把旧 `data/` 搬回新目录（`src/main/oixCore.ts:320-336`），因此**升降级安装都不会丢条目与 profile**；旧版本不认识的新列会被 `normalizeWebapp` 丢弃（未知键不落库），最坏是"新加的字段值丢失"，不会破坏旧字段。
   - **R16 的语义边界（必须与卸载区分）**：**升级 = 保留**（`data/chrome/**` 与登录态原样留下）；**卸载 = 永久删除**（见第 3 条）。
   - `install(ctx)` 在覆盖安装时会重跑，因此它**不得触碰 profile 目录**（§14.4 g-1）；`scripts/pack.mjs` 必须继续排除 `data/`（§20.1）。
3. **完全回退（卸载）= 永久删除**：卸载扩展会删除 `<userData>/extensions/webapp_chenzhi/`（含条目与**所有** profile，见 §14.4 / D-1）。README 必须给出**卸载前备份**的命令（与 §14.4(c) 同一份）：
   ```powershell
   $src = "$env:APPDATA\obox\extensions\webapp_chenzhi\data"
   $dst = "$env:USERPROFILE\obox-webapp-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
   New-Item -ItemType Directory -Path $dst -Force | Out-Null
   Copy-Item -Recurse -Force "$src" $dst
   Test-Path "$dst\data\webapp.db"; Test-Path "$dst\data\chrome"
   ```
4. **不可回退项**：已删除的 profile 内的登录态/历史（无备份即永久丢失）。**注意**：升级不属此类——升级会保留；只有"删除条目"与"卸载扩展"才是不可回退操作。

## 20. 打包与发布

### 20.1 `scripts/pack.mjs`（照搬 `rdp`，逐条对齐）

**白名单 `INCLUDE`**：

```js
const INCLUDE = ['manifest.json', 'index.js', 'helper.cjs', 'lib', 'ui', 'icon.svg', 'icon.png', 'LICENSE']
```

**排除目录 `EXCLUDE_DIRS = new Set(['data', 'out', 'node_modules', '.git', 'src'])`** —— 逐条理由（照搬 `extensions/rdp/scripts/pack.mjs:43-46` 的注释）：

| 排除项 | 理由 | 证据 |
|---|---|---|
| `data/` | 扩展**运行时数据目录**（`api.sqlite` / `api.fs` / `chrome/**` 的落点），**宿主覆盖安装/升级时靠它保留条目与浏览器数据**，因此绝不能进包；包里含它会被安装器**直接拒绝**（错误码 `forbidden-entry`，拒绝文案原文即"升级时由宿主保留"） | `src/main/oixCore.ts:32-35`（`EXT_DATA_DIR = 'data'`）、`:168-176`（拒绝逻辑与文案）、`:320-336`（升级时把 `backup/data` 搬回） |
| `out/` | 构建产物（`.oix` 本身） | — |
| `node_modules/` | 运行期零依赖；宿主不受理依赖目录 | `guides-user.md:10` |
| `.git/` | 版本库元数据 | — |
| `src/` | 界面**源码**，产物已进 `ui/` | `vite.config.mjs` 的 `outDir: ./ui` |

**必须存在的分发文件 `REQUIRED = ['manifest.json', 'index.js', 'helper.cjs']`**；缺任一 → 直接抛错。

**硬闸门（照搬并强化）**：

1. 收集完成后逐条检查：任何条目的首段落在 `EXCLUDE_DIRS` 里 → 抛「拒绝打包：条目 X 落在排除目录 Y/ 下」（`pack.mjs:75-81`）
2. 若 `ui/index.html` 缺失 → 打 warning（不阻断，便于后端单独验证）（`pack.mjs:83-88`）
3. **回读自检（R16 硬闸门，必须有测试钉住）**：产物尾部 EOCD 存在、条目数一致、**任何条目不得等于 `data` 或以 `data/` 开头**（`pack.mjs:201-209`）
4. **新增自检（webapp 特有）**：产物必须含 `lib/chromeArgs.mjs`、`lib/nameSanitize.mjs`、`lib/webapp.mjs`（`index.js` 静态 import 它们，缺了入口直接加载失败——`rdp` 的 `README.md:180` 记录过"设计稿漏了 `lib/`"这个坑）
5. **`data/` 排除的测试钉法（R16 要求 3）**，三层都要有：
   - **`pack.mjs` 自身自检**：打包结束后遍历 `entryNames`，若出现 `data` 或 `data/…` → 抛错（照搬 `rdp` 的 `pack.mjs:205-209`）
   - **`test/pack.test.js`（新增）**：先造一个假的 `data/chrome/x/Keep` 文件与 `data/webapp.db`，再跑 `node scripts/pack.mjs`，然后**解开产物 zip 的中央目录**断言：不存在任何 `data` 前缀条目、且 `manifest.json` 是第一个条目；跑完清理假文件
   - **CI/验收的口头判据**：`tar -tf out/webapp-1.0.0.oix | Select-String '^data/'` 必须**无输出**（写进 §23 的 AC4）
   - **理由（为什么必须钉住）**：一旦 `data/` 进了包，安装器会以 `forbidden-entry` **拒绝整个包**（用户装不上），而且即便宿主放宽也会用陈旧数据覆盖用户数据；这条闸门是"升级保留 profile"不被破坏的**唯一防线**

**zip 实现**：零依赖手写 **stored**（不压缩）zip；文件名 UTF-8 标志位 bit 11 置位（中文路径安全）；`manifest.json` 排在第一个条目（`pack.mjs:94-199`）

### 20.2 产物命名与命令

```
npm run release   # = npm test && npm run build && npm run pack
→ out/webapp-1.0.0.oix     ← 命名规则：<manifest.name>-<manifest.version>.oix（pack.mjs:196）
```

`package.json` 的 scripts 照搬 `extensions/rdp/package.json:9-15`：`dev` / `build` / `test` / `pack` / `release`。

### 20.3 发布流程（与 `rdp` 的实际做法一致）

**已核实的 `rdp` 实际做法**（`extensions/rdp/.git` 是独立仓库）：

```
remote  origin = https://github.com/obox-org/rdp.git
tags    v1.0.0
log     181387d feat: RDP 远程桌面扩展 1.0.0 首个开源版本   （单条 commit，工作区干净）
.gitignore 忽略 node_modules/ out/ ui/ data/ *.log .DS_Store
```

**webapp 照此执行**（步骤 1–3 在 `extensions/webapp/` 内，步骤 4–6 是发布）：

1. 在 `extensions/webapp/` 初始化独立仓库：`git init` → `git add` 白名单文件（**不含** `node_modules/`、`out/`、`ui/`、`data/`）→ commit 信息格式 `feat: webapp 网页应用扩展 1.0.0 首个开源版本`
2. `.gitignore` 内容照搬 `extensions/rdp/.gitignore`（`node_modules/`、`out/`、`ui/`、`data/`、`*.log`、`.DS_Store`）
3. 首次提交前跑齐门禁：`npm test`（`node --test` 全绿）+ `npm run build`（产出 `ui/`）+ `npm run pack`（产出 `out/webapp-1.0.0.oix`）+ `node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json`（0 error）
4. 在 GitHub 建仓库 `obox-org/webapp`（public，不初始化 README/LICENSE——本地已有），`git remote add origin https://github.com/obox-org/webapp.git`，`git push -u origin master`（沿用 rdp 的主分支名 `master`；若组织默认要求 `main` 则按实际默认分支推）
5. 打 tag 并推：`git tag v1.0.0` → `git push origin v1.0.0`
6. 建 Release：`tag = v1.0.0`、标题 `v1.0.0`、正文按 **§20.4 的模板**（含 R16 的"升级保留 vs 卸载永久删除"对比段与备份命令），**上传附件 `webapp-1.0.0.oix`**（阶段 1 Q10 的交付形态）

> **注意（与 obox 仓库提交约定的关系）**：`extensions/` 被 obox 仓库根 `.gitignore` 的 `/extensions/` 忽略，且 `rdp`/`todo`/`obox-updater` 都是独立仓库 → webapp 的实现与发布**完全不进 obox 仓库**，不触发 obox 的 PR/CI 流程。仓库内的流程产物（`.spec-workflow/**`）按阶段 1 的 Git 入口决定留作未跟踪文件。
>
> **关于 Release 附件**：本规格不规定用 `gh` CLI 还是 GitHub API（`.gitoken` 在 obox 仓库根，`AGENTS.md` 记录了 API 打 PR 的做法）。实现阶段按"能查到的最新可用做法"选择，并在 `docs/spec` 里记录实际用的命令。**本条为未核实项**（obox 仓库内没有 rdp 发 Release 的脚本或记录）。

### 20.4 Release 正文模板（R16 + D-1 的硬要求，不得省略第 2 段）

```markdown
## 安装
1. obox → 扩展管理器 → 「安装扩展」→ 选 `webapp-1.0.0.oix`
2. 或把 `webapp-1.0.0.oix` 直接拖进扩展管理器视图

## 本次提供
- 把内部站点登记成条目，点「打开」以 Chrome 应用模式（`--app`）打开独立窗口（无地址栏）
- 每条目独占浏览器数据目录（profile），站点之间登录态互不干扰
- 可按条目关闭证书校验（默认开启；列表上有「TLS 已降级」标记）
- 白名单窗口开关：尺寸 / 位置 / 最大化 / 界面语言（下拉）/ 缩放（下拉）/ 禁用 GPU

## ⚠️ 数据与风险（务必阅读）
- **升级/覆盖安装：浏览器数据保留。** 条目、`chrome/**` profile 与其中的登录态原样留下。
  （宿主把扩展运行时数据目录固定为 `data/`，覆盖安装时在删除备份前把它搬回新目录。）
- **卸载扩展：永久删除。** 所有站点的浏览器数据（登录状态、Cookie、缓存）与条目列表一起消失，**不可恢复**。
- **卸载前请先备份**（可复制）：
  ```powershell
  $src = "$env:APPDATA\obox\extensions\webapp_chenzhi\data"
  $dst = "$env:USERPROFILE\obox-webapp-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  Copy-Item -Recurse -Force "$src" $dst
  Test-Path "$dst\data\webapp.db"; Test-Path "$dst\data\chrome"
  ```
- 勾选「忽略证书问题」会关闭该站点的证书校验（TLS 降级），同网段攻击者可能读取或改写流量；
  `--unsafely-treat-insecure-origin-as-secure` 只把该 origin 当作安全上下文，**并不修复证书、也不能单独过掉证书错误**
  （真机实测：只给该参数时自签站点仍是"[隐私设置错误]"错误页；过证书错误靠的是 `--ignore-certificate-errors`）。
- 每个站点的 profile 位于 `%APPDATA%\obox\extensions\webapp_chenzhi\data\chrome\<名称>`，
  体积可能达到 GB 级（占用系统盘空间）。
```

## 21. 决策记录（D-1 – D-5 已全部关闭）

> **状态：全部关闭（2026-10-12，用户逐条确认）。已关闭的选项与理由保留在下方各节，供审视与追溯；实现以各节顶部的「已关闭 = X」结论为准。**
>
> 新增待微调项：**P6（语言下拉清单）**——见 §15.2.1，**不阻塞实现**。

| 编号 | 问题 | 结论 | 落地位置 |
|---|---|---|---|
| D-1 | 卸载扩展时 `chrome/` 下的所有 profile 怎么处理？ | **A：接受现状 + 文档醒目声明**（卸载 = 永久删除；README/Release 醒目声明 + 卸载前备份命令；`uninstall(ctx)` 禁止搬运 profile） | §1 暂停条件、§7 故事 22/22b/22c、§13.4、§14.4(a)–(f)、§19.3、§20.4、§23 |
| D-2 | `probe` 是否保留测试专用注入入口？ | **C：不做测试专用注入**（删掉 `chromeProbePaths`/`skipRegistry`/环境变量；改为 §18.3.1 手工可逆真机步骤；覆盖缺口登记为 R-W11） | §11.2（`probe` 入参）、§18.1、§18.2、§18.3 A13/A13b、§18.3.1、§18.4、§19.2 R-W11 |
| D-3 | webapp 是否有下拉字段？ | **B + C：`scaleFactor` 与 `lang` 都改为下拉**（R11 措辞修订；R14「下拉说明写在选项内」正式生效；语言清单登记为 P6） | §12.1 ⑨⑩、§12.3、§13.2、§15.1、§15.2 / §15.2.1 / §15.2.2、§18.1、§19.2 R-W14、§23 |
| D-4 | Goal Mode（本规格版本专用） | **enabled for this spec only；auto-commit 关闭**（提交与 PR 仍须在会话中显式执行并留证据） | §1 |
| **D-5（本次新增，已关闭）** | 如何限制单个 profile 目录大小、别把磁盘撑爆？ | **方案 1 = 目录级节流，且上限由用户在设置里定义**：全局设置项（默认 2 GB，可关）+ `--disk-cache-size=512MB`（缓存上限，与目录上限是两回事）+ 「打开」前预检拦截 + 「清理缓存（保留登录态）」/「仍然打开」+ 全局一键清理 + 按需显示体积。**不做** Chrome 目录配额（无此参数）、**不采用** NTFS 目录配额（需管理员、按卷生效）、**不做**自动清理 | §5.2 目标 7、§6 非目标 2/3/12/13、§10.2/§10.4、§11.1/§11.2、§12.1 ⑥、§14.1、§14.5、§14.6、§15.2 第 5–7 条、§17、§18、§19.2 R-W15–R-W19、§21.7、§22 I14–I18、§23 AC25–AC28、§24 票 11 |

### 21.1 D-1 的完整选项与理由（已关闭 = A）

**已核实的技术事实（这改变了阶段 1 P2 的前提）**：

- 卸载钩子 `uninstall(ctx)` 在删除扩展目录**之前**执行，但随后宿主执行 `fs.rm(<userData>/extensions/webapp_chenzhi/, { recursive: true, force: true })`（`src/main/capabilities.ts:96-101`、`:118`）→ **整个扩展目录连 `data/chrome/**` 一起删**
- 钩子超时 **10s**（`src/main/hookBridge.ts:16`），而 profile 可能 GB 级（R-5）→ 钩子里搬不动
- 钩子跑在渲染进程，扩展没有 `node:fs`；`api.fs` 只能操作 data 目录内且**没有 rename**（`src/api/types.ts:325-341`）

**结论：阶段 1 的 P2 初拟"不删、只保留数据"在当前宿主架构下不可实现。**

| 选项 | 做法 | 代价 |
|---|---|---|
| **A ✅ 已采纳：接受现状 + 文档显著声明** | 卸载 = 连所有站点浏览器数据一起永久消失。README 与 Release 说明用醒目段落写明，并给出"卸载前备份"的 PowerShell 命令（§14.4(c)、§19.3 第 3 条、§20.4） | 用户误卸载即永久丢数据；只有文档与"删除条目"时的二次确认作为防线 |
| B 卸载前把 `chrome/**` 复制到扩展目录之外（如 `%APPDATA%\obox\webapp-backup\`） | 在 `uninstall` 钩子里用**助手**做异步搬运（钩子只负责"踢一脚"，不等待完成） | 10s 钩子预算 + 助手可能已被通道关闭 → **大概率搬不完**；GB 级拷贝会让卸载卡死；失败后仍会全删 → 给出"以为备份了其实没"的错觉，比 A 更危险 |
| C 把 profile 根搬出扩展目录（如 `%APPDATA%\obox-webapp\chrome\`，由条目字段或全局设置指定） | profile 与扩展生命周期解耦，卸载不删数据 | **改变数据落位 → 与阶段 1 R4（`<扩展 data 目录>/chrome/<name>`）冲突**，需要新需求；且 `api.fs` 沙箱只允许 data 目录，必须由助手做全部 profile 读写 |
| D 在扩展内提供"清理全部浏览器数据"按钮，并在界面上反复提示卸载会删除 | 用户可主动清空；卸载后果不变 | 多一个功能（超出阶段 1 范围，属"多一个也算越界"）；仍不能阻止误卸载 |

**采纳 A 的理由**：它是唯一**不撒谎**的方案——B 会给出虚假的备份保证，C 要改已确认的需求 R4，D 越界。A 的代价（误卸载丢数据）用"删除条目时有不可恢复的二次确认" + README/Release 显著声明 + 可复制的备份命令来控制。

### 21.2 D-2 的完整选项与理由（已关闭 = C）

| 选项 | 做法 | 代价 |
|---|---|---|
| A 保留 `probe` 的测试注入入参（`chromeProbePaths` / `skipRegistry`），注明"仅测试用" | 集成测能覆盖探测顺序与 `[chrome-not-found]` | 生产代码多一个无业务意义的入参；虽不突破参数白名单，但属于"为测试开的门" |
| B 改用 `PATH` / 环境变量注入 | 无生产代码口子 | Windows 上路径探测是**绝对路径**，`PATH` 注入无效 |
| **C ✅ 已采纳：不做测试专用注入，两条分支改为手工可逆真机验收** | 生产代码最干净（`probe` 入参零语义） | 该分支**没有自动化覆盖**——已作为**用户显式接受的风险**登记为 **R-W11**；手工步骤见 §18.3.1（屏蔽第 1 顺位验顺位回退、再屏蔽第 4 顺位验未安装，末尾强制还原校验 5 条） |
| D 做成正式功能（界面上可自定义 Chrome 路径） | — | **与阶段 1 非目标"不做自定义 exe 路径"直接冲突**，出局 |

**采纳 C 的理由**：用户选择"生产代码干净"优先，并接受"这两条分支靠发版前手工验收覆盖"的代价。为降低风险，探测顺序被固化为一处常量数组、并由单测断言其**长度与顺序**（§18.2），使"顺序被打乱"仍可自动发现。

### 21.3 D-3 的完整选项与理由（已关闭 = B + C）

已核实（修订前）：webapp 字段集只有 text / number / check / pair，**没有任何 select 字段**；而 R14 明确要求沿用"下拉取值说明写在选项内"的规范（来源 `rdp` 的 `ConnectionField.vue:141-159`）。

| 选项 | 做法 | 代价 |
|---|---|---|
| A 不加 select 字段，把该规范记为"预留" | 严格不越界 | 该规范在 webapp 里"看不出来"；且用户要求"语言/缩放别让人手输非法值"的诉求落不了地 |
| **B ✅ 已采纳：「缩放比例」改为 15 项下拉**（0.5/0.75/…/4） | 落地 R14 的下拉规范；用户不用手输数字、不可能填非法值；值域与步进与 R11 原文**完全等价**（只是枚举化了合法值） | 下拉较长（15 项）；属对已确认字段**形态**的改动（用户已同意）；DB 列类型从 REAL 改为 TEXT（无历史数据，不需迁移） |
| **C ✅ 已采纳：「界面语言」改为枚举下拉**（提议 12 项，P6 待微调） | 落地 R14；杜绝手输非法标签 | 与 R11 原"正则允许任意合法 BCP-47"相比**收紧了取值面**（清单外语言无法选）；缓解：清单登记为 **P6**，用户可随时增删；已登记风险 R-W14 |
| D 给布尔开关做三元下拉（不传/传） | — | 布尔勾选框已能表达"不传"（未勾选即不传），下拉反而更绕 |

**采纳 B + C 的理由**：用户要求"这两个字段改为下拉"，且明确"R11 措辞要相应更新"。B 的语义与 R11 原文等价（不收紧），C 属于收紧但由 P6 保留微调余地——两者都让"非法值"在界面上不可能出现，是净收益。

**随之正式生效的 R14 条款**：因为 webapp 现在**有** select 字段，「下拉取值说明写在选项内」从"预留规范"改为**正式生效**，门禁从"空表跳过"改为对这两个字段的真实断言（§15.2.2 的 6 条 + §18.1 的 `fieldDocs` 用例）。

### 21.4 D-4 的完整选项与理由（已关闭 = enabled, auto-commit 关闭）

见 §1。采纳形态：`Goal mode: enabled for this spec only` + **auto-commit 关闭**（提交与 PR 仍须在会话中显式执行并留证据）+ goal target =「实现本 spec、通过 AC1–AC22、最终审查无 must-fix、Ship Decision: can ship」+ 最大自动修复轮次 `2` + 10 条暂停条件。

理由：D-1/D-2/D-3 已关闭，技能允许启用；但本扩展会执行**不可逆的磁盘删除**（条目与 profile），因此**不授予**自动提交权，把"写进版本库"这个动作留给人可见的显式步骤。

### 21.5 P6 / P7（新登记的待用户微调项，不阻塞实现）

| 编号 | 待微调内容 | 当前采用值 | 影响范围（若用户调整） |
|---|---|---|---|
| **P6** | `lang`（界面语言）下拉的**条目清单** | 12 项：`zh-CN` / `zh-TW` / `en-US` / `en-GB` / `ja-JP` / `ko-KR` / `de-DE` / `fr-FR` / `es-ES` / `ru-RU` / `pt-BR` / `it-IT`（另加"不指定"） | 只改两处：`src/fields.js` 的 `options` 与 `lib/webapp.mjs` 的 `LANG_VALUES`（以及 `test/fields.test.js` / `test/chromeArgs.test.js` 的表驱动数据）。字段形态、参数构造规则、数据模型、验收条目都不受影响 |
| **P7（新登记）** | `webapp.profileLimitMb` 的**档位清单**（当前 `0/512/1024/2048/4096/8192` MB）与 `webapp.diskCacheMb` 的档位（`0/128/512/1024` MB） | 见 §10.4 | 只改 `manifest.json` 的 `contributes.settings.fields[].options` 与 `lib/profileLimit.mjs` 的枚举常量（+ `test/settings.test.js` / `test/manifest-settings.test.js` 的表驱动数据）。**注意**：因宿主 `SettingField` 无 min/max，档位是唯一可调手段（§10.4 已核实缺口） |

> P6/P7 在 Goal Mode 的暂停条件第 1/11 条里已登记：若用户在实现过程中给出新清单/新档位，属于"本 spec 未覆盖的产品决策"，须暂停确认后按上表修改。

### 21.6 D-5 的完整理由（已关闭 = 方案 1，目录级节流）

**已确认的技术边界（决定了这只能是"节流"而非"硬配额"）**：

| 手段 | 可用性 | 结论 |
|---|---|---|
| Chrome 的"整个 profile 目录配额" | **不存在这样的参数** | 无法一次配置就限制目录 |
| NTFS 目录配额（`fsutil quota`） | 需管理员、按**卷**生效、对用户不透明 | **不采用** |
| `--disk-cache-size=<bytes>` | 可用，但**只覆盖 HTTP 缓存** | 采用为"缓存上限"（与目录上限并列写清） |
| helper 递归量目录体积 | 可用 | 采用为预检数据源（带 TTL 缓存） |
| 只清缓存（白名单删目录） | 可用 | 采用为超限后的唯一自动减量动作（保留登录态） |

**采纳理由**：用户明确选择"方案 1 + 上限由用户在设置里定义"。这套组合是**在可用手段内唯一诚实的方案**——它不假装能阻止所有增长（R-W15 已如实登记该局限），但能把"磁盘被悄悄撑爆"变成"打开前明确告诉你占了多少、缓存能省多少，然后由你决定"。三个设计取舍都由此推出：① 上限放**全局设置**而不是每条目（用户原话）；② 用 `select` 而不是 `number`（宿主无 min/max，§10.4）；③ 清理**只**清白名单缓存且返回可审计（删数据必须可见可控）。

### 21.7 已在本规格内裁定的、非用户级的小决策（记录以便审视，不需用户回答）

| # | 决策 | 裁定 | 理由 |
|---|---|---|---|
| S1 | 非法字符的替换字符 | 用 `-`，连续非法字符合并为一个 `-` | 可读性优于 `_`；合并避免 `a\\\\b` 变成一串 `----` |
| S2 | `--label-w` 取值 | 沿用 `144px`（不按 webapp 最长标签收窄） | 视觉一致、留余量、省测量证据链；收窄需补测量 |
| S3 | 窄窗堆叠断点 | `520px`（webapp 自算：144+8+280+32+40+24 = 528 → 取整 520） | 与 `rdp` 的 568 同源算法、参数按 webapp 控件列下限调整 |
| **S4（D-3 后作废）** | ~~`scaleFactor` 的"未设置"表示：DB 存 `0`（REAL）~~ | **改为**：`scaleFactor` 是 **TEXT 枚举**，`''` = 不指定 | 枚举化后不再需要数值哨兵，也不再需要 REAL；避免浮点往返 |
| S5 | `pair` 字段的存储形态 | 字符串 `"W,H"` / `"X,Y"` | 一列存两个数，避免 4 个额外列；解析在纯函数里 |
| S6 | `extraOrigins` 的分隔符 | 换行（界面 textarea），拼参数时转英文逗号 | 用户书写友好 + Chrome 要求逗号 |
| S7 | 名称唯一性 | 应用层 trim + 大小写不敏感查重 **+** 库层 `COLLATE NOCASE` 唯一索引 | 双层：文案可控 + 结构兜底 |
| S8 | 删除的中转区 | `chrome/.trash/<ts>-<name>` | 让"半删"限制在非条目目录内 |
| S9 | 改名的两阶段 intent | `chrome/.pending-move.json` | 无事务可用时的对账手段 |
| S10 | helper 的 profile 路径形态 | 扩展侧只生成相对 `chrome/<名>`；助手解析为绝对路径 | 保持 `buildChromeArgs` 纯函数 |
| S11 | 是否用 `api.fs` | **不用**（profile 是二进制大目录，`api.fs` 只有文本读写与递归删除、且无 rename） | 全部目录操作放助手 |
| S12 | 界面语言 | 只中文 | 与 `rdp` 一致；用户扩展 `titleKey` 无效 |
| S13 | 是否提供"默认浏览器打开" | 不提供 | P3 初拟不做，本规格按不做写 |
| **S14（R16 新增）** | `install(ctx)` 的允许动作边界 | 只允许幂等动作（日志 / 建表建索引 / `mkdir -p chrome/` / 清理自己的临时文件）；**禁止**任何触碰 profile 的删除、移动、重建 | 覆盖安装会重跑 `install`，而 profile 承载用户登录态；规格 §14.4 g-1 列了允许/禁止对照表与源码门禁 |
| **S15（R17 新增）** | 体积上限的存储位置 | **全局设置**（`api.settings`，键 `webapp.profileLimitMb`），**不入库、不做每条目列** | 用户明确"上限由用户在设置里定义"；入每条目列会让"改上限"变成改 N 条记录 |
| **S16（R17 新增）** | 体积缓存的存放位置 | **助手进程内存**（`Map`），TTL 60s | 体积数据的产生方是助手；放渲染进程会在子窗口重载时丢缓存（§14.6） |
| **S17（R17 新增）** | 超限时"需要用户选择"的信封 | `open` 返回 `{ ok: false, error: '[profile-over-limit] …', data: { overLimit: true, … } }` | 与既有"错误 = ok:false"一致；界面用 `data.overLimit === true` 区分"要用户选"与"真错误"，避免新增一种信封形态 |
| **S18（R17 新增）** | 缓存白名单的匹配方式 | 目录名**大小写不敏感**精确匹配 8 个固定名 + **深度限制 2** | 白名单（不是"名字含 cache"）；深度 2 覆盖 `chrome/<名>/<cacheDir>` 与 `chrome/<名>/<profile>/<cacheDir>`，不误删站点自建的更深同名目录 |

## 22. 实施决策汇总（供 `spec-do` 直接执行）

| # | 决策 | 落点 |
|---|---|---|
| I1 | 形态：**用户扩展**（独立仓库 + `.oix`），不是内置扩展 | §9、§20.3 |
| I2 | 执行外部进程：`api.ipc` stdio + `helper.cjs`（宿主无"带参启动进程"API） | §11.2 |
| I3 | 参数构造放在**扩展侧的纯函数**里；助手只做"探测 exe + 校验白名单 + spawn + profile 目录操作" | §11.2、§12 |
| I4 | 通道：单条 `webapp.helper`，`stdio` + `ndjson`，显式声明 | §10.2 |
| I5 | 消息：`api.app.onMessage`，方法 `list/save/remove/open/probe/profileInfo`，一律返回 `{ok,data|error}` 不抛错 | §11.1 |
| I6 | 存储：`api.sqlite` 的 `webapp.db` + 默认表 `webapp`；`COLLATE NOCASE` 唯一索引 | §13 |
| I7 | 不用 `api.secrets` / 不用 `api.fs` / 不用 `api.python` / 不用 `api.net` | §6、§16、S11 |
| I8 | 目录操作全部在助手里（`fs.rename` / `fs.rm`），配合 `.trash` 与 `.pending-move.json` | §14 |
| I9 | 界面 = Vue 3 + Vite 子应用，产物落 `ui/`，只消费宿主 token | §15 |
| I10 | 测试 = `node --test`，纯逻辑单测为主 + helper 真子进程集成测 + 源码门禁 + 真机验收清单 | §18 |
| I11 | 打包 = 零依赖手写 stored zip + 白名单 + `data/` 硬闸门 | §20.1 |
| I12 | 发布 = 独立仓库 `obox-org/webapp` + tag `v1.0.0` + Release 附 `webapp-1.0.0.oix` | §20.3 |
| **I13（R16）** | 升级保留 / 卸载删除：`data/` 由宿主在覆盖安装时搬回（保留），卸载整目录删除（永久）；`install(ctx)` 不得触碰 profile、`uninstall(ctx)` 不得搬运 profile | §13.4、§14.4 |
| **I14（R17）** | 体积上限 = **全局设置**（`contributes.settings` 两个 `select`，默认 2 GB / 512 MB），**不做每连接覆盖**；因 `SettingField` 无 min/max，一律用 `select` 表达取值约束 | §10.2、§10.4、§6 非目标 12 |
| **I15（R17）** | `--disk-cache-size` 只作"缓存上限"（Chrome 执行，只覆盖 HTTP 缓存），**不等于**目录上限；参数按设置产出，`0` 时不传 | §12.1 ⑥、§11.2 校验第 5 条 |
| **I16（R17）** | 「打开」前预检：助手量体积（TTL 60s 内存缓存 + 6 条失效条件），超限**拦截**并给「清理缓存并打开」/「仍然打开」；量体积失败**降级放行** | §14.6、§11.1 `profileSize`、§15.2 第 6 条 |
| **I17（R17）** | 只清缓存 = 白名单目录删除（8 个目录名，深度 2），Cookie/IndexedDB/Local Storage/Service Worker/History 一律不动；返回 `removedDirs` 可审计；单目录失败进 `skipped[]` 不抛错 | §14.5、§11.1 `cleanCaches`、§18.2 `helperCache.test.js` |
| **I18（R17）** | 体积展示**按需**（不常驻轮询、不在 `list` 时扫盘）；清理必须是用户点出来的动作（**不做自动清理**） | §14.6 末尾、§15.2 第 5/7 条、§6 非目标 13 |

## 23. 验收标准

**可执行 + 期望结果**（命令均在 `extensions/webapp/` 内或按标注路径执行）：

| # | 命令 / 操作 | 期望 |
|---|---|---|
| AC1 | `npm test`（即 `node --test`） | 全部通过，0 fail；退出码 0 |
| AC2 | `npm run build` | 退出码 0；产出 `ui/index.html` + `ui/assets/*` |
| AC3 | `npm run pack` | 退出码 0；产出 `out/webapp-1.0.0.oix`；控制台打印条目清单 |
| AC4 | `tar -tf out/webapp-1.0.0.oix` | 含 `manifest.json`（第一项）、`index.js`、`helper.cjs`、`lib/*.mjs`、`ui/index.html`、`ui/assets/*`；**不含**任何 `data/`、`src/`、`node_modules/`、`out/` 条目（R16 硬闸门：`tar -tf … \| Select-String '^data/'` 必须**无输出**） |
| AC5 | `node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json`（在 obox 仓库根） | 退出码 0；0 error |
| AC6 | 安装 `out/webapp-1.0.0.oix` | App 里出现「网页应用」卡片；点开显示空态或既有条目 |
| AC7 | 新建条目并「打开」 | 出现 Chrome 应用窗口（无地址栏）；`%APPDATA%\obox\extensions\webapp_chenzhi\data\chrome\<名>\` 存在 |
| AC8 | `ignoreCert=true` 打开自签站点 | 无证书警告 |
| AC9 | `ignoreCert=false` 打开同一自签站点 | 出现证书警告/拦截 |
| AC10 | 关闭该站点窗口后带 `windowSize=900,600` 打开 | 窗口为 900×600 |
| AC11 | 改名保存 | `chrome/` 下目录被改名且内容完整；再次打开仍是同一登录态 |
| AC12 | 窗口开着时删除 | 报「请先关闭该站点的浏览器窗口后重试」；条目与目录都还在 |
| AC13 | 关闭窗口后删除 | 确认框含"不可恢复"与"浏览器数据"字样；确认后条目消失、目录消失 |
| AC14 | **Chrome 未安装（按 §18.3.1 手工步骤）** | 报 `[chrome-not-found]`，文案按 4 顺位列出查找过的路径；**不回退 Edge**；**验完必须执行还原校验 5 条并全部通过** |
| AC15 | **探测顺位回退（按 §18.3.1 步骤 1）** | 只屏蔽第 1 顺位时打开应成功，`probe.chrome.source === 'registry'`；还原后回到 `programfiles` |
| AC16 | **升级保留（R16 主验收）** | 装 v1.0.0 → 新建条目并在该站点**登录** → 用新版本 `.oix` 覆盖安装 → 条目仍在、`data/chrome/<名>` 仍在、**再次打开仍是已登录状态** |
| AC17 | 升级保留（库层，R16 补充） | 安装态下 `data/webapp.db`、`.obox-meta-webapp.json`、`data/chrome/**` 在覆盖安装后仍存在 |
| AC18 | **升级 vs 卸载 对比（R16 + D-1）** | 同一条目：覆盖安装后 profile 与登录态**在**；卸载后扩展目录与 `chrome/**` **永久消失**；重新安装后条目与 profile 都不存在；README/Release 已写明对比结论与备份命令 |
| AC19 | 深浅主题切换 + 窗口拉到 500px | 配色跟随主题；字段上下堆叠、无横向滚动条 |
| AC20 | 点遮罩 / 按 Esc | 模态框不关闭 |
| AC21 | `ignoreCert=true` 的卡片 | 有「TLS 已降级」标记；关掉后消失 |
| AC22 | 尝试名称 `CON`、`a<b`、`名.`、超长名 | 均给字段级文案 + 建议名，不落库 |
| AC23 | **下拉字段（D-3）** | 「界面语言」「缩放比例」都是下拉；每项显示 `<值> — <说明>`、悬浮有 `title`、第一项为「不指定（用 Chrome 默认）」；选「不指定」时不产出对应参数，选 `zh-CN` + `1.5` 时产出 `--lang=zh-CN --force-device-scale-factor=1.5` |
| AC24 | **开发者同步纪律（R16）** | 按 README 命令只覆盖分发文件后，`data/webapp.db`、`data/chrome/**` **未被改动**；README 含"禁止 `robocopy /MIR` / 整目录 `Copy-Item -Recurse`"的反面示例 |
| **AC25** | **设置页存在且持久化（R17）** | 设置 → 扩展 → 「网页应用」有两项（`单站点数据上限` 默认 2 GB、`HTTP 缓存上限` 默认 512 MB）；改动后重启仍生效；`0` 分别表示"不限制"与"用 Chrome 默认" |
| **AC26** | **超限拦截与该模态框的三条关闭路径（R17）** | 上限 512 MB + 已超限站点 → 「打开」被拦截；模态框显示当前占用/上限/可清缓存；只有「清理缓存并打开」「仍然打开」「取消」三个按钮；点遮罩 / Esc **不关闭** |
| **AC27** | **清理只删缓存、Cookie 逐字节保留（R17）** | 清理前后 `data/chrome/<名>/Default/Cookies` 的 sha256 **相同**；白名单缓存目录消失；白名单外目录（含 `IndexedDB`、`Local Storage`、`Service Worker`、`History`、`Bookmarks`）**全部仍在**；返回的 `removedDirs` 与实际删除集合一致 |
| **AC28** | **缓存语义（R17）** | 连续两次 `profileSize`：第二次 `cached === true` 且 `scannedAt` 不变（< 10ms）；`force: true`、`cleanCaches` 之后、`launch` 之后、TTL（60s）过期后 → 均重新扫描；`webapp.diskCacheMb=512` 时命令行含 `--disk-cache-size=536870912`，`=0` 时**不含**该参数 |

## 24. 推荐实施顺序

**依赖关系（谁先谁后）**：

```
T1 骨架与清单（可安装空壳）
 └─ T2 pure lib：nameSanitize + webapp（净化/校验/DB 行/枚举常量）  ← 可并行于 T1
 └─ T3 pure lib：chromeArgs（参数构造 + origin + 白名单）          ← 可并行于 T1
T2 + T3 → T4 helper.cjs（探测 + launch + profile 操作）
T2 → T5 index.js（sqlite + onMessage 方法集 + 卡片注册 + install/uninstall 钩子）
T4 + T5 → T6 端到端打通（新建 → 打开 → 改名 → 删除）
T1 + T2 + T3 + T5 → T7 界面（App.vue + components + fields.js + styles.css，含两个下拉）
T1 → T8 打包与发布（pack.mjs + README + 独立仓库 + tag + Release）
T7 + T8 → T9 真机验收（§18.3 的 A1–A22 + §18.3.1 的 Chrome 探测手工步骤）
```

**tracer-bullet 切分（每片可独立验证，落在单文件所有权内避免并发写同一文件）**：

| 票 | 标题 | 交付什么（端到端行为） | 阻塞于 | 文件所有权 |
|---|---|---|---|---|
| 01 | 扩展骨架 + 清单 + 打包脚本 | 能跑 `pack.mjs` 出 `.oix`，能装进 obox 并在 App 里看到一张卡片（子窗口打开是空白页）；`validate-manifest.mjs` 0 error；**`pack.mjs` 的 `data/` 硬闸门 + `test/pack.test.js` 就位（R16 要求 3）** | 无 | `manifest.json`、`index.js`（最小卡片注册）、`scripts/pack.mjs`、`test/pack.test.js`、`package.json`、`vite.config.mjs`、`src/index.html`+`main.js`（最小）、`.gitignore`、`LICENSE`、`icon.svg` |
| 02 | 纯逻辑：名称净化 | `sanitizeName` / `isReservedName` / 长度预算 / 建议名 全部单测通过 | 无 | `lib/nameSanitize.mjs`、`test/nameSanitize.test.js` |
| 03 | 纯逻辑：数据模型与校验（**含两个枚举常量**） | `normalizeWebapp` / `validateWebapp` / `toDbRow` / `fromDbRow` / **`LANG_VALUES` / `SCALE_VALUES`** 全部单测通过（含文案表、"不在枚举内"两类错误） | 无 | `lib/webapp.mjs`、`test/webapp.test.js` |
| 04 | 纯逻辑：Chrome 参数构造 | `buildChromeArgs` / `deriveOrigin` / 白名单校验 全部单测通过（含 §12.1 顺序断言、**两个下拉"不指定即不传"与枚举边界断言**） | 02、03（复用净化与校验、复用枚举常量） | `lib/chromeArgs.mjs`、`test/chromeArgs.test.js` |
| 05 | 助手：协议外壳 + 探测 + launch | `node helper.cjs --selftest` 退出码 0；ndjson 往返正确；`probe` 返回 `chromeCandidates`（**恰好 4 项、顺序固定**）与 `chrome`；**`probe` 不接受任何测试专用入参（D-2）**；`launch` 白名单校验拒绝非法参数；真机可起 Chrome | 04 | `helper.cjs`、`test/helper.test.js` |
| 06 | 助手：profile 生命周期（移动/删除/占用） | `moveProfile` / `removeProfile` / `profileStatus` 单测通过；`.trash`、`.pending-move.json` 机制到位 | 05 | `helper.cjs`（追加方法）、`test/helperProfile.test.js` |
| 07 | 入口：DB + 方法集 + 卡片 + **钩子** | 用 mock `api` 单测 6 个方法；**`install(ctx)` 只做幂等动作、`uninstall(ctx)` 不搬运 profile（源码门禁就位）**；真机可完成"新建 → 列在列表里 → 打开 → 改名 → 删除"全链路（无界面也能经消息桥验证） | 03、05、06 | `index.js`、`test/index.test.js`、`test/uninstall.test.js` |
| 08 | 界面：列表 + 卡片 + 模态框 + 状态栏 + **两个下拉** | 子窗口里能完成全部交互；**「界面语言」「缩放比例」为下拉且说明写在选项内（R14 正式生效，`fieldDocs` 真实门禁就位）**；TLS 标记、删除确认（含"不可恢复/浏览器数据"）、窄窗堆叠、模态框只能按钮关闭 全部达标 | 02、03、07 | `src/**`（App.vue、components/*、fields.js、bridge.js、theme.js、styles.css、index.html、main.js）、`test/fields.test.js`、`test/fieldDocs.test.js`、`test/componentSource.test.js` |
| 09 | 打包与发布 + **文档（R16 + D-1）** | `out/webapp-1.0.0.oix` + README（**含"升级保留 vs 卸载永久删除"对比段、卸载前备份命令、开发者同步纪律与两个禁止的反面示例**）+ Release 正文按 §20.4 模板 + 独立仓库 + `v1.0.0` tag + Release 附件 | 07、08 | `scripts/pack.mjs`、`README.md`、`docs/**`、仓库与 Release（外部动作） |
| **11** | **入口与界面：体积上限 + 预检 + 只清缓存 + 设置页（R17）** | 设置 → 扩展 下出现「网页应用」页（两个 `select`，默认 2 GB / 512 MB，可改可关）；「打开」前预检并在超限时弹出**只能按钮关闭**的拦截模态框（当前占用/上限/可清缓存 + 三个按钮）；「清理缓存并打开」**只删白名单缓存目录、Cookie 逐字节保留**且清理后能打开；「仍然打开」不持久化；列表页有「清理全部缓存」（二次确认、报告释放量与跳过项）；卡片有「查看体积」按需显示 `已用 X / 上限 Y`；`--disk-cache-size` 按设置产出或不产出 | **06**（同一 `helper.cjs`：`profileSize`/`cleanCaches` 追加在 06 之后）、07（方法集与 `open` 的预检分支）、03（设置归一与 `formatBytes`） | `helper.cjs`（追加 2 个方法 + 缓存目录白名单 + 体积 TTL 缓存）、`test/helperCache.test.js`、`test/helperSize.test.js`、`test/settings.test.js`、`test/manifest-settings.test.js`、`index.js`（`open` 预检分支 + `profileSize`/`cleanCaches` 方法）、`manifest.json`（`contributes.settings`）、`src/**`（拦截模态框 `OverLimitModal.vue`、体积行与「清理全部缓存」入口） |
| 10 | 真机验收 | §18.3 的 A1–A22 **与 A25–A29** 逐条记录到 `docs/evidence/`；**其中 A13/A13b 按 §18.3.1 的手工可逆步骤执行（含还原校验 5 条）+ 证据落 `docs/evidence/chrome-probe-manual.txt`**；**A14/A15/A18 走完整的"登录 → 覆盖安装 → 验证登录态仍在 → 再卸载"链路**；**A26–A29 走完整的"超限 → 清理缓存 → 登录态仍在 → 仍然打开 → 全局清理"链路** | 09、11 | `docs/evidence/**` |

**本次修订对票的影响（R16 / D-1 / D-2 / D-3）**：

| 票 | 变化 |
|---|---|
| 01 | **新增**：`pack.mjs` 的 `data/` 排除硬闸门 + 新增 `test/pack.test.js`（R16 要求 3，三层钉法之一） |
| 03 | **新增**：`LANG_VALUES` / `SCALE_VALUES` 两个枚举常量与其单测；`scaleFactor` 列类型从 REAL 改 TEXT |
| 04 | **新增**：两个下拉"不指定即不传"与枚举边界（`'0.49'`/`'4.1'`/`'1.3'`/`'xx-YY'` 等）的断言；去掉原"数值域/正则域"用例 |
| 05 | **变更**：`probe` 删除测试专用入参（D-2 = C）；新增"入参被忽略且结果与 `{}` 一致"的断言；`chromeCandidates` 长度+顺序断言 |
| 07 | **新增**：`install(ctx)` 幂等约束与 `uninstall(ctx)` 禁止搬运的源码门禁（`test/uninstall.test.js`，R16 g-1 + D-1(d)） |
| 08 | **新增**：两个字段改为下拉、R14 门禁从"空转"改为真实断言（`test/fieldDocs.test.js`）；删除确认文案关键词断言 |
| 09 | **新增**：README 的三段硬要求（升级 vs 卸载对比、卸载前备份命令、开发者同步纪律与反面示例）+ Release 正文按 §20.4 模板；**再补 R17 段**（体积上限的含义、"缓存上限 ≠ 目录上限"、清理只删缓存） |
| 10 | **新增**：A13b（顺位回退）、A16/A17/A18（升级保留与升级/卸载对比）、A23（下拉）、A24（同步纪律）、**A25–A29（R17 全链路）**；A13 改为 §18.3.1 手工可逆步骤 |
| **11（新票）** | **全新**：R17 的"体积上限 + 预检 + 只清缓存 + 设置页"整条竖切。**与票 06 串行**（同一 `helper.cjs`），在 06 之后、可与 08 并行（文件不重叠：11 碰 `helper.cjs`/`index.js`/`manifest.json`/新增 `OverLimitModal.vue`，08 碰 `src/**` 的既有组件与 `fields.js`——**共享 `src/App.vue`，需约定：11 只追加挂载点与按钮、不改 08 已有的 DOM 结构**）。建议实际执行时把 11 排在 08 之后以彻底避开同文件竞争（代价：串行变长）。|

**并行边界**：01 / 02 / 03 / 04 可完全并行（文件不重叠）；05/06 必须串行（同一 `helper.cjs`）；07 与 08 可在 04 完成后并行（但 08 依赖 07 的接口稳定，建议 07 的方法签名先在 `docs/spec` 冻结）。

**tracer-bullet 判据**：每票都能"独立演示一个完整竖切"（01 = 能装能看；04 = 参数确定；05 = 真能拉起 Chrome；07 = 全链路能跑；08 = 能用；09 = 能发）。

## 25. 参考与后续

- 需求研究结论（阶段 1，唯一权威）：`.spec-workflow/webapp-extension/requirements.md`
- 参考实现：`extensions/rdp/`（`manifest.json` / `index.js` / `helper.cjs` / `lib/` / `src/` / `test/` / `scripts/pack.mjs` / `vite.config.mjs` / `README.md` / `docs/adr`）
- obox 扩展权威文档：`skills/obox-ext-dev/SKILL.md` 与 `references/{workflow,guides-user,manifest-reference,api-reference,themes-settings,troubleshooting}.md`、`scripts/validate-manifest.mjs`、`scripts/create-user-extension.mjs`
- 宿主源码：`src/api/types.ts`、`src/api/registration.ts`、`src/shared/ipcDeclaration.ts`、`src/main/{ipc,ipcCore,sqlite,sqliteCore,fs,oixCore,capabilities,appWindow,paths,extensionDirs,hookBridge}.ts`、`src/renderer/src/{AppWindow.vue,core/appTheme.ts,core/appStore.ts,core/loader.ts,core/host.ts}`
- **建议下一步**：D-1…D-5 已全部关闭（§21），**直接进入 `spec-do`** 按 §24 的 01–11 票执行；P6（语言下拉清单）与 P7（上限档位）为待微调项，不阻塞实现。
- **修订记录**：`amendments/01-close-four-decisions.md`（D-1/D-2/D-3/D-4 与新增需求 R16）、`amendments/02-profile-size-limit.md`（新增需求 R17 / D-5）
- **本阶段产物**：本文件 `.spec-workflow/webapp-extension/spec.md` + `amendments/01-close-four-decisions.md` + `amendments/02-profile-size-limit.md`（未创建代码、未创建 `issues/**` 独立票文件——票以 §24 的表格形式内嵌在本文件；若用户希望拆成 `issues/01-*.md`…`issues/11-*.md`，可由 `to-spec` 修订模式补写）。

## 26. 未能核实 / 存疑清单

| # | 未核实项 | 查法 | 修订后的状态 |
|---|---|---|---|
| 1 | ~~Chrome 在同一 `--user-data-dir` 已有实例时对 `--window-size` / `--lang` / `--disable-gpu` 等参数的忽略行为的确切范围~~ | — | **已核实（真机探针阶段一，2026-10-12）**：同 profile 二次启动时第二个进程 **≤1s exit 0** 并转交既有实例；`--app` 转发并新开窗口，但 `--window-size`/`--window-position`/`--lang` **一律无效**（沿用首个实例）。**仅 `--disable-gpu` 未独立观测**（见 §18.4.3 Q-1）。结论已回灌 §12.1 末尾、§14.6 开头、§15.2 第 3b 条、R-W1 |
| 2 | ~~`--unsafely-treat-insecure-origin-as-secure` 是否需要同时给 `--user-data-dir` 才能生效~~ | — | **已核实并改写结论（探针阶段一）**：该参数**单独使用对证书错误无效**（仍是错误页）；真正过证书错误的是 `--ignore-certificate-errors`（DevTools `/json/list` 标题由"[隐私设置错误]"变正常）。已回灌 §16、§19.1 R-1、§20.4，并明令禁止"后者能过证书"的表述 |
| 3 | ~~Chrome profile 目录在 Windows 上的真实占用锁语义（哪些文件被独占、`SingletonLock` 的可靠性）~~ | — | **已核实（探针阶段一）**：Windows **没有** `SingletonLock`/`SingletonCookie`/`SingletonSocket`（POSIX 专有）；实际占用 = 顶层 `lockfile`（0 B、独占、连读都失败）+ 约 30 个 LevelDB `LOCK` + 隐藏消息窗口。运行期**整目录删除失败**、**改名失败**、**删除目录内单个文件成功**；停进程后整体删除成功。已回灌 §14.3（判据改为"尝试删除/改名并捕获失败" + `lockfile` 快速探测，并删除全部 `SingletonLock` 表述） |
| 4 | 本机 Chrome 的确切版本号（用于记录"验证时的 Chrome 版本"） | `(Get-Item '<path>\chrome.exe').VersionInfo.ProductVersion`；**探针阶段一已把它列为基线快照的一部分**（§18.3.1 步骤 0）——本规格未固化该数字，**回填动作**：实现阶段把探针报告的版本号写进 `docs/evidence/chrome-probe-stage1.txt` 并在 README 标注"已在该 Chrome 版本上验证" | 已记录获取方式；版本号本身待探针完整报告 |
| 5 | `rdp` 发布 Release 时用的**具体命令/工具**（gh CLI 还是 GitHub API、Release 正文模板） | obox 仓库内无记录；查 `obox-org/rdp` 的 Release 页与本地 shell 历史；或直接问用户 | 仍然未核实（正文模板已由 §20.4 自行规定） |
| 6 | `obox-org/webapp` 仓库当前是否已存在、组织默认分支是 `main` 还是 `master` | `https://api.github.com/repos/obox-org/webapp`（用 `.gitoken` 或匿名）；或登录 GitHub 看 | 仍然未核实 |
| 7 | `api.sqlite` 的 `ALTER TABLE ADD COLUMN` 路径在宿主实现里是否有额外限制 | 实测：写一个临时扩展对该库执行 `ALTER TABLE webapp ADD COLUMN x TEXT`。属 §13.4 的**预留口径**（1.0.0 不需要） | 仍然未核实（不影响 1.0.0） |
| 8 | `node:sqlite` 的 `COLLATE NOCASE` 在**宿主实际使用的 Node/Electron 版本**上是否同样可用 | 在 obox dev 环境里打印 `process.versions`，或直接在宿主集成测里建该索引 | 仍然未核实 |
| 9 | 注册表 `App Paths\chrome.exe` 在本机可读，但**是否所有 Windows 安装都有该键** | 未核实；已按"注册表只作第 4 顺位、失败只记日志"处理 | 仍然未核实（D-2 = C 后，该顺位的**命中情况**改由 §18.3.1 手工覆盖） |
| ~~10~~ | ~~卸载钩子能否在 10s 内把 profile 备份到扩展目录之外~~ | — | **已由 D-1 结论取代**：不可行（10s 预算 vs GB 级体积，且钩子失败/超时后宿主照样删光目录）→ 决策为"禁止在 `uninstall` 里搬 profile"，见 §14.4(d) |
| **11（新）** | `probe` 的 4 顺位探测**命中路径**与"全不命中"两条分支无自动化覆盖 | 已由 **D-2 = C** 接受为风险；覆盖方式 = §18.3.1 的手工可逆步骤（发版前必跑）+ 证据落 `docs/evidence/chrome-probe-manual.txt`。**不再是"待查"而是"已接受"** | 已接受（R-W11） |
| **12（新）** | 覆盖安装时 `fs.rename(backup/data, target/data)` 失败（只记日志、不阻断安装）在本机是否会发生 | 真机 A14/A15 会在自家环境暴露；跨卷/权限异常场景未构造 | 未核实（R-W13，属宿主行为、本扩展无法消除） |
| **13（新，R17）** | Chrome 是否**真的**按 `--disk-cache-size` 限制 `Cache/` 体积（以及它在磁盘上的实际落点是否就是 `Default/Cache`） | 真机：设 128 MB → 用大流量站点浏览 → 观察 `data/chrome/<名>/Default/Cache` 体积是否被约束；对照不传该参数时的增长 | 未核实（R17 的"缓存上限"依赖 Chrome 自身实现；即使失效也不影响"目录上限 + 预检 + 只清缓存"这条主链路） |
| **14（新，R17）** | `cleanCaches` 在**该站点窗口正开着**时的实际失败比例（哪些缓存目录会被占用） | 真机 A27/A29：窗口开着跑全局清理，统计 `skipped[]` 的目录分布与 errno | 未核实（R-W17 已按"失败进 skipped、如实提示、不重试"处理） |
| **15（新，R17）** | GB 级 profile 在**本机磁盘**上的真实扫描耗时（用于校准 60s TTL 与 120s 超时是否合适） | 真机：对一个 > 1 GB 的真实 profile 连续跑 `profileSize`，记录首次（冷）与命中（热）耗时，落到 `docs/evidence/profile-size-timing.txt` | 未核实（R-W16 已按"只按需扫描 + TTL + 不轮询"处理） |
