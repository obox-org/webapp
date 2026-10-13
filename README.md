# webapp —— obox 网页应用扩展

把内部站点/自签证书站点当作**桌面应用**打开：用 **Chrome 的 app 模式**（`--app=<url>`，无地址栏）启动，
每个连接使用**独立的 Chrome profile**，可按连接决定是否忽略证书问题，并可限制单个站点的浏览器数据体积；**profile 存放位置可配置**（默认在扩展数据目录内；可指向其它磁盘，改位置时自动迁移已有数据）。

- 扩展 id：`webapp_chenzhi`（manifest `name: "webapp"` + `author: "chenzhi"`）
- 版本：`1.0.3`｜`apiVersion: 1`
- 形态：**App 卡片专用**（不贡献状态栏 / 命令 / 树 / 快捷键）
- 依赖：Windows + 已安装 Google Chrome（本扩展**不**自动回退 Edge）

> ⚠️ **界面没有操作/错误提示**（**1.0.1** 起，用户要求"彻底不要提示"）：子窗口里**不再有底部状态栏**，
> 新建/打开/删除/清理的结果与错误**只进开发者控制台**。因此 **R8 的"未找到 Chrome"报错在界面上看不到**——
> 点了「打开」没反应时，请打开子窗口 DevTools（或看 obox 终端里的 `[child-renderer:*]` 日志）。
> 取舍与补偿手段见 `docs/spec/amendments/05-remove-status-bar.md`。

> 📌 **版本沿革**：`1.0.0` 首个版本 → `1.0.1` 去掉底部状态栏（amendment 05）+ 卡片列表搜索
> （amendment 06）→ `1.0.2` 搜索框美化（胶囊形 + 内嵌放大镜 + 限宽 400px，与 rdp 扩展形态一致；
> 见 `docs/spec/amendments/07-search-box-beautify.md`）→ `1.0.3` **可配置 profile 根目录 + 改根自动迁移 +
> 三道数据安全防线 + 卸载语义对照化**（见 `docs/spec/amendments/08-profile-root.md`）。

---

## 1. 安装

1. 取 `out/webapp-1.0.3.oix`；
2. obox → 扩展管理 → 安装本地 `.oix`；
3. 安装后在 App 列表出现「网页应用」卡片。

> 开发者若要调试，用 `npm run dev -- -- --debug-extension webapp@<扩展绝对路径>`（**注意是两个 `--`**）。
> 调试态的扩展 id 是 **`webapp`**（不是安装态的 `webapp_chenzhi`），数据目录也随之不同
> （`userData/extensions/webapp/data`）——因此"升级保留数据 / 卸载删数据"这两件事**必须用安装态验证**。

---

## 2. 使用

| 操作     | 行为                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新建     | 填写 `name`（必填、唯一、大小写不敏感）、`url`（必填，**仅 http/https**）、`desc`（可选）；「忽略证书问题」默认**开启**；可选填窗口尺寸/位置/最大化/语言/缩放/禁用 GPU |
| 打开     | 以 Chrome app 模式打开该站点；profile **默认**落在 `<扩展目录>/data/chrome/<名>`；若在设置里配置了根目录，则落在 `<根>\<名>`                                           |
| 编辑     | 改 `name` 会**连同 profile 目录一起改名**（保留登录态）；改名/移动失败则报错且不落库                                                                                   |
| 删除     | 二次确认后删除条目**连同该站点的浏览器数据**（不可恢复）                                                                                                               |
| 清理缓存 | 「清理缓存（保留登录态）」只删缓存类目录，**不动 Cookie/登录态**                                                                                                       |
| 搜索     | 列表上方输入框**实时过滤**（规则见 §2.2）；`Esc` 或「清空」恢复全部                                                                                                    |

### 2.2 搜索（模糊匹配）

列表上方有一个搜索框（占位「搜索名称 / 地址 / 说明」），**输入即过滤**，`Esc`（或右侧「清空」）恢复全部。
匹配规则由 `src/search.js` 的纯函数实现，`test/search.test.js` 逐条钉住：

