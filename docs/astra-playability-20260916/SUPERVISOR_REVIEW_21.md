# Review 21 — 2026-09-17 03:45

HEAD712e900。still-nav7板上/对岸真实证据认可，不回入口；完整C05仍未完成。

晨光首败精确原因：dawn-exec-032801 climbFailure.last x15.06,z55.24 nearestClimb.d13.73，s-0 d1.87 recover，hp0。代码遍历220步结束后无条件runClimbExecutor，没有要求01-arrive-dawn通过或墙体真正可攀。nearestClimb是最近对象不代表可触达。stopped=null把耗尽误当正常，随后APPROACH在远处挨打。不可称攀爬系统坏。

1. dawn-from-shrines.mjs给行走→攀爬加明确门槛：正确world/mode/alive，基于生产攀爬距离和queryWall/真实可攀条件确认接触目标；未到则保存walkFailure（budget/no-progress/伤害/威胁等），return并释放输入，禁止运行climb/reload流程伪装阶段已到。无条件最近塔shaft不得作为实际support。
2. 追加执行器契约回归：最近shaft距离13.73必须拒绝攀爬交接；行走预算耗尽但未到不调用执行器；已到正确墙面才允许；runtime无可用wall应诊断退出而不是持续APPROACH。尊重已有物理阈值，不新造更大距离。
3. 新脚本canFaceEnemy仍用最近敌d<3冒充朝向，与R16修复回退，改为共享真实角度/攻击phase判断，勿复制旧combat错误。沿场景已知敌人位置/巡逻范围选择实际安全走廊并校验地形，优先避开s-0，不继续堆自动战斗AI。首伤环形轨迹保留动作/朝向/目标距离。不要扩大220/180预算硬跑。
4. 优先完成剩余C05：burst门侧可走入口连接、pull真实侧廊提示与路线，复用连续碰撞验证；针对实际导航写先失败回归与headed地图选目标到达证据。完成后再从四祠档一次晨光合法路径验证，保留自然奖励不拼档。
5. STATUS test:game不能写“见git”，补确切命令/计数/日志与当前PID；still-nav7 errors里enter调试文本不是pageerror须分类清楚，别删除原证据。持续执行，不总结停工。所有原边界不变。
