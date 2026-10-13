# 证据：profile 根目录可配置 + 自动迁移（`webapp` 1.0.3 / amendment 08）

- 对应 amendment：`docs/spec/amendments/08-profile-root.md`
- 对应规格：`.spec-workflow/webapp-profile-root/spec.md`（obox 仓库，未跟踪）
- 日期：2026-10-13
- 分支/版本：`extensions/webapp` 的 `master`，`webapp 1.0.2` → **`1.0.3`**

> ⚠️ **状态说明（诚实登记）**：本文件里 **A30–A44 的真机步骤已写完，但真机执行尚未全部完成**——
> 需要安装态 obox（`extId = webapp_chenzhi`）、一个具备 `openDirectory` 能力的宿主构建（A44）、
> 以及一个老版本宿主（A42）。**已自动化的部分**（`node --test` 的 194 例）逐条对应在下表的
> 「自动化覆盖」列，**未执行的真机项**标为「⏳ 待真机」，请勿当作已核实。

---

## 1. U-5：`api.fs` 能否在 data 目录写**点文件**（`.pending-move-root.json`）？

**结论：能。** 因此意图文件由**扩展侧**经 `api.fs` 读写（照 spec §9.4 D4 的原设计），
**不追加 amendment 09**，**不新增**助手侧的 `readRootIntent` / `writeRootIntent` / `clearRootIntent`。

### 1.1 查法（不安装到 `%APPDATA%`，一条命令内）

按 spec §21 U-5 的查法，但为了避免动到真实安装目录，改为**三层静态核实 + 一层真实文件系统往返**：

1. **路径规则层**：直接 import **宿主真实的** `validateRelPath`（`src/main/sqliteCore.ts`）判点文件是否被排除；
2. **IPC 层**：读 `src/main/fs.ts` 的 `resolvePath` / `fs:write-file` handler；
3. **渲染层**：读 `src/renderer/src/core/host.ts` 的 `buildFsApi`（是否有额外白名单）；
4. **文件系统层**：在一个**模拟的** `<…>/extensions/webapp_chenzhi/data` 目录里复刻
   `fs:write-file` / `fs:exists` / `fs:remove` 的语义，跑 `writeFile → rename → readFile → remove` 往返。

### 1.2 原始输出（`node u5-probe.mjs`，2026-10-13）

```text
validateRelPath(".pending-move-root.json") => ".pending-move-root.json"  [OK 未被排除]
validateRelPath(".pending-move-root.json.tmp") => ".pending-move-root.json.tmp"  [OK 未被排除]
validateRelPath("webapp.db") => "webapp.db"  [OK 未被排除]
validateRelPath("../x") => THROW 路径不能包含 .. 或空路径段  [按设计拒绝]
validateRelPath("C:\\x") => THROW 路径必须是相对路径，不能是绝对路径  [按设计拒绝]
validateRelPath("a/../b") => THROW 路径不能包含 .. 或空路径段  [按设计拒绝]
writeFile(C:\Users\<me>\AppData\Local\Temp\obox-u5-probe\extensions\webapp_chenzhi\data\.pending-move-root.json.tmp) => ok=true
renameSync(.tmp -> final) => ok=true
readFile => {"schema":1,"kind":"profile-root-move","phase":"pending"}
JSON.parse => {"schema":1,"kind":"profile-root-move","phase":"pending"}
exists(.pending-move-root.json) => true
remove => exists=false
```

> 被拒的三例是**对照样本**：证明 `validateRelPath` 的规则是**精确的**（只挡绝对路径 / `..` / 空段），
> 而不是"把所有东西都放过"——否则"点文件可写"这个结论就没有说服力。

### 1.3 代码依据（三层都放行）

