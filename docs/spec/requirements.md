# 需求研究结论：webapp 扩展（Chrome App 模式网页应用）

- 需求来源：用户指令「仿照 `extensions/rdp/`，开发 webapp 扩展，只放在 App 扩展里，使用 Chrome 的 app 模式并忽略证书问题」
- 流程：to-grill（阶段 1）｜日期：2026-10-12
- Git 入口：仓库 `C:\Users\chenzhi\Documents\workspace\web\obox`；分支 `master`；HEAD `831832e`；工作区干净（porcelain 0 行）；分支决策 = **继续在当前分支**（用户选择 B，流程产物留作未跟踪文件）

## 背景

obox 需要一个"网页应用"管理扩展：把内部系统/自签证书站点当作桌面应用打开。现有 `rdp` 扩展已验证"App 卡片 + `api.ipc` stdio 助手拉外部进程"这条路可行（拉 `mstsc`），本需求复用同一形态去拉 Chrome 的 app 模式窗口。

## 目标

在 obox 里提供 webapp 扩展：卡片列表管理多条"网页应用"，点击即以 **Chrome app 模式**（`--app=<url>`）打开独立窗口，按条目使用独立 Chrome profile，并按条目决定是否忽略证书问题。

## 非目标

- 不做浏览器选择（只用 Chrome，不自动回退 Edge，不做自定义 exe 路径）。
- 不开放任意 Chrome 参数（只给固定集合 + 少量白名单开关）。
- 不做 Chrome 进程跟踪/管理（无"运行中"状态、无"关闭"按钮）。
- 不做书签/历史/下载管理，不接管默认浏览器，不做站点内容注入。
- 不复用系统默认 profile（会导致参数被忽略）。

## 用户流程

1. 打开 App 卡片 → 见条目列表（卡片：`name` + `url` + 一行 `desc`）。
2. 右上「新建」→ 填 `name`（必填）、`url`（必填）、`desc`（可选）、「忽略证书问题」（默认勾选）→ 保存 → 条目立即出现。
3. 点某条「打开」→ 启动 Chrome app 窗口（该条目专属 profile）。
4. 「编辑」→ 改 `name`（改目录名并移动 profile）、`url`、`desc`、证书开关。
5. 「删除」→ 二次确认（明确提示**会连同该站点的浏览器数据一起删除、不可恢复**）→ 删除条目与 `chrome/<name>` 目录。
6. 失败路径：未装 Chrome → 界面明确报错；删除时 profile 被占用 → 报错要求先关闭该窗口。

## 功能范围

- R1 App 卡片专用（与 `rdp` 同构：`id`、名称、图标、`url` 指向 `ui/index.html`、`multiOpen:false`、约 1024×720），不贡献状态栏/命令/树/快捷键。
- R2 条目 CRUD（列表/新建/编辑/删除+确认），支持多条。
- R3 字段：`name`（必填、大小写不敏感唯一）、`url`（必填、**仅 http/https**）、`desc`（可选、单行、限长）、`ignoreCert`（布尔，**默认 true**）。
- R4 profile：`<扩展 data 目录>/chrome/<name 净化后>`；**目录跟随 `name`**，改名时移动目录，移动失败则报错且不改数据。
- R5 `name` 净化：替换 `\ / : * ? " < > |`；拒绝 Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）；去尾部点与空格；长度上限（含路径 ≤ 240）；大小写不敏感去重。
- R6 存储：`api.sqlite`（与 `rdp` 同构），DB 在 `<userData>/extensions/<扩展id>/data/`，升级保留。
- R7 启动：`api.ipc` 通道 + `helper.cjs`（纯 Node、stdio JSON-RPC），由助手 spawn `chrome.exe`。
- R8 Chrome 探测顺序：`%ProgramFiles%\Google\Chrome\Application\chrome.exe` → `%ProgramFiles(x86)%\...` → `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` → 注册表 `App Paths\chrome.exe`；全部失败 → `[chrome-not-found]` 明确报错（不静默换浏览器）。
- R9 固定参数：`--app=<url>`、`--user-data-dir=<R4 目录>`、`--disable-features=DownloadBubble`。
- R10 `ignoreCert = true` 时追加：`--ignore-certificate-errors` + `--unsafely-treat-insecure-origin-as-secure=<由 url 推导的 origin>`（并允许附加额外 origin）；`false` 时两个都不传。
- R11 白名单开关（**已确认**，每条连接可选、均可留空）：`--window-size=W,H`（宽/高整数）、`--window-position=X,Y`（左/上整数）、`--start-maximized`（布尔）、`--lang=<locale>`（如 `zh-CN`，校验 `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`）、`--force-device-scale-factor=<n>`（数值，0.5–4，步进 0.25）、`--disable-gpu`（布尔）。白名单之外一律拒绝保存并给出字段级提示。
- R12 打开语义：**不跟踪进程**；同一 profile 再次启动会并入既有实例并新开 app 窗口（预期行为，不算错误）。
- R13 删除语义：删条目**连 profile 目录一起删**（不可恢复）；若目录被占用 → 报错"请先关闭该站点的浏览器窗口"，不杀进程、不留半删目录。
- R14 界面沿用 `rdp` 既有规范：宿主主题 token（零自造色值）、每项独占一行 + 一行灰色说明、下拉取值说明写在选项内、标签列固定宽度左对齐、窄窗堆叠、模态框只能按钮关闭。
- R15 界面提示：条目若开着"忽略证书"，列表/详情需有可见标记（TLS 已降级），避免使用者忘记。