| 规则       | 说明                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 搜哪些字段 | `name`、`url`、`desc` **三个字段分别打分，取最优**（一个条目只会因为最好的那个字段得分；URL 里的域名/路径也能搜） |
| 大小写     | **不敏感**（`GITLAB` 与 `gitlab` 等价）                                                                           |
| 子序列匹配 | 查询字符**按顺序**出现在候选里即算命中（`gitlb` 命中 `gitlab`）；顺序颠倒或缺字符不算                             |
| 加权排序   | 前缀命中 > 词首命中（`-`/`_`/`/`/驼峰边界）> 普通连续包含 > 离散子序列；离散命中越紧凑分越高                      |
| 多词       | 按空白拆词，**全词都要命中**（AND；各词可以落在不同字段，例如 `gitlab 托管`）                                     |
| 空查询     | `''` / 纯空白 → **返回全部且保持原顺序**（"新条目在最上面"）                                                      |
| 排序       | 命中项按分数**降序**；**同分保持原顺序**                                                                          |
| 无匹配     | 显示「没有匹配的网页应用」空态 + 「清空搜索」按钮（复用同一个 `EmptyState.vue`）                                  |

### 2.1 升级 / 卸载：**默认根**与**外部根**是两种语义（1.0.3 起对照化）

> ⚠️ **1.0.3 起 profile 根可配置**（设置项 `webapp.profileRoot`）。下表的"外部根"指你把它指向的**扩展目录之外**的绝对路径。
> **默认根（`<扩展 data>/chrome`）随卸载永久删除；外部根下的 profile 会保留在磁盘上，需你自行清理。** 这是本站最容易被误解的一条，务必读完再决定把根放在哪里。

| 操作                                 | 默认根（`webapp.profileRoot` 为空）                                    | 外部根（你配置的绝对路径）                                              | 机制                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **升级 / 覆盖安装**（装新版 `.oix`） | ✅ **保留**（含 `data/chrome/**` 与其中所有登录态）                    | ✅ **保留**（根本就在扩展目录之外，宿主不接触它）                       | 宿主在覆盖安装时保留扩展运行时数据目录 `data/`（`src/main/oixCore.ts:320-336`）；含 `data/` 的包会被安装器以 `forbidden-entry` 拒绝               |
| **卸载扩展**                         | ❌ **永久删除**（整个扩展目录被递归删除，含所有站点 profile 与登录态） | ✅ **保留在磁盘上**（宿主只删扩展目录，够不到外部根）→ **需你自行清理** | `src/main/capabilities.ts:96-101` 先跑卸载钩子，`:118` 对 `<userData>/extensions/webapp_chenzhi/` 执行 `fs.rm(..., {recursive:true, force:true})` |

> `uninstall(ctx)` 钩子**不会**尝试搬运/备份 profile —— 钩子预算只有 10s，搬 GB 级目录必然失败，而失败后宿主照样全删；
> 它也**完全不触碰外部根**（`docs/spec/amendments/08-profile-root.md`，P4 = A）。唯一的例外是删掉迁移意图文件 `<data>/.pending-move-root.json`（避免重装后误判）。

**卸载前备份（可复制）**——注意：**若使用了外部根，`data/` 里没有 profile**，备份必须**同时**覆盖 `data/`（条目库）与**外部根**（各站点登录态），**缺一不可**。只备份 `chrome/` 会**丢掉全部条目**；只备份 `data/` 会**丢掉全部登录态**：

