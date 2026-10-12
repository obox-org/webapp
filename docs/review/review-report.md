# 最终交付审视报告：webapp 扩展（阶段 4 `do-review`）

- **审视日期**：2026-10-12（本机本地时间 23:0x–23:2x）
- **审视对象**：需求 `webapp-extension`（R1–R17）@ obox `master` `831832e`
- **协调结构**：**本地轴分离审视**。本次会话的 `subagent` 深度上限为 1（`extensions/webapp` 的父代理已处于 depth 1，派生即报 `subagent depth 2 exceeds maxDepth 1`），因此**未启动子代理**，由主审自身按 Standards 轴 / Spec 轴 / 运行时行为轴 / 文档一致性轴分别独立过一遍，轴间不互相掩盖。审视者即记录人。
- **产物权威元数据**：
  - `Authority: local-spec-workflow`
  - 权威需求源：`.spec-workflow/webapp-extension/requirements.md`（R1–R15）
  - 权威规格源：`.spec-workflow/webapp-extension/spec.md`（2021 行，含 R16/R17）+ `amendments/01-close-four-decisions.md`、`amendments/02-profile-size-limit.md`、`amendments/03-probe-stage1-feedback.md`
  - 本地缓存状态：无外部 tracker，未使用 `Authority: external-tracker-only`
  - 已读的规格/修订/实现/差异来源：见本报告第 8 节
- **Goal Mode 状态**：spec §1 声明 `enabled for this spec only`（授权锚点 amendment `01-close-four-decisions`，最大自动修复轮次 `2`）。**但 `.spec-workflow/webapp-extension/implementation-report.md` 不存在**（`glob .spec-workflow/**/*.md` 仅 5 个文件：requirements + spec + 3 个 amendment），即**运行期账本缺失**。按本技能规则，运行期轮次只能记在账本里、不得从此处自行启用或延长授权；账本缺失本身记为 must-fix（DR-007）。**本次不以自动循环方式进入 fix-review**，是否继续由用户决定。
- **本次审视未修改任何实现文件**：未改 `extensions/webapp/**`、未改 `.spec-workflow/**` 既有文件、未 `git add/commit/push`、未动 `extensions/rdp/**` 与根 `src/**`。唯一写入是本报告与 `review-reports/01-webapp-extension-final.md`。复跑 `node scripts/pack.mjs` 重写了 `out/`（任务书明示可接受）。

---

## 1. 审视范围

| 维度               | 内容                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原始目标           | 在 obox 里提供 webapp 用户扩展：App 卡片管理多条"网页应用"，点击以 Chrome `--app=<url>` 独立 profile 打开，可按条目忽略证书；含 R16（升级保留）与 R17（profile 体积节流）                                             |
| 非目标（不计缺陷） | 不做浏览器选择/回退 Edge、不开放任意 Chrome 参数、不做进程跟踪/关闭按钮、不做书签历史管理、不做硬配额、不做按条目覆盖上限、不做自动清理、不做体积报表、不做导入导出、不做默认浏览器打开、不做双语、不用 `api.secrets` |
| 受影响模块         | `extensions/webapp/**`（`manifest.json`、`index.js`、`helper.cjs`、`lib/*.mjs`、`src/**`、`ui/**`、`scripts/pack.mjs`、`test/**`）；宿主事实面 `src/main/*`、`src/api/*`；参照实现 `extensions/rdp/**`                |
| 关键用户路径       | 新建 → 列表 → 打开 → 编辑（改名搬目录）→ 删除（连 profile）；未装 Chrome 报错；超限拦截 → 清理缓存 → 仍然打开；全局清理缓存；设置页改上限                                                                             |
| 权限/安全          | TLS 降级（用户已接受 R-1）、助手参数白名单、profile 路径越界防护、缓存白名单（删数据的第三个动作）                                                                                                                    |
| 明确不在本轮范围   | 真实 Chrome 二次启动行为（已由探针阶段一核实，直接引用，未复跑）；`.oix` 真机安装/升级/卸载链路（需宿主环境，本轮未做）；`obox-org/webapp` 独立仓库与 Release（外部动作，未发生）                                     |

---

## 2. 审视 DAG（实际执行）

| ID      | 名称               | 审视目标                                         | 验证方式                                                                                                             | 允许改代码 | 期望输出              | 依赖    | 通过判据                   | 失败升级   |
| ------- | ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- | ------- | -------------------------- | ---------- |
| DR-SPEC | Spec 轴：需求覆盖  | R1–R17 逐条                                      | 读 spec/req/amendments + 在实现里定位落点 + 实跑                                                                     | no         | 覆盖表                | —       | 每条有落点或明确记为未满足 | must-fix   |
| DR-STD  | Standards 轴       | 命名/重复/错误吞没/测试质量/manifest 规范        | 读代码 + `node --test` + prettier + manifest 校验器                                                                  | no         | 分级发现表            | —       | 每条带 `file:line`         | should-fix |
| DR-RT   | 运行时行为轴       | 参数构造/路径防越界/删除白名单/生命周期/平台假设 | 读 `helper.cjs`/`lib/*` + 真子进程集成测结果 + 纯函数实测                                                            | no         | 风险登记              | DR-SPEC | 不被"看起来对"说服         | must-fix   |
| DR-DOC  | 文档与产物一致性轴 | README / `docs/evidence` vs 实现 vs spec         | 逐条比对原文 + 复跑 `pack.mjs` + 解包旧产物                                                                          | no         | 失实清单 + 以哪边为准 | DR-SPEC | 每处给出该改哪边           | should-fix |
| DR-GATE | 门槛复核           | AC1/AC3/AC4/AC5 与打包                           | `node --test --test-timeout=20000`、`npx prettier --check .`、`node scripts/pack.mjs`、`validate-manifest.mjs`、解包 | no         | 命令输出              | —       | 全绿                       | must-fix   |

**未执行的真实交互测试**：本扩展的界面是 obox 宿主子窗口内的 `app://` 页面，需要宿主安装 `.oix` 后交互。任务书明确禁止把文件同步到 `%APPDATA%\obox\extensions\**`，且本轮为只读审视，因此**未做真实页面交互测试**。按技能规则，凡"要求真实前端交互却未做"的情形不得判 `can ship` —— 本次判定与这一条**结论一致**，但原因不止于此（见第 3 节 M1）。

---

## 3. 交付判定

> ### **cannot ship**（交付完成度 = `incomplete`）

依据（逐条都有独立证据，见第 4 节）：

1. **M1**：`index.js` 是票 01/04 骨架，8 个消息方法只接线了 `probe`，其余 7 个一律返回「未知方法」。界面已经在调这些方法 → 新建/列表/打开/编辑/删除/体积/清理**全部不可用**。R2–R13、R15、R17 的端到端路径**未实现**。
2. **M2**：R17 的全局设置**无人读取**（`src` 内 `api.settings` 零命中），超限拦截约定的产出方 `[profile-over-limit]` 在实现里不存在（只有消费方 `src/App.vue:26`）。
3. **M3**：`out/webapp-1.0.0.oix` 是 22:58 的陈旧产物，与当前源码、manifest 均不一致。
4. **M4**：AC1（`npm test` 全绿）当前 **99 项 / 97 通过 / 2 失败**。
5. **M6**：`--disk-cache-size` 默认值与 spec §10.4/§12.1/§22 I14 及 spec 自己的对照表**冲突**，且未走修订流程。
6. spec 自定的"交付前必须复跑并全绿"（`docs/evidence/gates-and-probe.md:14`）**未达成**：该证据文件最新一行仍是 22:58 的 `fail 1`。

**这不是"范围外的小瑕疵"，而是"票 07/08/11 的核心竖切尚未落到 `index.js`"。** 按 spec §24 的 tracer-bullet 判据，票 07 的"全链路能跑"与票 08 的"能用"两项都未达成。

---

## 4. 发现清单

### 4.1 must-fix

---

#### DR-001 ｜ `index.js` 只实现 `probe`，界面调用的 7 个方法全部落到「未知方法」

- **严重性**：must-fix（阻塞级）
- **证据（文件:行 + 原文）**：
  - `extensions/webapp/index.js:18-21`：「⚠️ **本文件当前是票 01 的骨架 + 票 04 的 `probe`**（本批次只做 spec §24 的 01–04）：卡片注册、消息泵、`probe`、`install` / `uninstall` 钩子的结构与护栏已就位；`list` / `save` / `remove` / `open` / `profileInfo` 六个方法、sqlite 建表与唯一索引、profile 体积预检与"清理缓存"（追加需求）落在 **票 07**；界面落在 **票 08**。」
  - `extensions/webapp/index.js:155-168`：`switch (method) { case 'probe': return await probe(); default: return fail(\`未知方法: ${String(method)}\`) }`——**只有`probe` 一个 case**。
  - 界面调用面（全部落到 default）：`src/App.vue:78` `callExtension('list', {})`、`:116` `('save', payload)`、`:146` `('remove', {id})`、`:164` `('open', ...)`、`:195`/`:272` `('profileSize', ...)`、`:212`/`:247` `('cleanCaches', ...)`；`src/bridge.js:81` 的 JSDoc 也把这 8 个方法列为契约。
  - 反证后端其实已就绪：`helper.cjs:887-895` `const METHODS = { probe, launch, profileStatus, moveProfile, removeProfile, profileSize, cleanCaches }` ——7 个方法**全在**；`lib/*.mjs` 的纯逻辑也齐（`chromeArgs.mjs:243` `buildChromeArgs`、`webapp.mjs:190` `validateWebapp`、`profileLimit.mjs` 全套）。缺口**只在 `index.js` 的接线层**。
