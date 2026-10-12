# 审视通过报告 01 ｜ webapp-extension 最终交付审视（append-only）

- **通过编号**：`01`
- **pass-slug**：`webapp-extension-final`
- **日期**：2026-10-12（本机本地时间 23:0x–23:2x）
- **审视阶段**：SpecWorkflow 阶段 4 `do-review`
- **报告类型**：**append-only**（不覆盖历史；后续通过请新建 `02-*.md`，并在 `review-report.md` 更新指针）
- **最新权威摘要**：`.spec-workflow/webapp-extension/review-report.md`（本通过报告是其快照与索引，若两者冲突以 `review-report.md` 为准）

## 权威元数据

- `Authority: local-spec-workflow`
- 权威需求源：`.spec-workflow/webapp-extension/requirements.md`（R1–R15）
- 权威规格源：`.spec-workflow/webapp-extension/spec.md`（2021 行）+ `amendments/01-close-four-decisions.md` + `amendments/02-profile-size-limit.md` + `amendments/03-probe-stage1-feedback.md`
- 外部 tracker：无（未使用 `Authority: external-tracker-only`）
- 本地缓存状态：无 `implementation-report.md`（Goal Mode 运行期账本缺失 → DR-009）
- 审查基线：`master` @ `831832e`，工作区仅 `.spec-workflow/` 未跟踪

## 审视来源清单（实际读过）

| 类别 | 来源 |
|---|---|
| 需求 | `requirements.md`（119 行，全读） |
| 规格 | `spec.md`（1–340、340–639、640–1039、1039–1338、1810–2009、2009–2021，覆盖 §1–§26 全部章节标题与关键正文） |
| 修订 | `amendments/01`（121 行，全读）、`amendments/02`（139 行，全读）、`amendments/03`（124 行，全读） |
| 实现 | `manifest.json`、`index.js`（225 行，全读）、`helper.cjs`（方法表 + 协议循环精读，共 1254 行）、`lib/chromeArgs.mjs`（328 行，全读）、`lib/profileLimit.mjs`（297 行，全读）、`lib/entryFields.mjs`（128 行，全读）、`lib/webapp.mjs`（§88-237 精读）、`src/App.vue`、`src/components/*`、`scripts/pack.mjs`（复跑）、`test/**`（10 文件，含 `chromeArgs.test.js` 全读） |
| 文档（审视对象） | `README.md`（172 行，全读）、`docs/evidence/gates-and-probe.md`（67 行，全读） |
| 参照实现 | `extensions/rdp/{manifest.json,index.js,helper.cjs,lib/*,src/*,test/*,scripts/pack.mjs}`（结构与契约对读） |
| 宿主事实 | `src/api/contributions.ts`、`src/main/oixCore.ts`、`src/main/capabilities.ts`（经 spec 与证据文档的带行号引用交叉核对，未逐一复读） |

## 执行的命令与结果（全部为只读或可重复）

| 命令 | 结果 |
|---|---|
| `node --test --test-timeout=20000`（`extensions/webapp`） | `tests 99` / `pass 97` / `fail 2` / `duration_ms 1405` / **exit 1** |
| `npx prettier --check .` | `All matched files use Prettier code style!` / **exit 0** |
| `node scripts/pack.mjs` | `已打包: out/webapp-1.0.0.oix（225443 字节，11 个条目）` / **exit 0** |
| `node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json` | `✓ …: 通过`；`0 个 error、0 个 warning` / **exit 0** |
| `[System.IO.Compression.ZipFile]::OpenRead(out/webapp-1.0.0.oix)` | 11 条目；含 `manifest.json`/`helper.cjs`/`index.js`/`lib(4)`/`ui(3)`；**无 `data/`** |
| 临时脚本（`%TEMP%\obox-webapp-review-probe.mjs`，未写入仓库） | 确认 `normalizeWebapp(1.5)→"1.5"`；`validateWebapp(...,{raw})` 正确报错 → DR-011 判定为测试问题 |
| `Test-Path` 清单 | 6 个 spec 要求的测试文件 + `src/settings.js` + `LICENSE` + `icon.svg` + `docs/adr` **均不存在** |
| `Get-ChildItem $env:TEMP -Filter 'obox-webapp-helper-*'` | Count = **0**（此前 EPERM 失败与挂起已消失） |

## 交付判定

| 项 | 结论 |
|---|---|
| 完成度分类 | **`incomplete`** |
| Ship Decision | **`cannot ship`** |
| 真实前端交互测试 | **未执行**（只读审视 + 任务书禁止同步到 `%APPDATA%`）→ 按技能规则不得判 `can ship` |
| 内置代码审视 | **已执行**（Standards 轴 + Spec 轴本地分离，见 `review-report.md` 第 2 节 DAG） |
| 是否进入 `fix-review` | **不由本阶段自动进入**：Goal Mode 账本缺失（DR-009）+ DR-005/DR-006 命中暂停条件第 11 条（需用户裁定） |
| 子代理 | **未启动**（会话 `subagent` 深度上限 1，派生报 `subagent depth 2 exceeds maxDepth 1`）；四轴本地分离，记录人即主审 |

## 发现索引（22 条）

### must-fix（9）