```powershell
# 同时备份：data/（条目库 webapp.db）+ 外部根（各站点登录态）
$src  = Join-Path $env:APPDATA 'obox\extensions\webapp_chenzhi\data'
$prof = 'D:\obox-webapp\profiles'   # ← 改成你在设置里配置的 webapp.profileRoot；留空则用 $src\chrome
if ([string]::IsNullOrWhiteSpace($prof)) { $prof = Join-Path $src 'chrome' }
$dst = Join-Path $env:USERPROFILE ("webapp-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (-not (Test-Path $src)) { throw "找不到扩展数据目录：$src" }
if (-not (Test-Path $prof)) { throw "找不到 profile 根：$prof" }
Copy-Item $src  (Join-Path $dst 'data')  -Recurse -Force
Copy-Item $prof (Join-Path $dst 'profiles') -Recurse -Force
# 校验：条目库与站点 profile 都必须备份到（两个 True 才算成功）
"webapp.db   = $(Test-Path (Join-Path $dst 'data\webapp.db'))"
"profiles/   = $((Get-ChildItem (Join-Path $dst 'profiles') -Directory -ErrorAction SilentlyContinue).Count) 个站点目录"
"已备份到 $dst"
```

还原：把备份里的 `data/webapp.db` 放回 `<扩展目录>/data/`，把 `profiles/*` 放回你配置的根（若只想恢复某个站点，单独放回 `<根>/<该站点的目录名>`）。

**清理外部根（卸载后）**——卸载后外部根**原样留在磁盘上**，需要你自己删（这一步**不可恢复**，确认里面没有你要留的数据再执行）：

```powershell
# ⚠️ 不可恢复：确认路径是你配置的 webapp 根，且里面没有别的东西再用它
$prof = 'D:\obox-webapp\profiles'
if (Test-Path $prof) { Remove-Item $prof -Recurse -Force }
```

---

## 3. 设置（扩展设置页）

