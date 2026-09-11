# 《风醒 Aetherwake》Codex 继续优化执行计划

版本：2.0 / 直接执行版  
日期：2026-09-11  
仓库：`ymf214841385-ux/aetherwake`  
执行基线：`main @ 265cc80716e01c734f76b4ce1e1805ce9a144e6c`  
目标：在不推倒现有成果的前提下，把当前“开发检查点”推进到可稳定完成主线、可正确保存/重载、移动端可控、战斗与机关规则一致的候选版本。

---

## 0. Codex 总指令

不要重新设计整个项目，不要只写分析报告。先读取当前 HEAD、`docs/CHECKPOINT_2026-09-11.md`、`docs/RELEASE_VALIDATION.md`、`docs/AETHERWAKE_REBUILD_PLAN.md`，然后按 P0 → P1 → P2 顺序直接修改、测试、记录证据和提交。

执行要求：

1. 每批修改前记录 `git status --short`、`git rev-parse HEAD`。
2. 不覆盖当前有效的角色 GLB、环境材质、输入队列、固定步长、存档 v2、现有专项测试。
3. 每批只解决一组相关问题，完成后必须运行对应测试。
4. 不允许通过删除断言、批量 skip、吞掉退出码、测试注入通关状态来制造“通过”。
5. 正常输入验收必须使用真实键鼠/触控事件驱动，测试代码只允许读取 `window.__sim` 等状态，不直接写坐标、血量、完成标记或奖励。
6. 每个批次完成后更新 `docs/AETHERWAKE_REBUILD_STATUS.md` 和 `docs/RELEASE_VALIDATION.md`。
7. 全部完成后生成新的 `packed/aetherwake.zip`，并确认其 meta 的 `sourceCommit` 等于最终交付 HEAD。

---

# 第一阶段：P0 主线正确性

## P0-1 Boss 战：修复收招窗口和最终击杀

### 涉及文件
- `aetherwake/src/game/sim.ts`
- `aetherwake/src/game/combat.ts`
- `aetherwake/src/game/combat.test.ts`
- `aetherwake/scripts/qa/boss-*.mjs`
- 必要时新增 `boss-lifecycle.test.ts`

### 当前问题
Boss 的 `recover` 状态可能在距离重新大于近战范围后被直接改写成 `approach`，导致玩家看见 Boss 收招但无法稳定获得反击窗口。当前检查点也明确记录正常输入 Boss 最终击杀/结局尚未通过。

### 修改任务
1. 把 Boss AI 的攻击流程改成严格状态机：
   `approach -> windup -> strike -> recover -> approach`。
2. `recover` 未结束前，距离变化不得抢占该状态。
3. `hurt` 结束后根据明确规则进入 `recover` 或 `approach`，不要出现状态竞争。
4. 为 Boss 增加可观测的攻击周期字段/调试状态，仅 DEV/测试可读。
5. 校准 Boss：
   - 起手可读；
   - 攻击可闪避；
   - 收招至少存在稳定反击窗口；
   - 50% 血以下远程射线不能形成无限压制。
6. 修复最后一击后：Boss 只奖励一次、进入 ending、保存 `bossDead=true`。

### 测试
```bash
cd aetherwake
npm run typecheck
npm run test:game
node --test scripts/qa/boss-fight-policy.test.mjs scripts/qa/boss-fight-tick.test.mjs
```

### 正常输入验收
- 新档或合法同档进入 Boss 战。
- 不写 Boss HP、不改坐标。
- 至少连续完成 3 轮“闪避 → 收招 → 反击”。
- 最后正常击杀 Boss。
- 结果必须：`bossDead=true`、`mode=ending`、奖励只发生一次。

### 完成标准
没有正常输入击杀证据，不得标记完成。

---

## P0-2 通关后保存与重载

### 涉及文件
- `sim.ts`
- `persistence.ts`
- `persistence.test.ts`
- `routes.mainline.test.ts`

### 修改任务
1. `resetWorldEntities()` 创建 Boss 时必须读取 `bossDead`，通关存档加载后不得重新生成一个可战斗 Boss。
2. Ending 保存后刷新页面：
   - Boss 仍死亡；
   - 奖励不重复；
   - 残堡状态保持完成；
   - 玩家进入合法 post-game 状态。
3. 明确 ending 后继续游戏策略：
   - 推荐允许“继续探索”，回到残堡安全点；
   - 若保持 ending 页面，也必须有明确“继续”入口。
