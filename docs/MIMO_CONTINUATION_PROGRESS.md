# MiMo Continuation Progress

工作树：`/Users/ymf/Projects/aetherwake-rebuild-20260909/opencode-go`  
基线 HEAD：`265cc80716e01c734f76b4ce1e1805ce9a144e6c`  
分支：`codex/glm53flash-optimization-20260911`  
执行计划：`docs/CONTINUATION_PLAN_2026-09-11.md`（P0→P1→P2）

---

## 批次 1 — P0-1 Boss recover 状态机（本批）

### 变更前
- `git status --short`：`?? docs/CONTINUATION_PLAN_2026-09-11.md`
- `git rev-parse HEAD`：`265cc80716e01c734f76b4ce1e1805ce9a144e6c`

### 根因（生产 `sim.ts`）
`dist > meleeR` 分支每帧 `brain.phase = "approach"`，在玩家闪避拉开距离时**抢占 recover**；`blocked`/`dy`/aggro 门外则 recover **冻结不计时**；`bossOffArena` 走回家也会改写为 approach。

### 失败回归（先红后绿）
`aetherwake/src/game/boss-lifecycle.test.ts`
- recover not stolen by distance（修前 FAIL：phase→approach）
- windup mid-telegraph not cancelled by leaving meleeR
- recover ticks when player blocked / tall dy / beyond aggro
- off-arena walk-home does not steal recover
- controlled sim: each recover window allows one landed counter（3 次，非浏览器普通输入验收）

### 最小修
1. **in-chain 优先**：`windup→strike→recover` 自跑计时，距离/LOS/dy 不得改写
2. **离场规则**：链内 strike 可 miss，仍进入 recover；recover 结束才 `approach`
3. **off-arena**：走回家时若在链内只 tick 链，不改 phase
4. **hurt 出口**：`approach`（在 aggro 且未 blocked）否则 `lost`

### 验证
```bash
npm run typecheck    # PASS
npm run test:game    # 170 pass / 0 fail
```

### 明确未做（本批）
- 浏览器普通输入连续 3 轮「闪避→收招→反击」与最终击杀（P0-1 验收，需真实键鼠，不写资源/冷却）
- P0-2 bossDead 存档/重载（下一批）

### 说明
三轮受控 sim 测试**不是** ordinary-input 验收：仅允许设置 `brain.phase=recover` 与玩家朝向，不写 Boss HP/坐标；真实 3 轮必须浏览器事件。

---

## 批次 2 — P0-2 bossDead 通关保存/重载

### 变更前 HEAD
`d5933ee`（批次 1）

### 根因
`resetWorldEntities` 无条件 `makeEnemy(boss)` 且 `alive=true`；`applySave` 恢复 `bossDead=true` 后仍被塞进可战斗 Boss。

### 最小修
`bossDead` 时生成 dead Boss（`alive=false, hp=0, phase=dead, rewarded=true`），不重复发奖。

### 回归（先红后绿）
`P0-2 bossDead save reload`：
- applySave 后 boss 不复活
- 普通攻击击杀 → save → 新 Sim continueSave → bossDead 保持、非 ending、boss 仍死

### 验证
- `test:game` **172 pass / 0 fail**
- `typecheck` PASS
- `build:app` PASS（无 migrate）

### 未做
- 浏览器刷新/继续 UI 链路
- 同存档三塔四祠全主线
- 浏览器普通输入 3 轮反击与最终击杀

---

## 批次 3 — 复查回归：freshRuntime dead-boss + strike 隔墙

### 变更前 HEAD
`b80cf12`

### 失败复现
1. `s.bossDead=true; s.freshRuntime(false)` → `bossDead=false` 但 `boss.alive=false`（b80cf12 在清 flag 前按旧值造 corpse）
2. strike 链移出 LOS 门后，无 `!blocked` 可能隔墙扣血（源码风险）

### 最小修
- dead spawn 仅当 **`keepProgress && this.bossDead`**
- strike 命中增加 **`!blocked`**；链计时仍继续

### 回归
- `freshRuntime(false) after bossDead=true must spawn a live full-HP boss`（先红后绿）
- `strike does not hurt when a solid wall blocks boss→player`（链继续、不掉血）
- 保留 continueSave 不复活测试

### 验证
- `typecheck` PASS
- `test:game` **174 pass / 0 fail**
- `build:app` PASS（无 migrate）

---