- **复现**：安装/加载扩展后，子窗口内点「＋ 新建」或「打开」→ 状态栏红字显示 `未知方法: save` / `未知方法: open`（`src/App.vue:66-67` 的 `setStatus`，`index.js:162` 的 default 分支）。`list` 同样返回该文案 → 列表永远加载不出条目（`App.vue:313` 的 `loadError` 分支）。
- **期望**：spec §11.1 的 8 个方法（`list`/`save`/`remove`/`open`/`profileSize`/`cleanCaches`/`probe`/`profileInfo`）+ `api.sqlite.open('webapp.db')` 建表与 `COLLATE NOCASE` 唯一索引（§13.3）+ `open` 的体积预检分支（§14.6）全部在 `index.js` 实现。
- **实际**：只实现 `probe`。
- **影响**：R2–R13、R15、R17 的产品行为**整体不可用**；AC6–AC13、AC16–AC18、AC21–AC23、AC25–AC29 全部无法成立。这是"UI 已完整、后端逻辑已完整、接线缺失"的典型**假完成**。
- **对应 spec**：§11.1、§11.3、§13.3、§14.6、§23 AC6–AC13/AC25–AC29、§24 票 07/08/11
- **建议修法**：按票 07 + 11 在 `index.js` 补齐 8 个方法、懒开库与唯一索引、`open` 预检分支（读 `api.settings.get('webapp.profileLimitMb','2048')` → `profileSize` → 超限返回 `{ok:false, message 以 [profile-over-limit] 开头, data:{overLimit:true,...}}` → 但 §11.1 的 `fail()` 只回 `{ok,error}`，需先解决 `data` 信封，见 DR-002）。
- **为什么是 must-fix**：验收关键路径完全缺失，不是风格或覆盖问题。

---

#### DR-002 ｜ `fail()` 信封无法承载 `overLimit` 所需的 `data`，而界面依赖它

- **严重性**：must-fix
- **证据**：
  - spec `§14.6` 第 5 步（`spec.md:1021-1023`）：超限时返回 `{ ok: false, error: '[profile-over-limit] …', data: { overLimit: true, bytes, limitBytes, cacheBytes, id } }`，并要求「界面据 `data.overLimit === true` 区分它与真正的错误」。
  - 实现 `index.js:66-69`：`function fail(error) { return { ok: false, error: messageOf(error) } }` ——**只有 `ok` 与 `error` 两个键，没有 `data`**。这是 `rdp` 的信封形态。
  - 界面确实按 spec 写：`src/App.vue:26` `const OVER_LIMIT_PREFIX = '[profile-over-limit]'`、`:175` `if (message.startsWith(OVER_LIMIT_PREFIX))` —— 改用**字符串前缀**兜底，而不是 `data.overLimit`。
- **期望**：`ok:false` 能带 `data`（或界面与 spec 就"用前缀还是用 data"达成一致并同步 §14.6 / §11.1 / S17）。
- **实际**：信封不支持 `data`；界面自创前缀判据，与 spec 明文判据不一致。
- **影响**：R17 要求 3 的"超限拦截"落地时必然要改信封契约或改 spec；当前 `S17` 决策记录（`spec.md:1882`）已与实现脱节。
- **建议修法**：`fail(error, data)` 增加可选 `data`；界面优先读 `data?.overLimit === true`、保留前缀作兜底；同步 §11.1 与 S17。**注意这是对 `rdp` 信封形态的偏离，需在 spec 里写清理由。**
- **为什么是 must-fix**：这是"界面与规格对同一交互用了两套判据"，属于契约级不一致，且不改则 R17 无法按 AC26 验收。

---

#### DR-003 ｜ R17 的全局上限设置无任何读取方；`webapp.profileLimitMb` / `webapp.diskCacheMb` 是死配置

- **严重性**：must-fix
- **证据**：
  - `manifest.json:18-52` 声明了 `contributes.settings` 两个 `select` 字段（键 `webapp.profileLimitMb` 默认 `"2048"`、`webapp.diskCacheMb` 默认 `"-1"`）。
  - `grep -r "api\.settings" extensions/webapp/src` → **零命中**（本次实跑）。
  - `lib/profileLimit.mjs:22-25` 定义了 `SETTING_KEYS`，但全仓只有该定义与 `test/settings.test.js` 引用它，**没有任何生产代码调用 `api.settings.get`**。
  - spec `§10.4`（`spec.md:462-465`）要求：读取 `api.settings.get('webapp.profileLimitMb','2048')`、`api.settings.get('webapp.diskCacheMb','512')`、用 `api.settings.onChanged` 作废体积缓存。
- **期望**：扩展侧（`index.js` 的 `open` 预检）与助手参数构造读这两个设置。
- **实际**：无人读。
- **影响**：R17 的"上限由用户在设置里定义"落空；设置页改动**不产生任何行为变化**。AC25 只能验到"设置能存"，验不到"生效"。
- **对应 spec**：§10.4、§14.6 预检第 1 步、§22 I14/I15、§23 AC25/AC28
- **建议修法**：在 `index.js` 的 `open` 前 `api.settings.get` 两个键并按 `lib/profileLimit.mjs` 归一；把归一结果传 `buildChromeArgs(entry, { diskCacheMb })`；`api.settings.onChanged` → 下次 `profileSize` 带 `force:true`（spec §14.6 失效条件 ⑥ 的既定口径）。
- **为什么是 must-fix**：R17 是已确认的需求（amendment 02），其"设置驱动"这一核心机制完全未接。

---

#### DR-004 ｜ `extraOrigins` 与主 origin 未跨集合去重（AC/单测已抓到）

- **严重性**：must-fix
- **证据**：
  - 单测实跑失败（本次独立复现）：
    ```
    ✖ extraOrigins：多行 → 逗号连接、主 origin 恒在最前、去重、空行忽略
      + actual   '--unsafely-treat-insecure-origin-as-secure=https://a,https://b,https://a'
      - expected '--unsafely-treat-insecure-origin-as-secure=https://a,https://b'
      at test/chromeArgs.test.js:153:10
    ```
  - 用例输入 `test/chromeArgs.test.js:145-157`：主 url `https://a/`，`extraOrigins: '\nhttps://b\n\nhttps://a\nhttps://B\n'`，并另外断言 `normalizeExtraOrigins(...).origins === ['https://b']`（`https://a` 与 `https://B` 已在函数内被去重）。
  - 缺陷点 `lib/chromeArgs.mjs:281-284`：
    ```js
    args.push(
      `--unsafely-treat-insecure-origin-as-secure=${insecureOriginValue([
        deriveOrigin(checked.value), // ← 主 origin 直接前置，未与 extraOrigins 比对
        ...extraOrigins
      ])}`
    )
    ```
    `normalizeExtraOrigins`（`lib/chromeArgs.mjs:110-161`）只在**自己那一组**里去重（`seen` 集合只装 extraOrigins），主 origin 不在其中。
- **期望**：spec §12.2（`spec.md:697-702`）「去重（大小写不敏感，主机名大小写不敏感）」+「恒以主 origin 开头」；§18.1（`spec.md:1331`）「多行 → 逗号连接、主 origin 在前、去重」。
- **实际**：末尾重复出现主 origin。
- **影响**：`--unsafely-treat-insecure-origin-as-secure` 的取值含重复项。功能上 Chrome 容忍重复，因此**不是安全缺陷**；但它是 AC1（`npm test` 全绿）与 §18.1 的确定性断言失败，且违背"参数数组逐一相等"的可回归契约。
- **建议修法**：合并时按大小写不敏感去重（保留主 origin 在最前的顺序）：
  ```js
  const merged = []
  for (const o of [deriveOrigin(checked.value), ...extraOrigins]) {
    if (!merged.some((m) => m.toLowerCase() === o.toLowerCase())) merged.push(o)
  }
  ```
- **为什么是 must-fix**：AC1 是硬门槛，且这是**真实逻辑缺陷**（不是测试写错）。

---

#### DR-005 ｜ `--disk-cache-size` 默认值与 spec 明文冲突，且未经修订流程

- **严重性**：must-fix
- **证据（三方不一致）**：
  | 来源                                       | `webapp.diskCacheMb` 默认         | 可选值                                                 |
  | ------------------------------------------ | --------------------------------- | ------------------------------------------------------ |
  | spec §10.4（`spec.md:458`）                | `"512"`                           | `0/128/512/1024`（无 `-1`）                            |
  | spec §12.1 对照表（`spec.md:669`）         | 「默认 512 MB ⇒ `536870912`」     | —                                                      |
  | spec §22 I14（`spec.md:1902`）             | 「默认 2 GB / **512 MB**」        | —                                                      |
  | spec §22 I15（`spec.md:1903`）             | 「参数按设置产出，`0` 时不传」    | —                                                      |
  | **实现** `lib/profileLimit.mjs:32-34`      | `DEFAULT_DISK_CACHE_MB = -1`      | `DISK_CACHE_MB_VALUES = ['-1','0','128','512','1024']` |
  | **实现** `manifest.json:41-48`             | `"default": "-1"`                 | `-1/0/128/512/1024`                                    |
  | **实现** `test/chromeArgs.test.js:296-299` | 断言默认含 `--disk-cache-size=-1` | —                                                      |
  - 实现自述理由（有真机证据）：`lib/profileLimit.mjs:81-86`「只有 **`-1`** 能真正把它按住：实测 `Default\Cache` = **0 字节 / 0 文件**。因此默认值是 `-1`」。
  - **但这条改动没有对应的 amendment**：`amendments/01`（4 条决策）、`02`（R17，明文写 `--disk-cache-size=536870912`）、`03`（探针回灌，只回灌 8 条已核实结论，未改该默认值）都未覆盖。amendment 03 §10 Q-3（`amendments/03-probe-stage1-feedback.md:115`）明确把"`--disk-cache-size` 是否真限体积"登记为**未核实**；`spec.md:2019` §26 第 13 项同样写"**未核实**"。
