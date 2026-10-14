# Amendment 09：Chrome 经 `cmd /c start` 以孤儿进程启动（+ 迁移只走设置页只读状态、冲突自动覆盖、根目录改为目录选择）

- 类型：**机制变更（启动方式）+ 与 spec 的显式偏离（界面 / 覆盖策略）+ 宿主新字段类型的采用**
- 决策来源：用户直接指令（当前会话；含开工后追加的三轮要求）
- 影响版本：`1.0.3` → **`1.0.4`**（五处一致：`manifest.json` / `package.json` /
  `package-lock.json` 顶层 + `packages[""]` / `index.js` 的 `EXT_VERSION`）
- **所需宿主版本：obox `≥ 1.0.9`**（本版用到两种新增设置字段类型：`directory` 与 `status`；
  老宿主的行为与后果见 §5.3）
- 变更范围：`lib/chromeLaunch.mjs`（新增）、`lib/profileRoot.mjs`（5 个纯函数/常量）、
  `lib/profileLimit.mjs`（新设置键）、`helper.cjs`、`index.js`、`src/App.vue`、`src/styles.css`、
  `src/components/ConfirmOverwrite.vue`（删除）、`manifest.json`、`scripts/pack.mjs`、
  `test/*`（新增 2 个文件、改写 6 处）、`README.md`、本文件
- 落地状态：**已实现**（`node --test` 241 例全绿 / `npx prettier --check .` 全绿 / `npm run build` 成功 /
  `node scripts/pack.mjs` → `out/webapp-1.0.4.oix`；**真机验收见 §7，尚未执行**）
- 权威参照：`extensions/rdp/lib/mstscArgs.mjs`、`extensions/rdp/helper.cjs`（`startViaCmd`）、
  `extensions/rdp/index.js`（`open`）、`extensions/rdp/docs/adr/0003-mstsc-orphan-launch-via-cmd.md`、
  `extensions/rdp/test/mstscArgs.test.js`

---

## 1. 启动方式：不再 `spawn(chromeExe, args, { detached: true })`

### 1.1 现状的问题

1.0.3 的 `launch` 直接 `spawn(exe, args, { detached: true, stdio: 'ignore' })` + `unref()`，
于是任务管理器里能看见 `obox.exe → 助手 node → chrome.exe` 这条链。用户的心理模型是
"我只是打开了一个网页应用窗口"，而"关掉 obox 会不会带走它"取决于**宿主的实现细节**
（宿主结束 IPC 助手时只 `child.kill()` 直接子进程，不做树杀），不是结构上的保证。

### 1.2 决策：经 `cmd.exe /c start` 派发（与 rdp 1.0.3 逐条同源）

```js
spawn('cmd.exe', buildStartArgs(chromeExePath, args), {
  windowsVerbatimArguments: false, // 见 §1.3：**不要**照抄 cmdkey 那处的 true
  detached: true,
  stdio: 'ignore',
  windowsHide: true
})
// 参数数组：['/c', 'start', '', <chrome.exe 绝对路径>, ...<白名单参数>]
```

`cmd` 派发后立即自己退出 ⇒ Chrome 的父进程变成一条**已断开的链**：它既不是助手、也不是 obox
的后代。**成功判据 = `cmd` 退出码 0**；超时 `START_TIMEOUT_MS = 15_000`（超时先 `kill()` 掉 cmd，
不留僵尸）。

### 1.3 四个不能改的点（改了会**静默**出错，单测全绿也不代表真机对）

| #   | 点                                                                               | 为什么                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **必须传参数数组**，不能把整串命令写成一个参数                                   | Node 会为"含空格的单参数"整体再包一层引号，`cmd` 的引号消解规则会把里层引号全部吃掉 ⇒ `start` 拿到的不是我们要的 token，而 `cmd` 仍然 `exit 0`（静默走错）                                 |
| 2   | **`windowsVerbatimArguments: false`**（与同文件 `runCmdkey` 的 `true` **相反**） | `cmdkey` 用自己的土解析器（必须 `true`）；`cmd.exe` 用标准命令行解析器，Node 在 `false` 下的转义（含空白参数整体加引号）正是我们要的。改成 `true` 会让 `C:\Program Files\…` 在空格处被拆开 |
| 3   | **`start` 后的空 `""` 必须保留**                                                 | 它是窗口标题占位；没有它时 `start` 会把第一个带引号的参数**当成窗口标题**，可执行文件路径就丢了                                                                                            |
| 4   | **本模块不做任何引号/转义，也不 `trim` 参数**                                    | 原样返回交给 Node；任何自行改写都可能改变语义（URL 里的空白必须原样交给 Chrome）                                                                                                           |

### 1.4 逐参数护栏（与 rdp 的**刻意差异**）

rdp 只需检查**一个** `.rdp` 路径；Chrome 的参数是一整个白名单数组
（`--app=<url>`、`--user-data-dir=<生效根>\<净化名>`、若干开关），因此
`lib/chromeLaunch.mjs` **逐个元素**检查：