| 层 | 位置 | 事实 |
| --- | --- | --- |
| 主进程路径校验 | `src/main/sqliteCore.ts:26-33` | `validateRelPath` 只拒**绝对路径 / 盘符 / `..` / 空路径段**；**对文件名是否以 `.` 开头没有任何规则** |
| 主进程 fs handler | `src/main/fs.ts:17-19`、`:73-90` | `resolvePath = join(dataDir, validateRelPath(rel))`；`fs:write-file` 还会 `mkdir(dirname(p), { recursive: true })` ⇒ 点文件与普通文件**同路径处理** |
| 渲染进程 api.fs | `src/renderer/src/core/host.ts:586-595` | `buildFsApi` 只把 `{ ok:false }` 转成 `throw`，**没有额外白名单/后缀规则** |
| 类型声明 | `src/api/types.ts:326-341` | `readFile` / `writeFile` / `exists` / `remove` 都收 `rel: string`，无点文件限制 |

### 1.4 如实登记的唯一缺口：`api.fs` **没有 `rename`**

`api.fs` 只提供 `readFile / writeFile / readDir / exists / remove / watch`，**没有 rename**
（`src/api/types.ts:326-341`）。因此意图文件**无法**用 spec 原文的"临时文件 + 原子 rename"写入。

**实现口径（已在代码注释与 amendment 08 §7 写明）**：

1. 先写 `<data>/.pending-move-root.json.tmp`，再写 `<data>/.pending-move-root.json`（两步写）；
2. 读侧对不完整 JSON **容错**：`JSON.parse` 失败 / `schema`/`kind` 不匹配 ⇒ 视为"无迁移"
   （`index.js` 的 `readRootIntent` + `lib/profileRoot.mjs` 的 `isMigratableIntent`）。

**语义影响**：读到的**永远**是"完整的 JSON 或什么都没有"，只是原子性由 `rename` 降级为"两次写 + 容错读"。
最坏情况是断电时正式文件内容不完整 ⇒ 下次启动**看不到迁移意图**（不会误当作"迁移已完成"，
因为生效根在"无意图"时取设置值 —— 而设置值**只在迁移全部完成后**才写入，此时数据确实已在新根）。

---

## 2. 门槛输出（自动化，可复跑）

### 2.1 `node --test`（基线 131 → **194 例**，全绿）

```text
$ cd extensions/webapp; node --test
ℹ tests 194
ℹ suites 0
ℹ pass 194
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10431.4409
```

新增/同步的门禁文件：

```text
test/profileRoot.test.js     （新增，27 例）P-1..P-16（含 P-14b：本模块不得 import 任何 node: 内建）
test/rootMigration.test.js   （新增，10 例）I-1..I-9 + 编排状态机串跑
test/helper.test.js          （131+ 例中 +7；真实子进程集成测）
test/ipcSurface.test.js      （方法集合 8 → 12 + 四条数据安全门禁）
test/manifest-settings.test.js（字段 2 → 3；五处版本 = 1.0.3）
test/settings.test.js        （SETTING_KEYS 加入 profileRoot）
test/chromeArgs.test.js      （+4：两种 --user-data-dir 形态）
test/componentSource.test.js （+9：迁移状态行 / 覆盖确认框 / 两条确认路径 / 降级文案 / 动态卡片文案）
test/pack.test.js            （REQUIRED_LIB 加入 lib/profileRoot.mjs）
```

### 2.2 `npx prettier --check .`（exit 0）

```text
$ npx prettier --check .
Checking formatting...
All matched files use Prettier code style!
```

### 2.3 `npm run build`

```text
$ npm run build
vite v7.3.7 building client environment for production...
transforming...
✓ 26 modules transformed.
../ui/index.html                   0.56 kB │ gzip:  0.43 kB
../ui/assets/style-BmzGBtmu.css   10.51 kB │ gzip:  2.41 kB
../ui/assets/index-DruDUmUk.js   113.09 kB │ gzip: 42.75 kB
✓ built in 370ms
```

### 2.4 `node scripts/pack.mjs` → `out/webapp-1.0.3.oix`

```text
$ node scripts/pack.mjs
已打包: …/out/webapp-1.0.3.oix（<字节数> 字节，<条目数> 个条目）
条目: manifest.json, index.js, helper.cjs, lib/…, ui/…
```