- **期望**：默认 512 MB（→ `--disk-cache-size=536870912`）。
- **实际**：默认 `-1`（禁用磁盘 HTTP 缓存），且 `spec.md:671` 的对照表仍写「能否防止撑爆磁盘 → **不能**」，而 `-1` 的语义变化未被任何规范文件吸收。
- **影响**：① 规范与实现冲突，后续任何"以 spec 为准"的重实现都会把默认改回 512；② 用户升级后默认行为是"每次打开重新下载静态资源"（性能代价），属**未确认的产品默认值变更**；③ `settings.test.js` / `fields.test.js:237` 已把 `-1` 固化成断言，使冲突被测试"洗白"。
- **建议修法（二选一，须由用户裁定，属 Goal Mode 暂停条件第 11 条『档位需增减』）**：
  - (a) 若采用 `-1`：**补写 amendment 04**，把 §10.4 / §12.1 / §22 I14-I15 / §26 第 13 项一并改成 `-1`（含"正数档不限制总量"的实测说明），使 spec 与实现一致；
  - (b) 若保持 spec：把 `DEFAULT_DISK_CACHE_MB` 改回 `512`、manifest 默认改回 `"512"`，并同步 `test/chromeArgs.test.js:296-299` 与 `test/fields.test.js:237` 的断言。
- **为什么是 must-fix**：默认值是用户可见行为，且当前处于"规范说 A、实现做 B、测试固化 B"的三方冲突，交付文档无法自洽。

---

#### DR-006 ｜ 缓存清理白名单与 spec 明文不一致（10 项 vs 8 项，两个名单互相矛盾）

- **严重性**：must-fix
- **证据**：
  - spec §14.5 白名单（`spec.md:957-966`）**恰 8 项**：`Cache` / `Code Cache` / `GPUCache` / `GrShaderCache` / `ShaderCache` / `DawnGraphiteCache` / `DawnWebGPUCache` / `Crashpad`。
  - spec §16（`spec.md:1300`）：「`CACHE_DIR_NAMES` 是**白名单**：只有 **8 个**固定目录名可能被删」；§21.6 S18（`spec.md:1883`）：「大小写不敏感精确匹配 **8 个**固定名」；§22 I17（`spec.md:1905`）：「白名单目录删除（**8 个目录名**，深度 2）」；amendment 02 §3（`02-profile-size-limit.md:54`）也写「白名单（**8 个目录名**）」。
  - 实现 `lib/profileLimit.mjs:171-182` 是 **10 项** = spec 的 8 项**全部保留**（含 `Crashpad`）**再额外多出 2 项**：`BrowserMetrics` 与 `optimization_guide_model_store`：
    ```js
    export const CACHE_DIR_NAMES = Object.freeze([
      'Cache',
      'Code Cache',
      'GPUCache',
      'GrShaderCache',
      'ShaderCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'Crashpad', // ← spec 的 8 项
      'BrowserMetrics',
      'optimization_guide_model_store' // ← spec 没有这两项
    ])
    ```
    （注：实现的净差异 = spec 的 8 项一项不少，**额外多 2 项**，共 10 项。因此差异方向是"扩大了删除面"，不是"漏删"。）
  - 实现文件头注释自相矛盾：`lib/profileLimit.mjs:10` 写「**缓存白名单是 8 个固定目录名**」，而第 171-182 行是 10 项。
  - `lib/profileLimit.mjs:160-166` 自述把这两项作为「用户决策，带证据」加入，但**没有 amendment 记录该决策**；`spec.md:1047` §17 只把 `optimization_guide_model_store` 与 `BrowserMetrics` 描述为**体积增长来源**（用于说明为何需要节流），并未授权把它们列入删除白名单。
- **期望**：删除白名单严格等于 spec 的 8 项（或 spec 改为 10 项）。
- **实际**：实现扩大了**删除面**（多两类目录会被 `fs.rm({recursive:true})` 删除），超出了"白名单是安全边界的一部分"的规范表述。
- **影响**：这是"删数据动作的边界"被单方面扩大。虽然 `BrowserMetrics`（诊断数据）与 `optimization_guide_model_store`（可重建模型）删除后果可控，但 §16 明写「只有 8 个固定目录名可能被删」，且 spec 与 amendment 02 反复以"8 个"作为安全论证的依据 → 规范文档目前**不成立**。
- **建议修法**：补 amendment 04 把 §14.5/§16/§21.6 S18/§22 I17 的"8 项"改为"10 项"并列出新增两项与理由（引用真机体积证据）；同时修正 `lib/profileLimit.mjs:10` 的"8 个"。**不要**反向删掉这两项（它们有真机依据、且删除后果可控），除非用户要求严格贴 8 项。
- **为什么是 must-fix**：安全边界描述与实现不符，且 §16 是"权限与安全"章节的正式断言。

---

#### DR-007 ｜ AC1 未达成（99 项 / 97 通过 / 2 失败），且 spec 定下的"交付前必须复跑并全绿"未执行

- **严重性**：must-fix
- **证据**：
  - 本次独立复跑 `cd extensions/webapp; node --test --test-timeout=20000` → `ℹ tests 99` / `ℹ pass 97` / `ℹ fail 2` / `[exit code: 1]`（`duration_ms 1405`）。
  - spec §23 AC1（`spec.md:1914`）：「`npm test`（即 `node --test`）→ **全部通过，0 fail**；退出码 0」。
  - `package.json` 的 `"test": "node --test"`（与 AC1 一致）。
  - `docs/evidence/gates-and-probe.md:14` 原文：「**交付前必须复跑并全绿**；上表末尾的 1 个测试失败与 2 个格式问题属迭代中状态，需在 `do-review` 前清零。」→ 该闸门**未执行**（文档自身也没有更新）。
  - 该证据文件的测试表最新一行仍是 22:58 的「fail 1」（`gates-and-probe.md:9`），与当前 99/97/2 的状态脱节（文件 mtime 22:58:58）。
- **期望**：AC1 全绿。
- **实际**：2 条失败（DR-004 为真缺陷；DR-008 为测试脚手架问题）。
- **影响**：AC1 是硬门槛；证据文档与真实状态不一致会误导后续。
- **建议修法**：先修 DR-004（产品），再按 DR-008 修测试；然后复跑并把结果回填 `docs/evidence/gates-and-probe.md`（含 99 项、时间、退出码）。
- **为什么是 must-fix**：AC1 明文 0 fail。

---

#### DR-008 ｜ 交付物陈旧：`out/webapp-1.0.0.oix` 与当前源码/manifest 不一致

- **严重性**：must-fix
- **证据**：
  - 既有产物：`out/webapp-1.0.0.oix` **222,841 B**，mtime **22:58:01**，内含 `ui/assets/index-BymUoBCF.js`（解包实得 11 条目，与协调者所述一致）。
  - 本次复跑 `node scripts/pack.mjs` → **225,443 B**，含 `ui/assets/index-DK0gm9jk.js`（哈希变了 → UI 构建产物已变），`exit 0`。
  - 打包源含**后改动的文件**：`manifest.json`(22:5x)、`index.js`(✓)、`lib/profileLimit.mjs`(22:58:49)、`lib/chromeArgs.mjs`(22:52:43)、`lib/entryFields.mjs`(22:50:01)、`lib/nameSanitize.mjs`(22:48:57)、`lib/webapp.mjs`(22:51:31)，而产物是 22:58:01 打的 → 至少 `profileLimit.mjs`（22:58:49）**晚于**产物。
  - 旧产物内的 `manifest.json` 是 2,309 B，与当前 `manifest.json`（2,309 B）同尺寸但 `ui` 资源哈希不同；旧包的 `ui/assets/index-BymUoBCF.js` 与 `extensions/rdp/ui/assets/index-BHaCIB5u.js` 同源世代无关，属 webapp 早期构建。
- **期望**：`out/webapp-1.0.0.oix` 由**最终源码**产出，且与 `manifest.json`、`ui/` 一致。
- **实际**：产物是中途快照。
- **影响**：README §1 让用户「取 `out/webapp-1.0.0.oix`」；README §2.1 的升级/卸载语义、§3 的设置默认值都依附于该产物，而产物与源码不一致 → 任何基于该包的验收都无效。
- **建议修法**：修完 DR-001/002/003/004/005/006 后依次跑 `npm test` → `npm run build` → `npm run pack`，并用 AC4 的 `tar -tf` 判据复核（无 `data/`）。
- **为什么是 must-fix**：交付物与源码不一致，等于交付未发生。

---

#### DR-009 ｜ Goal Mode 运行期账本 `implementation-report.md` 缺失

- **严重性**：must-fix（流程性）
- **证据**：`glob .spec-workflow/**/*.md` 返回 5 个文件：`requirements.md`、`spec.md`、`amendments/01`、`amendments/02`、`amendments/03` —— **无 `implementation-report.md`，也无 `review-report.md`（本次新建）、`implementation-reports/`、`issues/`**。
- **期望**：spec §1（`spec.md:33`）「运行期自动修复轮次计数由后续 `implementation-report.md` 维护」。
- **实际**：账本不存在。
- **影响**：无法判定"已用几轮自动修复"；本技能明令审查阶段只能更新账本字段、不得自行启用/延长 Goal Mode → 当前**无法安全地自动进入 fix-review 循环**。
- **建议修法**：由实现阶段补建 `implementation-report.md`（记初始脏工作区基线、票完成情况、验证状态、已用轮次）。在此之前，修复应作为**用户显式授权**的修复轮次推进。
- **为什么是 must-fix**：Goal Mode 授权锚点要求该账本存在，否则自动循环失去依据。

---

### 4.2 should-fix

---

#### DR-010 ｜ 6 个 spec 明文要求的测试文件缺失，`AC1` 的"可回归"面显著窄于 spec §18