4. 增加 `bossDead` 的存档回归测试。

### 验收
```text
击杀 Boss -> 自动保存 -> 刷新页面 -> 继续游戏 -> Boss 不复活 -> 完成状态不回滚
```

---

## P0-3 灵祠、检查点、世界场景恢复

### 涉及文件
- `sim.ts`
- `persistence.ts`
- `world.ts`
- `persistence.test.ts`

### 修改任务
1. 存档增加明确 `worldKind` / `shrineId` / `checkpointId` 语义，禁止仅靠坐标猜所在世界。
2. 如果设计不允许灵祠内部存档，则进入后台/刷新时明确保存到最近安全入口，而不是保存一个无法恢复的室内坐标。
3. 如果允许室内存档，则必须恢复：
   - 当前灵祠；
   - 谜题状态；
   - 移动物/金属物归属；
   - 正确碰撞集合。
4. 塔顶检查点加载后必须在合法支撑面上，不得落入塔体。
5. checkpoint 的 Y 不直接无条件复用旧值；用 ID 解析当前世界安全点。

### 验收矩阵
- 野外保存/读取
- 塔中层保存/读取
- 塔顶保存/读取
- 灵祠入口保存/读取
- 灵祠完成后保存/读取
- Boss 前保存/读取
- Boss 后保存/读取

---

## P0-4 同一存档完成三塔四祠到终局

### 涉及文件
- `scripts/play-routes.mjs`
- `routes.mainline.test.ts`
- `progression.test.ts`
- `docs/rebuild-evidence/*`

### 修改任务
建立一条**同一新档**的真实输入路线：

1. 新游戏；
2. 点亮晨光塔；
3. 完成第一个灵祠；
4. 点亮镜湖塔；
5. 完成第二、第三灵祠；
6. 点亮雪冠塔；
7. 完成第四灵祠；
8. 验证封印打开；
9. 进入残堡；
10. 正常击杀 Boss；
11. 进入结局；
12. 保存；
13. 刷新；
14. 继续；
15. 验证完成状态仍正确。

不得直接设置 `towersOn`、`shrinesOn`、`bossDead`。

### 输出证据
`docs/rebuild-evidence/full-mainline/`：
- `summary.json`
- 各关键节点截图
- 保存前后状态快照
- 最终 HEAD

---

# 第二阶段：P1 操作与规则一致性

## P1-1 手机多指输入

### 涉及文件
- `GameClient.tsx`
- `input.ts`
- `input.test.ts`

### 修改任务
1. 每个 pointerId 只拥有自己的控制状态。
2. `pointerup` / `pointercancel` / `lostpointercapture` 只清除该 pointerId 对应输入。
3. 只有 `blur`、页面隐藏、全局暂停、世界切换才调用完整 `resetInput()`。
4. 修复匿名事件监听无法对称解绑的问题。
5. 移动端弓按钮统一为：
   - 若 README 定义“开关”，实现点击切换；
   - 或修改 README 为按住瞄准，但两处必须一致。

### 真机验收
- 左手移动 + 右手转镜头，右手抬起后继续移动。
- 移动 + 跳/翔。
- 移动 + 攻击。
- 瞄准 + 转镜头 + 射箭。
- 后台/前台恢复。
- 横竖屏切换。

---

## P1-2 攀爬/翻顶连续化

### 涉及文件
- `sim.ts`
- `physics.ts`
- `params.ts`
- `climb-detach.test.ts`

### 修改任务
1. 删除/替换直接把角色推进墙内约 2.35m 的翻顶路径。
2. 新增 mantle 状态或等价连续过程：
   - 找目标支撑面；
   - 检查头顶净空；
   - 检查水平路径；
   - 逐固定步长移动；
   - 最后进入 grounded。
3. 翻顶失败时保持攀爬/安全坠落，不穿墙。
4. “松手/闪避脱离”优先级高于自动翻顶。
5. 地面高度查询不能把过高地形直接当成合法可行走支撑。

### 验收
灰盒覆盖：低天花板、悬檐、窄台、墙角、斜坡、三塔顶部。

---

## P1-3 攻击上下文统一

### 涉及文件
- `combat.ts`
- `sim.ts`
- `character/animate.ts`

### 修改任务
创建 `AttackContext`：
```ts
{
  id,
  weaponId,
  startedAt,
  yaw,
  phase,
  normalizedTime,
  hitTargets
}
```

