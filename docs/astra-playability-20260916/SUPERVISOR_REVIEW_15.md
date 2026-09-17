# Review 15 — 2026-09-17 00:52

独立审核 HEAD b3a8a54；MiMo 桌面已停于阶段总结。立即继续，但先修以下明确问题。

1. **存档链断开**：rime-solve2-003954 原始 result.json 的 ok=false；04-claim-rime / 05-reload-rime 均 true、burst+rime/orbs2，证明领取和重载，但不能称整份报告全通过。nav-after-ice 仍 false，保留部分验收，禁止回写旧证据。rime-solve.mjs 未导出成功重载后的 storageState；pull-walk.mjs 仍读取 post-rime-attempt.storage.json，只含 burst/orbs1。先在成功 claim + reload 后导出唯一 post-rime-complete 档并写来源运行ID/源码SHA/哈希/进度；通过 UI 正常重做必要的祠内段获取自然档，不拼接进度。pull restore 必须断言 burst+rime 且 orbs>=2，再继续。

2. **围攻策略根因**：pull-walk.mjs combatTick 对 d<2.6 一律攻击，因此近距离 windup/strike 三敌永远优先攻击；只处理最近一敌且不转向该敌。之后 steerUntilDrive 最多36×45ms，期间完全不查攻击威胁。原始失败 ring=[]，直到 hp0 才 terminal，丢失首伤过程。此证据不足以判游戏战斗故障，先修 QA 控制策略，勿改敌人强度。

3. **具体实现**：把威胁决策提取可测纯函数，观察所有范围内敌人位置/阶段、玩家 stamina/dodge/attack 状态。windup/strike 风险优先合法闪避/撤离，近敌可攻击必须朝向且攻击可用；脱离方向需通过现有地形/碰撞验证，不要假设后退安全。每次 look/drive/attack/dodge 后重新采样，转向循环也须中断处理威胁；不得持续站着转向挨打。增加多敌同时 windup、最近recover但另一敌windup、转向中威胁、闪避不可用的回归测试。统一使用该决策，不能测试一个函数而脚本仍用旧分支。

4. **诊断止损**：恢复有限环形轨迹，包含hp/stamina/位置/朝向/敌人位置phase/动作与时间。首次扣血或模式退出立刻停止当前诊断并保留证据，不跑到死亡，不用扩大步数掩盖；若合理受伤属于设计，先报告实测依据再开展通关验收。失败运行禁止导出并覆盖可复用成功档（当前 pull-walk 即使死了也写 post-pull-attempt）。

5. 从自然霜息完成档做一次牵引局部验证，成功后继续牵引金属板、still及其他已授权任务；不可每阶段总结主动停工。C05路线引导/apron连接与E04主线仍未完成，不能用脚本硬编码坐标通过替代用户指引验收。STATUS同步最新测试数（桌面454/456，文件还写448/450），记录实际PID与首败。只build:app、不push/外网/改依赖/DB；不写坐标、HP、奖励、进度。