## 批次 4 — 浏览器阻塞记录 + P0-3 存档定位

### 浏览器普通输入（未验收）
- 预览 `http://127.0.0.1:8115/`（`index-B297F3u9.js`）
- `boss-browser.mjs` 实跑：`mode=playing seal=false towers=0` → **`seal-not-open`**
- 本树无合法封印存档；**不注入** towers/shrines/Boss HP
- 3 轮闪避→收招→反击与击杀 **未做**（需封印档或完整 play-routes）

### P0-3 最小修
- 祠内 `captureSave` 写 **overworld 入口** 位姿，不写祠内局部坐标
- `applySave`：`shrine=null`，`worldKind` 仅 graybox/overworld
- `resolveCheckpoint`：埋地 Y → 地面；塔顶 Y 保留（≤ ground+48）

### 回归（先红后绿）
- 祠内保存 → continueSave 回到祠门口 overworld
- checkpoint y=-50 → spawn/player 站在地面
- tower-dawn 顶 Y 不被压回塔基

### 验证
- `typecheck` PASS
- `test:game` **177 pass / 0 fail**
- `build:app` PASS

### 未验收
- 浏览器 3 轮反击 / 击杀 / 刷新继续（等封印档或 P0-4 全路线）
- 祠内谜题/金属物完整恢复（本批按设计改为入口安全点，非室内恢复）

---

## 批次 5 — resolveCheckpoint 按 ID 解析 + P0-4 路线启动

### 审查缺口
旧 `resolveCheckpoint` 用 `terrain..terrain+48` 窗，未按 ID 解析；塔测试只喂正确 y。

### 最小修
- `tower-*` → 解析 TOWERS 得 **authored cap** `tw.y+TOWER_HEIGHT-1.2`
- 其它/未知 ID → **heightFn(xz)** 地面
- applySave：塔 ID 玩家贴 cap；其它保留 xz、只解析支撑 y

### 失败回归（先红后绿）
- `tower-dawn with wrong saved y (ground+10) resolves to authored cap`
- `unknown checkpoint id stands on terrain at xz`

### 验证
- typecheck PASS
- test:game **179 pass / 0 fail**

### P0-4
- `play-routes.mjs` 自有预览 **8101**（PID 93217），日志 `/tmp/play-routes-p04.log`
- 已到 dawn 攀爬 rest y=30.6；**未重启**健康长跑
- 同 browser storageState / 连续日志由 harness 写出

---

## 批次 6 — p04 第一趟路线结果（PID 93217，已结束）

### 构建边界（勿标 43e78cb 验收）
- 预览构建时间 **22:50**，早于 `43e78cb`（resolveCheckpoint）提交
- 本趟 **不是** 43e78cb 浏览器验收

### 通过（正常输入）
- 晨光塔点亮 + storage-ckpt-tower-dawn
- 风桥 ruinSolved
- 牵引祠 orbs=1 + storage-ckpt-shrine-pull

### 首个真实失败：camp-a 烹饪
- `stuck dist=41 at 8.9,73.2 airborne/climbing` → `nav timeout fire`
- `after cook spicy=0` — **未达营火，不算烹饪成功**
- 已修：南侧走廊路点 + climbing 强制脱墙 + meals/spicy 验收日志

### 第二失败：rime 领取时 page.close
- lastGood：`shrine=0 prompt=领取灵核 ices=2`（已到祭坛）
- `closeReason=page.close`；orbs 仍为 1，citadel 未尝试
- **未**把 page.close 记为通关

### 保留
- `storage-ckpt-tower-dawn.json`、`storage-ckpt-shrine-pull.json`
- 下一趟须 **新 build:app**（含 43e78cb）再验检查点/刷新继续

---

## 批次 7 — p04b（新 build，含 43e78cb）PID 94302

### 构建
- `build:app` 含 `43e78cb` resolveCheckpoint
- 可作检查点修复的浏览器基线（**非**整线通关验收）

### 通过
- dawn 点亮；pull **orbs=1**；rime **orbs=2**（p04 在 rime 领取时 page.close，本趟完成）
- storage-ckpt-tower-dawn / shrine-pull / shrine-rime