要求：
1. 起手锁定本刀攻击 yaw；有效帧不再实时读取新 `cam.yaw`。
2. 动画使用 attack id 重播，连续攻击不能因为状态没有跨过 idle 渲染帧而漏播。
3. 普通剑、重剑、Boss 体型补偿拆开计算，禁止 `rangeBoost > 0` 隐式切换重武器范围。
4. 武器耐久降到 0 后立即停止本次后续命中循环。
5. 弓伤害明确使用武器属性；弓耐久是否消耗形成清晰设计并测试。
6. 箭使用 segment/sweep 碰撞而不是只检测下一帧端点。

### 验收
- 起手后快速转镜头，刀不能转向背后的敌人。
- 连续 10 次攻击动画均重播。
- 同一刀同一敌人最多一次伤害。
- 薄墙不能穿箭。

---

## P1-4 风桥重做为真实物理谜题

### 涉及文件
- `wind.ts`
- `sim.ts`
- `world.ts`
- `wind.test.ts`

### 修改任务
1. 环境风和玩家引风分开。
2. 引风必须有：方向、半径、遮挡、持续时间。
3. 木板不再无条件向固定答案点以 4.8m/s 吸附。
4. 木板使用速度 + 阻尼 + 碰撞。
5. 如果保留吸附辅助，仅在木板进入目标槽位附近后启用，并且每块板有不同槽位。
6. `planksBridge()` 改为检查“形成连续可走结构”，而不是“全部挤到一点”。
7. `dockSolvedPlanks()` 恢复的几何必须与玩家实际解完后的几何完全一致。
8. `occluded()` 真正接入引风目标判定。

### 验收
- 范围外无效
- 隔墙无效
- 顺风/逆风差异明确
- 构件掉落可复位
- 正常过桥
- 保存重载后仍可过桥
- 侧翼路线仍可作为替代方案

---

## P1-5 动态物体与世界归属

### 涉及文件
- `sim.ts`
- `physics.ts`

### 修改任务
1. 金属物改稳定 ID 持有，不再依赖数组 index。
2. 解除持有必须同时清 `heldMetalId` 与目标 `held`。
3. 动态物体支撑使用前一固定步快照，避免互相抬升反馈。
4. 同高度重叠物体不得互相作为“地面”。
5. 搬运目标沿路径做碰撞检查。
6. 进入灵祠后只更新当前世界实体；室内不得改写室外 Boss/物体高度。

### 验收
2/3 个金属块重叠、堆叠、墙角、进出灵祠、死亡、读档均不得自升或跨世界污染。

---

## P1-6 互动/能力统一目标规则

### 涉及文件
- `sim.ts`
- 可新增 `targeting.ts`

### 修改任务
建立共享 target query：
- world
- 3D range
- facing cone
- LOS
- surface/material
- target category
- allowed exceptions

应用到：祭坛、宝箱、风之种、拾取、牵引、凝时、霜息、Boss。

重点：凝时对 Boss 的持续时间/免疫/冷却必须明确，不能无限刷新冻结作为正常战斗解法。

---

## P1-7 模式切换事务化

### 涉及文件
- `sim.ts`
- `input.ts`

### 修改任务
统一处理：新游戏、读档、死亡、重生、进入/离开灵祠、暂停、背包、地图、对话。

规则：一旦本帧发生 mode/world 切换，旧世界的移动、攻击、敌人更新不得继续执行。

拆分：
- simulation time
- UI time
- attack/action time

暂停时攻击时间不得继续偷偷推进。

---

# 第三阶段：P2 画面、人物、性能

## P2-1 角色模型与动画

保留当前默认 v6，不重新从零建模。先在真实游戏运动中比较 v6/v7/v8：
- 面部/颈部接缝
- 攻击重心转移
- 攀爬墙面接触
- 滑翔手柄接触
- 武器握持
- 步伐脚滑

只有真实时间序列优于 v6 才替换默认资产。

20 骨骼无手指骨的问题不能靠代码伪装成精细抓握；若需要明显提升手部接触，应升级授权明确的角色 rig。

---

## P2-2 镜头与瞄准

1. 允许合理仰视塔顶。
2. 相机碰撞使用连续或足够可靠的体积检测。
3. 平滑后的最终相机位置再次做碰撞约束。
4. 准星 → 世界射线 → 目标点 → 角色发射点，统一一条瞄准链。
5. 箭起点附近墙体优先拦截。
6. 键盘镜头转动按时间积分；鼠标 delta 保持像素位移语义。