- **严重性**：should-fix（但导致 DR-001 这类缺陷逃逸，因此优先级高）
- **证据**（本次实跑 `Test-Path`）：
  | spec 要求（§9.2 / §18.1 / §18.2 / §24）                                                   | 现状                                                                              |
  | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
  | `test/fieldDocs.test.js`（§18.1、§15.2.2 的 6 条真实门禁）                                | **不存在**                                                                        |
  | `test/helperProfile.test.js`（amendment 03 §7 新增，`lockfile` 三态 + 删除失败归一）      | **不存在**                                                                        |
  | `test/helperCache.test.js`（§18.2，保留清单**逐字节不变** sha256）                        | **不存在**                                                                        |
  | `test/helperSize.test.js`（§18.2，体积统计 + TTL 语义）                                   | **不存在**                                                                        |
  | `test/uninstall.test.js`（§14.4(d)/g-1 源码门禁：`install`/`uninstall` 不得搬运 profile） | **不存在**                                                                        |
  | `test/index.test.js`（§24 票 07："用 mock `api` 单测 6 个方法"）                          | **不存在**                                                                        |
  | `src/settings.js`（§9.2/§9.3 明列）                                                       | **不存在**（设置归一被放进了 `lib/profileLimit.mjs`，属合理重构，但 spec 未同步） |
- **后果（实测验证）**：DR-001 这个"7 个方法全缺"的致命缺陷，**在 99 项测试里没有任何一条能发现** —— 因为 `test/` 里没有一条走 `index.js`（`test/index.test.js` 缺失），而 `test/componentSource.test.js` 只对 `src/**` 做**源码文本断言**（`:21` `readFileSync(...'utf8')`，`:88-90` 断言 `APP.includes("callExtension('cleanCaches'")` 等）。测试绿而产品不可用，正是"测试绕过真实业务逻辑"。
- **建议修法**：补齐上述文件。优先级：`test/index.test.js`（mock `api` 跑通 8 个方法 + 超限分支）> `fieldDocs`/`uninstall`（源码门禁）> `helperCache`/`helperSize`/`helperProfile`（helper 集成）。
- **为什么是 should-fix 而非 must-fix**：缺测试本身不改变产品行为，但它已实际导致 must-fix 逃逸；修复 DR-001 时必须同时补 `test/index.test.js`，否则会再次逃逸。

---

#### DR-011 ｜ `scaleFactor` 单测失败实为**测试脚手架问题**，不是产品缺陷

- **严重性**：should-fix（改测试，不改产品）
- **证据（本次用临时脚本实测，落在系统 temp，未改仓库）**：
  ```
  normalizeWebapp({scaleFactor: 1.5}).scaleFactor = "1.5"
  PATH-A buildChromeArgs(normalizeWebapp(num 1.5)) -> NO ERROR   ← 失败用例走这条
  PATH-B validateWebapp(entry, [], {raw:{scaleFactor: 1.5}}) = {"ok":false,"errors":[{"field":"scaleFactor","message":"缩放比例不在可选清单内（请从下拉中选择）"}]}
  PATH-B validateWebapp(entry, [], {raw:{scaleFactor: "1.5"}}) = {"ok":true,"errors":[]}
  PATH-B validateWebapp(raw "1.3") = {"ok":false,...}
  ```
  - 生产校验路径**已经**做了原值类型守卫：`lib/webapp.mjs:168-177` `whitelistErrors(entry, raw)` —— 第 173 行 `if (value === undefined || value === null || value === '' || typeof value === 'string') continue`，否则把**原值**（number `1.5`）塞回 `passed` 交给 `validateWhitelistFields` 判非法。设计意图写在 `lib/webapp.mjs:157-167` 注释里（明确引用"规格 §18.1 要求 number 的 1.5 报字段级错误"）。
  - 失败用例走的是 `test/chromeArgs.test.js:25-38` 的 `errorsOf()` = `buildChromeArgs(normalizeWebapp(input))`，**不传 `raw`**，于是 `normalizeWebapp`（`lib/webapp.mjs:96-98,150`）按设计把 number 归一成字符串 `'1.5'`，`buildChromeArgs` 再校验就合法了 → 测试读到 `null`。
  - 失败断言：`test/chromeArgs.test.js:243-249` 把 `1.5`（number）列在 `bad` 数组里，却用不经过类型守卫的路径断言。
- **判定**：**测试与实现口径不一致，实现正确**（对 `'1.5'` 放行、对 number `1.5` 与 `'1.3'` 报错，均符合 spec §12.3/§15.2）。协调者把这条列为"归属待定"是对的；我判定**不要改产品**。
- **建议修法**：把该数据点从 `buildChromeArgs` 用例移出，改为断言 `validateWebapp(...,{raw})` 的类型守卫生效；或给 `errorsOf` 增加"传 raw"的分支。**若改产品（让 `normalizeWebapp` 保留 number），会破坏 §13.2「所有列都必须产出具体值/类型稳定」的设计。**
- **为什么是 should-fix**：AC1 需要全绿，但修法是改测试；不涉及产品契约。

---

#### DR-012 ｜ 协调者代写的 `README.md` 把未实现的能力写成可用功能

- **严重性**：should-fix（文档失实）
- **证据（README 原文 vs 实现）**：
  | README 原文                                                           | 实现事实                                                                                                               |
  | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
  | `README.md:27` 表格「新建 → 填写 … 保存」                             | `index.js:158-163` 无 `save` case → 返回「未知方法: save」                                                             |
  | `README.md:28`「打开 → 以 Chrome app 模式打开该站点；profile 落在 …」 | 无 `open` case；且 `index.js` 无 sqlite/预检                                                                           |
  | `README.md:29`「编辑 … 改 `name` 会**连同 profile 目录一起改名**」    | `index.js` 无 `save`；无 `moveProfile` 接线（`helper` 侧有，`index.js:222-224` 只把它列进未使用的 `WEBAPP_CONSTANTS`） |
  | `README.md:30-31`「删除/清理缓存」                                    | 无 `remove`/`cleanCaches` case                                                                                         |
  | `README.md:58-59` 设置页「超过上限时…先拦下并给出两个动作」           | 无任何 `api.settings` 读取，无 `[profile-over-limit]` 产出方                                                           |
  | `README.md:70`「`BrowserMetrics` … 已列入清理白名单」                 | 与 spec §14.5/§16 的"8 项白名单"冲突（见 DR-006），但**与实现一致**                                                    |
  | `README.md:59` `webapp.diskCacheMb` 默认 `-1`                         | 与实现/manifest 一致，**与 spec §10.4 的默认 512 冲突**（见 DR-005）                                                   |
- **该以哪边为准**：**以规格 + 实现事实为准，README 需重写**。具体：R2–R13/R15/R17 未实现期间，README 不得宣称这些操作可用；DR-005/DR-006 裁定后再同步默认值与白名单项数。
- **为什么是 should-fix**：文档本身不改变行为，但它会误导用户与后续 reviewer（本次即因此差点漏判 DR-001）。

---

#### DR-013 ｜ `docs/evidence/gates-and-probe.md` 的门槛表与真机表无法支撑交付判定

- **严重性**：should-fix
- **证据**：
  - `gates-and-probe.md:9` 测试一栏最终记录为「22:58:24 → **fail 1**（新增 `pack.test.js` / `manifest-settings.test.js` 后处于迭代中）」，**没有 99 项那次记录**；当前真实为 `tests 99 / pass 97 / fail 2`。
  - `gates-and-probe.md:10` prettier 一栏最终记录为「22:58:24 → exit 1（2 文件，迭代中）」；本次实跑 `npx prettier --check .` → **exit 0**（`All matched files use Prettier code style!`）。→ 该表已过时且偏悲观。
  - `gates-and-probe.md:14` 自己写了"需在 do-review 前清零"但我方复核未清零。
  - `gates-and-probe.md:19` 记录的产物「222,841 字节，11 个条目」与当前源码打出的 **225,443 字节** 不一致（DR-008）。
  - `gates-and-probe.md:23` 声称「包内无 `data/` ✅」，该结论对旧包成立、对新包我复跑后同样成立（`pack.mjs` 输出条目清单里无 `data/`）——这条**可确认**。
  - 第 3 节真机探针表（`:29-38`）与我收到的已核实事实一致，**可用作判定依据**（本轮未复跑 Chrome，直接采信）。
  - 第 3.1 节未核实清单（`:42-46`）与任务书给的 5 条未核实项完全一致，**如实登记，不构成缺陷**。
- **该以哪边为准**：以**当前实跑输出**为准；该文件需在最终复跑后回填（测试计数、prettier 退出码、产物字节数、manifest 在包内位置）。
- **为什么是 should-fix**：证据文档是交付判定的依据，过时即失去效力。

---

#### DR-014 ｜ `package.json` 的 `description` 是乱码（UTF-8 被按 GBK 解读的典型形态）

- **严重性**：should-fix
- **证据**：`extensions/webapp/package.json:5` 原文实读为
  `"description": "缃戦〉搴旂敤鎵╁睍锛圤box 鐢ㄦ埛鎵╁睍锛岀粡 .oix 鍒嗗彂瀹夎锛夛細鎶婂唴閮ㄧ珯鐐逛互 Chrome 搴旂敤妯″紡鎵撳紑锛屾寜鏉＄洰鐙珛 profile銆備笌 obox 瀹夸富鍙湁鎵╁睍 API 渚濊禆鍏崇郴銆?"`
  （对照 `manifest.json:7` 的正常中文 `"网页应用：以 Chrome 应用模式打开内部站点…"`）
- **影响**：该字段不进 `.oix`（`pack.mjs` 只收 `manifest.json`/`index.js`/`helper.cjs`/`lib`/`ui`），因此**不影响产品**；但它是仓库内唯一一处中文乱码，说明该文件被某次写入用了错误编码。
- **建议修法**：以 UTF-8 重写该字段为正常中文。
- **为什么是 should-fix**：不影响运行，但属明显的编码缺陷，且易在后续写入时扩散。

---

#### DR-015 ｜ `README.md:106` 引用的证据文件 `docs/evidence/chrome-probe-manual.txt` 不存在

