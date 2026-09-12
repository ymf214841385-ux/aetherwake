# Aetherwake Rebuild Status

## 当前工作基线（MiMo 继续优化 2026-09-11）
- 工作树：`/Users/ymf/Projects/aetherwake-rebuild-20260909/opencode-go`
- 分支：`codex/glm53flash-optimization-20260911`
- 基线 HEAD：`265cc80716e01c734f76b4ce1e1805ce9a144e6c`（published main）
- 执行计划：`docs/CONTINUATION_PLAN_2026-09-11.md`
- 进度：`docs/MIMO_CONTINUATION_PROGRESS.md`
- 权限：本地修改/测试/小批可回退提交；**不 push**、不 publish、不写旧 repo

## P0-1 本批
- Boss `windup→strike→recover` 严格状态机；距离/LOS/dy/off-arena 不得抢占或冻结 recover
- 回归：`aetherwake/src/game/boss-lifecycle.test.ts`
- `typecheck` PASS；`test:game` **170 pass / 0 fail**
- **未完成**：浏览器普通输入 3 轮闪避→收招→反击与最终击杀；P0-2 存档重载

## 历史基线（旧 rebuild 分支文档，保留）
- 仓库：ymf214841385-ux/aetherwake
- 分支：codex/aetherwake-rebuild-v2
- 起始 HEAD：ddaea4db03dd63100187b7a649ce5d034ece23ea
- 当前 HEAD：976bea0（未推送）本轮本地提交
- 代码提交：976bea0 feat(aetherwake): skinned wanderer, durable QA, four-shrine route
- 未提交改动及归属：仅 `.grok/` 运行时 pid 与一条冗余 webm。无他人脏工作区，未 reset
- 当前阶段：`test:game` 116 pass；QA harness 58+ pass；`build:app` 无 migrate。T25 headed 600s 通过。T21 四祠通过、三塔/残堡未同趟完成。T15 未认可。不推送。
- 计划：docs/AETHERWAKE_REBUILD_PLAN.md
- 本轮权限：本地修改、安装项目依赖、隔离测试、本地提交；不推送、不部署、不强推、不访问生产数据库

## 阶段状态
| 阶段 | 状态 | 代码提交 | 测试证据 | 未完成/阻塞 |
|---|---|---|---|---|
| M0 | 已验证 | 本分支本地提交 | `npm ci`；`npm run build:app` 成功且未跑 migrate；dev :8080 | 无 |
| M1 | 已验证 | 同上 | `test:game` 40 pass：输入、存档、金属自升、跳塔 | 无 |
| M2 | 已验证（灰盒/自动） | 同上 | 状态机、相机球扫、灰盒 `?graybox=1` | 连续两分钟人工操作待用户 |
| M3 | 已验证（数值+截图） | 同上 | world-sample.json 山 52.8 / 出生 11.4；风谷路径 | 路线示意未手绘 |
| M4 | 部分 | 同上 | 原创层级骨骼角色，hero-close.png | 无授权 GLB；用户未认可美术 |
| M5 | 部分 | 同上 | 白天锁定、160 段地形、六机位截图 | 草木密度与水岸仍偏简 |
| M6 | 已实现，部分验证 | 同上 | 统一风场、引风、风桥、战斗窗口、敌人阶段 | 机关两条路线未连续录像 |
| M7 | 部分 | 同上 | 新操作表、触区绑定、竖屏提示、设置 | 真机手机未测；无录像 |
| M8 | 已迁移，部分验证 | 同上 | 三塔四祠三营八种+四术+引风+残堡规则测试 | 完整主线实爬未完成 |
| M9 | 部分 | 同上 | typecheck 0；build:app；HeadlessChrome 截图 | 真机帧率、十分钟内存、ZIP 仍为旧包 |

## 环境核验
- Node v25.9.0 / npm 11.12.1
- `DATABASE_URL`：absent
- `npm run build` 仍为 `vite build && db:migrate`（保留给部署）
- 本任务编译：`npm run build:app` → vite/nitro 成功，**没有**调用 migrate
- 预览：`cd aetherwake && npm run dev` → http://127.0.0.1:8080/

