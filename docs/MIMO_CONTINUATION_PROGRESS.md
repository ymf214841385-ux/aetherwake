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