- **严重性**：should-fix
- **证据**：`README.md:106`「证据留档：`docs/evidence/chrome-probe-manual.txt`」；`extensions/webapp/docs/evidence/` 目录下**只有** `gates-and-probe.md`（本次列举实得）。spec §18.3.1 / §24 票 10 也要求该文件（A13/A13b 手工可逆步骤的证据落点）。
- **影响**：README 指向空文件；R-W11（已接受的覆盖缺口）实际**没有手工验收证据**。AC14/AC15 无法判定为"已验收"。
- **建议修法**：执行 spec §18.3.1 的手工可逆步骤并落证据；或在 README 中如实标注"尚未执行"。
- **为什么是 should-fix**：属已接受风险范围内的证据缺口，不改变产品行为；但 README 不得指向不存在的文件。

---

#### DR-016 ｜ `lib/entryFields.mjs` 的模块依赖图注释里文件名写错

- **严重性**：should-fix（文档/注释级）
- **证据**：`lib/entryFields.mjs:20` 注释写
  `* chromeArgs.mjs ──→ entryFields.mjs, nameSanitize.mjs, **profileLimits.mjs**`
  而实际文件是 `lib/profileLimit.mjs`（单数），`chromeArgs.mjs:21` 的 import 也是
  `import { DEFAULT_DISK_CACHE_MB, diskCacheSizeArg } from './profileLimit.mjs'`。
- **影响**：仅注释；但 `test/settings.test.js` 里有一条「防复发门禁：只有一个 profileLimit 模块（不得再出现 `profileLimits.mjs` 分叉）」，说明该名字曾被当作真实风险登记过 —— 注释与门禁自相矛盾。
- **建议修法**：注释改为 `profileLimit.mjs`。
- **为什么是 should-fix**：不影响运行，但与既有门禁冲突，易误导后来者。

---

#### DR-017 ｜ README 的卸载前备份命令只备份 `chrome/`，会漏掉条目库（有数据丢失风险）

- **严重性**：should-fix（**本清单中风险最高的一条**：其余是"功能不可用/描述失实"，这条会造成**不可逆的数据丢失**）
- **证据（README 与 spec 给出的命令不同）**：
  - `README.md:46-50` 实际给的是：
    ```powershell
    $src = Join-Path $env:APPDATA 'obox\extensions\webapp_chenzhi\data\chrome'
    $dst = Join-Path $env:USERPROFILE ("webapp-profile-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    if (Test-Path $src) { Copy-Item $src $dst -Recurse -Force; "已备份到 $dst" } else { "没有可备份的 profile（$src 不存在）" }
    ```
    备份源是 `data\chrome`，**不含 `data\webapp.db`**；`README.md:52` 的还原说明也只讲"把备份目录里的各个 `<name>` 子目录放回 `<扩展目录>/data/chrome/` 下同名位置"。
  - spec §14.4(c)（`spec.md:1096-1104`）给的是**整个 `data`**：
    ```powershell
    # 卸载 webapp 扩展前，备份全部站点的浏览器数据（profile）与条目列表
    $src = "$env:APPDATA\obox\extensions\webapp_chenzhi\data"
    $dst = "$env:USERPROFILE\obox-webapp-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Copy-Item -Recurse -Force "$src" $dst
    # 校验：条目库与 profile 根都应存在
    Test-Path "$dst\data\webapp.db"; Test-Path "$dst\data\chrome"
    ```
    并明确（`spec.md:1106`）：「备份的是整个 `data`（含 `webapp.db` 条目列表、`.obox-meta-webapp.json`、`chrome/**`），因此恢复后**条目与登录态都在**」。
  - spec §14.4(c) 标题（`spec.md:1094`）还要求「README 与 Release 说明里给**同一份**」。
- **期望**：README 的备份命令与 spec §14.4(c) 同一份（备份整个 `data`）。
- **实际**：README 只备份 profile 目录，漏掉 `webapp.db`。
- **影响**：用户按 README 备份 → 卸载 → 重装 → **登录态在，但条目列表全部丢失**，与 spec §14.4(b) 第 1 条"条目、`chrome/**` profile 与其中的登录态原样留下"的承诺直接矛盾，也使 R16 的意图在文档层落空。
- **对应 spec**：§14.4(b) 第 1 条、§14.4(c)、§23 AC18/AC24
- **建议修法**：README 命令改为备份整个 `data` 目录（照抄 spec §14.4(c)），还原说明改为"把 `data\` 拷回 `<扩展目录>\`"。
- **为什么是 should-fix 而非 must-fix**：它不改变代码行为，因此不阻塞"代码可否交付"；但它是**唯一会造成不可逆数据丢失的缺陷**，修复优先级应排在所有文档项之前，建议在 `fix-review` 里按 must-fix 处理。

---

#### DR-018 ｜ spec §9.2 声明的文件清单与真实仓库不符（缺 `LICENSE` / `icon.svg` / `docs/adr/` 等）

- **严重性**：should-fix
- **证据**：本次 `Test-Path` 实得：
  `LICENSE` → False；`icon.svg` → False；`docs/adr` → False
  而 spec §9.2（`spec.md:286-291`）的目标结构明列 `LICENSE`、`icon.svg`、`docs/adr/`；§9.3 亦列 `README.md`、`docs/`。
  另：`extensions/rdp/` 有 `docs/adr/0001-*.md`、`0002-*.md`，spec §9.1（`spec.md:235`）写明「`docs/adr/*` 按 obox 流程在实现阶段产出」，`AGENTS.md` 的开发流程也要求「ADR 写入 tmp/adr/ → 归档到 `<开发目录>/docs/adr/`」。
- **影响**：`AGENTS.md` 强制的"测试 + 独立子代理审视 → ADR 归档"环节未见产物；扩展缺少许可证文件（`package.json:7` 声明 `"license": "MIT"` 但无 `LICENSE` 正文）。
- **建议修法**：补 `LICENSE`（MIT 正文）与 `docs/adr/`（至少记"独立 profile 是设计必然性""缓存白名单 10 项 vs 8 项""`--disk-cache-size` 默认 -1"三条决策），或修 spec §9.2 使之与交付一致。
- **为什么是 should-fix**：不影响运行，但属流程与仓库约定的欠账。

---

### 4.3 nice-to-have

---

#### DR-019 ｜ `formatBytes` 在界面里有两份独立实现

- **证据**：`src/App.vue:288-289` `const units = ['B','KB','MB','GB','TB']` 与 `src/components/WebappCard.vue:47-51`（同口径注释 + 同 units 数组）、`src/components/OverLimitModal.vue:35`（第三次出现同 units 数组）。
- **影响**：三处需同步修改；`lib/profileLimit.mjs:276-289` 才是单一事实来源。
- **建议修法**：抽到 `src/` 下的共享小模块（子应用不依赖 `lib/` 是既定约定，`WebappCard.vue:47` 注释已说明），例如 `src/format.js`。

#### DR-020 ｜ `lib/chromeArgs.mjs` 的 `toWholeNumber` 接受负数

- **证据**：`lib/chromeArgs.mjs:44` `if (!/^-?\d+$/.test(text)) return null` —— 允许 `-` 号；`windowSize` 的合法性靠 `checkPair` 的下限（`:203` `min: 320` / `:204` `min: 240`）兜住。
- **影响**：当前无缺陷（下限拦住了）；但 `checkPair` 与 `toWholeNumber` 若被分别改动，容易出现"校验放行、构造产出负数"的错配。
- **建议修法**：给组合列拆出"仅非负"的窄函数，或加一条注释钉住"下限由 checkPair 负责"。

#### DR-021 ｜ 与 `extensions/rdp` 的重复：`fields.js` / `styles.css` 大段同形

- **证据**：`extensions/webapp/src/fields.js` 10,509 B vs `extensions/rdp/src/fields.js` 37,313 B；`extensions/webapp/src/styles.css` 21,728 B vs `extensions/rdp/src/styles.css` 19,795 B。`lib/chromeArgs.mjs` 的 R14 栅格与 token 约定照搬自 rdp（spec §15.1 明令照搬）。
- **判定**：**可接受**。两个扩展是独立分发的仓库/包（spec §9、§20.3），共享代码需要额外发布通道，收益不抵成本；spec §9.1 也把"照搬结构"定为明确策略。仅登记为长期维护成本（一处视觉修复要改两遍）。

#### DR-022 ｜ `test/chromeArgs.test.js:95-96` 的 `cases` 数组有重复项

- **证据**：`test/chromeArgs.test.js:95-96`：
  ```js
  { windowSize: '' },
  { windowSize: '' },
  ```
- **影响**：无功能影响（只是同一用例跑两遍），属笔误。
- **建议修法**：删掉一条（疑为原本想写 `{ windowDesc: ... }` 或 `windowSize: ','`）。

---

## 5. 需求覆盖复核：R1–R17

判定口径：`满足` / `部分满足` / `未满足` / `证据不足`。**凡涉及用户可见操作的条目，均因 DR-001（`index.js` 未接线）判为未满足。**