## 实际执行的验证
| 检查 | 命令/步骤 | 环境 | 退出码/结果 | 证据 |
|---|---|---|---|---|
| git 基线 | `git rev-parse HEAD` | 仓库 | ddaea4d | 本文件 |
| 依赖 | `npm ci`（aetherwake/） | 本地 | 0 | 473 packages |
| 游戏测试 | `npm run test:game` | node strip-types | 0，40 pass | 终端 |
| 地形采样 | `npm run check:world` | 同上 | 山 52.76 出生 11.4 | docs/rebuild-evidence/world-sample.json |
| 类型 | `npx tsc --noEmit` | 同上 | 0 | 终端 |
| 无迁移编译 | `npm run build:app` | DATABASE_URL unset | 0 | vite 1854 modules |
| 浏览器开局 | Playwright 点「开始探索」+ W | HeadlessChrome 153 1280×800 | 走到 z≈98.3 | title.png playing.png |
| 六机位 | `node scripts/capture-views.mjs` | 同上 | playing | spawn-vista / hero-close / cliff-lookback / glide-down / lake-shore / ruin-camp |
| 原脚本测试 | `node --test scripts/**/*.test.mjs` | 基线 | 既有 ENOENT `.grok/skills/og/references` | 非本轮引入 |

## 决策日志
- 碰撞：不引入 Rapier。解析高度场 + 塔/台/金属实体共用运动学胶囊。
- 构建：保留 `build`（含迁移），新增 `build:app`。
- 存档：v2 键 `aetherwake-save-v2`，读取 v1 时备份，不覆盖原文；合法 0 保留。
- 引风为第 5 项能力（键 5 / 默认），1–4 仍为旧四术；旧档 art+1。
- 新档封印：三塔且四祠。旧档 `legacy-orbs` 或已通关不撤销。
- 主角：原创层级骨骼（非换色占位），无付费 GLB。见 ASSET_GAPS.md。
- 昼夜默认锁定早晨 `0.22`，避免验收被循环打坏。

## 缺陷 B01—B13
| 编号 | 状态 | 说明 |
|---|---|---|
| B01 | 已验证 | 键盘与触控冲刺分离 |
| B02 | 已验证 | 无步进不消费；多步进一次；100 次短按 |
| B03 | 已验证 | 支撑排除自身 |
| B04 | 已验证 | 塔柱不可站顶，跳入不吸顶 |
| B05 | 已修复待真机 | 触区按元素身份；resetInput 覆盖失焦/隐藏/取消 |
| B06 | 已修复待长测 | 攀爬用身体前方墙；相机球扫 |
| B07 | 已验证数值 | 沿岸衰减不再压平主山；气候分区 |
| B08 | 已验证 | 有效帧命中，同挥击一次 |
| B09 | 部分 | 角色重做但仍为程序几何 |
| B10 | 已验证 | continue 不先 startNew |
| B11 | 已验证 | 装备稳定 ID |
| B12 | 已验证同源 | 高度函数与网格同公式；塔为实体 |
| B13 | 已验证 | `build:app` 无迁移 |

## 未验证项与阻塞
- 真机 iOS/Android：T09/T10/T26 不能标完成。
- 用户认可美术：T15/T24 未通过。孤立 FRONT 仍偏玩具。
- 浏览器主线：四祠四核+风桥已实跑；三塔从未同趟点亮；残堡未进。`play-routes.json` ok=false。
- T25 十分钟 headed 稳定性已通过（607s，~60fps，上下文恢复）。headless 仍会 ~457s 关页。
- 原仓库脚本测试缺少 `.grok/skills/og/references`（基线问题）。

## 下一项明确动作（续跑）
1. 镜湖塔水面起爬 / 晨光中段 rest 循环：让同一趟 play-routes 点亮三塔后进残堡。
2. 人工验收角色近景（T15 未过）。
3. Codex 独立验收后再推 GitHub main。本会话不推送。

