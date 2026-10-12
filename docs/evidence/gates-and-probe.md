# 证据留档：门槛、打包与真机探针（webapp 扩展 1.0.0）

> 本文件由协调者（父代理）在实现过程中独立采集，未依赖实现代理自述。时间均为本机本地时间。

## 1. 质量门槛（协调者独立执行）

| 门槛 | 命令 | 结果（时间） |
|---|---|---|
| 单元测试 | `node --test`（在 `extensions/webapp` 内） | 22:46:21 → tests 8 / pass 5 / fail 3（初始红）<br>22:46:40 → 23 / 16 / 7<br>22:51:38 → **23 / 23 / 0** ✅<br>22:57:40 → fail 0 ✅<br>23:0x → fail 1/2（迭代中：新增 pack/manifest-settings/settings/chromeArgs/ipcSurface）<br>**收尾 → tests 106 / pass 106 / fail 0 ✅** |
| 代码风格 | `npx prettier --check .` | 22:56:41 → **exit 1**（10 文件）<br>22:57:40 → **exit 0** ✅<br>**收尾 → exit 0「All matched files use Prettier code style!」✅** |
| 清单校验 | `node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json` | 22:42 / 22:52 / 22:56 / 22:58 / **收尾 → 0 error / 0 warning，exit 0** ✅ |
| 界面构建 | `npm run build` | 22:56:55 → `ui/index.html` 560 B、`index-BymUoBCF.js` 100,747 B、`style-CpW7mQvU.css` 9,817 B ✅<br>**收尾 → `ui/index.html` 0.56 kB、`index-B9RBvIgX.js` 101.65 kB、`style-CpW7mQvU.css` 9.82 kB ✅** |

**交付前已复跑并全绿**（106/106、prettier exit 0、build 成功、manifest 0 error）。

## 2. 打包产物（协调者独立解包核对）

```
node scripts/pack.mjs   →  out/webapp-1.0.0.oix（244,074 字节，11 个条目），exit 0

根级条目：manifest.json、helper.cjs、index.js         （扁平布局，manifest 在 zip 根）
一级目录：lib(5)  ui(3)
危险项检查：包内无 data/                              ✅（含 data/ 会被宿主以 forbidden-entry 拒装）
未进包（符合预期）：src/、test/、scripts/、docs/、node_modules/、out/
```

> **产物时间戳纪律**：每次改完源码必须 `npm run build` **再** `node scripts/pack.mjs`，
> 否则 `out/*.oix` 会与源码不一致（本目录曾出现过"22:58 的旧产物带 `index-BymUoBCF.js`、
> 而新构建是 `index-DK0gm9jk.js`"的情况）。当前产物：`ui/assets/index-B9RBvIgX.js`（含票 07 接线层）。

### 2.1 接线层证据（票 07 / R17 的"每个方法都能被界面调到"）

`test/ipcSurface.test.js` 是防复发门禁，两个方向都断言：

- **正向**：`src/**` 里 `callExtension('x', …)` 用到的每个 `x`，`index.js` 必须有 `case 'x'`
  （曾出现过"界面已接线、入口还是骨架"→ 点「新建」得到 `未知方法: save`）；
- **反向**：`index.js` 分发的每个方法都要有界面调用点（防死代码）。

当前分发表（恰好 8 个，与规格 §11.1 一致）：
`list` / `save` / `remove` / `open` / `probe` / `profileInfo` / `profileSize` / `cleanCaches`。

同文件还断言：`api.settings` 真的读了 `webapp.profileLimitMb` 与 `webapp.diskCacheMb`、
真的产出 `[profile-over-limit]` 与 `[profile-size-failed]`、真的建了
`CREATE UNIQUE INDEX … (name COLLATE NOCASE)`、改名/删除分别衔接 `moveProfile`/`removeProfile`
且占用文案**不硬编码** `journal.baj` 之类的文件名。

## 3. 真机 Chrome 行为探针（Chrome 154.0.8037.98，临时 profile）