| 需求    | 规格要求（要点）                                                                                                                                                                                                                                            | 实现落点                                                                                                                                                                                   | 判定                                            | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | App 卡片专用：`id`/名称/图标/`url`→`ui/index.html`/`multiOpen:false`/约 1024×720；不贡献状态栏、命令、树、快捷键                                                                                                                                            | `index.js:141-153`；`manifest.json:9-17`                                                                                                                                                   | **满足**（R17 后贡献点增加 `settings`，见 R17） | `index.js:149` `url: new URL('./ui/index.html', new URL('.', import.meta.url)).href`（未硬编码，符合 §11.3）；`:150` `multiOpen:false`；`:151-152` `width:1024,height:720`；`manifest.json` 无 `navItems/statusBarItems/...`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **R2**  | 条目 CRUD（列表/新建/编辑/删除+确认），支持多条                                                                                                                                                                                                             | UI 侧完整：`src/App.vue:78/116/146`、`src/components/WebappModal.vue`、`DeleteConfirm.vue`；**入口侧缺失**                                                                                 | **未满足**                                      | `index.js:158-163` 无 `list/save/remove` case → default 返回「未知方法」（DR-001）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **R3**  | 字段 `name`（必填、大小写不敏感唯一）/`url`（必填、仅 http/https）/`desc`（可选、单行限长）/`ignoreCert`（默认 true）                                                                                                                                       | `lib/webapp.mjs:135-142,190-289`；`lib/entryFields.mjs:87-104`；`src/fields.js`                                                                                                            | **部分满足**（纯逻辑层满足，端到端未通）        | `lib/webapp.mjs:139-142` `ignoreCert` 默认 true；`:231-235` 大小写不敏感查重（`nameKey`）；`lib/entryFields.mjs:90-102` 仅 http/https；`lib/webapp.mjs:241` `desc` 限长；`manifest.json` 无字段声明（字段在 `fields.js`）。**未满足项**：无 `list/save` 接线 → 用户无法真正新增                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **R4**  | profile = `<扩展 data 目录>/chrome/<name 净化后>`；目录跟随 `name`，改名时移动，移动失败报错且不改数据                                                                                                                                                      | `lib/chromeArgs.mjs:32-34`（相对路径）、`lib/nameSanitize.mjs`（`PROFILE_ROOT`）、`helper.cjs`（`moveProfile`/`profileStatus`）                                                            | **部分满足**                                    | `lib/chromeArgs.mjs:33` `--user-data-dir=${PROFILE_ROOT}/${sanitizeName(name)}`；`helper.cjs:891` 有 `moveProfile`；**但 `index.js` 无 `save` 接线 → 改名搬目录的端到端流程不存在**；spec §14.2 的"两阶段 intent（`.pending-move.json`）"与"每次 `list` 对账"**未在 `index.js` 实现**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **R5**  | `name` 净化：替换 `\ / : * ? " < > \|`；拒绝 Windows 保留名；去尾部点与空格；长度 ≤240；大小写不敏感去重                                                                                                                                                    | `lib/nameSanitize.mjs`（7,760 B，`sanitizeName`/`isReservedName`/`assertNameLength`/`suggestName`）；`lib/webapp.mjs:200-236`                                                              | **满足**（纯逻辑）                              | `lib/webapp.mjs:200` `illegalChar = /[\\/:*?"<>\|\u0000-\u001f]/`；`:211` `isReservedName`；`:219` `/[. ]$/`；`:224` `assertNameLength`；`:231-235` 去重。`test/nameSanitize.test.js`(8 用例)+`test/webapp.test.js`(15 用例) 覆盖。**注**：spec §12.3 文案表要求"保留名""尾点空格""超长"各给**建议名**，实现均给了（`:209/:214/:222/:227`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **R6**  | 存储 `api.sqlite`，DB 在 `<userData>/extensions/<id>/data/`，升级保留                                                                                                                                                                                       | **未在 `index.js` 实现**                                                                                                                                                                   | **未满足**                                      | `grep` 确认 `index.js` 内无 `api.sqlite.open`（`:28` 定义了 `DB_NAME` 但仅被 `WEBAPP_CONSTANTS` 引用，`:219-225`）；`index.js:18-21` 自述"sqlite 建表与唯一索引落在票 07"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **R7**  | 启动：`api.ipc` 通道 + `helper.cjs`（纯 Node、stdio JSON-RPC），由助手 spawn `chrome.exe`                                                                                                                                                                   | `manifest.json:10-17`（通道声明）、`index.js:95-121`（懒连 + 超时表）、`helper.cjs:889`（`launch`）                                                                                        | **部分满足**                                    | 通道声明正确（`framing:"ndjson"` 显式，见 §10.2）；`helper.cjs` 的 `launch` 存在；**但 `index.js` 无 `open` case → 用户点不到**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **R8**  | Chrome 探测 4 顺位 → 全失败 `[chrome-not-found]`，不静默换浏览器                                                                                                                                                                                            | `helper.cjs` `probe`/`launch`；`test/helper.test.js:105` 断言候选恒 4 项且顺序固定                                                                                                         | **满足**（helper 层）                           | `test/helper.test.js:105`「probe 往返：jsonrpc 2.0、cwd 继承、候选恒为 4 项且顺序固定」通过；`helper.cjs:888` `probe` 在方法表内。**注**：spec §26 第 11 项/R-W11 已接受"命中路径与全不命中两条分支无自动化覆盖"，`docs/evidence/chrome-probe-manual.txt` **不存在**（DR-015）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **R9**  | 固定参数 `--app=<url>`、`--user-data-dir=<R4>`、`--disable-features=DownloadBubble`                                                                                                                                                                         | `lib/chromeArgs.mjs:37,270`                                                                                                                                                                | **满足**                                        | `:37` `DISABLE_FEATURES_ARG = '--disable-features=DownloadBubble'`；`:270` `const args = [appArg(checked.value), userDataDirArg(profileName), DISABLE_FEATURES_ARG]`；`test/chromeArgs.test.js:40-49` 逐项断言                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **R10** | `ignoreCert=true` 追加 `--ignore-certificate-errors` + `--unsafely-treat-insecure-origin-as-secure=<origin>`（允许额外 origin）；`false` 都不传                                                                                                             | `lib/chromeArgs.mjs:38-39,256-286`；`normalizeExtraOrigins:110-161`                                                                                                                        | **部分满足**                                    | 两个参数与"false 都不传"正确（`test/chromeArgs.test.js:51-61`）；额外 origin 的归一/协议一致/≤8/行号文案齐全（`:159-172`）。**未满足项**：**跨集合去重缺陷**（DR-004，单测失败）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **R11** | 白名单开关 6 项（尺寸/位置/最大化/语言/缩放/禁用 GPU），白名单外一律拒绝保存                                                                                                                                                                                | `lib/chromeArgs.mjs:194-231,288-303`；`lib/entryFields.mjs:33-70`（两个枚举）；`lib/webapp.mjs:61-77`（`WHITELIST_KEYS` 6 项）                                                             | **满足**                                        | 6 个参数构造齐全（`:288-303`）；`WHITELIST_KEYS` 恰 6 项（`test/webapp.test.js`「恰好 6 个白名单开关」通过）；D-3 的枚举化正确（`LANG_VALUES` 13 项含 `''`、`SCALE_VALUES` 16 项含 `''`，实测）；「空值不传」正确（`:299-302`，`test/chromeArgs.test.js:92-119`）。**注**：`scaleFactor` 的类型守卫在 `validateWebapp` 而非 `buildChromeArgs`（DR-011，非缺陷）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **R12** | 打开语义：**不跟踪进程**；同 profile 再次启动并入既有实例并新开窗口（预期行为，不算错误）                                                                                                                                                                   | `index.js` 无 `open`；`helper.cjs` `launch` 只回 pid                                                                                                                                       | **未满足**                                      | DR-001；且 spec §14.6/§15.2 第 3b 条的"已知行为"提示在 `src/App.vue` 有文案（`test/componentSource.test.js:97-99` 断言存在），但产生该状态的后端动作不可达                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **R13** | 删除语义：删条目连 profile 一起删（不可恢复）；被占用 → 报错"请先关闭该站点的浏览器窗口"，不杀进程、不留半删目录                                                                                                                                            | `helper.cjs` `removeProfile`/`profileStatus` + `.trash`；`src/components/DeleteConfirm.vue`                                                                                                | **部分满足**                                    | helper 侧有（`helper.cjs:892`），且 `test/helper.test.js:353`「路径防护与 profile 生命周期：rename 两阶段、源不存在、删除进 .trash」通过；`DeleteConfirm.vue` 文案含"不可恢复/浏览器数据"（`test/componentSource.test.js:50-52` 通过）。**未满足项**：`index.js:158-163` 无 `remove` case → 端到端不可达；spec §14.3 第 5 步"每次激活后懒清 `.trash` 残留"**未在 `index.js` 实现**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **R14** | 界面沿用 `rdp` 规范：宿主 token 零自造色值、每项独占一行 + 一行灰说明、下拉取值说明写在选项内、标签列固定宽左对齐、窄窗堆叠、模态框只能按钮关闭                                                                                                             | `src/styles.css`（21,728 B）、`src/components/WebappField.vue:64-69`、`src/components/WebappModal.vue`、`OverLimitModal.vue`、`App.vue`                                                    | **部分满足（证据受限）**                        | 源码门禁通过：`test/componentSource.test.js:32-48`（模态框无遮罩点击/Esc 关闭、三个关闭按钮在）、`:64-69`（`{{ option.value }} — {{ option.label }}`、`:title="option.desc"`、空值项 `value=""` 在最前）、`:105-113`（全仓不得出现 `SingletonLock`）。**证据不足项**：`--label-w:144px` 与 `520px` 断点的**实测测量证据**缺失（spec §15.1 裁定取整为 520px，并要求"若实测需收窄必须补 `docs/evidence/` 测量记录"）；**真实页面交互测试未做**（本报告第 2 节说明）；`test/fieldDocs.test.js` 缺失 → §15.2.2 的 6 条真实断言**无一在册**（DR-010）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **R15** | 界面提示：开着"忽略证书"时列表/详情须有可见标记（TLS 已降级）                                                                                                                                                                                               | `src/components/WebappCard.vue`（`tlsDegraded` computed + `TLS 已降级`）                                                                                                                   | **部分满足**                                    | `test/componentSource.test.js:55-62` 通过：断言 `CARD.includes('TLS 已降级')` 且 `v-if="tlsDegraded"` 由 `props.row?.ignoreCert === true` 派生。**未满足项**：卡片数据来自 `list`（不可达，DR-001）→ 标记在真实使用中不会出现；spec §15.2 第 1 条要求的"编辑模态框里 `ignoreCert` 说明行**始终可见** + 开启时加一行 `⚠ 已关闭该站点的证书校验（TLS 降级）`"**无门禁断言**、未验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **R16** | 升级/覆盖安装必须保留 profile 与登录态；`install(ctx)` 禁止触碰 profile；`pack.mjs` 必须排除 `data/`；README/Release 写清"升级保留 vs 卸载永久删除"                                                                                                         | `index.js:193-198`（`install` 仅日志）、`:214-216`（`uninstall` 仅日志）、`scripts/pack.mjs`、`README.md:33-50`                                                                            | **部分满足**                                    | **已满足**：`install` 实现为**纯日志、零副作用**（`index.js:193-198` 只 `console.log`），符合 §14.4(g-1) 的"只允许幂等动作"（比"允许建表/建目录"更保守，可接受）；`uninstall` 仅日志（`:214-216`），符合 §14.4(d)；`pack.mjs` 实测排除 `data/`（复跑输出条目清单无 `data/`）；README §2.1 有对比段与备份命令（`:33-50`）。**未满足项**：① spec §14.4(d)/g-1 的**源码门禁** `test/uninstall.test.js` **不存在**（DR-010）→ "不得搬运 profile"无自动回归；② `install` 未按要求 `mkdir -p chrome/` 或建表（spec 允许但不要求，属最保守选择，**不判缺陷**）；③ AC16/AC17/AC18（升级链路真机验收）**无证据文件**；④ README 的备份命令与 spec §14.4(c) 的命令**不一致**（README 只备份 `data\chrome`，spec 备份整个 `data` 含 `webapp.db` 条目列表）→ 按 README 备份**会丢条目列表**，属**新发现的具体缺陷**（见 DR-017）                                                                                                                                                                                                                                                                                                                         |
| **R17** | ① 全局设置上限（默认 2 GB，可调可关，不做每连接覆盖）② 固定参数新增 `--disk-cache-size`（并注明与目录上限是两回事）③ 打开前预检（量体积+TTL+超限拦截+两个动作）④ 全局一键清理缓存（保留登录态）⑤ 卡片按需显示体积 ⑥ `profileSize`/`cleanCaches` 契约 ⑦ 验收 | `manifest.json:18-52`（设置声明）、`lib/profileLimit.mjs`（归一/白名单/TTL/文案）、`helper.cjs:893-894`（`profileSize`/`cleanCaches`）、`src/components/OverLimitModal.vue`、`src/App.vue` | **未满足**（②③⑤⑦）／**部分满足**（①④⑥）         | **①**：设置**已声明**（`manifest.json:18-52`，2 个 select，默认 `"2048"`/`"-1"`）但**无人读取**（DR-003）→ 实质未满足；**②**：`lib/profileLimit.mjs:91-98` `diskCacheSizeArg` 已实现且正数按字节（`test/chromeArgs.test.js:309-311` 实测 `512→536870912`），**但默认值与 spec 冲突**（DR-005）；**③**：`helper.cjs:893` 有 `profileSize`（TTL 语义 `lib/profileLimit.mjs:143-150`，`test/settings.test.js` 有 TTL 用例），**但 `index.js` 无 `open` 预检分支、`[profile-over-limit]` 无产出方**（DR-002/003）→ 未满足；**④**：`helper.cjs:894` `cleanCaches` + 白名单（10 项，DR-006）+ `test/helper.test.js:219`「只删白名单缓存，保留清单逐字节不变，深度 3 不删」**通过**、`:319`「省略 name = 遍历全部条目；目录不存在的条目进 skipped」**通过** → helper 层满足，**但界面调用不可达**（DR-001）；**⑤**：`src/App.vue:195/272` 有 `profileSize` 调用、`WebappCard.vue` 有体积显示 → UI 在，**数据不可达**；**⑥**：`helper.cjs` 两个方法在册，契约形状需按 §11.2 逐字核对（本次未逐字段核对，标**证据不足**）；**⑦**：`test/helperCache.test.js`/`test/helperSize.test.js`/`test/fieldDocs.test.js` **缺失**（DR-010），AC25–AC29 无证据 |

