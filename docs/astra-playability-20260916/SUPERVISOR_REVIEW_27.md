# Review 27 — 2026-09-17 06:15

R26仍未击杀，禁止继续a/b/c/d/e式无证据整段尝试。改为生产机制支持的最小局部诊断。

1. boss-combat注释“生产range2.15”不适用于boss：sim.handleCombat给boss rangeBoost+.6；meleeHit使用(rangeBoost>0?ATTACK_RANGE_HEAVY:ATTACK_RANGE)+rangeBoost。先读取精确武器/参数，以生产meleeHit/LOS/高度判断是否能出刀，不能强制d<=2.05把角色贴进boss。保持原生产规则，不修改参数。
2. 优先采用已有合法凝时而不是继续扩展闪避AI：sim.handleArts art4(Digit5)在16m内选最近活敌，best.frozen=4.2，对冻结目标命中还有原生加成。先核对前置消耗/冷却与boss冻结生效路径，再普通Digit5/F，只读确认真正冻结的是boss（不是附近sentinel），记录冻结时长、敌phase、HP及实际命中。这是正常玩法，绝不能写frozen/HP/奖励。冻结有效时利用安全范围对齐攻击；无效则记录原因，不能无限F。
3. attack双tap相隔50ms不是可靠确认，startAttack非idle就拒绝。改一次输入后观察实际attack windup→active→recover/命中HP；active期间不要由spacing/reenter抢走朝向或主动走出命中范围，危险仍优先。单次攻击证据包含武器/距离/y差/角度/LOS/phase与bossHP前后，查清未命中原因，不再单凭“tap执行”算动作。
4. 首伤现在用hp<3错误，初始hp可能4或已受伤。每次以实际前一HP变化比较，保留前后ring；brainT字段虽采集但威胁策略不用它，不能宣称已经解决时机。若凝时方案生效不必继续另造闪避状态机。
5. 单次局部验证合法控制→真实命中→击杀；需要近门自然checkpoint先确认保存语义，不能注坐标/状态或拼进度。bossDead+胜利界面+reload保留才通过。若失败首段诊断停止，继续能独立完成的M4/M5清单，明确boss未验，不无限全程重跑。保持所有边界，不改敌人/物理/预算，不push/部署。