- `%VAR%`（正则 `/%[^%]*%/`）⇒ 抛错（`-32602`，`无法安全派发`）。cmd 会把它当变量展开
  （未定义 ⇒ 空串），**URL 或 profile 路径被静默改写**。只查 `args[0]` 的实现会漏掉
  `--user-data-dir=D:\%TEMP%\x`（症状：登录态被写进另一个目录）。
- 双引号 / CR / LF ⇒ 抛错；空/纯空白参数 ⇒ 抛错。
- **放行**：`&` `^` `|` `<` `>` `(` `)` `!` 与**不配对**的单个 `%`（`100% done`）——
  真机实测（转述 `extensions/rdp/docs/adr/0003` 的探针，Windows 11 build 26200）这些字符
  经 `cmd /c start` 全部原样到达目标进程。

**代价（必须知情）**：合法的**百分号编码 URL**（`…/a%20b%20c`，含 ≥2 个 `%`）会被这条护栏**拒掉**。
这是刻意取舍：放行意味着 cmd 把 `%20b%` 当变量展开、URL 被静默截断；拒绝则是可见、可解释的错误。
同理，条目名里含 `%VAR%` 的站点（净化不会去掉 `%`）也会被拒（此前 `spawn` 不经 shell，`%` 是字面量）。

### 1.5 `launch` 的契约变更：`pid` 不再有意义

| 项               | 1.0.3                                                     | 1.0.4                                                                                   |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 成功判据（助手） | `spawn` 事件的 `child.pid`                                | `cmd` 的**退出码 0**                                                                    |
| `launch` 回包    | `{ pid: number, exe, profileDir, chromeSource, summary }` | `{ pid: null, exe, profileDir, chromeSource, summary }`（字段名保留，值恒 null）        |
| 成功判据（入口） | `index.js` 的 `if (!pid) fail(…)`                         | `if (!result \|\| typeof result !== 'object') fail(…)`（helper 失败会抛错，走不到这里） |

**退出码判据的代价（用户已知情接受）**：`cmd` 退出 0 只证明"命令已派发"，**不证明 Chrome 真的起来了**。
尤其本扩展的既有行为是"同一 profile 已有实例时，第二个进程 ≤1s `exit 0` 并把参数转交既有实例"
（README §4 第 1 条）——这两件事在退出码上**不可区分**。因此文案只承诺"已派发"，绝不写"已打开窗口"。

### 1.6 与 rdp 实现的差异清单（有意保留的）

| 差异                 | rdp                                                               | webapp 1.0.4                                                                                    | 理由                                                                                                |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 目标程序路径解析     | `resolveMstscPath()`（纯函数：`%SystemRoot%\System32\mstsc.exe`） | **不新增**解析函数，复用 `helper.cjs` 现成的 `detectChrome()`（3 处固定路径 + 注册表第 4 顺位） | Chrome 的探测本身不是纯函数（`existsSync` + `reg query`）且已有一份实现；再造一份就是第二份事实来源 |
| 护栏作用对象         | 单个 `.rdp` 路径                                                  | **数组的每个元素**                                                                              | Chrome 参数是白名单数组（见 §1.4）                                                                  |
| 参数是否 `trim`      | 是（路径不该带空白）                                              | **否**（空/纯空白参数直接拒绝）                                                                 | 任何改写都可能改变 URL 语义                                                                         |
| 派发前是否存在性预检 | `existsSync(mstsc.exe)` 失败即抛                                  | `detectChrome()` 已经只返回存在的路径；**仍补一次** `existsSync(exe)`（探测与派发之间的竞态）   | 同 rdp：`start` 目标解析失败会弹框并挂住 cmd                                                        |
| 返回字段             | `{ pid: null, path, warnings }`                                   | `{ pid: null, exe, profileDir, chromeSource, summary }`（既有字段原样保留）                     | 不改既有契约                                                                                        |

---

## 2. 扩展页面不再显示迁移信息；覆盖冲突**自动覆盖**（本次唯一的语义变化）

### 2.1 用户决策

1. **扩展页面（子窗口 UI）彻底移除迁移展示**：`rootbar` 全部四态（`--migrating` / `--warn` /
   `--done` / `--browse`）与样式、`已搬 X/Y` 文案、「继续 / 放弃」按钮、扩展页里的目录浏览入口
   与手填输入框，**全部删除**。
2. **迁移改为静默自动续做**：中断后下次启动（子窗口挂载）自动续做；进度与异常**只写日志**
   （`[webapp] …` 前缀沿用既有风格）。
3. **覆盖冲突不再弹确认框**：按用户此前**已明确接受的风险**（"覆盖目标、不备份、不可恢复"）
   **自动覆盖**（先删目标同名目录、再把源搬过去）。日志里逐条记录被覆盖的条目；状态文本里
   写出"已覆盖 N 项（不可恢复）"。
4. **迁移状态改为在宿主设置页只读显示**（`webapp.migrationStatus`，`status` 类型，**不给按钮**，见 §3）。
5. **`profileRoot` 改为目录选择控件**（`directory` 类型），并在设置为空时把默认根绝对路径回填进去（见 §4、§5）。
6. **设置页改根 = 迁移的触发点**（见 §2.6）：扩展页面没有按钮之后，"用户选了新目录"由设置变更通知驱动。