| ID | 标题 | 关键证据 |
|---|---|---|
| DR-001 | `index.js` 只实现 `probe`，界面调用的 7 个方法全落到「未知方法」 | `index.js:18-21`、`index.js:158-163`、`src/App.vue:78/116/146/164/195/212/247/272`、`helper.cjs:887-895` |
| DR-002 | `fail()` 信封无 `data`，界面改判字符串前缀，与 spec §14.6/S17 不一致 | `index.js:66-69`、`spec.md:1021-1023`、`src/App.vue:26,175` |
| DR-003 | R17 全局上限设置无读取方（`api.settings` 零命中） | `manifest.json:18-52`、`lib/profileLimit.mjs:22-25`、spec §10.4 `spec.md:462-465` |
| DR-004 | `extraOrigins` 与主 origin 未跨集合去重（单测失败） | `lib/chromeArgs.mjs:281-284`、`test/chromeArgs.test.js:145-157,153` |
| DR-005 | `--disk-cache-size` 默认 `-1` 与 spec 默认 `512` 冲突且无 amendment | `lib/profileLimit.mjs:32-34`、`manifest.json:41`、`spec.md:458/669/1902` |
| DR-006 | 清理白名单 10 项 vs spec 8 项，且文件头注释自相矛盾 | `lib/profileLimit.mjs:10,171-182`、`spec.md:957-966/1300/1883/1905` |
| DR-007 | AC1 未达成（99/97/2），"交付前必须复跑并全绿"未执行 | `spec.md:1914`、`gates-and-probe.md:9,14` |
| DR-008 | `out/webapp-1.0.0.oix` 陈旧（222,841 B → 225,443 B） | 产物 mtime 22:58:01 vs `lib/profileLimit.mjs` 22:58:49；复跑输出 |
| DR-009 | Goal Mode 运行期账本 `implementation-report.md` 缺失 | `glob .spec-workflow/**/*.md` = 5 个文件，无账本 |

### should-fix（9）

| ID | 标题 | 关键证据 |
|---|---|---|
| DR-010 | 6 个 spec 要求的测试文件缺失（含 `test/index.test.js`、`uninstall`/`fieldDocs`/`helperProfile`/`helperCache`/`helperSize`）→ 已实际导致 DR-001 逃逸 | `Test-Path` 全 False；`test/componentSource.test.js:21` 只做源码文本断言 |
| DR-011 | `scaleFactor` 失败实为**测试脚手架问题**，产品正确（勿改产品） | `lib/webapp.mjs:168-177`；临时脚本实测 `validateWebapp(...,{raw:{scaleFactor:1.5}})` → 正确报错 |
| DR-012 | README 把未实现能力写成可用功能 | `README.md:27-31,58-59` vs `index.js:158-163` |
| DR-013 | `gates-and-probe.md` 门槛表过时（`fail 1`/prettier exit 1 → 实际 99/97/2、exit 0） | `gates-and-probe.md:9,10,19` |
| DR-014 | `package.json:5` 的 `description` 乱码 | 实读为 `"缃戦〉搴旂敤…"` |
| DR-015 | README 引用的 `docs/evidence/chrome-probe-manual.txt` 不存在 | `README.md:106`；目录仅 `gates-and-probe.md` |
| DR-016 | `lib/entryFields.mjs:20` 依赖图注释写错文件名（`profileLimits.mjs`） | vs `lib/chromeArgs.mjs:21` 的 import |
| DR-017 | **README 卸载前备份命令只备份 `data\chrome`，漏掉 `webapp.db` 条目库 → 数据丢失** | `README.md:46-50` vs `spec.md:1096-1106` |
| DR-018 | spec §9.2 列的 `LICENSE`/`icon.svg`/`docs/adr/` 均不存在 | `Test-Path` 全 False |

### nice-to-have（4）

| ID | 标题 | 关键证据 |
|---|---|---|
| DR-019 | 界面里 `formatBytes`/units 数组三处重复 | `src/App.vue:288-289`、`WebappCard.vue:47-51`、`OverLimitModal.vue:35` |
| DR-020 | `toWholeNumber` 接受负数（当前由 `checkPair` 下限兜住） | `lib/chromeArgs.mjs:44` vs `:203-204` |
| DR-021 | 与 `rdp` 的 `fields.js`/`styles.css` 大段同形（判定：可接受，属独立分发的成本） | 文件尺寸对读 |
| DR-022 | `test/chromeArgs.test.js:95-96` `cases` 有重复项 | 原文两行相同 |

## 两个失败测试的独立判定

| 用例 | 判定 |
|---|---|
| `extraOrigins：多行 → 逗号连接、主 origin 恒在最前、去重、空行忽略`（`test/chromeArgs.test.js:145-157`） | **真实产品缺陷**（DR-004，must-fix） |
| `枚举边界（表驱动，D-3）：scaleFactor 15 项合法、其余一律字段级错误`（`test/chromeArgs.test.js:218-250`） | **测试脚手架问题**（DR-011，should-fix）；**不要改产品** |

**此前 2 个 `EPERM ... obox-webapp-helper-*` 失败与"测试挂起"**：本次复跑未复现（99 项在 1,405 ms 内结束，`%TEMP%` 下遗留目录数 0）→ 判定为**已解决的临时环境/teardown 竞态**，不阻塞交付，也不再计入失败。

## 文档一致性结论（详见 `review-report.md` 第 7 节，13 处）

以**规格 + 实现事实 + 当前实跑输出**为准；`README.md` 需在 DR-001 修复前撤回"可用功能"表述；`gates-and-probe.md` 需在最终复跑后回填。`docs/evidence/gates-and-probe.md:29-38` 的真机探针表与 `:42-46` 的 5 条未核实项**本轮直接采信**（未复跑 Chrome），可作判定依据。

## 传递到下一阶段

- must-fix 必须先修（DR-001–DR-009），其中 DR-005/DR-006 需**用户先裁定**；
- 修复后必须补 `test/index.test.js` 与 `test/uninstall.test.js`，否则 DR-001 类缺陷会再次逃逸；
- 修复后复跑并把结果回填 `docs/evidence/gates-and-probe.md`；
- 建议下一步为 `fix-review`（产出修复规格），**本轮不由审查阶段自动触发**。