| 键                      | 类型                               | 默认   | 说明                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webapp.profileLimitMb` | select `0/512/1024/2048/4096/8192` | `2048` | **单站点数据体积上限**（MB）。`0` = 不检查、不拦截。超过上限时，点「打开」会**先拦下**并给出「清理缓存（保留登录态）」/「仍然打开」两个动作                                                                              |
| `webapp.diskCacheMb`    | select `-1/0/128/512/1024`         | `-1`   | 传给 Chrome 的 `--disk-cache-size`。**`-1` = 禁用磁盘 HTTP 缓存**（磁盘最省，代价是每次打开都要重新下载静态资源）；`0` = 不限制；正数 = 仅"单条准入阈值 ≈ cap/8" + 下次启动时清理超限缓存（**不是运行期上限**）          |
| `webapp.profileRoot`    | text（绝对路径）                   | 空串   | **站点浏览器数据的存放根目录**。留空 = 用默认目录（扩展数据目录下的 `chrome`）。**改这里会把已有数据自动迁移到新目录，迁移未完成时不会生效**。卸载时只有默认目录下的数据会被删除；指向外部目录时数据会保留，需你自行清理 |

**`webapp.profileRoot` 的校验与拒绝情形**（不合法的值**不生效**，运行时继续用当前生效根，界面会说明原因）：

| 值                                 | 结果                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| 空串 / 纯空白                      | 用默认根（`<扩展 data>/chrome`），**零迁移**                                 |
| 相对路径（`chrome`、`profiles\x`） | ❌ 拒绝：必须是绝对路径                                                      |
| 纯盘符根（`C:\`、`D:/`）           | ❌ 拒绝：不能把磁盘根当数据根                                                |
| obox 自己的安装目录（或其下）      | ❌ 拒绝                                                                      |
| 扩展自己的 data 目录（或其祖先）   | ❌ 拒绝：条目枚举会把 `webapp.db` 当条目                                     |
| UNC（`\\server\share\profiles`）   | ✅ 允许，但会给出性能警告（网络盘上打开变慢、迁移可能很久；断网/拔盘会失败） |
| 不存在的绝对路径                   | ✅ 允许：自动创建目录并写标记文件 `.obox-webapp-root`                        |

体积预检的缓存 TTL 为 **60 秒**（过期 / 手动强制 / 清理后 / 改名或删除后 / 启动后 / 设置变更都会失效）；量体积失败时**降级放行**（不因为量不出来就打不开）。

### 3.1 配置浏览器数据根目录（迁移语义，1.0.3 新增）

**怎么配**：设置 → 扩展 → 网页应用 → 「浏览器数据根目录」（也可在扩展界面点「浏览…」选目录；**「浏览…」依赖 obox 的选目录能力**，老版本请手工粘贴路径，见 §4 第 10 条）。

**行为**：

1. 保存后扩展会**自动迁移**存量站点目录到新根（逐目录进行、**串行**、每搬完一个就记录进度）；
2. **设置值只在全部搬完后才写入**——迁移未完成时，生效根**恒为旧根**（所以你不会遇到"设置说 D 盘、数据还在 C 盘"）；
3. 迁移**可中断、可续做**：中途关掉 obox / 断电 / 磁盘满，下次打开扩展会自动接着搬；扩展界面顶部会显示「正在迁移浏览器数据：已搬 X/Y」并给出「继续 / 放弃」；
4. **冲突（目标根下已有同名目录）会被逐条列出并要求你确认**；确认后才执行"**先删除目标同名目录 → 再把源搬过去**"。⚠️ **目标目录里原有的浏览器数据（含登录态）会被永久删除且无法恢复，本扩展不保留任何备份**——这是你已明确接受的取舍（见 `docs/spec/amendments/08-profile-root.md` 的风险段）。点「取消」则**一个字都不删**；
5. 迁移期间**禁止改名**与**再次改根**（打开 / 删除 / 清理仍可用）；
6. 「放弃」= 停止迁移并把设置写回旧根；**已经复制到目标根的数据会保留在磁盘上**，需你自行清理；
7. 迁移**只搬"在条目库里有对应条目"的目录**；根下你自己放的其它文件夹与文件**一律不动**（宁可不搬，也不搬错）。旧根下的残留目录也**不自动清理**。

**安全边界（三条防线）**：

- **路径校验**：见上表；
- **标记文件**：根下必须有 `.obox-webapp-root`（本扩展建的根会自动写入）。**缺标记时删除 / 清理 / 改名一律被拒绝**（界面提示「该目录不是本扩展管理的目录：删除与清理已被拒绝」）——因此把根指到**真实 Chrome profile**（`%LOCALAPPDATA%\Google\Chrome\User Data`）时，一次误点也不会删掉你日常浏览器的登录态。打开与查体积仍然可用（它们是"写"与"读"，不是"删"）；
- **永不删根**：任何删/移动作**只作用于根之下的子目录**，根目录本身永远不会被删除。

**根指向一个已有数据的目录时的副作用（知情项）**：本扩展只把 `<根>\<条目名>` 当作数据，但它会在根下维护两个**同名保留项**——
标记文件 `.obox-webapp-root` 与删除中转目录 `.trash/`（改名时还会短暂出现 `.pending-move.json`）。若你把根指向 `%LOCALAPPDATA%\Google\Chrome\User Data`
这样的**已有目录**，这两个名字会被创建在里面（同名时会被覆盖/合并），Chrome 自身不受影响但目录里会多出它们。
因此**推荐把根指向一个专门给本扩展用的空目录**（例如 `D:\obox-webapp\profiles`），而不是日常浏览器的 profile 根。

---

## 4. 已知行为（真机实测）

1. **同一站点已打开时，新的窗口尺寸/位置/语言等设置一律不生效** —— Chrome 会把第二次启动并入既有实例，第二次进程约 1s 内 `exit 0`；`--app=<url>` 会被转发并**新开一个完全重叠的默认尺寸窗口**（不是聚焦已有窗口）。想生效请先关闭该站点的浏览器窗口。这也是"**每条连接必须独立 profile**"的原因：不独立就无法给不同站点不同的尺寸/语言。
   > 这条提示原本有**三处**落点（状态栏成功文案 / 高级选项说明行 / 本 README）。
   > **1.0.1** 去掉状态栏后**只剩两处**：新建-编辑模态框的「高级选项」折叠区说明行 + 本小节。
   > 界面上也不再有任何操作/错误提示（含 R8 的"未找到 Chrome"），诊断信息只在开发者控制台。
2. **只有 `--ignore-certificate-errors` 能过证书错误**；`--unsafely-treat-insecure-origin-as-secure` 只把 origin 当作安全上下文，**单独使用仍是证书错误页**。
3. **禁用 HTTP 磁盘缓存 ≠ 禁用 Service Worker / CacheStorage**：用了 Service Worker 的站点仍可能在 profile 内缓存内容并增长，这部分**不在清理白名单**里（删了会破坏站点离线/登录相关行为）。
4. **profile 体积地板 ≈17 MB**（一次短会话）；会话超过约 1 分钟会额外下载 **≈40 MB 的 `optimization_guide` 模型**（不受缓存参数管辖）；**`BrowserMetrics` 每次启动 +4 MB**（同一 profile 反复打开会累积，已列入清理白名单）。
5. **删除连接时若该站点的 Chrome 窗口还开着**，profile 目录被占用会导致删除失败（Windows 上不存在 `SingletonLock` 这类"锁文件"，判据是**尝试删除/改名并捕获失败**）。删除确认框会**提前**提示"请先关闭窗口"或"该站点还没有浏览器数据"（来自一次只读的 `profileInfo` 探测）；删除真失败时的错误**只进控制台**（**1.0.1** 起界面无提示）。
6. 关闭最后一个 app 窗口后约 **0.8 秒**，Chrome 的 browser 与全部子进程退出，**无托盘/后台残留**。
7. **改根会自动迁移存量数据**（逐目录进行、可中断续做、**冲突时必须逐条确认后才覆盖**）；迁移期间**改名与再次改根被拒绝**，「打开 / 删除 / 清理」仍可用。
8. **根缺少标记文件 `.obox-webapp-root` 时，删除 / 清理 / 改名一律被拒**（打开与查体积仍可用）——这是防止误删真实 Chrome profile 的那道防线。界面会显示「该目录不是本扩展管理的目录」。
9. **迁移的完整性判据**：目标目录的文件数与总字节数必须 ≥ 源的 **95%**（硬门槛 `floor(源 × 0.95)`）且关键文件（`Default/Preferences`、`Default/Network/Cookies`，源里确实有时才要求）都在，**通过之后才删除源目录**。任一不满足 ⇒ 该条目 `failed`、**源保留**、整体停在"迁移未完成"。小样本下这条会偏严（源 10 个文件时目标至少要 9 个），宁可让你关窗重试，也不把截断的 profile 当成功。
10. **UNC / 移动盘上打开变慢或失败属预期**（网络盘、拔盘、断网）；把根指到 UNC 时扩展会给出性能警告。
11. **「浏览…」需要 obox 具备目录选择能力**（`api.dialog.showOpenDialog` 支持 `properties: ['openDirectory']`）。没有该能力的版本上，弹出的会是**文件**选择框：扩展会把**该文件所在的文件夹**当作候选目录并明确提示（"当前 obox 版本不支持「选择目录」…"），**这是预期行为、不是故障**——候选值**仍要你确认后**才提交，也**仍会**走同一套校验。**扩展不按版本号判断能力**（只按"拿到的路径是不是目录"），因此不会因为宿主版本串不同而误判。

---

## 5. 手工验收：Chrome 未安装 / 探测顺序（已接受的覆盖缺口）

这两条分支**没有自动化回归保护**（本扩展不做"仅测试用"的探测注入）。手工步骤可逆、可复现：

```powershell
# 0. 基线快照
$dir = 'C:\Program Files\Google\Chrome\Application'
"$dir -> $(Test-Path $dir)"; (Get-Item (Join-Path $dir 'chrome.exe')).VersionInfo.ProductVersion
reg export "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" "$env:TEMP\chrome-apppath.reg" /y

