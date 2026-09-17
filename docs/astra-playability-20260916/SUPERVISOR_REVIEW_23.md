# Review 23 — 2026-09-17 04:28 (in-flight review)

本轮仍在执行，保持现有单个进程，不重启/重叠。dawn PID4146正在跑；下一检查点先落实以下验收边界。

1. burst-door-nav-r22d final=(16.89,101.18)，仍靠近出生点，离burst门很远。脚本walked允许03-walk-along-nav OR03-arrive-door，不能以此证明门侧/apron通过。保留这份证据标为fresh map route smoke。新增独立必需的门侧到达验收：沿真实nav普通输入到门侧→踏上apron→合法进入burst，记录实际支持/高度/最后路段及交互结果；不必重复整原野长程，可由自然合法临近存档开始，但标清局部范围。不得写位置，不能把出现walk状态即绿当物理可走。
2. MAX_RISE由STEP_UP+.08到2*FOOT_SNAP需证明与实际生产一致，不只prodWalk复制validator。直接用Sim.step普通movement输入的局部回归（内存fixture可设置初始地形/起点，不是headed通关证据）对比真实脚跨b8-b9与门侧前后support；必须含被墙阻挡、高不可越台阶负例，保留原高standable墙回归。若生产确实可snap则允许校准验证器，禁止修改物理预算；若未证实则不能只放宽校验器让nav变绿。
3. 当前成功dawn或失败均只完成这一次。下一步优先完成上述入口边界以及pull侧廊实际可走段，不重复未诊断整路线。STATUS及时记录实际PID/日志，运行结束更新证据范围和精确测试数，不阶段总结停工。