---

## P2-3 性能和 600 秒稳定性

### 目标档位
至少建立：
- Desktop High
- Desktop Medium
- Mobile Low

### 采集
- FPS p50 / p95 frame time
- draw calls
- triangles
- texture memory 估计
- JS heap 趋势
- WebGL context lost/restored

### 600 秒测试
正常游玩状态连续 600 秒：移动、转镜头、战斗、滑翔、进入/离开灵祠。

要求：
- 无持续性内存爬升；
- 无重复事件监听累积；
- context restore 后继续可玩；
- 保存可恢复。

---

# 第四阶段：测试体系清理

## T1 先归因现有 16 项 full-test 失败

当前记录：专项游戏测试 163 passed / 0 failed，但完整 `npm test` 331 项中 315 passed / 16 failed，且失败会阻断后续套件。

逐项分类：
- A：产品真实缺陷 -> 修复
- B：测试夹具缺失 -> 补夹具
- C：项目已不使用的模板遗留测试 -> 明确隔离到模板测试，不与游戏发行门禁混淆
- D：错误期望 -> 修改期望并写理由

禁止直接删测试或全部 skip。

## T2 拆分 CI/本地门禁

建议脚本：
```json
{
  "test:unit": "...",
  "test:game": "...",
  "test:qa": "...",
  "test:app": "...",
  "test:all": "..."
}
```

每个套件独立输出结果，`test:all` 最终汇总并保持非零失败码。

---

# 第五阶段：最终发行验收

必须依次通过：

```bash
cd aetherwake
npm run typecheck
npm run lint
npm run test:game
npm run check:world
npm run build:app
npm test
```

然后运行：

1. 新档同一存档完整主线；
2. Boss 正常输入击杀；
3. ending；
4. 保存；
5. 刷新；
6. continue；
7. 600 秒稳定性；
8. 移动端真机；
9. WebGL context loss/restore；
10. 重新打包。

打包：
```bash
node scripts/pack-release.mjs
```

检查：
```bash
git rev-parse HEAD
cat ../packed/aetherwake.zip.meta.json
```

`sourceCommit` 必须等于最终 HEAD。

---

# 第六阶段：建议提交顺序

不要把所有修复压成一个巨型 commit。建议：

1. `fix: make boss recovery deterministic`
2. `fix: persist completed boss lifecycle`
3. `fix: restore world and checkpoint semantics`
4. `test: add same-save full mainline acceptance`
5. `fix: isolate mobile pointer ownership`
6. `fix: replace climb-top snap with validated mantle`
7. `fix: unify melee attack context and projectile sweep`
8. `fix: make wind bridge physically solvable and persistent`
9. `fix: stabilize dynamic object ownership and support`
10. `fix: unify interaction and ability targeting`
11. `fix: make mode transitions transactional`
12. `perf: add long-session and device quality validation`
13. `test: reconcile full-suite release gates`
14. `chore: refresh release evidence and deterministic package`

每个提交都必须做到：可构建、对应测试通过、可独立回退。

---

# 第七阶段：Codex 每批回复格式

每完成一个批次，输出：

```text
批次：P0-1 Boss 战
状态：完成 / 部分完成 / 阻塞
修改文件：
- ...

修复内容：
- ...

验证：
- command -> PASS/FAIL

正常输入验收：
- 路线
- 结果
- 证据路径

仍存在问题：
- ...

提交：<sha> <message>
下一批：P0-2
```

不要只回复“已优化”。

---

# 最终完成定义

只有同时满足以下条件才可称“本轮完成”：

- 同一新档正常输入完成三塔四祠；
- 封印正常打开；
- Boss 可稳定正常击杀；
- ending 可进入；
- 保存并刷新后完成状态正确；
- 灵祠/塔顶/野外检查点恢复正确；
- 手机多指控制无串区清零；
- 攀爬无明显单帧穿墙/吸顶；
- 风桥有真实因果且重载后仍成立；
- `typecheck`、游戏测试、发行构建通过；
- 完整测试的剩余失败全部有明确归因，产品相关失败清零；
- 600 秒稳定性完成；
- 至少一台触控真机完成主流程抽样；
- `packed/aetherwake.zip.meta.json` 对应最终 HEAD。

在这些条件完成前，统一称为 **development candidate / 开发候选版**，不要标为 final release。