# 1. 验"第 4 顺位（注册表）仍能找到 Chrome"
Rename-Item $dir "$dir.bak"          # 需要管理员权限
#    预期：打开连接仍成功；扩展自检/状态里 chrome source = registry

# 2. 验 [chrome-not-found]
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /f
#    预期：报错文案列出**按序查找过的四条路径**，且不回退 Edge

# 3. 还原（务必执行）
reg import "$env:TEMP\chrome-apppath.reg"
Rename-Item "$dir.bak" $dir
# 4. 还原校验（四条都应通过）
"$dir -> $(Test-Path $dir)"                    # 期望 True
"$dir.bak -> $(Test-Path "$dir.bak")"          # 期望 False
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve   # 期望与基线一致
(Get-Item (Join-Path $dir 'chrome.exe')).VersionInfo.ProductVersion                    # 期望与基线一致
```

最后手工打开一次日常 Chrome，确认你自己的浏览器数据未受影响。

证据留档：`docs/evidence/chrome-probe-manual.txt`。

---

## 6. 开发者

### 6.1 目录结构

```
manifest.json        扩展清单（name/displayName/author/apiVersion/contributes；三个设置项）
index.js             扩展入口：App 卡片注册 + 消息路由（**12 个方法**：list/save/remove/open/probe/profileInfo/
                     profileSize/cleanCaches + rootStatus/startRootMigration/resolveRootMigration/browseRootDir）
                     + 迁移编排（生效根、意图文件、状态机、唯一写设置点）+ install/uninstall 钩子
