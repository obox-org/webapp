# 实现报告（Goal Mode 账本）· webapp 扩展 1.0.0

- 需求目录：`.spec-workflow/webapp-extension/`
- 权威输入：`requirements.md`（阶段 1）→ `spec.md`（阶段 2，2021 行）→ `amendments/01–04`
- 实现目录：`extensions/webapp/`（**独立仓库**，仓库根 `.gitignore:13` 忽略 `/extensions/`）
- 审视：`review-report.md`（阶段 4，359 行）+ `review-reports/01-webapp-extension-final.md`

## 1. 票与实现落点（spec §24）

| 票 | 内容 | 落点 |
|---|---|---|
| 01–04 | 工程骨架、manifest、助手（Chrome 4 顺位探测/参数构造/启动）、纯逻辑（净化/校验/origin 推导/参数构造） | `manifest.json`、`helper.cjs`、`lib/{nameSanitize,chromeArgs,entryFields,webapp,profileLimit}.mjs` |
| 05–08 | 界面与构建：卡片列表、新建/编辑模态、删除确认、超限拦截、状态栏 | `src/**`（14 文件：`App.vue` 405 行、`styles.css` 714 行、`fields.js` 297 行、`components/*` 7 个）+ `ui/**` 构建产物 |
| **07（本次补齐的阻塞项）** | **接线层：8 方法分发、sqlite 表与大小写不敏感唯一索引、设置读取、打开前体积预检** | `index.js`（580 行，8 个 `case` 见 §3） |
| 09 | 打包 `.oix`（排除 `data/` 等 + 硬闸门） | `scripts/pack.mjs`（202 行） |
| 10 | 文档 | `README.md`（172 行）、`docs/evidence/*` |
| 11 | R17 体积上限全链路（设置→预检→拦截→清理） | `index.js` 预检分支 + `src/components/OverLimitModal.vue` + `lib/profileLimit.mjs` |

## 2. 门槛（最终一次，协调者 23:14 亲自复跑）

```
node --test --test-timeout=30000   → tests 106 / pass 106 / fail 0
npx prettier --check .             → exit 0，「All matched files use Prettier code style!」
npm run build                      → ui/index.html + assets/index-B9RBvIgX.js(101.65 kB) + style-*.css
node scripts/pack.mjs              → out/webapp-1.0.0.oix（244,074 B / 11 条目）
node skills/obox-ext-dev/scripts/validate-manifest.mjs extensions/webapp/manifest.json → 0 error / 0 warning
```

`.oix` 独立解包核对（协调者执行，非自述）：11 条目、`manifest.json` 为第一项、`lib/`5 + `ui/`3，**无 `data/`、无 `src/`**；重跑打包字节一致（幂等）。

## 3. 接线层证据（DR-001 关闭）

```
index.js 分发表（恰好 8 个）：L601 list / L603 save / L605 remove / L607 open
                             L609 probe / L611 profileInfo / L613 profileSize / L615 cleanCaches
index.js 关键实现计数：COLLATE NOCASE 2 · api.settings 6 · profile-over-limit 3
                       profile-size-failed 2 · moveProfile 7 · removeProfile 3
`save` 改名两阶段：先 moveProfile 再落库；落库失败回滚；回滚失败只 warn 并回写真实目录名
`remove` 占用归一文案：不硬编码 journal.baj，用助手返回的真实错误
`open` 预检：limitMb=0 跳过 → profileSize → 目录不存在跳过 → 量体积失败降级放行
             → 超限返回 {ok:false,error:'[profile-over-limit]…',data:{overLimit:true,…}}；force 放行且不持久化
sqlite：CREATE TABLE IF NOT EXISTS webapp(...) + CREATE UNIQUE INDEX … (name COLLATE NOCASE)，懒建（不在 install 钩子）
settings：api.settings.get('webapp.profileLimitMb','2048') / ('webapp.diskCacheMb','-1')，档位外回落+warn
```

**反逃逸门禁**：`test/ipcSurface.test.js` 双向断言"界面调用的方法 ⇄ `index.js` 的 case"；它上线当场抓出 `probe`/`profileInfo` 无界面入口，二者被接进 UI（顶栏「环境检查」按钮、删除确认框只读预检），**未削弱断言**。

## 4. 真机探针结论（Chrome 154.0.8037.98）

`--app` 生效；`--window-size/-position/-start-maximized` 精确生效；`--ignore-certificate-errors` 能过自签/过期证书而 `--unsafely-treat-insecure-origin-as-secure` **单独不能**；**同 profile 二次启动忽略一切进程级参数**（故每连接独立 profile 是必要设计）；Windows **无** `SingletonLock`（占用判据＝尝试删/改名并捕获失败）；关窗后 ≈0.8s 进程全退；**`--disk-cache-size` 不限制单次会话总量**、正数仅"单次准入阈值 ≈ cap/8 + 下次启动清空超限"、**`-1` 才真正禁用**；profile 地板 ≈17 MB、`optimization_guide_model_store` ≈40 MB、`BrowserMetrics` 每次启动 +4 MB。详见 `extensions/webapp/docs/evidence/gates-and-probe.md`。

## 5. 用户决策（全部关闭）

D-1 卸载即永久删 profile（文档醒目声明 + 备份命令；钩子内不搬运）｜D-2 不做测试注入，Chrome 未安装/探测顺序走可逆手工验收（已接受覆盖缺口）｜D-3 缩放 15 项 + 语言 12 项下拉、R14 下拉说明正式生效｜D-4 Goal Mode enabled、**不自动提交**｜D-5/R17 上限由设置页定义｜**追加**：升级/覆盖安装保留 `data/` 下的 profile（宿主 `oixCore.ts:320-336`）｜**后裁定**（见 `amendments/04`）：`diskCacheMb` 默认 `-1`、清理白名单 10 项。

## 6. do-review 结论与处置

审视判定 **cannot ship（incomplete）**，9 条 must-fix。其中 **DR-001/003/004/007/008/011 已由后续实现关闭并经协调者独立复跑确认**；**DR-005/006 属"spec 未追上用户决策"，由 `amendments/04` 正式登记**；**DR-002 部分保留并记为可接受**（超限场景已带 `data`）；**DR-009 由本文件关闭**；**DR-010 由 §3 的 `test/ipcSurface.test.js` + `amendments/04 §3` 的命名映射关闭**；**DR-012/013/015/016/017 已修**（其中 DR-017 会造成不可逆数据丢失，已改为备份整个 `data`，含 `webapp.db`）；**DR-014 复核无问题**；**DR-018 的 `LICENSE` 在发布步骤补**。

## 7. 未完成 / 未核实

- **真实页面交互验收（A1–A29）尚未执行**：用户裁定"先跑完审视与发布，最后再真机验收"。
- 未核实：`--disable-gpu` 是否仅首个进程读取；`--force-device-scale-factor` 未做真机验证；`--disk-cache-size` 超限"清空 vs 裁剪"；GB 级 profile 扫描耗时；窗口开着时 `cleanCaches` 失败分布。
- 发布步骤（建仓/tag/release）**未执行**：按 D-4，提交与发布必须在会话中显式执行并留证据。

## 8. 约束遵守

实现与审视全程**未**触碰：根仓库 `src/**`、`extensions/rdp/**`、`extensions/webapp/**` 之外的仓库文件；**未**做任何 `git add/commit/push`；**未**同步到 `%APPDATA%\obox\extensions\**`。唯一副作用：`out/` 被按允许重打包。