### 2.2 改了什么

| 项                                                                                        | 处置                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.vue` 的 `rootbar` 四态 / 进度 / 逐条清单 /「继续」「放弃」/「浏览…」+ 手填输入框 | **删除**                                                                                                                                                                                                                                                                                                                                             |
| 覆盖确认框                                                                                | 组件 `src/components/ConfirmOverwrite.vue` **删除**；`styles.css` 的 `.overwrite__*` 一并删除                                                                                                                                                                                                                                                        |
| `src/App.vue` 的迁移函数                                                                  | 删除 `continueMigration` / `abandonMigration` / `confirmOverwrite` / `cancelOverwrite` / `browseRoot` / `submitManualRoot` / `refreshRootStatus`，**新增** `reconcileRootSilently()`（只读一次 `rootStatus` → 有未完成迁移就 `resolveRootMigration({action:'continue'})`，其余一律只写日志）                                                         |
| `styles.css`                                                                              | 删除 `.rootbar*` 与 `.overwrite__*` 全部规则（零残留）                                                                                                                                                                                                                                                                                               |
| **覆盖策略（语义变化）**                                                                  | `index.js` 新增 `autoConfirmOverwrite(intent, name)`；`reconcileIntent` 与 `startRootMigration` 在**动手之前**把冲突写成 `conflicts: { confirmedAt, confirmedBy: 'auto-overwrite', names }` 并把条目标 `overwrite: true`；**闸门结构一行没改**（`decideMigrationItem` 仍要求"确认过才允许覆盖"，只是确认来源从"用户点按钮"换成"用户预先接受的策略"） |
| 迁移状态写进设置                                                                          | 新增 `writeMigrationStatus(intent)`（值没变不写），在开始 / 逐条推进 / 完成 / 失败 / 空闲五类时机写入（见 §3）                                                                                                                                                                                                                                       |
| 默认根回填                                                                                | 新增 `backfillDefaultRoot()`（第一次连上助手后执行一次，幂等；见 §4）                                                                                                                                                                                                                                                                                |
| 迁移编排的其余部分                                                                        | **零改动**：意图文件、`effectiveRoot` 恒为旧根、`prepareRoot` 缺标记拒绝、完整性判据 C1–C5、设置值最后写入、卸载不碰外部根                                                                                                                                                                                                                           |

### 2.3 ⚠️ 语义变化与风险（单列，便于转达用户）

**变化**：1.0.3 的覆盖闸门是"**逐条列出冲突 → 用户点「覆盖并继续」→ 才允许删目标同名目录**"。
1.0.4 起这个闸门**自动通过**（`confirmedBy: 'auto-overwrite'`），迁移一旦开始就会**直接删除**目标根下
与条目同名的目录（其中的浏览器数据、登录态**永久丢失、不可恢复、无备份**）。

**为什么必须变**：用户已决定"扩展页面不显示迁移信息、不给按钮"。没有界面就无法取得逐条确认；
若保留"未确认就跳过"的行为，冲突会让迁移永久停在那里（且用户看不到任何提示）——比自动覆盖更糟。

**风险（如实登记）**：

1. **最大的一条**：`profileRoot` 指向一个**已有数据**的目录时（典型场景：用户把它指到
   `%LOCALAPPDATA%\Google\Chrome\User Data` 或另一个工具的数据目录），只要目标根下存在与本站条目
   **同名**的目录，该目录会被**静默删除**。⚠️ **标记文件挡不住这条**：`startRootMigration` 会先调
   `prepareRoot`，而它**会**在那个目录里写入 `.obox-webapp-root`（"目标根必须有标记"是硬前提，
   不是"这个根看起来像我们的"的证明）。1.0.3 时用户会在确认框里**逐条看到**这些名字，现在看不到。
2. 覆盖只在"**同名**"时发生（`decideMigrationItem` 的冲突判据是两侧都存在），不会删除根下其它目录。
3. 每一次覆盖都有两处留痕：控制台 `[webapp] 迁移已自动覆盖（不可恢复）：<名字>`，以及
   `webapp.migrationStatus` 文本里的"已覆盖 N 项（不可恢复）"。
4. **若要改成"跳过冲突项"（更保守）**，需要动的正是这三处（都在 `index.js`）：
   ① `autoConfirmOverwrite()` 的调用点（`reconcileIntent` 的逐项循环）——改成不确认、让它按
   `decideMigrationItem` 的 `skipped` 分支走；
   ② `startRootMigration` 里生成 `autoNames` / `conflicts` 的那段——不要自动把冲突标 `overwrite: true`；
   ③ 收尾判定里的 `pendingConflicts(current)` 分支——`skipped` 会让 `advanceMigrationState` 仍可写设置，
   因此**不需要**改状态机（"跳过不算失败"是既有语义）；
   另需同步 `test/rootMigration.test.js` 的 I-6 与 `test/migrationStatus.test.js` 的状态文本断言。
   ⚠️ 不要只改 ①：`startRootMigration` 的预检（②）也会把冲突标成待覆盖。

### 2.4 其余代价（如实登记）

1. **「未受管目录」警示行也下线**：缺标记时删除 / 清理 / 改名**仍然被硬拒绝**（入口侧文案原样保留），
   但用户只能从控制台看到原因。
2. **状态可见性下降**：迁移进度只在设置页的只读状态项（需要用户主动去看）与控制台日志里。
   （"改根不会自动迁移"这条代价**已由 §2.6 的触发点消除**。）

### 2.5 门禁同步（**只动被删除功能自己的断言，其余一条未削弱**）

| 测试                                                       | 处置                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/componentSource.test.js`                             | 删除 5 条针对已删功能的用例；`ConfirmOverwrite.vue` 从"模态框只能按钮关闭"矩阵里移除；**新增 4 条**：迁移展示标识符必须全部消失、静默续做存在且界面不做覆盖确认、`index.js` 的护栏一处未动、`.rootbar` 不得复活                                            |
| `test/ipcSurface.test.js`                                  | 反向门禁改为 **`NO_UI_CALLER` 白名单**（`browseRootDir` / `startRootMigration`，两者仍留在分发表里）+ **单独断言它们确实没有调用点**；`needsConfirm` 断言改为 `auto-overwrite`；设置写入的计数**按 key** 数（`profileRoot` 5 处 / `migrationStatus` 1 处） |
| `test/rootMigration.test.js`                               | **I-2** 计数按 key；**I-6** 从"未确认 ⇒ 不动手"改写为"自动覆盖，但必须留下显式确认记录 + 逐条日志"；**新增 I-10**：设置页改根 ⇒ 走同一个 `startRootMigration`，且拒绝分支不得叠开第二个迁移                                                                |
| `test/chromeLaunch.test.js`（新增）                        | 纯函数矩阵 + 源码门禁（必须 `spawn('cmd.exe', args, …)`、不得再直接 spawn Chrome、`open` 判据不得回退成 `if (!pid)`）                                                                                                                                      |
| `test/migrationStatus.test.js`（新增）                     | 状态文本矩阵 + 默认根回填矩阵 + **`planRootChangeTrigger` 矩阵（正常触发 1 条 + 4 条不触发）** + 源码门禁（回填绝不触发迁移、状态写入只写 `migrationStatus`、`readSettings` 只读 `profileRoot`、触发逻辑不在界面侧）                                       |
| `test/manifest-settings.test.js` / `test/settings.test.js` | 设置项 3 → 4 个；`profileRoot` = `directory`、`migrationStatus` = `status`；键名集合与版本钉 `1.0.4`                                                                                                                                                       |
| `test/pack.test.js` / `test/profileRoot.test.js`           | 库模块清单加 `lib/chromeLaunch.mjs`（`scripts/pack.mjs` 的 `REQUIRED_LIB` 同步）                                                                                                                                                                           |

