# Review 20 — 2026-09-17 03:24

R19源码已裁剪still路线，headed板上/对岸仍未验，不可标全通过。晨光脚本存在确定接线回退，立即修，不再整路线试错。

1. dawn-from-shrines.mjs 216把nearestClimbId固定dawn-shaft、interactVisible固定true，REST的spiral/ledge检测因此失效，地面高处永远APPROACH而可能遮蔽SUMMIT。读取真实support/nearestClimb目标与真实互动enabled；不要编造遥测。
2. 控制器有DESCEND/FAIL/DEAD，调用循环没处理DESCEND/FAIL，能空转180次；ASCEND内部12次又重复climb.tap，绕过每步最新dec与tryClimb。不要新增第三套控制。对照已有成功short-loop.mjs约315起的R10处理器，提取/复用已验收的执行器（支持传入自然四祠context），逐阶段处理释放指针、休息、下降、regrab和summit；每短输入后重算dec，真正使用tryClimb/tryInteract。maxY只诊断，禁止以y>20推定正在climbing。
3. 添加真实执行器层回归：grounded spiral低耐力必须停输入恢复；DESCEND确实执行合法下降或停止诊断；FAIL立即停止；高处可用祭坛不得被假shaft遮蔽；禁止climb无条件连点。不能仅重复纯函数测试而调用器仍错。若沿用原short-loop已通过路径，保持原自然存档，不能拼接旧dawn奖励。
4. 记录逐步state/hp/stamina/support/墙面目标/y/动作/决策与时间，保存首次无进展片段。一次从四祠档验证晨光；到y36失败先局部诊断，不放宽循环/物理参数。不声称“自y36继续”除非有自然持久化支持该位置。
5. C05仍优先：still-navcheck没走到板上，修复探针实际输入并用成功still-board路线共享，分别记录板上与对岸nav不回头；不要用独立成功通关替代导航验收。burst门侧与pull侧廊真实引导继续收敛。只有这些正常后继续三塔封印空王。每项完成继续，不阶段总结停工；所有原边界保持。
