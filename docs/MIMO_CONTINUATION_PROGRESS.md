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