### 2.6 设置页改根 = 迁移的触发点（补 §2.4 的缺口）

**行为**：扩展订阅 `api.settings.onChanged`；当 `key === 'webapp.profileRoot'` 且判据认为
"**用户把数据指向了另一个根**"时，走**与原来「迁移到此目录」按钮完全相同**的状态机入口
（`startRootMigration({ root })`，自动覆盖确认照旧）⇒ **静默开始迁移**，没有任何界面交互、没有按钮。
"在设置页选中新目录"因此就是**用户意图**的声明。

**判据（纯函数 `planRootChangeTrigger`，矩阵逐条有单测）**：

| 情形                                          | changed | trigger | reason                     | 处置                                           |
| --------------------------------------------- | ------- | ------- | -------------------------- | ---------------------------------------------- |
| 无进行中迁移 + 选了**另一个**根（正常触发）   | true    | true    | `changed`                  | 自动开始迁移                                   |
| 空 / 纯空白                                   | false   | false   | `configured-empty`         | 只记日志（"空 = 默认根"由扩展语义承担）        |
| 与**当前数据所在根**同路径（含大小写/尾斜杠） | false   | false   | `same-as-current`          | **什么都不做**                                 |
| 与**进行中迁移的目标根**同路径                | false   | false   | `same-as-migration-target` | 什么都不做（幂等）                             |
| 值非法（V2–V5 / 形态非法）                    | false   | false   | `configured-invalid`       | 只写日志（带不通过原因），**不改设置、不迁移** |
| 有未完成意图 + 选了别的根                     | true    | false   | `migration-active`         | **拒绝**：回写设置值 + 写状态 + 记 warn        |

**防自触发机制（选定：与"当前数据根"比较；未采用"写入侧加标记"）**，理由：

1. `api.settings.set` 的通知**投递时机不由扩展决定**（当前宿主是同步的 `stateStore.setSetting`，
   将来可能变成异步/跨窗口同步）；异步投递下"这次写入是谁发起的"根本无从判断，而
   "**值是否指向了另一个根**"是与投递时机无关的事实。
2. 扩展自己有 **5 处**写 `profileRoot`（迁移完成 / 放弃回写 / 无存量条目 / 默认根回填 /
   迁移中改根的回写）：靠"每处都记得置标志"必然漏一处，而**漏一处的后果是多跑一次迁移**。