## 业务规则

- 同一个 `name` 不允许重复（大小写不敏感）；空 `name`、空 `url` 拒绝保存。
- 只有 http/https 允许；`file:`、`javascript:`、`chrome:` 等一律拒绝。
- `url` 是唯一事实来源：origin 从它推导，不单独落库（避免漂移）。
- 改名 → 目录移动失败时不落库（保持名与目录一致）。

## 数据语义

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 整数 | 主键（同 rdp 的 sqlite 惯例） |
| `name` | 文本 | 显示名 + 目录名来源；大小写不敏感唯一 |
| `url` | 文本 | 仅 http/https |
| `desc` | 文本 | 可选、单行 |
| `ignoreCert` | 0/1 | 默认 1 |
| `windowSize` / `windowPos` / `startMaximized` / `lang` / `scaleFactor` / `disableGpu` | 见 R11 | 白名单开关：可留空；空值不传该参数，留空即用 Chrome 默认 |
| `createdAt` / `updatedAt` | ISO 文本 | 审计 |

## 权限、安全与审计

- **TLS 降级（用户已接受，见风险）**：默认忽略证书错误；每条可关闭。
- 助手只做"探测 Chrome + 启动参数明确的 Chrome 进程"，不接收任意命令，不接受任意参数透传（R11 白名单之外拒绝）。
- 扩展不接触密码/凭据；无 `api.secrets` 使用。
- 日志不得输出完整命令行中的敏感项（当前命令行无凭据，仍保持"只记摘要"）。

## 异常与边界场景

1. 未安装 Chrome → `[chrome-not-found]`（含探测过的路径）。
2. profile 目录被占用（Chrome 在跑）→ 删除报错；打开继续正常（并入实例）。
3. `name` 含非法字符/保留名/超长 → 保存时给出字段级错误并给出净化后的建议名。
4. 改名时移动目录失败（占用/权限）→ 报错，不落库。
5. url 非法协议 → 字段级错误。
6. Chrome 参数被忽略（同一 user-data-dir 已有实例）→ 属预期；R14 的提示里说明"若开关未生效请先关闭该站点窗口"。
7. 首次打开条目 → 目录自动创建（`--user-data-dir` 由 Chrome 自行建立）。

## 风险

- **R-1（用户已接受）**：`--ignore-certificate-errors` 关闭 TLS 校验，同网段攻击者可读改写流量；`--unsafely-treat-insecure-origin-as-secure` 只把 origin 当作安全上下文，并不修证书。默认开启 + 可逐条关闭。
- **R-2**：删除连 profile 一起删属不可恢复的数据操作（已确认接受），UI 二次确认必须写明。
- **R-3**：Chrome 版本升级可能改名/移除这些开关（不承诺长期有效，需真机验证）。
- **R-4**：同一 profile 被多个窗口共用时开关行为依赖 Chrome 的并入语义（已按"不跟踪进程 + 提示"处理）。
- **R-5**：profile 目录可能很大（GB 级），磁盘占用需在文档中说明。

## 已关闭问题

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 分支 | 继续在 master（用户选择 B） |
| Q2 | 启动方式 | 事实已定：宿主无"带参数启动进程"API ⇒ 复用 `api.ipc` + `helper.cjs`（同 rdp） |
| Q3 | profile 策略 | 每条连接独占：`<扩展目录>/chrome/<name>` |
| Q4 | 证书忽略粒度 | 全局默认忽略 + **每条可关闭**（对"强制无开关"做了风险复核后改为可关闭） |
| Q5 | name 与目录 | 目录跟随 name，改名移动目录（净化 + 保留名 + 大小写去重） |
| Q6 | 浏览器 | 只用 Chrome；找不到明确报错 |
| Q7 | 额外参数 | 不开放任意参数；固定集合 + 少量白名单开关 |
| Q8 | 删除 profile | 连 profile 一起删（不可恢复，二次确认） |
| Q9 | 进程管理 | 不跟踪进程；占用时报错 |
| Q10 | 交付形态 | `extensions/webapp/` 独立仓库 + 建 `obox-org/webapp` + tag `v1.0.0` + release 附 `webapp-1.0.0.oix` |

## 显式延后 / 待确认

- **P1（已关闭）**：R11 白名单开关清单已确认（窗口尺寸/位置、最大化、语言、缩放、禁用 GPU）。
- **P2（待确认）**：卸载扩展时是否删除 `chrome/` 下的所有 profile（初拟**不删**，只保留数据与文档说明）。
- **P3（待确认）**：是否需要"在默认浏览器打开该 url"辅助动作（初拟不做）。
- **P4（待确认）**：是否需要导入/导出条目（初拟不做）。
- **P5（延后）**：是否需要多窗口/多 profile 的分组管理（不做）。

## 建议下一步

进入 `to-spec`：把本文件作为权威输入，产出实现规格（模块划分、消息契约、`.oix` 打包、测试与验收清单）。P1/P2 可在 spec 阶段一并定稿。