### 真实失败
1. **camp-a cook**：仍卡 dawn 西壁 ~(8,73) climbing；`cooked=false`（已加强恢复，本趟未吃到）
2. **page.close**（第二次）：`go shrine burst` 后 browser 关闭；closeReason=page.close
   - exit-94302 `lastNote=ppid-dead` 仅表示 heartbeat 在父进程不在时改写 lastNote（lifecycle.mjs:951），**不能**单独证明父退出关闭了浏览器（signals=[]）
   - play-routes 仅在 finally 设 `intentionalTeardown` 再 `context.close`/`browser.close`；中途 page.close **不是** harness 主动 teardown
   - 关联**待验证**：需复现或日志中的 close 调用链才写根因
   - 非谜题逻辑失败；orbs=2 未达封印
   - 下一趟用 `run-durable.mjs`（ppid=1）排除短命父进程假说
3. 整线 **未** 开印、未到 citadel/Boss

### 证据边界
- 主控独立复测 14 项；我报告 179 unit + 本两趟浏览器日志
- 不把 page.close / cook FAILED 记为通过

---

## 批次 8 — 95073 durable 全路线 + Boss 续档专项

### 95073（run-durable, ppid=1, HEAD 2feeef8 build）
- **三塔四祠 orbs=4 seal=true** 正常输入通过
- camp-a **cooked=true meals=1/0**；eat spicy=89.8
- save-reload restored=true（封印进度保持）
- Boss：swings=30 hits=7 bossHp **20→7.4** 未杀；deaths 汇总 0（观测漏计）
- 归档：`runs/play-routes-95073-*/`（日志/心跳/exit/storage ckpts）

### Boss 根因（执行器，非策略）
- dodge 后 **无 continue** 落入无条件 `tryMeleeClick`（swing26–29 d=7–8.3）
- `nextCitadelAction` / `citadelFightStep`：swing 仅 band+face；dodge 后 approach
- `citadel-dispatch.test.mjs` **5/5**（含 executor 两 tick 序列）
- play-routes 已接 `citadelFightStep`
- deaths：`mode=dead || state=dead || hp<=0` 均累计

### applySave 位姿（43e78cb 回归）
- **问题**：`tower-*` 无条件把 player 拉回塔顶 → 合法庭院/祠入口 continue 仍回 crown
- **修**：continue 恢复 **保存位姿**；checkpoint 仅死亡重生
  - 位姿损坏或 xz 在该塔 8m 内 → 贴 cap
  - 否则保留 xz，只解析支撑 y
- 回归：courtyard+tower-crown ckpt；祠入口+tower ckpt；错误塔高仍过

### 续档 Boss 跑（非纯 UI 保存）
- 使用 `storage-ckpt-after-citadel.json`（orbs=4 seal）
- **`boss-resume` 内 `sim.save()` 为程序调用**，不称 UI 保存验收
- 96566/96987：crown 下山死亡 + page.close；未击杀
- 旧测试 **tower-dawn wrong y** 在位姿修复后仍 181 pass

### 当前
- typecheck PASS；test:game **181 pass**
- 未改 HP/进度/冷却；未 push

---

## 批次 9 — 封印档落点核实 + boss-from-sealed

### 主控独立复测
- boss-lifecycle + citadel-dispatch **23/23** 通过

### 存档落点（真实 v2.player）
| 档 | player | 备注 |
|----|--------|------|
| after-citadel / tower-crown | (44.7, **53.5**, -124.5) hp1.5 spicy0 meals[] | **塔顶**，非庭院；霜冻下山必死 |
| tower-mere | (-110.9, 44.5, 11.7) hp4 | orbs=4 四祠；**有辣炒椒**；缺 crown |

- after-citadel **不是**庭院档；applySave 修复无法把它变到庭院
- 96566/96987 首次死亡：`dead en route crown-east`；归档 `runs/boss-desc-fail-*`

### 本批
- `CROWN_TO_CITADEL` 与 play-routes fightBoss 对齐（回归 10/10）
- `boss-from-sealed.mjs`：默认 **tower-mere** → 吃辣炒椒 → 补 crown → 同路下山 → `sim.save()` 验 v2.player → citadelFightStep
- **sim.save() 为程序调用**，非 UI 保存验收
- durable PID **98787** 启动中

---

## 批次 10 — 99242 诊断口径 + 正常输入约束还原

### 99242（诊断，非 normal-input 验收）
- 使用过 `sim.closeOverlay()` 与 DOM `.click()` 关袋/吃料理 — **违反正常输入**
- **不杀**健康诊断 run；结果 **不得** 记 Boss 击杀/通过
- 已到 crown approach (38.5,34.5,-90.9)

