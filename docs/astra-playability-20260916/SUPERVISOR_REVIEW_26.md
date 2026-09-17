# Review 26 — 2026-09-17 05:54

R25已进入院内，boss hp18.2表明至少一次真实命中，但尚未击败。停止全程盲试，修下面明确控制器缺陷。

1. boss-from-crown.mjs steerDrive在对齐后必前进180ms；“in melee hold facing”和attack前都调用它，所以保持朝向实际贴进boss，最终d0.9。拆分look-only与move，攻击前只允许look-only，且每次短look后重读phase，recover结束立刻放弃攻击。不得把方向确认等价移动。
2. 被击出院内(t.z>-.8/<-8)先steerDrive回位然后continue，跳过windup/strike检测。威胁处理必须优先于回位，并在每个回位/转向输入后重采样，不能走回攻击里。回位路径受真实墙面/门洞约束，不盲走(6,-3)。
3. 通用combat-threat DANGER3.6，但生产boss strike伤害范围3.8、windup触发3.4，windup结束后strike0.18再recover1.1。不能在3.6~3.8误判无威胁。QA策略按实际enemy kind/range/timer处理，不改生产伤害参数。DODGE_IFRAMES=.18、DODGE_TIME=.28、CD=.7、cost18；一看到windup就无方向闪避未必覆盖strike，需记录brain.t和实际invuln/dodge状态，选择真实可走方向离开攻击范围或覆盖命中窗口。
4. 先测试真实控制层：recover近距只转向不drive；windup在3.7m不得continue；回位遇windup立即中断；attack前phase变化撤销；闪避不可用有安全脱离或明确停止，不持续无效动作。测试勿只复制实现。
5. 保存首次伤害前后有限ring：boss phase/t/hp/distance、playerhp/stamina/yaw/invuln/dodgeCd、输入动作与时间、支撑/LOS。由此证明首伤原因和实际攻击命中，再单次战斗验证。允许自然保存接近门前安全checkpoint缩短诊断，先确认存档语义，不能合成进度/HP/坐标。
6. 成功要求bossDead+胜利界面+reload保留三塔四祠；否则保持未完成。同步STATUS/PID/证据后继续M4/M5，不push/部署/改物理预算或敌人，原边界保持。不阶段总结停工。