**未满足/证据不足条目汇总**：R2（未满足）、R6（未满足）、R12（未满足）、R17（未满足）；R3、R4、R7、R10、R13、R14、R15、R16（部分满足）；R17⑥ 契约逐字段核对（证据不足）。

---

## 6. 两个失败测试的独立判定

| 用例                                                                 | 位置                                             | 独立判定                                                | 依据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extraOrigins：多行 → 逗号连接、主 origin 恒在最前、去重、空行忽略`  | `test/chromeArgs.test.js:145-157`，失败在 `:153` | **真实产品缺陷**（must-fix → DR-004）                   | `lib/chromeArgs.mjs:281-284` 合并主 origin 与 `extraOrigins` 时未跨集合去重；`normalizeExtraOrigins`（`:110-161`）的 `seen` 集合只覆盖 extraOrigins。`https://B` 在函数内已被去重为 `https://b`，但主 origin 恒被前置且不比对。复跑输出 `actual: '...,https://a,https://b,https://a'` vs `expected: '...,https://a,https://b'`                                                                                                                                                                                                                                             |
| `枚举边界（表驱动，D-3）：scaleFactor 15 项合法、其余一律字段级错误` | `test/chromeArgs.test.js:218-250`，失败在 `:244` | **测试脚手架问题，不是产品缺陷**（should-fix → DR-011） | 实测：`normalizeWebapp({scaleFactor:1.5}).scaleFactor === "1.5"`（`lib/webapp.mjs:96-98,150` 按设计把字符串列统一成字符串）；失败用例走 `errorsOf()` = `buildChromeArgs(normalizeWebapp(input))`（`test/chromeArgs.test.js:25-38`），**不传 `raw`** → 绕过 `lib/webapp.mjs:168-177` 的原值类型守卫。生产校验路径 `validateWebapp(entry, [], {raw:{scaleFactor:1.5}})` 实测返回 `{"ok":false,"errors":[{"field":"scaleFactor","message":"缩放比例不在可选清单内（请从下拉中选择）"}]}`，对 `'1.5'` 返回 `{"ok":true}`，对 `'1.3'` 返回错误 —— **完全符合 spec §12.3/§15.2** |

**补充**：任务书提到的 `EPERM ... obox-webapp-helper-*` 两个失败与"测试挂起"**已消失**。本次复跑 `node --test --test-timeout=20000` 在 **1,405 ms** 内正常结束（`duration_ms 1405`），且 `%TEMP%` 下 `obox-webapp-helper-*` 目录数为 **0**。因此那两条与"挂起"我判定为**已解决的临时环境/脚手架竞态**，不阻塞交付、也不再计入失败。当前 2 条失败与它们**无关**。

---

## 7. 文档与实现不一致清单（该以哪边为准）

| #   | 文档陈述                                                                                                                  | 实现/规格事实                                                                                          | 该以哪边为准                                                                                   | 处置                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `README.md:27-31` 把"新建/打开/编辑/删除/清理缓存"列为可用操作                                                            | `index.js:158-163` 只有 `probe`                                                                        | **实现事实为准**                                                                               | README 必须删掉未实现的能力声明，或在实现补齐后再写（DR-012）                        |
| 2   | `README.md:59` + `manifest.json:41` 说 `webapp.diskCacheMb` 默认 `-1`                                                     | spec §10.4（`spec.md:458`）/§12.1（`:669`）/§22 I14（`:1902`）说默认 `512`                             | **未裁定，须用户定**（DR-005）；实现内部（README vs manifest vs 代码）**自洽**，与 spec 不自洽 | 二选一：补 amendment 改 spec，或改实现回 512                                         |
| 3   | `README.md:70` + `lib/profileLimit.mjs:171-182` 说清理白名单含 `BrowserMetrics`/`optimization_guide_model_store`（10 项） | spec §14.5（`spec.md:957-966`）/§16（`:1300`）/S18（`:1883`）/I17（`:1905`）说**8 项**且**不含**这两项 | **spec 为准**（白名单是安全边界，扩面须走修订）                                                | 补 amendment 写清 10 项及其理由；同时修 `lib/profileLimit.mjs:10` 的"8 个"（DR-006） |
| 4   | `lib/profileLimit.mjs:10`「缓存白名单是 **8 个**固定目录名」                                                              | 同文件 `:171-182` 是 **10 项**                                                                         | **代码为准**（注释错）                                                                         | 改注释（DR-006 附带）                                                                |
| 5   | `docs/evidence/gates-and-probe.md:9-10` 门槛表最新记录 `fail 1` / prettier `exit 1`                                       | 本次实跑：`tests 99 / pass 97 / fail 2`；prettier **exit 0**                                           | **本次实跑输出为准**                                                                           | 回填该表（测试计数、prettier 退出码、时间、产物字节数）（DR-013）                    |
| 6   | `docs/evidence/gates-and-probe.md:19` 产物「222,841 字节」                                                                | 本次复跑 `pack.mjs` → **225,443 字节**（`ui/assets/index-DK0gm9jk.js`）                                | **本次实跑为准**                                                                               | 回填（DR-008/DR-013）                                                                |
| 7   | `docs/evidence/gates-and-probe.md:14`「需在 `do-review` 前清零」                                                          | 未清零                                                                                                 | **文档自身为准则被违反**                                                                       | 先清零再复跑（DR-007）                                                               |
| 8   | `README.md:106` 指向 `docs/evidence/chrome-probe-manual.txt`                                                              | 该文件不存在                                                                                           | **文件系统为准**                                                                               | 执行 §18.3.1 并落证据，或标注"尚未执行"（DR-015）                                    |
| 9   | `lib/entryFields.mjs:20` 依赖图写 `profileLimits.mjs`                                                                     | 实际 `profileLimit.mjs`（`lib/chromeArgs.mjs:21` 的 import 为准）                                      | **代码为准**                                                                                   | 改注释（DR-016）                                                                     |
| 10  | `README.md:46-50` 备份 `data\chrome`，还原只讲 profile 子目录                                                             | spec §14.4(c)（`spec.md:1096-1106`）备份整个 `data`（含 `webapp.db` 条目库）                           | **spec 为准**（否则丢条目库）                                                                  | 改 README 命令与还原说明（DR-017）                                                   |
| 11  | spec §9.2（`spec.md:286-291`）列 `LICENSE`/`icon.svg`/`docs/adr/`                                                         | 三者均不存在                                                                                           | **文件系统为准**                                                                               | 补文件或改 spec（DR-018）                                                            |
| 12  | spec §9.2/§9.3 列 `src/settings.js`；§18.1/§18.2 列 6 个测试文件                                                          | 均不存在（设置归一改放 `lib/profileLimit.mjs`）                                                        | **实现为准**（重构合理），但 spec 须同步                                                       | 改 spec §9.2/§9.3/§18 + 补测试（DR-010/DR-018）                                      |
| 13  | spec §26 第 4 项（`spec.md:2010`）要求把 Chrome 版本号回填 `docs/evidence/chrome-probe-stage1.txt` 并在 README 标注       | 该文件不存在；`gates-and-probe.md:27` 有版本 `Chrome 154.0.8037.98`                                    | **证据文档为准**（有版本号）                                                                   | 落 `chrome-probe-stage1.txt` 或在 README 标注验证版本                                |