### 约束还原（boss-from-sealed）
- 禁用 `sim.closeOverlay` / DOM button.click
- 吃料理：`getByRole('button', {name:/辣炒椒/})` **Playwright click**
- 关袋：再按 **Tab**（`a.bag && inventory → playing`；Escape 会进 paused）
- 验收：meals 数、spicy、mode=playing 打印（不只 clicked）
- crown 点亮后 **leaveTower 径向离塔**（95073 防摔）

### 下一步
- 99242 结束后 **只启动一次** 修正后的 normal-input 专项
- Boss 击杀仍未验收

---

## 批次 11 — normal-input 专项 99783（唯一一次）

### 口径
- 无 `sim.closeOverlay` / DOM click
- 吃：Playwright `getByRole(/辣炒椒/)`；关袋 **Tab**
- **已验证**：`meals 1→0`，`spicy 0→89.8`，`mode=playing`，`ate=true`

### 结果（PID 99783，已结束）
- crown legs 走通；**crown lit towers=dawn,mere,crown seal=true**
- `crown leave radially` 后 **page.close**（evaluate 失败）
- **未**到庭院 sim.save / Boss 击杀 / ending
- 归档：`runs/boss-ni-99783-*/`、`diag-99242-*`

### 未验收
- Boss 击杀、ending、刷新继续
- 庭院 v2.player 落点验证（未到达保存步）

---

## 批次 12 — D1 A/B 采样 + D1.1/D1.2 退出契约

### D1 A/B（本轮无效）
| 轮 | PID | 模式 | 事实 |
|----|-----|------|------|
| A | 1495 | headless | meal click 超时；SIGTERM elapsedMs=331616（未满 10 分钟） |
| B | 1911 | headed | eat ok；crown 未开印 seal=false |

证据：`runs/d1-ab-20260912-005518/`。B-exit：`flushed is not defined`（工具缺陷，非 99783 死因）。

### D1.1 → D1.2
- D1.1 内联 SUCCESS/THROW 子进程 **不能** 证明生产退出（主控不通过）
- D1.2：`finalize-harness.mjs` **finalizeHarness**；`ok?0:1` 只升级；报告失败=2
- 测试 `finalize-harness.test.mjs` **import 生产函数** + 真实 Playwright + setInterval 心跳
- case：ok / throw / ok+report EISDIR；父进程验证退出码与浏览器 PID 已死
- 进度文件批 1–11 自 **eb39ade** 原样恢复，禁止重写历史

---

## 批次 13 — D1.3 修复 + 顺序 A/B（原始证据，不判因果）

### D1.3 修复（6ce49a5）
- `isHarnessOwnedBrowserPid`：descendant+chromium；无关 sleep 拒绝 kill
- `writeExit` **cleanup/dispose 之后**；pre-cleanup 仅 diag
- 回归 8/8：含 cleanup throw/timeout、unrelated sleeper

### A/B（同 HEAD 6ce49a5 / 同 bundle / 同 mere 存档）
证据：`runs/d13-ab-20260912-024327/`

| | A headless 8272 | B headed 8994 |
|--|-----------------|---------------|
| elapsed | 457896ms | 299540ms |
| exitCode | 1 | 1 |
| eat | meals1→0 spicy0→89.8 | 同 |
| 首异常 | Target closed @ crown approach | **无** page-close；climb 未开印 seal=false |
| 10s 采样 | 是（0ms browser 活，1s 内 chromium 死） | 不适用 |
| classify | browser-lost observed | null（导航失败如实记录） |
| finalJson | ok | ok |

因果由主控判定；本文件不推断 headless 根因。

---

## 批次 14 — D2 外部 cron 真因 + headed 默认

### 真因（主控闭环，项目不改 Hermes/cron）
- `cleanup-browser.sh` 每 3min：`chrome.*--headless` age>300s → SIGTERM
- 三条日志 PID 94372/99784/8379 对应本项目失败；D1.3 A exit **143** @ 02:51:00.839
- 文档：`docs/D2_CRON_HEADLESS_KILL.md`（仅三条 PID，无全量 Hermes 配置）

### 最小修（b8fb471）
- `DEFAULT_HEADED_NAMES` 含 **boss-sealed / boss-resume**
- `resolveQaHeaded`：显式 `QA_HEADED=0` 优先
- 回归 5/5（含 override）

