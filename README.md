# webapp —— obox 网页应用扩展

把内部站点/自签证书站点当作**桌面应用**打开：用 **Chrome 的 app 模式**（`--app=<url>`，无地址栏）启动，
每个连接使用**独立的 Chrome profile**，可按连接决定是否忽略证书问题，并可限制单个站点的浏览器数据体积。

- 扩展 id：`webapp_chenzhi`（manifest `name: "webapp"` + `author: "chenzhi"`）
- 版本：`1.0.1`｜`apiVersion: 1`
- 形态：**App 卡片专用**（不贡献状态栏 / 命令 / 树 / 快捷键）
- 依赖：Windows + 已安装 Google Chrome（本扩展**不**自动回退 Edge）

> ⚠️ **界面没有操作/错误提示**（1.0.1 起，用户要求"彻底不要提示"）：子窗口里**不再有底部状态栏**，
> 新建/打开/删除/清理的结果与错误**只进开发者控制台**。因此 **R8 的"未找到 Chrome"报错在界面上看不到**——
> 点了「打开」没反应时，请打开子窗口 DevTools（或看 obox 终端里的 `[child-renderer:*]` 日志）。
> 取舍与补偿手段见 `docs/spec/amendments/05-remove-status-bar.md`。

---

## 1. 安装

1. 取 `out/webapp-1.0.1.oix`；
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
| 打开     | 以 Chrome app 模式打开该站点；profile 落在 `<扩展目录>/data/chrome/<name 净化后>`                                                                                      |
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

### 2.1 升级 / 卸载：两种完全不同的语义（重要）

| 操作                                 | 你的站点数据                                                           | 机制                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **升级 / 覆盖安装**（装新版 `.oix`） | ✅ **保留**（含 `data/chrome/**` 与其中所有登录态）                    | 宿主在覆盖安装时保留扩展运行时数据目录 `data/`（`src/main/oixCore.ts:320-336`）；含 `data/` 的包会被安装器以 `forbidden-entry` 拒绝               |
| **卸载扩展**                         | ❌ **永久删除**（整个扩展目录被递归删除，含所有站点 profile 与登录态） | `src/main/capabilities.ts:96-101` 先跑卸载钩子，`:118` 对 `<userData>/extensions/webapp_chenzhi/` 执行 `fs.rm(..., {recursive:true, force:true})` |

> `uninstall(ctx)` 钩子**不会**尝试搬运/备份 profile —— 钩子预算只有 10s，搬 GB 级目录必然失败，而失败后宿主照样全删。

**卸载前备份（可复制）**——备份**整个 `data` 目录**，它同时装着**条目库 `webapp.db`**（你建的连接列表）与 `chrome/**`（各站点登录态）。只备份 `chrome/` 会**丢掉全部条目**：

```powershell
# 整个 data：webapp.db（条目库）+ chrome/**（各站点登录态）
$src = Join-Path $env:APPDATA 'obox\extensions\webapp_chenzhi\data'
$dst = Join-Path $env:USERPROFILE ("webapp-data-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (-not (Test-Path $src)) { throw "找不到扩展数据目录：$src" }
Copy-Item $src $dst -Recurse -Force
# 校验：条目库与站点 profile 都必须备份到
"webapp.db  = $(Test-Path (Join-Path $dst 'webapp.db'))"
"chrome/    = $((Get-ChildItem (Join-Path $dst 'chrome') -Directory -ErrorAction SilentlyContinue).Count) 个站点目录"
"已备份到 $dst"
```

还原：把备份目录里的 `webapp.db` 与 `chrome/` 放回 `<扩展目录>/data/` 下同名位置即可（若只想恢复某个站点，单独放回 `chrome/<该站点的目录名>`）。

---

## 3. 设置（扩展设置页）