（逐字输出与条目清单见 §3 的核对表——打包会重新生成，以现场输出为准。）

### 2.5 `helper.cjs --selftest`（exit 0，未启动 Chrome）

```text
$ node helper.cjs --selftest
[webapp-helper] selftest 通过（临时目录 C:\…\obox-webapp-selftest-…，未启动 Chrome；
缓存白名单 10 项、保留清单 19 项、TTL 60s）
# exit 0
```

`--selftest` 新增的第 ⑩ 组断言（默认根不变 + 自定义根）：

```text
[webapp-helper] [profile-root-unmarked] 目录 …\自定义根 不是本扩展管理的目录（缺少 .obox-webapp-root），已拒绝清理
[webapp-helper] 清理缓存 站点C：删除 1 个目录（Default/Cache），释放 128 字节
[webapp-helper] 迁移 迁移条目：done（files=3 bytes=525 跨卷=false 覆盖=false）
[webapp-helper] 迁移 迁移条目：done（files=3 bytes=525 跨卷=true 覆盖=false）
[webapp-helper] 迁移 冲突条目：overwritten（files=3 bytes=525 跨卷=false 覆盖=true）
```

### 2.6 源码门禁（本仓库自带的"提交前必须全绿"清单）

```powershell
cd ../..
node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json
```

（输出见 `docs/evidence/gates-and-probe.md` 的对应小节。）

---

## 3. 打包产物核对（`out/webapp-1.0.3.oix`）

> 下面的清单与校验命令**逐条可复跑**；`<…>` 处填现场输出。

| 核对项 | 期望 | 现场结果 |
| --- | --- | --- |
| 产物名 | `out/webapp-1.0.3.oix` | ⏳ 以现场输出为准 |
| 包内 `manifest.json` 的 `version` | `1.0.3` | ⏳ |
| **无 `data/`** 条目 | 必须 | ⏳（`pack.mjs` 有硬闸门 + 回读自检） |
| **无 `src/`** 条目 | 必须 | ⏳（同上） |
| 含 `lib/profileRoot.mjs` | 必须（`REQUIRED_LIB`） | ⏳ |
| `ui/assets/*.css` 含新界面要素 | `.rootbar` / `.overwrite__list` | ⏳ |
| `ui/assets/*.js` 含新方法名 | `rootStatus` / `startRootMigration` / `resolveRootMigration` / `browseRootDir` / `openDirectory` | ⏳ |
| 包内**无** `test/`、`scripts/`、`docs/` | 必须 | ⏳ |

复跑命令：

```powershell
cd extensions/webapp
npm run build
node scripts/pack.mjs
# 条目清单由 pack.mjs 打印；下列命令做二次核对
$bytes = [System.IO.File]::ReadAllBytes('out/webapp-1.0.3.oix')
$text  = [System.Text.Encoding]::UTF8.GetString($bytes)
"含 data/ 条目 = $($text -match '(?m)^data/')"      # 期望 False
"含 src/  条目 = $($text -match '(?m)^src/')"       # 期望 False
$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
"manifest version = $($manifest.version)"            # 期望 1.0.3
Select-String -Path ui/assets/*.css -Pattern '\.rootbar|\.overwrite__list' | Measure-Object | % Count
Select-String -Path ui/assets/*.js  -Pattern 'rootStatus|startRootMigration|resolveRootMigration|browseRootDir|openDirectory' | Measure-Object | % Count
```

---

## 4. 真机验收（A30–A44）

> 全部在**安装态**（`extId = webapp_chenzhi`）执行。调试态 id 是 `webapp`、数据目录也不同，
> **不能用调试态代替**（README §1 已记录这个坑）。

### A30 默认根零迁移（存量用户不受影响）— ⏳ 待真机