### 授权执行中
- 完整 `play-routes.mjs` + `citadelFightStep` 新档；显式 `QA_HEADED=1`
- melee 为真实 Playwright canvas/mouse.click（非合成 MouseEvent）
- 停止 A/B；不把 cron 修复等同通关

### D2 全路线实跑（PID 11439 / cr 11494，headed，已结束）
- Chrome for Testing **无 --headless**；**跨 8 分钟存活**；**未出现在 cleanup log**
- 新档：dawn+四祠+cook cooked + mere + eat spicy89.8 + **crown seal=true**
- Boss：swings=172 hits=5 bossHp **20→11**；后段 **位姿冻结** 连续 miss
- save-reload **restored=true**；bossDead=false
- 存档 v2 已按节点原样归档（含 hp/spicy/坐标）
- 证据：`runs/d2-play-routes-20260912-034501/`
- **不**将 headed/cron 对策等同通关；Boss 击杀未验收

---

## 批次 15 — D3 LOS 阻挡（主控复现）

### 事实更正
- 11439 后段 **非 sim 冻结**：attack idle→active；`meleeHit=true` 但 **`losBlocked=true`**
- solid：`citadel-wall-0-11-e`；日志位姿 player(7.97,10.85,-1.90) boss(9.91,10.903,-2.55)

### 最小方案（已实现）
1. 受控回归：blocked 不授权伤害 melee；`targetVisibility` 报同 id
2. `Sim.targetVisibility` 只读；快照 `bossMeleeBlocked`/`blockerId`
3. `citadelFightStep` blocked→**reposition**；play-routes 走 (6,-4)
4. 连续 3 次同 pose miss → 记轨迹、reposition 一次，再失败即停（不再 172 挥空）
5. 未删 LOS/未降墙/未改伤害 HP 冷却

### 验证
- typecheck PASS；test:game **184 pass**
- citadel-dispatch **6/6**（含 D3 reposition）

### D3 实跑（PID 14254 / cr 14310，headed，已停）
- 新档 seal 路径：dawn+四祠 orbs=4 + mere + **crown seal=true**
- Boss：**swing=1 hit 20→18.2** 后出现 **west wing** `citadel-wall-0-11-w`
- reposition (6,-4) 后仍 blocked → 初版循环刷日志；已 **一次后 break**（855800b）
- **未**完成 3 轮反击 / 击杀 / ending
- 证据：`runs/d3-play-routes-20260912-044659/first-segment.txt`

---

## 批次 16 — D3.1 reposition arrive 0.5

### 修复（9e059d6）
- 共用 `executeLosReposition`：目标(6,-4) **arrive:0.5 sprint:false**
- 用生产 `navigationOutcome` 回归：旧 arrive 3.2 在 2.61m 误判 arrived
- 记录起止/位移/耗时/nav/blocker；一次预算；失败即停

### 实跑（PID 18701，headed，已结束）
- seal 路径完整：dawn+四祠+crown
- **swing#1–2 hit 20→16.4**
- reposition：**真实走到** (6.05,-4.36) targetDist1=0.36 displacement=3.62 arrived=true
- **blockerAfter 仍为 citadel-wall-0-11-e** → ok=false 短轨迹停止
- 证据：`runs/d31-play-routes-20260912-064544/first-segment.txt`
- **未**完成 3 轮反击 / 击杀 / ending

### 事实（不自行扩方案）
- arrive 0.5 已修「假到达」
- 当前几何下 **(6,-4) 并未解除** 对 boss(10.6,0.5) 的东翼墙 LOS

---

## 批次 17 — D3.2 两段 reposition

### 修复（c97773b）
- seg1 (6,-4) arrive0.5；wing-blocked 且 boss.z>-0.3 → 同预算 seg2 (6,2)
- 严格：`nav.arrived===true`；`boss` 存在；`bossMeleeBlocked===false`（undefined≠clear）
- 回归 8/8 + Sim 几何（门中心东西 Boss clear；路径 101 点无墙）

### 实跑（PID 21702，headed，已结束）
- seal 全路径：dawn+四祠+crown
- **reposition ok**：`citadel-wall-0-11-w` → (5.85,-3.88) arrived clear displacement=5.63
- **swing#1–2 hit 20→16.4**（reposition 后继续命中）
- **文档更正（D4）**：该轮并非仅 fight 窗口不足；日志为 **airborne dodge 未发动 → dead → 自动复活赶路耗尽**；`deaths=0` 为漏计假统计
- 证据：`runs/d32-play-routes-20260912-074802/first-segment.txt`