| 键                      | 类型                               | 默认   | 说明                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webapp.profileLimitMb` | select `0/512/1024/2048/4096/8192` | `2048` | **单站点数据体积上限**（MB）。`0` = 不检查、不拦截。超过上限时，点「打开」会**先拦下**并给出「清理缓存（保留登录态）」/「仍然打开」两个动作                                                                     |
| `webapp.diskCacheMb`    | select `-1/0/128/512/1024`         | `-1`   | 传给 Chrome 的 `--disk-cache-size`。**`-1` = 禁用磁盘 HTTP 缓存**（磁盘最省，代价是每次打开都要重新下载静态资源）；`0` = 不限制；正数 = 仅"单条准入阈值 ≈ cap/8" + 下次启动时清理超限缓存（**不是运行期上限**） |

体积预检的缓存 TTL 为 **60 秒**（过期 / 手动强制 / 清理后 / 改名或删除后 / 启动后 / 设置变更都会失效）；量体积失败时**降级放行**（不因为量不出来就打不开）。

---

## 4. 已知行为（真机实测）

1. **同一站点已打开时，新的窗口尺寸/位置/语言等设置一律不生效** —— Chrome 会把第二次启动并入既有实例，第二次进程约 1s 内 `exit 0`；`--app=<url>` 会被转发并**新开一个完全重叠的默认尺寸窗口**（不是聚焦已有窗口）。想生效请先关闭该站点的浏览器窗口。这也是"**每条连接必须独立 profile**"的原因：不独立就无法给不同站点不同的尺寸/语言。
   > 这条提示原本有**三处**落点（状态栏成功文案 / 高级选项说明行 / 本 README）。
   > 1.0.1 去掉状态栏后**只剩两处**：新建-编辑模态框的「高级选项」折叠区说明行 + 本小节。
   > 界面上也不再有任何操作/错误提示（含 R8 的"未找到 Chrome"），诊断信息只在开发者控制台。
2. **只有 `--ignore-certificate-errors` 能过证书错误**；`--unsafely-treat-insecure-origin-as-secure` 只把 origin 当作安全上下文，**单独使用仍是证书错误页**。
3. **禁用 HTTP 磁盘缓存 ≠ 禁用 Service Worker / CacheStorage**：用了 Service Worker 的站点仍可能在 profile 内缓存内容并增长，这部分**不在清理白名单**里（删了会破坏站点离线/登录相关行为）。
4. **profile 体积地板 ≈17 MB**（一次短会话）；会话超过约 1 分钟会额外下载 **≈40 MB 的 `optimization_guide` 模型**（不受缓存参数管辖）；**`BrowserMetrics` 每次启动 +4 MB**（同一 profile 反复打开会累积，已列入清理白名单）。
5. **删除连接时若该站点的 Chrome 窗口还开着**，profile 目录被占用会导致删除失败（Windows 上不存在 `SingletonLock` 这类"锁文件"，判据是**尝试删除/改名并捕获失败**）。删除确认框会**提前**提示"请先关闭窗口"或"该站点还没有浏览器数据"（来自一次只读的 `profileInfo` 探测）；删除真失败时的错误**只进控制台**（1.0.1 起界面无提示）。
6. 关闭最后一个 app 窗口后约 **0.8 秒**，Chrome 的 browser 与全部子进程退出，**无托盘/后台残留**。

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
manifest.json        扩展清单（name/displayName/author/apiVersion/contributes）
index.js             扩展入口：App 卡片注册 + 消息路由（list/save/remove/open/probe/profileSize/cleanCaches）+ install/uninstall 钩子
helper.cjs           纯 Node 助手（api.ipc stdio JSON-RPC）：Chrome 探测、启动、profile 体积统计、
                     只清缓存、目录改名/删除（参数白名单校验也在这一层）
lib/chromeArgs.mjs   命令行构造（固定参数 + 白名单开关 + 证书参数 + origin 推导 + launch 摘要脱敏）
lib/nameSanitize.mjs name 净化（非法字符/Windows 保留名/尾点空格/长度/大小写去重）
lib/profileLimit.mjs 体积上限、缓存白名单/保留清单、深度 2 判定、TTL、设置档位与文案（单一事实来源）
lib/entryFields.mjs  两个下拉的枚举（LANG_VALUES / SCALE_VALUES）、URL 校验、布尔归一
lib/webapp.mjs       条目归一/校验/库行互转（含 §12.3 的全部字段级文案）
src/                 Vue 界面源码（App.vue + components/* + fields.js + bridge.js + theme.js + styles.css）
ui/                  界面构建产物（进包）
scripts/pack.mjs     打包 .oix（显式排除 data/、out/、node_modules/、.git/、src/、docs/、test/、scripts/）
test/                node --test 单测
out/                 打包产物（不进包、不提交）
```

### 6.2 门槛（提交前必须全绿）

```powershell
cd extensions/webapp
node --test                    # 单元测试
npx prettier --check .         # 代码风格
npm run build                  # 构建 ui/
cd ../..
node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json
```

### 6.3 同步纪律（把构建产物同步到已安装目录时）

只覆盖这五类分发文件：`ui/`、`lib/`、`index.js`、`helper.cjs`、`manifest.json`。
**绝不动 `data/`**（`data/webapp.db` 与 `data/chrome/**` 是使用者的条目库与登录态）。

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
- Chrome 窗口开着时 `cleanCaches` 的失败分布未测。

---

## 7. 安全说明

- 「忽略证书问题」默认**开启**（每条连接可关闭）。开启时会传 `--ignore-certificate-errors` + `--unsafely-treat-insecure-origin-as-secure=<origin>`，**Chrome 对 TLS 证书的校验被关闭**，同一网络下的攻击者可读/改写流量。仅建议用于可信内网的自签证书站点。
- 本扩展不接触密码/凭据，不使用 `api.secrets`。
- 会**删除数据**的动作只有三个：**删除连接**（连同该站点浏览器数据）、**清理缓存**（只删缓存类目录，保留 Cookie/登录态）、**卸载扩展**（永久删除全部 profile）。没有第四个，也不做自动清理。