helper.cjs           纯 Node 助手（api.ipc stdio JSON-RPC）：Chrome 探测、启动、profile 体积统计、只清缓存、
                     目录改名/删除、**根状态/建根写标记/候选根判定/逐目录迁移**（**11 个方法**；参数白名单
                     与缺标记门禁也在这一层）
lib/profileRoot.mjs  **profile 根的单一实现**：路径校验/归一、标记文件、迁移意图 schema 与状态机、
                     冲突决策、完整性判据（C1–C5）、生效根解析、卡片文案（**零 node 依赖**，界面也会 import）
lib/chromeArgs.mjs   命令行构造（固定参数 + 白名单开关 + 证书参数 + origin 推导 + launch 摘要脱敏 +
                     `--user-data-dir` 的两种形态：默认根相对 / 自定义根绝对）
lib/nameSanitize.mjs name 净化（非法字符/Windows 保留名/尾点空格/长度/大小写去重）
lib/profileLimit.mjs 体积上限、缓存白名单/保留清单、深度 2 判定、TTL、设置档位与文案（单一事实来源）
lib/entryFields.mjs  两个下拉的枚举（LANG_VALUES / SCALE_VALUES）、URL 校验、布尔归一
lib/webapp.mjs       条目归一/校验/库行互转（含 §12.3 的全部字段级文案）
src/                 Vue 界面源码（App.vue + components/* + fields.js + bridge.js + theme.js + styles.css）
ui/                  界面构建产物（进包）
scripts/pack.mjs     打包 .oix（显式排除 data/、out/、node_modules/、.git/、src/、docs/、test/、scripts/）
test/                node --test 单测（profileRoot / rootMigration / helper / ipcSurface / componentSource …）
out/                 打包产物（不进包、不提交）
```

### 6.2 门槛（提交前必须全绿）

```powershell
cd extensions/webapp
node --test                    # 单元测试（194 例）
npx prettier --check .         # 代码风格
npm run build                  # 构建 ui/
node scripts/pack.mjs          # 打包（产物自检：无 data/、无 src/）
cd ../..
node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json
```

### 6.3 同步纪律（把构建产物同步到已安装目录时）

只覆盖这五类分发文件：`ui/`、`lib/`、`index.js`、`helper.cjs`、`manifest.json`。
**绝不动 `data/`**（`data/webapp.db` 与 `data/chrome/**` 是使用者的条目库与登录态）。

⚠️ **同样不要动你在设置里配置的自定义根**（`webapp.profileRoot`）：它不在扩展目录内，因此**上面这套同步命令碰不到它**；
但如果你用 `robocopy /MIR` 之类的镜像命令去同步"整个扩展目录 + 根"，就有可能把根里的站点数据镜像掉 —— 同步前先确认目标不在根里。

### 6.4 打包

```powershell
cd extensions/webapp
node scripts/pack.mjs          # → out/webapp-<version>.oix
```

包内**必须没有 `data/`**（宿主安装器会以 `forbidden-entry` 拒绝含 `data/` 的包，因为 `data/` 是升级时由宿主保留的运行时数据目录）。

### 6.5 尚未核实（如实登记，勿当已核实）

- `--disable-gpu` 是否同属"仅首个进程读取"（有间接证据：同 profile 二次启动时命令行一字未变、`--window-size/-position/-lang` 全被忽略；但未直接观测 GPU 渲染模式变化）；
- `--force-device-scale-factor` 本轮**未做真机验证**；
- `--disk-cache-size` 超限清理是"清空"还是"裁剪到上限"未区分；
- GB 级 profile 的扫描耗时未测；
- Chrome 窗口开着时 `cleanCaches` 的失败分布未测；
- **v1.0.3 新增的覆盖缺口**（如实登记）：
  - `migrateRootDir` 的"复制完成但完整性判据不通过 ⇒ `failed` 且**源保留**"这一分支需要"复制必然被截断"的故障（磁盘满 / 权限 / 目标被外力删除），纯 Node 造不出确定性场景 ⇒ 判据本身由 `test/profileRoot.test.js` 的 `verifyMigration` 表驱动用例覆盖，真机截断场景**未自动化**；
  - 跨卷（`EXDEV` / `forceCopy`）路径的真机耗时与 `EXDEV` 具体行为未测（`test/helper.test.js` 用 `forceCopy` 走同一条复制代码路径）；
  - U-1「子窗口聚焦时对话框的归属窗口」、U-4「UNC 下 `mkdirSync`/`copyFile` 的失败码」仍未核实（见 `docs/evidence/profile-root-migration.md`）。

---

## 7. 安全说明

- 「忽略证书问题」默认**开启**（每条连接可关闭）。开启时会传 `--ignore-certificate-errors` + `--unsafely-treat-insecure-origin-as-secure=<origin>`，**Chrome 对 TLS 证书的校验被关闭**，同一网络下的攻击者可读/改写流量。仅建议用于可信内网的自签证书站点。
- 本扩展不接触密码/凭据，不使用 `api.secrets`。
- 会**删除数据**的动作有**四个**：
  1. **删除连接**（连同该站点浏览器数据）；
  2. **清理缓存**（只删缓存类目录，保留 Cookie/登录态）；
  3. **卸载扩展**（永久删除**默认根**下的全部 profile；**外部根下的 profile 会保留在磁盘上**，需你自行清理）；
  4. **改根迁移**（迁移成功后会删除**旧根下已搬完的条目目录**；**覆盖模式下还会先删除目标根下的同名目录**——删源前经过完整性判据 C1–C5，删目标前**必须由你在覆盖确认框里逐条确认**，确认文案写明"永久删除且无法恢复"）。
     没有第五个，也不做自动清理（迁移只在**你改设置**时发生，不是后台任务）。
- **新增能力面（必须知情）**：配置了自定义根后，本扩展会**读写扩展目录之外的路径**——范围**严格限制**为**该根及其直接子目录**（`<根>\<条目名>`）；不做递归扫描根之外的任何位置，也不使用 `api.fs` 去碰外部路径（`api.fs` 的沙箱只覆盖扩展自己的 data 目录）。
- **标记文件与永不删根**：根下必须有 `.obox-webapp-root`，**缺标记时删除 / 清理 / 改名一律被拒**；任何情况下**不删除根目录本身**（只删根之下的子目录）。