| 项 | 结论 | 关键证据 |
|---|---|---|
| app 模式 | **生效** | 可见窗口 class `Chrome_WidgetWin_1`，标题=页面标题（无 " - Google Chrome" 后缀）；另有隐藏的 `Chrome_WidgetWin_0` |
| 窗口参数 | **精确生效** | `--window-size=600,400 --window-position=120,140` → `GetWindowRect` = `120,140,720,540`（600×400）；`--start-maximized` → `zoomed=True` |
| 证书开关 | `--ignore-certificate-errors` **能过自签/过期证书**；`--unsafely-treat-insecure-origin-as-secure` **单独不能** | DevTools `/json/list`：错误页 title=`隐私设置错误` → 正常页 title=域名 |
| 同 profile 二次启动 | **进程级参数一律被忽略**；`--app` 会转发并**新开一个完全重叠的默认窗口** | 第二次进程 1s 内 `exit 0`；browser 命令行一字未变；新窗口仍 600×400 @100,100，`navigator.language` 仍 zh-CN |
| profile 占用 | Windows **没有** `SingletonLock/SingletonCookie/SingletonSocket` | 实际为顶层 `lockfile`（独占，连读都失败）+ ~30 个 LevelDB `LOCK` + 隐藏消息窗口；运行期**整目录删除失败**（`IOException ... 'journal.baj' ... being used by another process`）、**改名失败**（access denied），但**删目录内单文件成功** → 判据必须是"尝试删除/改名并捕获失败" |
| 关窗后进程 | 最后一个 app 窗口关闭后 **~0.8s** browser + 全部子进程退出，无托盘/后台残留 | 按 PID 对比，关闭前后列表 |
| `--disk-cache-size` | **不限制单次会话总量**；`-1` 才真正禁用 | 20 MB cap + 300 MB 流量 → `Default\Cache` 301.998 MB；80s 时间序列与干净退出均不下降；`-1` → 0 字节 0 文件；`0` → 等同不限；cap=1 MB 时单条 >128 KiB 进不了缓存（实为"单条准入阈值 ≈ cap/8"）；**超限清理只在下次启动发生且为清空式**（cap=10 MB、202 MB → 重启后 1.567 MB；两个对照证明非"每次重启都清"） |
| profile 占用排行 | 短会话地板 **≈17 MB** | 会话 >约 1 分钟追加 **≈40 MB** `optimization_guide_model_store`（`model.tflite` 35 MB，不受缓存参数管辖）；`BrowserMetrics` **每次启动 +4 MB**；`GrShaderCache` ≈4.5 MB；`Default\Cache` 是唯一可被流量撑大的部分；`IndexedDB`/`Local Storage`/`Service Worker`/`Code Cache` 在普通站点下 ≤0.04 MB |

### 3.1 未核实（不得当作已核实）

1. `--disable-gpu` 是否同属"仅首个进程读取"（仅有间接证据）；
2. `--force-device-scale-factor` 未做真机验证；
3. `--disk-cache-size` 超限是"清空"还是"裁剪到上限"未区分；
4. GB 级 profile 的扫描耗时未测；
5. Chrome 窗口开着时 `cleanCaches` 的失败分布未测。

### 3.2 环境注意事项（复跑必读）

本 DSH 会话的 `pwsh` 工具**会在每条命令结束时回收其子进程**：`Start-Process` 起的 Chrome 在命令结束后被整树回收（用户原有的 11 个 chrome 进程 PID 全程未变，可反证不是 Chrome 自行退出）。
因此真机实验必须把"**启动 → 观测 → 按 PID 清理 → 删临时 profile**"写在**同一条命令**内；跨命令持有实例只能靠 `run_in_background` 的托管 job。

### 3.3 探针清理证据

`tmp/chrome-probe`（378.5 MB）与 `tmp/chrome-probe2` 已删除；本次启动的 chrome 进程 0 残留；用户原有 11 个 chrome PID 全在；端口 8731/8733 已关闭；`git status` 除 `.spec-workflow/`（流程产物）外干净。

## 4. 宿主侧事实（本仓库源码）

| 事实 | 位置 |
|---|---|
| 覆盖安装保留扩展运行时数据目录 `data/`（升级不丢库与 profile） | `src/main/oixCore.ts:32-35`、`:320-336` |
| 包内含 `data/` 被拒（`forbidden-entry`，原文案"升级时由宿主保留"） | `src/main/oixCore.ts:168-176` |
| 卸载先跑钩子、再递归删除整个扩展目录 | `src/main/capabilities.ts:96-101`、`:118` |
| 卸载钩子超时 10s | `src/main/hookBridge.ts:16` |
| `api.sqlite` 库落 `<userData>/extensions/<id>/data/` | `src/main/sqlite.ts:34-37` |
| stdio 助手用 Electron 二进制 + `ELECTRON_RUN_AS_NODE=1`，cwd = `<扩展目录>/data` | `src/main/ipcCore.ts:612-627`、`src/main/ipc.ts:452-471` |
| 宿主 `SettingField` 无 `min`/`max` ⇒ 数值设置只能用 select 枚举 | `src/api/contributions.ts:76-89` |