3. 这个判据顺带把"同路径写入""非法值""迁移中改根"三种情形一起兜住（它们本来也要判）。
4. ⚠️ **比较顺序很关键**：**先比路径、再走 `normalizeRoot`**——真实默认根含 `obox` 段会被 V5
   判成非法，而"回填写的就是默认根"必须被认成 `same-as-current`（否则会误报非法并可能触发迁移）。
   对应地，`index.js` 传入的 `dataRoot` 在"默认根"情形下用已知的 `defaultRootAbs`（`info.root` 是空串，
   比不了）。

**迁移进行中再次改根的行为（已裁定）**：**拒绝**——把设置值**回写**成当前迁移的目标根（`intent.to`）、
把状态项写成"`<进度>` + `改根被拒绝：已有迁移进行中，需先完成后再改根（本次选择未生效）`"、
并记一行 warn；**不叠开第二个迁移**（既有迁移继续由 `reconcileIntent` 续做）。
回写本身不会再触发（值 == 迁移目标 ⇒ `same-as-migration-target`）。
已知小事：下一次逐条进度写入会覆盖那条提示（控制台日志保留完整记录）。

---

## 3. 迁移状态：设置页只读项 `webapp.migrationStatus`

### 3.1 形状与文本

```json
{
  "key": "webapp.migrationStatus",
  "label": "迁移状态",
  "type": "status",
  "default": "当前无未完成的迁移",
  "description": "只读：浏览器数据迁移的进度与结果（含已搬条目数、已覆盖项数与失败原因）。扩展页面不显示迁移信息；迁移在打开扩展卡片时静默续做，冲突会按已接受的策略自动覆盖（不可恢复）。"
}
```

文本由**纯函数** `lib/profileRoot.mjs` 的 `migrationStatusText(intent)` 产出（可单测），
`index.js` 的 `writeMigrationStatus(intent)` 负责写（**值没变就不写**，避免每搬一条都落盘 + 触发
`onChanged`）。样例：

| 场景                   | 文本样例                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空闲（无未完成迁移）   | `当前无未完成的迁移`                                                                                                                                    |
| 进行中（有覆盖与失败） | `浏览器数据迁移进行中：已搬 2/5；已覆盖 1 项（不可恢复）；跳过 1 项；失败 1 项（[migrate-failed] 磁盘满）；目标根 = D:\obox-webapp\profiles`            |
| 完成                   | `浏览器数据迁移已完成：已搬 5/5；已覆盖 1 项（不可恢复）；生效根 = D:\obox-webapp\profiles`                                                             |
| 放弃                   | `浏览器数据迁移已放弃：设置值已写回旧根；已搬 3/5；已覆盖 1 项（不可恢复）；当前生效根 = C:\…\chrome；已经复制到目标根的数据保留在磁盘上，需你自行清理` |

失败原因摘要上限 **80 字符**（超出截断并加 `…`），避免把整篇错误塞进设置项。

**多行渲染（已按新宿主的实现调整）**：宿主（obox ≥ 1.0.9）的 `status` 渲染会把**含 `\n` 的值按行
渲染成列表**（`src/renderer/src/extensions/settings/SettingsView.vue` 的 `statusLines()`：
非字符串值 `String()`、空值回落占位文案、首尾空行去掉），因此 `migrationStatusText()` 的输出是
**每行一条**（第 1 行 = 阶段与进度，其后是"已覆盖 N 项（不可恢复）"/"跳过"/"失败（原因）"/"目标根"），
**空闲态刻意保持单行**（单行渲染成一行文本，不出现单元素列表）。

### 3.2 与改根的隔离（硬要求）

- **键不同**：`webapp.migrationStatus` ≠ `webapp.profileRoot`；改根判定（`readSettings`）**只读**
  `profileRoot`，`test/ipcSurface.test.js` 与 `test/migrationStatus.test.js` 都有源码门禁。
- **写入点不同**：写状态只有 `writeMigrationStatus` 一处；它不写意图文件、不调对账。
- **`onChanged` 收紧**：1.0.3 的实现是"任何 `webapp.*` 键都作废体积缓存"，而迁移会**频繁**写状态 ⇒
  1.0.4 改成只对 `profileLimitMb` / `diskCacheMb` / `profileRoot` 三个真正的配置键作废缓存。

### 3.3 可见性代价

状态项需要用户**主动进设置页**才看得到（扩展页面不再显示迁移信息）；迁移过程中的即时反馈只剩
控制台 `[child-renderer:*]` 日志。这是用户"扩展页面不显示迁移"决策的直接结果。

---

## 4. 默认根回填（`profileRoot` 为空时写回真实路径）

### 4.1 做什么

设置为空（或纯空白）时，把解析出的默认根绝对路径（`<扩展 data>/chrome`）**写回**
`webapp.profileRoot`，让设置页的目录选择框显示真实路径。判据是纯函数
`planDefaultRootBackfill({ configured, defaultRoot })`（矩阵见其 JSDoc 与 `test/migrationStatus.test.js`）：

