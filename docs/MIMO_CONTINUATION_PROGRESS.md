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
