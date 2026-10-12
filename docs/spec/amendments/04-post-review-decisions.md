# Amendment 04 · do-review 后裁定与处置（2026-10-12 23:15）

本文件回应 `.spec-workflow/webapp-extension/review-report.md` 的 must-fix / should-fix，逐条给出**事实、裁定与落点**。
裁定依据优先级：**用户已确认的决策 > 真机实测 > 规格原文**；规格与用户决策冲突处，以用户决策为准并在此登记。

## 1. 用户裁定（关闭 DR-005 / DR-006）

do-review 指出两处"实现与 spec 冲突"，二者**都不是实现跑偏，而是 spec 未及时追上用户的正式决策**：

| 项                          | spec 原文                | 实现      | 裁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webapp.diskCacheMb` 默认值 | `512`（§10.4/§12.1/I14） | **`-1`**  | **以 `-1` 为准**。用户在看到真机证据后明确选择"禁用磁盘 HTTP 缓存"（选项 C）：`--disk-cache-size` **不限制单次会话总量**（20 MB cap 下 300 MB 流量 → `Default\Cache` 301.998 MB），正数只在**下次启动**清空超限缓存且充当**单条准入阈值 ≈ cap/8**，**只有 `-1` 实测 `Default\Cache` 为 0 字节 0 文件**。设置项选项为 `-1/0/128/512/1024`，默认 `-1`                                                                                                                                                                 |
| `cleanCaches` 白名单        | 8 项                     | **10 项** | **以 10 项为准**。用户明确选择"再加上 `optimization_guide_model_store`"：原 8 项（`Cache`/`Code Cache`/`GPUCache`/`GrShaderCache`/`ShaderCache`/`DawnGraphiteCache`/`DawnWebGPUCache`/`Crashpad`）**加** `BrowserMetrics`（每次启动 +4 MB，会累积）与 `optimization_guide_model_store`（≈40 MB，Chrome 会重建）。保留清单不变（Cookies / Login Data / Web Data / Local Storage / Session Storage / IndexedDB / **Service Worker** / **CacheStorage** / Preferences / History / Bookmarks / Favicons / Extensions…） |

> 因此 spec §10.4、§12.1、§14.5 的对应数值以**本 amendment** 为准；`lib/profileLimit.mjs` 文件头"8 个"的自相矛盾注释需一并改为 10 项（DR-006 的注释部分）。

## 2. 已在实现侧关闭的 must-fix（附独立复核证据）

| ID     | 原问题                                               | 现状与证据（协调者 23:14 亲自复跑）                                                                                                                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-001 | `index.js` 只有 `probe`，其余 7 个方法返回"未知方法" | ✅ 已修：`index.js` **恰好 8 个 case**（`L601 list`/`L603 save`/`L605 remove`/`L607 open`/`L609 probe`/`L611 profileInfo`/`L613 profileSize`/`L615 cleanCaches`）；sqlite 建表 + `COLLATE NOCASE` 唯一索引（2 处）、`api.settings`（6 处）、`[profile-over-limit]`（3 处）、`[profile-size-failed]`（2 处）、`moveProfile`（7 处）、`removeProfile`（3 处） |
| DR-003 | `api.settings` 在 `src` 零命中，上限设置无人读取     | ✅ 已修：读取在 `index.js`（`api.settings.get('webapp.profileLimitMb','2048')` / `'webapp.diskCacheMb','-1'`，档位外回落 + warn），并按 §14.6⑥ 以 `settingsChanged` 触发下一次 `profileSize` 带 `force`                                                                                                                                                     |
| DR-004 | `extraOrigins` 与主 origin 未跨集合去重              | ✅ 已修：主 origin 恒在最前 + 跨集合去重（大小写不敏感）+ 空行忽略 + 逗号连接；`test/chromeArgs.test.js` 钉住                                                                                                                                                                                                                                               |
| DR-007 | AC1 未达成（99/97/2），spec 要求 do-review 前清零    | ✅ 已达成：`node --test --test-timeout=30000` = **106 / 106 / 0**                                                                                                                                                                                                                                                                                           |
| DR-008 | `out/webapp-1.0.0.oix` 陈旧（222,841 B）             | ✅ 已重建：**244,074 B / 11 条目**；重跑 `pack.mjs` 字节完全一致（幂等）；`manifest.json` 为第一项，**无 `data/`、无 `src/`**                                                                                                                                                                                                                               |
| DR-011 | `scaleFactor=1.5` 失败被误判为产品缺陷               | ✅ 按裁定**改测试、未改产品**：生产路径 `validateWebapp(entry, [], { raw })` 的类型守卫行为正确保留；失败用例改为在 `buildChromeArgs(normalizeWebapp(...))` 路径上断言"数值被归一为字符串枚举"，类型守卫断言留在 `test/webapp.test.js`                                                                                                                      |
| DR-002 | `fail()` 信封无 `data`，界面用字符串前缀判据         | **部分保留、记为可接受**：规格 §14.6/S17 只在"超限需用户选择"这一种场景要求 `data`，该场景的返回**已带** `data:{overLimit:true,…}`；通用 `fail()` 不带 `data` 是简化的错误信封。字符串前缀判据与 `data.overLimit` 并存，界面两者都可用（后续如需收紧，改 `src/App.vue` 判据即可，不影响契约）                                                               |

## 3. 测试文件与规格命名的差异（关闭 DR-010）

规格曾按"一文件一主题"给测试命名，实现改为**合并主题**（主题覆盖不减少，文件数更少）；同时补上了审视报告要求的**反逃逸门禁**：

| 规格文件名                                     | 实际落点                                                                          | 覆盖内容                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/index.test.js`                           | **`test/ipcSurface.test.js`**(5,927 B)                                            | **双向断言**：`src/**` 里 `callExtension('x')` 的每个 x 必须在 `index.js` 有 `case`；反之 `index.js` 的每个方法必须有界面调用点；并断言分发表恰 8 个、`api.settings` 真读两个键、真产出 `[profile-over-limit]`/`[profile-size-failed]`、真建 `COLLATE NOCASE` 唯一索引、改名/删除分别衔接 `moveProfile`/`removeProfile`、无 `journal.baj` 硬编码 |
| `helperProfile/helperCache/helperSize.test.js` | **`test/helper.test.js`**(17,490 B)                                               | 助手契约、协议错误形状（含 `--disk-cache-size` 值域含 `-1`）、`cleanCaches` 白名单/保留清单/深度 3 不删、`profileSize` 与 TTL、越权与未知方法                                                                                                                                                                                                    |
| `fieldDocs.test.js`                            | **`test/fields.test.js`**(9,390 B) + **`test/componentSource.test.js`**(6,287 B)  | 缩放 15 项 / 语言 12 项枚举、下拉说明与 `title`、标签列与窄窗堆叠、模态框按钮关闭、不含 `SingletonLock` 字样                                                                                                                                                                                                                                     |
| `uninstall.test.js`                            | **`test/settings.test.js`** + `componentSource`                                   | 白/黑名单交集为空、10 项白名单逐项、`install`/`uninstall` 钩子为纯日志（不搬 profile）                                                                                                                                                                                                                                                           |
| `src/settings.js`                              | **不需要**：设置读取落在 `index.js`（`api.settings`），界面在 `src/**` 内直接消费 |