| 当前 `configured`  | 结果                                           |
| ------------------ | ---------------------------------------------- |
| 空串 / 纯空白      | **回填**默认根绝对路径                         |
| 与默认根**同路径** | 不写（`already-default`，避免多余的写 + 通知） |
| 别的自定义根       | 不写（不覆盖用户的选择）                       |
| 非法（V2–V5 不过） | 不写（不把用户那个非法值悄悄改掉）             |
| 默认根不是绝对路径 | 不写（`no-default-root`）                      |

### 4.2 什么时候写（选择与理由）

**时机 = 本进程第一次成功连上助手之后**（`ensureHelper().then(...)` 里触发一次，进程内幂等）。

- 理想是"激活瞬间"，但**宿主不向扩展暴露 data 目录路径**（`src/api/types.ts` 的 `fs` 只收相对路径，
  没有 `dataDir`/`paths` 之类的接口）⇒ 唯一来源是**助手的 cwd**（规格 §11.2：助手以
  `cwd = <扩展目录>/data` 拉起，`profileRootStatus({})` 回的 `root` 就是 `<cwd>/chrome`）。
- 而"激活瞬间为知道一个路径就拉起助手子进程"违背 `ensureHelper` 的既有纪律
  （"激活扩展不该顺手拉起子进程"，规格 §17）⇒ 折中为"通道一建立就回填"。
- **实际观感**：用户**至少打开过一次扩展卡片**（或触发任何走助手的动作）之后，设置页才显示真实路径；
  在此之前输入框是空的（默认值空串 + description 说明"空 = 默认根"）。这条已写进 README。

### 4.3 两个"防行为漂移"的细节（都是真实踩点）

1. **`treatAsDefaultRoot(resolved, defaultRootAbs)`**：回填后 `resolveEffectiveRoot` 会把值归成
   `kind:'custom'`（非空 + 绝对路径）⇒ `isDefault` 变 `false`，`rootParam()` 开始给助手传 `root`、
   卡片文案也换成绝对路径——**同一份数据的行为会随"有没有回填过"漂移**。因此 `effectiveRootNow()`
   最后判一次"值等于默认根 ⇒ 仍按默认根处理"（`isDefault: true`），行为与回填前逐字一致。
2. **`readSettings` 的提前判断（顺序很关键）**：真实默认根是
   `%APPDATA%\obox\extensions\webapp_chenzhi\data\chrome`，其中有一段就叫 `obox`，会被 `normalizeRoot`
   的 **V5**（"不能指向 obox 自己的安装目录"）判成**非法** ⇒ 若不特判，回填后每次读设置都会刷一条
   "设置 webapp.profileRoot 不合法，已忽略"。因此 `readSettings` 在**归一之后、告警之前**加了一步：
   "值 == 默认根 ⇒ 按 `kind:'default'` 处理"。同理 `planDefaultRootBackfill` 的判据**只做形状检查**
   （必须绝对路径），不套 V2–V5——否则永远回填不了。

### 4.4 绝不触发迁移

回填只写 `profileRoot` 一个键：不写意图文件、不调 `reconcileIntent`/`prepareRoot`/`migrateRootDir`，
且值经 `treatAsDefaultRoot` 仍按默认根处理。源码门禁在 `test/migrationStatus.test.js`
（逐条断言函数体里不得出现迁移动作）。

---

## 5. `webapp.profileRoot` 改为 `directory`（宿主新增的字段类型）

### 5.1 改了什么

`manifest.json` 里 `webapp.profileRoot` 的 `type`: `text` → **`directory`**。
宿主侧该类型（用户裁定的**最终交互**）= **`readonly` 输入框 + 点击输入框即弹文件夹选择器**
（另保留一个「浏览…」按钮，纯为键盘可达性），值的语义是**绝对路径字符串**。
⚠️ **"手工输入 / 粘贴路径"不是该字段的用法**（输入框只读）：代价是**不能直接粘贴** UNC / 长路径，
只能在对话框里逐级导航（先前"可编辑文本框 + 点按钮才弹框"的版本**作废**）。宿主只负责弹选择器与写回，
**不校验**目录是否存在/是否受管——校验仍由扩展侧完成（`lib/profileRoot.mjs` 的 V1–V7）。
⚠️ **由此带来一个已知后果**：输入框只读 ⇒ 用户**没有"清空回默认根"的入口**（目录对话框只能选目录、
选不出空值）。已配置过自定义根的用户想回到默认根，需要后续宿主或扩展补一个"清除"动作
（本版只登记，不实现；扩展侧的"空 = 默认根"语义一字未改）。

### 5.2 默认值：**空串**（不是绝对路径），理由如下

1. **manifest 无法表达 `<扩展 data>/chrome`**：`default` 是静态字符串，而扩展 data 目录是运行期路径
   （`userData/extensions/webapp_chenzhi/data`，调试态还不同）。写死任何绝对路径都是错的。
2. **"空串 = 默认根"是本扩展既有的唯一约定**，由唯一实现承担：
   `normalizeRoot('')` → `kind:'default'`；`helper.cjs` 的 `resolveRoot()` 把空值解析成 `<助手 cwd>/chrome`。