```powershell
# 0. 装 1.0.3，把 webapp.profileRoot 留空
# 1. 打开某站点并登录
$data = Join-Path $env:APPDATA 'obox\extensions\webapp_chenzhi\data'
"chrome/<名> 存在   = $(Test-Path (Join-Path $data 'chrome\<名>'))"          # 期望 True
"无迁移意图文件     = -not (Test-Path (Join-Path $data '.pending-move-root.json'))"  # 期望 True
```

判据：目录仍在 `<data>/chrome/<名>`；**没有** `.pending-move-root.json`；`open` 的日志摘要里
`profile=chrome/<名>`；界面顶部**没有**迁移状态行。

**自动化覆盖**：`test/helper.test.js` 的默认根用例（既有 6 个用例零修改通过）+ `test/chromeArgs.test.js`
的 `userDataDirArg('内网') === '--user-data-dir=chrome/内网'`。

### A31 改根自动迁移成功（同卷）— ⏳ 待真机

```powershell
$data = Join-Path $env:APPDATA 'obox\extensions\webapp_chenzhi\data'
# 0. 设置 webapp.profileRoot = D:\obox-webapp\profiles，等迁移完成
$root = 'D:\obox-webapp\profiles'
"目标目录存在       = $(Test-Path (Join-Path $root '<名>'))"                     # 期望 True
"Cookies 存在       = $(Test-Path (Join-Path $root '<名>\Default\Network\Cookies'))" # 期望 True
"标记文件存在       = $(Test-Path (Join-Path $root '.obox-webapp-root'))"        # 期望 True
"旧根下已消失       = -not (Test-Path (Join-Path $data 'chrome\<名>'))"          # 期望 True
"意图文件已删除     = -not (Test-Path (Join-Path $data '.pending-move-root.json'))" # 期望 True
#[设置页] webapp.profileRoot 的值 = D:\obox-webapp\profiles                     # 期望 相等
```

判据附加项：**再次打开仍是已登录状态**。

**自动化覆盖**：`test/helper.test.js` 的 `migrateRootDir` probe→move 用例（同卷 rename）+
`--selftest` 的第 ⑩ 组。

### A32 迁移中断后续做 — ⏳ 待真机

1. 迁移进行中**杀掉 obox 进程**（或把目标盘写保护制造 `failed`）；
2. 重新启动 obox → 打开扩展界面。

判据：界面顶部显示「正在迁移浏览器数据：已搬 X/Y」+「继续」「放弃」；点「继续」后接着搬完；
**已搬完的条目内容未被二次覆盖**（先记 sha256 清单，续做后比对）。

**自动化覆盖**：`test/helper.test.js` 的"目标存在、源已不存在 ⇒ done"用例（断电续做的常见形态）+
`test/profileRoot.test.js` 的 `advanceMigrationState`（`pending→running→done`、`failed` 阻塞）。

### A33 取消覆盖 ⇒ 跳过且零改动 — ⏳ 待真机（自动化已覆盖核心判据）

1. 在目标根里**预先手工建**一个与某条目同名的非空目录；
2. 发起迁移 → 在覆盖确认框里点「取消」。

```powershell
# 先记目标内容的哈希
Get-ChildItem 'D:\obox-webapp\profiles\<名>' -Recurse -File | ForEach-Object {
  "$($_.FullName) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)"
} | Set-Content $env:TEMP\before.txt
# 点「取消」后重算，比对
Get-ChildItem 'D:\obox-webapp\profiles\<名>' -Recurse -File | ForEach-Object {
  "$($_.FullName) $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)"
} | Set-Content $env:TEMP\after.txt
Compare-Object (Get-Content $env:TEMP\before.txt) (Get-Content $env:TEMP\after.txt)   # 期望无差异
```

判据：该条目进 `skipped`（`reason='未确认覆盖'`）；**逐字节未变**；源仍完整；无冲突条目正常搬完。

**自动化覆盖**：`test/helper.test.js` 的"未确认 ⇒ skipped 且两侧逐字节未变"用例
（`test/rootMigration.test.js` 的 I-6 还钉住"未确认时**不进入**逐目录搬运"）。

