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