3. 宿主该类型的语义也允许空（`空串 / undefined = 未选择，由扩展自行决定默认目录`）。
4. description 已写明"留空 = 用默认目录（扩展数据目录下的 chrome）"，并有单测钉住。
5. 用户另外要求"设置为空时把默认根的真实路径回填进去"——那是 §4 的**回填**，不是把绝对路径写进 manifest。

### 5.3 老宿主兼容（源码级证据 + 处理）

**证据**：

- 老宿主（`≤ obox v1.0.8`）的设置字段渲染链是
  `src/renderer/src/extensions/settings/SettingsView.vue` 的
  `v-if text / v-else-if number / v-else-if boolean / v-else-if select`——**末尾没有兜底分支**，
  因此 `directory` 与 `status` 字段**都不渲染任何控件**（label 与 description 仍在）。**不崩**，但**不可用**。
- **新版宿主**（本次一起改的那个）在链尾补了兜底：`v-else` 渲染成**可编辑文本框**并
  `console.warn` 一次（`SettingsView.vue` 的"未知字段类型：回落成文本框"分支）——
  所以"认识 `directory`/`status` 类型名但还没实现渲染"的**中间版本**宿主会把它们显示成普通文本框
  （对 `status` 而言是可编辑的，但扩展下一次写状态就会覆盖，无害）。
- 宿主自己的类型注释已写明这条兼容性：`src/api/contributions.ts`——"未知类型：宿主按 `text` 兜底渲染
  （**这是本仓库新增的行为**）；…老宿主（≤ v1.0.8）在字段渲染链末尾没有兜底分支…该字段不渲染任何控件…
  扩展若要在老宿主上也有可用输入，需自行降级为 `text`"。
- 也就是说：**升级后的宿主**对未知类型有 `text` 兜底；**已经发布的老宿主（≤ v1.0.8）没有**。
- ⚠️ **宿主文档的一处不一致（不影响本扩展，只登记）**：`src/api/contributions.ts` 的类型注释仍写着
  "`directory`：目录选择控件 = **可编辑文本框** + 「浏览…」按钮"，而渲染实现与用户裁定是
  **`readonly` 输入框 + 点击即弹框**（`SettingsView.vue` 的 `directory` 分支）。以实现为准。

**处理（本次选择）**：**要求 obox `≥ 1.0.9`**（README 顶部与 §3 都写明）。老宿主上的后果如实登记：

| 老宿主上的后果         | 说明                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| 根目录**无法在界面改** | `directory` 不渲染控件；且扩展页面已按用户要求删掉手填入口 ⇒ 只能升级 obox，或用 1.0.3 版扩展的界面 |
| 迁移状态**看不到**     | `status` 同样不渲染；状态仍会写进设置存储，升级后即可看到最新一次写入的文本                         |
| 其它功能**不受影响**   | 扩展仍照常读 `profileRoot`（已配置的值继续生效；空值 = 默认根）；打开/删除/清理/迁移续做全不受影响  |
| 默认根回填**仍会发生** | 它是扩展自己写设置，与宿主是否渲染该字段无关（写进去的值升级后立刻可见）                            |

---

## 6. 门禁与证据

| 门槛                     | 结果                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `node --test`            | **241 例全绿**（1.0.3 基线 194；本版 +47：chromeLaunch 22 例、migrationStatus 22 例，其余为改写与新增）               |
| `npx prettier --check .` | 全绿                                                                                                                  |
| `npm run build`          | 成功（`ui/` 为 vite 产物）                                                                                            |
| `node scripts/pack.mjs`  | `out/webapp-1.0.4.oix`（399,701 字节 / 14 个条目；无 `data/`、无 `src/`、无 `test/`；包内 version = 1.0.4）           |
| `ui/assets/*` 扫描       | 旧迁移**标识符**（`rootbar` / `migrationText` / `continueMigration` / `ConfirmOverwrite` / `manualRoot` …）**0 命中** |

---

## 7. 真机验收步骤（**本次未执行**，发版前必做）