## 运行与演示
```bash
cd aetherwake
npm install   # 已用 npm ci
npm run dev   # http://127.0.0.1:8080/
npm run build:app
npm run test:game
npm run check:world
```
开发灰盒：`http://127.0.0.1:8080/?graybox=1` 后点开始。
证据目录：`docs/rebuild-evidence/`
内容盘点：`docs/CONTENT_INVENTORY.md`
资源缺口：`docs/ASSET_GAPS.md`
验收矩阵：`docs/rebuild-evidence/ACCEPTANCE.md`


## Codex interruption checkpoint — 2026-09-09 23:42 CST
Grok Build quota exhausted (HTTP402), round7 exited. Implementation and verification incomplete. Current task-owned working changes preserved; no GitHub upload. Independent normal-direction check confirms head/torso/arms now outward. Terrain shader type fix present; actual visual/route/600s stability acceptance remains outstanding. Resume details: task-root GROK_QUOTA_CHECKPOINT.md.


## Root takeover and E31 checkpoint — 2026-09-12T07:59:38.907428+00:00

This section supersedes historical validation counts and ownership. User requested root personally finish all remaining work after Astra's round, with collaboration agents; E29 ended, no CLI executor remains. Main integration tree is opencode-go at HEAD 7decaa06068e1e3dc4ed3c9e833d0386f810b745 with preserved E23–E31 uncommitted changes.

- E30 corrected actual Boss QA reach (3.2m acceptance vs production 3.45m), handed live clear-LOS movement back to combat within existing 100ms observations, and connected same-browser victory/save/reload acceptance. Legacy airborne-C assertions now obey production eligibility; they are not late-airborne survival proofs.
- E30 headed run49416 stopped alive HP2 before combat: descent-landing-not-observed. Monitor saw a real grounded frame in the existing 300ms/radius, but navigation's reads missed it. Archive: docs/rebuild-evidence/runs/root-e30-browser.
- E31 root independently reproduced the game defect: moving onto ground only 0.009606457m lower incorrectly switched a grounded player airborne. Root fixed snapVertical to follow ground within existing FOOT_SNAP=0.62 only while already grounded with nonpositive vy. Baseline 8pass/2fail; full game after 224/224, typecheck PASS. Independent boundary review preserved jump, cliff and landing damage behavior.
- Stable grounding exposed a real QA steering error: fourth Boss dodge rejected the open gate path and strafed into a gate wing. Root added narrow gate crossing plus checks on the actual eight-way key direction through the radius-expanded gate segment. Boss retreat now uses actual strike3.8m +0.5m observation/inertia margin, not old3.55. Isolated threshold-only experiment still failed; gate steering is the demonstrated repair.
- Root final all-QA: 455/455, zero skips, build:app PASS (no migration); evidence in docs/rebuild-evidence/runs/root-e31-ground-follow. Three controlled Sim starts reach ending with12hits/HP1 using normal queue/fixed steps and no mid-run state writes; this is not browser acceptance.
- New single headed original-v2-save QA launched PID52589, run root-e31-ground-follow. .grok/durable-play-routes-52589.log and exit-52589.json. Do not restart healthy QA. Initial save SHA6591658e25bef67b972ceea66451e3422461732dac7439c31b3ac5bc712278e3; no refresh reinjection. First failure must be archived and diagnosed. Actual Boss ending/reload is still pending at this checkpoint.
- P1-1 isolated root-p1-input/codex/root-p1-input is ready (37/37 input/DOM-listener+Sim-transition tests, typecheck PASS), with genuine red baselines. Root and independent agent reviewing before integration after browser round. Three existing +three new files, no main writes. Evidence .grok/p1-input/REPORT.md and P1-input.patch in that worktree. It is not mobile-device acceptance.
- Full downloaded execution plan remains in scope: P1 input/mantle/combat/bridge/object/interaction/mode, P2 camera/visual/performance, same-new-save main route, current-build600s and persistence matrix, final committed-source package and verified GitHub publication. Old607s result belongs to an older tree and is not current acceptance. v6 GLB assets exist; old procedural-only notes below are historical. No new GitHub publication or release package has been made.