**可用作判定依据、本轮直接采信（未复跑）**：`gates-and-probe.md:29-38` 的真机探针表（`--app` 生效、窗口参数精确生效、两个证书参数的区分、同 profile 二次启动忽略进程级参数、Windows 无 `SingletonLock`、关窗 ~0.8s 全退、`--disk-cache-size` 语义、体积地板 ≈17 MB / `optimization_guide_model_store` ≈40 MB / `BrowserMetrics` +4MB/次）。第 3.1 节的 5 条未核实项（`:42-46`）与任务书一致，**如实登记，不得当作已核实，也不得当作缺陷**。

---

## 8. 通过项（已独立验证）

| 项                       | 命令/方式                                                                                | 结果                                                                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 清单校验                 | `node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json` | `✓ …: 通过`；`0 个 error、0 个 warning`；exit 0 ✅                                                                                                                                                                                                                       |
| 代码风格                 | `npx prettier --check .`                                                                 | `All matched files use Prettier code style!`；exit 0 ✅                                                                                                                                                                                                                  |
| 打包                     | `node scripts/pack.mjs`                                                                  | exit 0；`225,443 字节，11 个条目`；`manifest.json` 在根；`lib/(4)`+`ui/(3)`；**无 `data/`、无 `src/`、无 `test/`** ✅                                                                                                                                                    |
| helper 纯逻辑与集成      | `test/helper.test.js` 7 用例全通过                                                       | 含「probe 候选恒 4 项且顺序固定」（R8）、「cleanCaches 只删白名单缓存、保留清单逐字节不变、深度 3 不删」（R17④ 核心保障）、「cleanCaches 省略 name = 遍历全部条目 + skipped 不报错」、「路径防护与 profile 生命周期（rename 两阶段、删除进 .trash）」、「stdout 纯净性」 |
| 名称净化与数据模型       | `test/nameSanitize.test.js`(8) + `test/webapp.test.js`(15) 全通过                        | R3/R5 纯逻辑、文案表逐条匹配、`COLLATE NOCASE` 口径查重、`toDbRow/fromDbRow` 类型往返、`WHITELIST_KEYS` 恰 6 项                                                                                                                                                          |
| 安全边界（删除面）       | `test/helper.test.js:219` + `classifyCachePath`（`lib/profileLimit.mjs:250-269`）        | 白名单外不删；`. / ..` 与深度 >2 拒绝；保留清单任一命中即拒；**未发现会误删 Cookie/Login Data/IndexedDB/Service Worker 的路径**                                                                                                                                          |
| 路径越界防护             | `helper.cjs` 的 `--user-data-dir` 校验（`-32602`）+ `test/helper.test.js:353`            | 相对路径单层 `chrome/<名>`、拒 `..`/盘符/绝对路径；实测通过                                                                                                                                                                                                              |
| 反 `SingletonLock` 门禁  | `test/componentSource.test.js:105-113`                                                   | 全仓源码不得出现 `SingletonLock`；通过（与 amendment 03 的三处纠正一致）                                                                                                                                                                                                 |
| 模态框只能按钮关闭       | `test/componentSource.test.js:32-48`                                                     | 无 `@mousedown.self`/`@click.self`/`Escape`/`keydown`；三个关闭按钮在；通过                                                                                                                                                                                              |
| R14 下拉规范（源码级）   | `test/componentSource.test.js:64-69`                                                     | `{{ option.value }} — {{ option.label }}`、`:title="option.desc"`、`option.optional` → 空值项 `value=""` 在最前；通过                                                                                                                                                    |
| R17 拦截模态框三按钮     | `test/componentSource.test.js:79-84`                                                     | `clean`/`force`/`close` 三按钮 + 「保留登录状态与 Cookie」；通过                                                                                                                                                                                                         |
| manifest `settings` 形状 | `test/manifest-settings.test.js`(8) 全通过                                               | 键名/类型/`select.options` 完整性——**这是唯一的 settings 形状防线**（校验器与宿主都不查）                                                                                                                                                                                |
| 与 rdp 的接口约定        | 对读 `extensions/rdp/{manifest.json,index.js,helper.cjs}`                                | 通道声明形态（`ipcChannels` + `stdio` + `ndjson` + 相对 `program`）、`ok/fail` 信封、懒连接 + `onClose` 重置、`--selftest` 形态、打包白名单均同构；**唯一有意偏离是 DR-002 的 `data` 信封（尚未实现）**                                                                  |

---

## 9. 残余风险登记

| ID                                                  | 风险                                                   | 状态                                                                                                                                                   | 说明                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| R-W1                                                | 同 profile 二次启动忽略进程级参数                      | **已核实**（真机探针）                                                                                                                                 | 已在 spec/README 写清，非缺陷                                                                 |
| R-W11                                               | `probe` 的 4 顺位命中与"全不命中"无自动化覆盖          | **已接受**（用户）                                                                                                                                     | 手工步骤在 spec §18.3.1；但 `chrome-probe-manual.txt` 不存在 → 实际**尚无验收证据**（DR-015） |
| R-W15                                               | 体积节流挡不住非缓存增长（IndexedDB/SW/Local Storage） | **已接受**                                                                                                                                             | README §4 第 3 条已如实写明；`PROTECTED_DIR_NAMES` 正确保留 `Service Worker`/`IndexedDB`      |
| R-W16                                               | GB 级首次扫描可能很慢                                  | **未核实**                                                                                                                                             | spec §26 第 15 项；TTL 60s + 按需扫描已缓解                                                   |
| R-W17                                               | 清理与运行中 Chrome 竞争 → 部分目录进 `skipped`        | **未核实**                                                                                                                                             | spec §26 第 14 项；已按"如实提示、不重试、不杀进程"处理                                       |
| R-W13                                               | 覆盖安装时宿主搬回 `data/` 失败只记日志                | **未核实（宿主行为）**                                                                                                                                 | 扩展无法消除；缓解 = 升级前备份 + A14                                                         |
| 新: `--disk-cache-size` 是否真限体积                | **未核实**                                             | spec §26 第 13 项；**探针阶段一已实测"正数不限总量、`-1` 才禁用"**（`gates-and-probe.md:37`）→ 该实测结果**支持**实现选 `-1`，但 spec 未吸收（DR-005） |
| 新: `--disable-gpu` 是否仅首个进程读取              | **未核实**                                             | spec §18.4.3 Q-1；README §6.5 已登记                                                                                                                   |
| 新: `--force-device-scale-factor` 未做真机验证      | **未核实**                                             | README §6.5 已登记                                                                                                                                     |
| 新: 窄窗断点 520px 与 `--label-w:144px` 的测量依据  | **无证据**                                             | spec §15.1 裁定取整但要求"若收窄须补测量记录"；未见 `docs/evidence/` 测量文件                                                                          |
| 新: 真实页面交互（深浅主题、窄窗堆叠、模态框、Esc） | **未验证**                                             | 本轮为只读审视且禁止同步到 `%APPDATA%`；需宿主安装后人工验收（AC19/AC20）                                                                              |

---

## 10. 后续建议

1. **不要进入 `fix-review` 的自动循环**：Goal Mode 授权账本 `implementation-report.md` 缺失（DR-009），且 must-fix 里 DR-005/DR-006 属"需用户裁定的产品决策"（命中 spec §1 暂停条件第 11 条），必须先由用户拍板。
2. **需用户裁定的两件事**（各一个 Decision Question，不在此展开为多个问题）：
   - `webapp.diskCacheMb` 默认值取 `-1`（实现现状，有真机依据）还是 `512`（spec 现状）？（DR-005）
   - 清理白名单取 10 项（实现现状：+`BrowserMetrics`+`optimization_guide_model_store`）还是 spec 的 8 项？（DR-006）
3. **裁定后进入 `fix-review`** 产出修复规格，必须包含：DR-001（`index.js` 8 方法 + sqlite + 预检接线）、DR-002（`data` 信封）、DR-003（设置读取）、DR-004（去重）、DR-005/006（按裁定同步 spec 或实现）、DR-007（AC1 全绿）、DR-008（重打包）、DR-009（补账本）、DR-010（补 6 个测试文件，尤其 `test/index.test.js` 与 `test/uninstall.test.js`）、DR-011（改测试）、DR-012/013/015/017（文档回填，其中 DR-017 涉及数据丢失，最高优先）。
4. **修复后必须复跑并回填证据**：`node --test --test-timeout=20000`、`npx prettier --check .`、`npm run build`、`node scripts/pack.mjs` + 解包核对、`validate-manifest.mjs`。
5. **本报告不构成 `can ship`**；在 DR-001–DR-009 全部关闭并复跑全绿之前，任何 Release/tag 动作都不应发生。

---

## 11. 审视产物

- 本报告（最新权威摘要）：`.spec-workflow/webapp-extension/review-report.md`
- 本轮 append-only 通过报告：`.spec-workflow/webapp-extension/review-reports/01-webapp-extension-final.md`
- 本轮**未**产生 `verification/` 下的截图/抓包类证据（未做真实页面交互，原因见第 2 节）；命令输出已内联在本报告第 4/6/8 节。
- 本轮**未**启动子代理（深度上限 1，见封面"协调结构"）；记录人即主审，四轴本地分离。