```powershell
# ① 点开一个站点后：Chrome 的父进程必须"查不到活进程"，且不属于 obox/助手
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Select-Object ProcessId, ParentProcessId, CommandLine
# 判据：任一 chrome.exe 的 ParentProcessId 用 Get-Process -Id 查不到；
#       且该 pid 不在 obox/助手进程集合里（对照 1.0.3：父进程是助手 node）

# ② 关掉 obox ⇒ 已打开的站点窗口仍在（本次改动的主目标）
#    步骤：点开站点 → 完全退出 obox（托盘退出）→ 站点窗口仍可交互（刷新/登录态在）

# ③ 含空格 / 中文 / 特殊字符的 URL 与 profile 路径仍能打开
#    - 条目名带空格与中文（例如「内网 系统 #1」）→ 打开成功，profile 落在同名目录
#    - 根目录配置成含空格的绝对路径（例如 D:\obox webapp\profiles）→ 打开成功
#    - 含 %VAR% 形态的输入（名字或 URL）→ **明确报错**（-32602），不静默改写路径

# ④ 同一站点重复打开的行为与 1.0.3 一致（Chrome 单实例复用 profile）
#    第二次点击 → 新窗口（默认尺寸）约 1s 内出现；控制台可看到 launch 摘要

# ⑤ 【1.0.4 新增】设置页只读状态项与默认根回填
#    - 全新安装（profileRoot 为空）→ 打开一次扩展卡片 → 设置页「浏览器数据根目录」显示形如
#      C:\Users\<你>\AppData\Roaming\obox\extensions\webapp_chenzhi\data\chrome 的真实路径；
#      同一次不应出现任何"迁移"迹象（无意图文件、状态项 = 当前无未完成的迁移）
#    - 迁移完成后状态项应显示"已完成：…；生效根 = D:\obox-webapp\profiles"

# ⑥ 【1.0.4 新增，**危险步骤：确认目标目录里没有你要留的数据再执行**】自动覆盖
#    - 造冲突：在目标根 D:\obox-webapp\profiles 下手工建一个与某条目同名的目录（放个标记文件）
#    - 触发迁移 → 预期：该目录被删除（标记文件消失）、源目录被搬过来、控制台出现
#      "[webapp] 迁移已自动覆盖（不可恢复）：<名字>"、状态项出现"已覆盖 1 项（不可恢复）"

# ⑦ 【1.0.4 新增】设置页改根 = 自动开始迁移（§2.6）
#    - 在设置页把「浏览器数据根目录」选到 D:\obox-webapp\profiles → 预期：**没有任何按钮/提示**，
#      控制台出现 "[webapp] 设置页改根 ⇒ 自动开始迁移：D:\obox-webapp\profiles"，随后逐条进度；
#      迁移完成后状态项 = "已完成：…；生效根 = D:\obox-webapp\profiles"
#    - 同一次改成**同一路径**（大小写/尾斜杠不同）→ 控制台只出现
#      "忽略 webapp.profileRoot 的这次变更（same-as-current）"，**不开始迁移**
#    - 迁移进行中再选**另一个**目录 → 预期：设置值被回写成当前迁移的目标根、状态项出现
#      "改根被拒绝：已有迁移进行中…"，**不叠开第二个迁移**
```

---

## 8. 回退方案（若真机验收 ①/② 失败，或用户否决自动覆盖）

**触发条件**（任一成立）：① 真机验收显示 Chrome 仍挂在 obox 之下；② 某些机器 `cmd.exe` 被组策略禁用；
③ 15s 超时频繁触发、用户可感知；④ 大量站点因"百分号编码 URL"被拒而打不开；⑤ 用户否决"自动覆盖"。

**回退动作（最小、可逆）**：

1. `helper.cjs` 的 `launch` 把派发段改回
   `spawn(exe, args, { detached: true, stdio: 'ignore' })` + `spawn` 事件取 `child.pid`，
   删除 `startViaCmd`；`index.js` 的判据回退为 `if (!pid) fail(…)`（旧代码可从 `v1.0.3` 取回）；
2. **保留** `lib/chromeLaunch.mjs` 与它的测试（记录了一次被否决的尝试与护栏矩阵）；
3. 界面展示层从 `v1.0.3` 取回 `rootbar` 相关模板/样式与 `ConfirmOverwrite.vue`；
   `manifest.json` 的 `type` 回退为 `text`（老宿主也有输入框）；
4. **自动覆盖**按 §2.3 第 4 条的**三处**改回"跳过冲突项"（保守方案），并同步状态项文案；
5. 版本按"另一个补丁版"发（1.0.4 已发布则发 1.0.5，**不重写已发布的 tag**）。

---

## 9. 未核实 / 待决策（**不得**当作已验证）

| #   | 项                                                                                                | 状态                                                     |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | 真的 Chrome（而非替身）经 `cmd /c start` 派发后的**父进程关系**与"关掉 obox 后窗口仍在"           | **未执行**（§7 的手工验收；纯 Node 造不出真进程树）      |
| 2   | `cmd` 派发的真机耗时分布（rdp 实测 49–905ms，Chrome 未测）与 15s 超时是否够                       | 未测                                                     |
| 3   | 企业策略禁用 `cmd.exe` 的机器上会怎样（`spawn` error ⇒ `-32603`）                                 | 未核实                                                   |
| 4   | 升级后宿主的 `directory`（只读输入框 + 点击弹选择器）与 `status` 控件在设置页的真实渲染与写回形态 | 宿主侧新增，**本次只读了实现源码**，未在真机设置页验证   |
| 5   | 老宿主（≤ v1.0.8）上这两个字段"无控件"的实际观感                                                  | 由源码推断（§5.3），未在真机复现                         |
| 6   | **设置页改根 ⇒ 自动开始迁移**（§2.6）在真机上的端到端表现（含"迁移中再改根被拒并回写"）           | **已实现并有纯函数矩阵 + 源码门禁**，但**真机未验证**    |
| 7   | 自动覆盖在"根指向真实 Chrome `User Data` 且条目同名"时的实际破坏面（§2.3 第 1 条）                | **风险已知情接受**，但未真机演练；回退方案见 §8 第 4 条  |
| 8   | 默认根回填后的"行为不漂移"在真实 `%APPDATA%\obox\…` 路径下                                        | 由纯函数矩阵 + 源码门禁覆盖；**真机未验证**（§7 步骤 ⑤） |