---

## 批次 18 — D4 dodge 门控 + 死亡即停

### 修复（dcdfb24）
- `Sim.canAcceptDodge` 与 handleLocomotion 一致：grounded && cd<=0 && stamina>18
- 政策仅在门控通过时发 dodge；否则 back-off/hold（无伪无敌帧）
- citadel：**read 先于 resumePlay**；首次死亡写 `citadel-first-death-*.json` 并停
- dodge 后采样 dodgeT/cd/stamina `started=`
- 10s@100ms 环形诊断；15s 无 Boss 掉血停

### 验证
- typecheck PASS；test:game **188**；citadel-dispatch **10/10**

### 实跑（PID 24500，headed，已结束）
- dawn+四祠 orbs=4 + mere
- **crown 爬塔失败**（regrab airborne y=22.7；`crown not lit`；citadel **未尝试**）
- 未进入 Boss 段，故未触发 D4 死亡/闪避门控实测
- 证据：`runs/d4-play-routes-20260912-085144/first-segment.txt`

---

## 批次 19 — D4.1 citadel-resume 专项（scope=citadel-resume）

### 入口（6c5ba16）
- `QA_FOCUS=citadel` + `QA_STORAGE_CHECKPOINT`：指定塔顶档原样注入正式 save key，仅一次
- 点「继续旅途」；`v2MatchesSource` 校验；其它 focus 不变
- 回归 5/5；复用原 fightBoss / D4 死亡与 15s 无掉血停止

### 指定存档
- `d31-.../storage-ckpt-tower-crown.json`
- sha256 `6591658e…78e3`
- 三塔四祠 orbs=4 bossDead=false 塔顶 (44.617,53.46,-124.514) hp=2.5

### 实跑（PID 30445，headed，已结束）
- **restore ok**：towers=dawn,mere,crown orbs=4 hp=2.5 pos 塔顶 **v2Match=true**
- 塔顶正常下山；落点 below-courtyard (40.2,-34.5)
- recover 后 **15s 无 Boss 掉血** 短轨迹停；swings=0 bossHp=20
- **scope=citadel-resume**（继承进度，非本轮新档全通）
- 证据：`runs/d41-citadel-resume-20260912-110220/`

---

## 批次 20 — E1 QA 计时/采样/focus 误判（仅 QA，未开新浏览器）

### 30445 分类（主控）
- QA 缺陷：导航混入 15s 无伤害、伪 100ms 环、focus 失败仍 fightBoss
- 导航 18,-13 卡墙另列未解决

### 实现（生产模块 combat-progress-monitor.mjs）
- `classifyFightSnapshot`：playing/活/seal/hz≤8/dy≤3 → combat；其它有效→navigation；缺→unknown 停表
- 仅相邻 combat-combat 累计 dt；gap>500ms 记 sample-gap；nav 不计入 no-damage
- Boss 真实掉血重置 noDamageMs；≥15000 → combat-no-damage
- 串行采样 read→补足 100ms；环 ≤101 且 now-10000 前剔除
- death 锁存 abort；hold/goTo 包装检查 abort 并 releaseAll
- focusOk=false → precondition-failed，**不调用 fightBoss**

### 验证（假时钟，import 生产模块）
- **14/14** E1 监测测试
- typecheck PASS
- **未启动**新浏览器全图/Boss

### 未解决（保留）
- 18,-13 导航卡墙
- Boss 击杀 / ending / 刷新继续

---

## 批次 21 — E1.1 精准补修（主控不通过后）

### 主控已证缺陷
1. `classifyFightSnapshot({mode:dead,...})` 曾返回 unknown，未 latch
2. `runCombatSampleLoop` 未在 play-routes 真实调用（sampleLoop=null）
3. wrapGoTo 只入口检查；resumePlay/follow/tryMeleeClick 未共用 abort

### 修复
- **死亡优先**：mode dead / state dead / hp≤0 任一 → `dead`，在 playing 门之前
- **`createFightOrchestrator`**：play-routes fightBoss 真实调用；采样在**下塔导航前** startSampling；finally `await stopSampling` 再关浏览器
- scoped resumePlay：读到 dead 先 abort，**不点复活**；hold 分片 100ms；goTo/follow/click 共用 abort
- onEvent：death / no-damage / read-error → 共享 abort（首因）