## Root accepted P0 resumed ending and integrated P1-1 — 2026-09-12T08:14:21.831374+00:00

This later checkpoint supersedes the pending PID52589 and input statements above.

- **Real headed acceptance PASS**, PID52589 run root-e31-ground-follow: original legitimate crown save → normal descent →12 actual C dodges → Boss killed → visible ending → existing-save normal reload and Continue → Boss still dead. FinishHP2, amber88 before and after reload, ending→playing, exit0 in68235ms. No added resources, coordinates or progress. Root checked actual JSON and ending screenshot, and archived result/log/exit/save/screenshot with hashes in docs/rebuild-evidence/runs/root-e31-browser/ROOT_ACCEPTANCE.json. This proves resumed-citadel P0; it is not a same-new-save full mainline or visual-quality pass. Screenshot still demonstrates camera/visual work remains.
- P1-1 six-file isolated patch has now been reviewed and applied to main by root. It fixes pointer ownership/local release, reset invalidation, listeners/rotation, bow toggle; independent review found and repaired both pending pointer-click and held-Space activation after reset. Root applied only after verifying original three files were untouched and git apply --check. Agent65/65; integrated game279/279, QA455/455, typecheck PASS, build:app PASS.
- Root also corrected a QA dependency issue found by integrated typecheck: digital key selection now lives in typed dependency-free scripts/qa/digital-direction.mjs, re-exported by route-navigation; citadel-steer no longer imports the entire untyped orchestrator into game tests. Selection behavior unchanged, all455QA reran passed. The first integrated typecheck failure is preserved in root-p1-input/root-typecheck.log; final pass is root-typecheck-final.log. Do not misattribute it to the input agent.
- **Headed input smoke PASS**, normal new-game UI, real native Chromium touch/mouse/keyboard only: bowtap on/off, pointerdown→pause→oldclick does not reactivate, Space held→pause→keyup does not reactivate, mixed mouse-stick plus touch-look release preserves movement, final release settles. Seven checks, no pageerrors, owned server stopped. Evidence runs/root-p1-input-browser/result.json and screenshot; script aetherwake/scripts/qa/touch-input-smoke.mjs. This is browser emulation/mixed pointers, not physical iOS/Android multi-finger acceptance. Legacy MouseEvent pointer click lacking pointer fields remains explicitly unsupported in this patch and needs compatibility follow-up before claiming all mobile devices.
- Current full npm test inventory:653script tests,637pass/16fail, zero skipped; later && app/game groups did not run via npm test. Root identified4 absent template-doc contracts,4 template app-env defaults,8 PWA tests polluted by real game site/card cwd. No tests were removed/skipped. Details root-e31-ground-follow/FULL_TEST_INVENTORY.md; T1/T2 fixture repair/gate separation still required.
- Active next implementation: combat_sim_probe owns **root-p1-mantle / codex/root-p1-mantle**, based on recorded current-game overlay. Root approved continuous lift/across/settle mantle, C priority, full body/path clearance, genuine cap support, bounded fixed-step speed and safe cancellation. Root corrected agent's mistaken reach1.35 reading to actual MANTLE_REACH_Y=2.1. Original15frontier probes include already-intersecting thin ledges; those must demonstrate rejection/no worsened penetration, and separate valid-grip cases must prove real cap completion. No widening reach, skipping roofs, geometric rewrite, resource injection or root-tree edits. Agent no browser/build/commit/push; returns overlay-relative patch to root.
- **Root's next personal source task is P1-7**, using root-p1-mode-audit/MODE_TRANSITION_REVIEW.md and4 actual queue+Sim red probes. Add coherent transition revision, invalidate current local actions on any mode/world/same-world reset, end step/transition-capable loops after preserving current-hit accounting. Overlay freezes/preserves action/world state and only resets input; world resets clear transients. Split presentation time from gameplay t while retaining already-correct paused attack freeze; decouple cooked meal IDs from frozen t. UI direct mode assignments must use the common public transition entry. No production P1-7 edit has started yet.
- combat_flow_audit and remaining_scope_audit completed/stopped; use them for bounded reviews/independent work as useful, do not restart the old CLI executors. No main browser/test/writer process remains after these checks. The mantle agent is active in isolation. Main integration tree remains uncommitted; no finalpackage/GitHubrelease. Preserve all earlier source/evidence and do not re-run accepted healthy gates absent a relevant change.