### A34 缺标记拒删（核心安全用例） — ⏳ 待真机（自动化已覆盖判断与字节不变）

```powershell
# 0. 把 webapp.profileRoot 指向 %LOCALAPPDATA%\Google\Chrome\User Data（真实 Chrome profile）
$root = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
"无标记文件 = -not (Test-Path (Join-Path $root '.obox-webapp-root'))"   # 期望 True
# 1. 记 sha256 清单（抽样：Default\Preferences、Default\Network\Cookies、Default\Login Data）
# 2. 在扩展里新建一条与真实 profile 子目录同名的 webapp 条目 → 点「删除」
```

判据：删除**被拒绝**，文案「该目录不是本扩展管理的目录：删除与清理已被拒绝」；
sha256 清单**逐字节未变**；**库行也不删**（刷新后条目仍在）。

**自动化覆盖**：`test/helper.test.js` 的"缺标记拒删 / 拒清理 / 拒改名（自定义根），且一个字节都没动"
（含 Cookies 的 sha256 前后比对）。

### A35 永不删根 — ⏳ 待真机（自动化已覆盖）

判据：删除**全部**条目 + 清理全部缓存之后，根目录本身仍存在、`.obox-webapp-root` 仍在、
根下的非条目目录与文件**未被触碰**。

**自动化覆盖**：`test/helper.test.js` 的「永不删根」用例（空串 / `.` / `..` / `.trash` / `a/b` /
`C:\` / `..\..` 七种越界名全部 `-32602`，且 `marker.txt` 与 `not-an-entry/` 未被触碰）。

### A36 卸载后外部根保留 — ⏳ 待真机

```powershell
$data = Join-Path $env:APPDATA 'obox\extensions\webapp_chenzhi'
$root = 'D:\obox-webapp\profiles'
# 0. 记根下的文件数与总字节
$before = (Get-ChildItem $root -Recurse -File | Measure-Object -Property Length -Sum)
# 1. 卸载扩展
"扩展目录已消失 = -not (Test-Path $data)"     # 期望 True
$after = (Get-ChildItem $root -Recurse -File | Measure-Object -Property Length -Sum)
"文件数一致 = $($before.Count -eq $after.Count)"        # 期望 True
"字节数一致 = $($before.Sum -eq $after.Sum)"            # 期望 True
```

判据附加项：README / Release / 设置项 description 的**对照段**与"外部根需自行清理"文案都在。

**自动化覆盖**：`test/ipcSurface.test.js` 的卸载语义门禁（钩子里没有搬移/删除数据的调用、
两句话字面量存在、只允许删意图文件）+ `test/manifest-settings.test.js` 的 description 断言。

### A37 体积上限在自定义根下仍正确 — ⏳ 待真机

判据：往 `<根>/<名>` 塞一个 > 上限的大文件 → 点「打开」被拦截，模态框数字与 `du` 实测一致；
「清理缓存并打开」后 Cookie 的 sha256 **不变**、白名单缓存目录消失。

**自动化覆盖**：`test/helper.test.js` 的自定义根体积/清理用例。

### A38 清理全部缓存（自定义根）— ⏳ 待真机

判据：遍历的是**自定义根**下的条目（不是默认根）；`cleaned` 与实际删除集合一致；
默认根（若仍有残留目录）**未被触碰**。

**自动化覆盖**：`test/helper.test.js` 的 `cleanCaches` 全局遍历用例（自定义根）。

### A39 同名改名在自定义根下仍可用 — ⏳ 待真机

判据：目录在**新根内**被改名；内容一致；再次打开仍是同一登录态；`.pending-move.json` 正常创建/清理。

**自动化覆盖**：`test/helper.test.js` 的 `moveProfile` + root 用例（含缺标记拒绝）。

### A40 跨盘迁移的真实耗时与完整性 — ⏳ 待真机

```powershell
# C 盘（默认根）→ D 盘（自定义根），用一个 GB 级 profile
$root = 'D:\obox-webapp\profiles\<名>'
"文件数 = $((Get-ChildItem $root -Recurse -File).Count)"
"字节数 = $((Get-ChildItem $root -Recurse -File | Measure-Object Length -Sum).Sum)"
# 与迁移前的源对比：两者都必须 ≥ 源的 95%
```

判据：完成后文件数与字节 ≥ 源 95%、`Preferences`/`Cookies` 存在、可正常打开且登录态在；
**记录耗时**到下表的空白处。

| 场景 | 字节数 | 耗时 |
| --- | --- | --- |
| 同卷 rename（A31） | ⏳ | ⏳（预期毫秒级） |
| 跨盘复制（A40） | ⏳ | ⏳ |
| 覆盖路径的递归删除（A43） | ⏳ | ⏳（可能数万文件） |

**自动化覆盖**：`test/helper.test.js` 的 `forceCopy` 跨卷用例（走同一条"复制 → 校验 → 删源"代码路径）。

### A41 设置值只在全部搬完后写入 — ⏳ 待真机

判据：制造一个必然 `failed` 的条目（目标盘只读 / 磁盘满）→ 迁移后设置值**仍是旧根**；
意图文件仍在；界面显示「迁移未完成 / 失败」；旧根数据完整。

**自动化覆盖**：`test/rootMigration.test.js` 的 I-2（`api.settings.set` 恰好 3 处，且写设置排在
`advanceMigrationState` 的"全部完成"判定之后、`!state.writable` 时提前 return）+
`test/profileRoot.test.js` 的"`failed` 阻塞写设置"。

### A42 「浏览…」的降级行为（老宿主） — ⏳ 待真机

前提：一个**没有** `openDirectory` 能力的宿主（obox ≤ 1.0.7）。

判据：点「浏览…」弹出的是**文件**选择框；选中一个文件后候选根 = 其父目录且界面出现降级提示
（`FILE_SELECTED_NOTE`）；取消 / 无返回 ⇒ **不改动任何值**；**不报错、不崩溃**；文案与实际行为一致。

**自动化覆盖（源码级，真机仍需跑）**：见 §5。

### A43 冲突覆盖 + 确认框列出过它们 — ⏳ 待真机（自动化已覆盖两态）

1. 在目标根预先手工建一个与条目**同名**的目录，放一个可识别文件（记 sha256）；
2. 发起改根迁移。

判据：
① 迁移**先弹确认框**，框内**逐条列出**该目录名，且文案含「永久删除且无法恢复」；
② 点「取消」⇒ **什么都没删**（sha256 不变）、设置值仍是旧根；
③ 重新发起并点「覆盖并继续」⇒ 目标里的旧文件**消失**、目标内容 = 源内容、源目录已删、
`items[].status = 'overwritten'`，界面报「覆盖 1」。

**自动化覆盖**：`test/helper.test.js` 的"已确认 ⇒ overwritten（目标旧内容消失、源已删）"用例 +
`test/componentSource.test.js` 的确认框文案门禁（逐条列出 + 不可恢复 + 无备份选项 + 只能按钮关闭）。

### A44 改宿主后的「选目录」正路径 — ⏳ 待真机

前提：**具备 `openDirectory` 能力**的宿主构建（宿主改动已合并进 obox master `703d6d0`，未发版）。

判据：点「浏览…」弹出的是**文件夹**选择框；选中后候选根 = 该目录；提交后正常创建标记并迁移。
**宿主回归**：不传 `properties` 的既有调用仍是文件框；`openFile` + `filters` 仍按 filters 过滤。

---

## 5. 降级路径的源码级证据（老宿主 / 探测失败）

**探测实现（`index.js` 的 `browseRootDir`）**：见 `docs/spec/amendments/08-profile-root.md` §8 的贴码。

**降级时界面说了什么**（三个常量都在 `index.js`，由 `test/componentSource.test.js` 钉住字面量）：

| 触发 | 文案 |
| --- | --- |
| 老宿主 / 无对话框能力 / 探测失败 | `当前 obox 版本不支持「选择目录」；请在下方粘贴目录路径（例如 D:\obox-webapp\profiles），或升级 obox 后重试` |
| 选到的是**文件** | `当前 obox 版本不支持「选择目录」，弹出的是文件选择框；已把所选文件所在的文件夹当作候选目录，请确认后再提交，或升级 obox 后重试` |
| 宿主 `{ok:false}` | `无法打开目录选择框（<原因>）；请手工粘贴目录路径` |
| 候选没过 V1–V7 | 该条校验的原文 |

**"不得报错、不得崩溃"的源码级证据**：

- `browseRootDir` 的**每一个**分支都 `return ok({ … })`；`test/rootMigration.test.js` 的 I-8
  断言该函数体内**没有 `throw`**；
- `api.dialog` 不存在 ⇒ 直接返回 `{ supported:false, degraded:true, note: DEGRADED_NOTE }`（不 throw）；
- `api.dialog.showOpenDialog` 抛错 ⇒ `catch` 后返回失败提示 + 手填（不 throw）；
- `ok:false` ⇒ 返回失败提示 + 手填（不 throw）；
- `checkRootCandidate` 调用失败 ⇒ 返回"无法校验所选路径"提示（不 throw）。

**"禁止用版本号判断能力"的源码级证据**：I-8 断言 `index.js` 里**不出现** `getOboxVersion`；
`browseSupported` 是 `let` 内存变量（I-8 断言 `let browseSupported = null`，且断言它不进 `api.settings.set`）。

**界面侧的降级形态**：手填输入框**任何时候都在**（不是"不支持时才出现"）；`browseNote` 显示上面的文案；
候选值**永远不自动提交**——必须用户点「迁移到此目录」，且仍走同一套校验与迁移入口（`startRootMigration`）。

---

## 6. 自动化覆盖 vs 真机（汇总）

| 验收 | 自动化证据 | 真机 |
| --- | --- | --- |
| A30 | helper 默认根用例 + chromeArgs 相对形态 | ⏳ |
| A31 | helper `migrateRootDir` 同卷 + selftest ⑩ | ⏳ |
| A32 | helper 续做形态（目标在/源不在）+ 状态机单测 | ⏳ |
| A33 | helper skipped 两侧逐字节未变 + I-6 | ⏳（界面确认框） |
| A34 | helper 缺标记拒删 + sha256 比对 | ⏳ |
| A35 | helper 永不删根（七种越界名） | ⏳ |
| A36 | ipcSurface 卸载语义 + manifest description | ⏳ |
| A37 | helper 自定义根体积/清理 | ⏳ |
| A38 | helper cleanCaches 全局遍历（自定义根） | ⏳ |
| A39 | helper moveProfile + root | ⏳ |
| A40 | helper `forceCopy` 跨卷 | ⏳（耗时表） |
| A41 | I-2 唯一写点与顺序 + "failed 阻塞写设置" | ⏳ |
| A42 | I-8 + componentSource 降级文案 | ⏳ |
| A43 | helper overwritten + componentSource 确认框 | ⏳ |
| A44 | I-8（`properties: ['openDirectory']`） | ⏳ |

**已如实登记的覆盖缺口**（同 README §6.5）：

1. `migrateRootDir` 的"复制完成但 C1–C5 不通过 ⇒ `failed` 且**源保留**"分支需要"复制必然被截断"的故障
   （磁盘满 / 权限 / 目标被外力删除），纯 Node 造不出确定性场景 ⇒ 判据本身由 `verifyMigration` 的表驱动
   用例覆盖，**真机截断场景未自动化**；
2. 跨卷 `EXDEV` 的真机行为与耗时未测（代码已处理 `EXDEV` 退回复制）；
3. U-1（子窗口聚焦时对话框的归属窗口）与 U-4（UNC 下 `mkdirSync`/`copyFile` 的失败码）仍未核实。