### 验证
- **13/13**（含 orchestrator 死亡中途 goTo 测试：无复活/无新键/停止后无样本）
- typecheck PASS；test:game **188**
- 文档撤回「已实现串行采样接入」的旧表述（本批起真实接线）
- **未**开新浏览器

### 未解决（保留）
- 18,-13 导航卡墙
- Boss 击杀 / ending / 刷新继续

## Codex Astra batch — E1.2 production navigation scope (2026-09-12)

Ownership transferred from stopped MiMo to Codex CLI gpt-6-astra reasoning low. Read PRECISE_QA_GATE_E1 and latest ROOT_DIAGNOSIS; no applicable AGENTS.md found in the ancestor chain or implementation subdirectories. Only opencode-go implementation files touched; existing evidence and separate Sol trees preserved. No agents, browser, install, build, migration, game/balance/coordinate/save-field changes, or push.

Implemented the real hold/tap/resumePlay/lookToward/goTo/follow/leaveShrine bodies in `scripts/qa/route-navigation.mjs`, instantiated by play-routes with its existing page, state, geometry helpers, and clock. Optional scope is threaded through each read, navigation iteration, recovery branch, waypoint, and input. Unscoped resume retains revival. Scoped reads recognize death before revival, first cause wins, and throw FightStopError; no aborted x/z snapshots are synthesized. Holds keep keys down across <=100ms wait slices, check before each key-down, and release in finally. Follow returns the first failed waypoint. Fight look/tap/melee and LOS reads use the same scope. Input timestamps now describe executed key/mouse calls instead of planned navigation labels. The sampler only observes/latches; stop waits for in-flight reads and discards results after shutdown. Fight sampling still begins before descent and is awaited in finally before release/outer cleanup. Dedicated stop catch records reason, actual snapshot and ring for the controller.

Failing baseline: after mechanically extracting the unchanged production bodies, `node --test aetherwake/scripts/qa/route-navigation.test.mjs` failed 2/2: missing death rejection on the second read within an ongoing goTo, and follow returned target 40 instead of first failed target 20. Log: `/tmp/e12-baseline.log`. The death test allows an initial follow read, one live goTo iteration with input, then death on that goTo's second read; this is not a cooperative fake navigator.

Passing validation:
- `node --test aetherwake/scripts/qa/combat-progress-monitor.test.mjs aetherwake/scripts/qa/route-navigation.test.mjs aetherwake/scripts/qa/los-reposition.test.mjs aetherwake/scripts/qa/citadel-dispatch.test.mjs`: 36/36 (`/tmp/e12-pass.log`). All existing monitor/classification/timer/ring/focus tests retained. Replaced the old fake-navigation orchestration case with real factory/orchestrator regressions: second-read death/no revive/no further input or waypoint, failure stops follow, sampler abort during active keys, <=100ms wait abort with finally release, shutdown drains/discards pending read, first-cause retention and unscoped revival.
- `cd aetherwake && npm run typecheck`: pass.
- `node --check aetherwake/scripts/play-routes.mjs` and `git diff --check`: pass.

Additional focused run including `boss-fight-tick.test.mjs` was 43/47 (`/tmp/e12-focused.log`). Its four failures also reproduce against unchanged HEAD files exported with git archive to `/tmp/e12-head-baseline`: `node --test /tmp/e12-head-baseline/aetherwake/scripts/qa/boss-fight-tick.test.mjs` is 7/11 (`/tmp/e12-tick-head-baseline.log`), with the same dodge-versus-back-off expectations. These files were not changed; diagnosis belongs to the controller.

Residual limits: injected browser IO verifies the actual navigation loops but is not browser or full-route proof. Existing geometry/navigation reliability, boss completion, ending and refresh remain unverified here. Cooperative stops cannot cancel an already submitted browser operation or finish an indefinitely hung read; cleanup awaits it. Stop input latency is bounded by the next <=100ms wait check plus IO/event-loop latency, not a hard real-time guarantee. Controller review required before any new browser run.

Local commit blocked by workspace permissions: explicit `git add` of only the six implementation/progress files failed with `Unable to create .../repo/.git/worktrees/opencode-go/index.lock: Operation not permitted` (exit 128). No files were staged and no commit was created. Patch is left for controller review; no permission escalation attempted.