**这种合并曾有代价**：DR-001（接线层缺失）逃逸的原因正是"没有一条测试走 `index.js`"。`test/ipcSurface.test.js` 的加入就是针对该逃逸路径的门禁，且它上线当场抓出 `probe`/`profileInfo` 无界面入口（未被削弱断言，二者被接进 UI：顶栏「环境检查」按钮 + 删除确认框只读预检）。

## 4. 文档失实与数据安全（DR-012/013/015/017）

| ID                                     | 处置                                                                                                                                                                                                    | 落点                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **DR-017**（唯一会造成不可逆数据丢失） | ✅ **已修（协调者改）**：README 的卸载前备份命令从"只备份 `data\chrome`"改为**备份整个 `data`**（含条目库 `webapp.db`），并加两条校验输出（`webapp.db` 是否存在、`chrome/` 下站点目录数）；还原说明同步 | `README.md` §2.1                        |
| DR-015                                 | ✅ 已修：新建 `docs/evidence/chrome-probe-manual.txt`（带基线/步骤/还原校验/结论的可填写模板），README §5 的引用不再指向不存在的文件                                                                    | `docs/evidence/chrome-probe-manual.txt` |
| DR-013                                 | ✅ 已修：`gates-and-probe.md` 的门槛表回填为最终全绿值、打包产物更新为 **244,074 B / `index-B9RBvIgX.js`**，并新增 §2.1 接线层证据与"改完源码必须 build 再 pack"的时间戳纪律                            | `docs/evidence/gates-and-probe.md`      |
| DR-012                                 | ✅ 已修：README 撤回"未实现能力"的可用性表述；README §6.1 的模块职责按实现更正（`lib/webapp.mjs` = 归一/校验/库行互转，业务编排在 `index.js`），并更正调试态 id 为 `webapp@<路径>`                      | `README.md`                             |
| DR-014                                 | ✅ 已复核无问题：`package.json` 的 `description` 为正常 UTF-8 中文（无乱码）                                                                                                                            | `package.json`                          |
| DR-016                                 | ✅ 已修：注释里的 `profileLimits.mjs` 字样更新（该模块已合并删除）                                                                                                                                      | `lib/entryFields.mjs`                   |
| DR-018                                 | `LICENSE`：**建仓时补**（发布步骤内执行）；`icon.svg`：`manifest.json` **未声明图标**，故非缺陷，列为可选美化；`docs/adr/`：本扩展无宿主级架构决策，个别实现取舍已在本 amendment 与 spec 内记录         | 发布步骤                                |

## 5. 未核实项（保持登记，不因审视而改写）

`--disable-gpu` 是否同属"仅首个进程读取"、`--force-device-scale-factor` 未做真机验证、`--disk-cache-size` 超限是"清空"还是"裁剪到上限"、GB 级 profile 扫描耗时、Chrome 窗口开着时 `cleanCaches` 的失败分布。
另：**真实页面交互验收（A1–A29）尚未执行**（用户裁定：先完成审视与发布，随后做真机验收）。