## Release freeze — 2026-09-12 (latest scope)

User requested publishing the completed current round and deferring all remaining optimization. This section supersedes earlier instructions to continue the full plan.

Published application scope: accepted P0/E31 dodge/ground-follow, Boss navigation and same-browser ending/save/reload, plus P1-1 input ownership/reset/bow fixes. Game 279/279 and headed input smoke 7/7 passed; QA 455/455 passed again after making captured regression fixtures portable. Typecheck and build:app passed on the same application source; no database migration.

P1-2 mantle is **not integrated into the application**: the frozen candidate passes 43 focused tests but full game is 261/267 with six unresolved legacy starting-position overlaps, and has no browser acceptance. Candidate patch/report/manifest and failure details are preserved in rebuild-evidence/runs/root-p1-mantle-diagnosis for later work. The existing application climbing behavior remains.

Deferred: P1-2 acceptance, P1-7 mode transitions, other P1/P2 optimization, visual quality/camera, same-new-save full mainline, current-version 600-second stability, physical mobile multitouch/legacy click compatibility. Full npm test still has 16 historical template/auth/PWA fixture failures (637/653 script tests); it must not be described as all green. See root-e31-ground-follow/FULL_TEST_INVENTORY.md.

Packaging uses the source commit, then a separate package-only commit. ZIP metadata identifies the exact source commit and SHA-256. Portable game observations preserve the original save v2 string and pre-dodge observations, avoiding dependencies on excluded raw logs/local captures. The packaging script now resolves the repository root explicitly so it replaces the repository's packed/aetherwake.zip, including when invoked from the application directory.


## User-corrected merge release — 2026-09-12 (supersedes archive-only release)

The user explicitly required merging the current agent round. P1-2 is now **integrated into the application source**, alongside accepted P0/E31 and P1-1; it is no longer only an archived candidate. This is a development checkpoint, not a claim that every requirement is complete.

- Continuous, collision-checked mantle replaces top teleport; preparation and every step validate the body/path and real support. C dismount has priority, transient state is cleared on lifecycle resets, and ordinary climbs respect thin ledges. No world geometry or reach/stamina budgets were expanded.
- Root fixed a headed-route regression exposed by the actual-cap check: outward/tangential W from a rest ledge must not automatically re-grab the wall. Automatic re-grab now requires inward movement; explicit E and C behavior remain. Five regression cases preserve the original two failing observations and pass after the fix.
- Invalid legacy fixture positions now assert their original overlap and start on actual clear terrain/low ledges. Original input, loops, stamina assignments and assertions are preserved. Final game tests: **325/327**, zero skips. Two failures remain: climb-detach summit path (600 W frames exhaust stamina before its final height assertion), and sim ledge-rest sequence (after 90 W frames, forcibly setting stamina to 4 leaves insufficient stamina to reach the next rest). These failures are retained and deferred rather than weakening tests or changing game budgets.
- QA **455/455**; typecheck and build:app PASS. Controlled Sim routes demonstrate all three actual caps and rime's real altar support; these are not full browser acceptance.
- Headed new-game runs63653/64074 activated mere/crown but showed repeated re-grab when leaving upper ledges. The observed defect led to the root direction regression/fix. The last browser rerun is recorded separately in this directory; do not infer full mainline acceptance from tower activation.
- Remaining P1/P2, visual quality, broader mainline/device/stability validation, and the 16 historical template/auth/PWA script-test failures remain deferred per user request.

Final headed rerun64925 (including direction fix): **NOT ACCEPTED**. New-game mere climb failed to activate within the original 240-second climb window; root stopped before repeated ring retries. Evidence: `rebuild-evidence/runs/root-mantle-merge/final-browser`. This merged development checkpoint includes the requested current-round code, with known two game failures and unresolved headed-route validation. No later optimization or background executor remains active.
