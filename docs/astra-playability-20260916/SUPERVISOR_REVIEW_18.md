# Review 18 — 2026-09-17 02:40

HEAD d16ad49；认可pull-solve3领取+重载第三枚，claimPath=sidewalk-alternate/metalBridge=false保持，不是金属桥验收。下一步先修still确定根因，不再重复固定路点。

1. still-solve3证据冻结moveBlock.x=367.37,z13。STILL_BLOCK.w=3.2,d7 =>当时X范围365.77..368.97,Z范围9.5..16.5。脚本path固定(365.5,13)再(364,17)，明确离开板面；最终x363.64,z15.94,y515.6符合走出板边掉坑。不能据此扩大板宽或放宽物理。
2. 修still-solve.mjs：先走到坑前安全lip(z<10且留玩家半径余量)，等待石块横向对齐玩家通道后Digit5/F冻结，或沿安全岸侧对齐实测石块中心再冻结。冻结后读取实际solid bounds/top；路径从板前中心到板后安全岸全程保持板内X余量，不能提前斜向中央祭坛；只有z越过16.5并grounded于对岸才朝祭坛转。实时记录frozen剩余时间和动作实际耗时，普通F续冻必须被生产接受；失败首段停止，不盲目增加循环数。
3. 生产导航也有直接高度可疑点：sim.ts 2653传给moveBlock.y的是heightFn(block.x,block.z)（坑底），buildStillShrineRoute找到真实slab却仍用opts.moveBlock.y；应从真实standable slab的物理top规则取点，不从坑底取。此外[entry,block中心,altar]斜线可能在到达对岸前走出窄板。先新增生产navigationSnapshot回归：冻结居中与偏移石块，所有walk段采样必须有真实支持且不跨侧边；路径按真实前沿/后沿连接，不以放宽validator解决。无可达路线要诚实action-required并提示等待对齐，而不是泛泛调整站位。
4. 使用现有shrine-puzzle.test.ts intended freeze-when-aligned作为机制参考，但headed不得写yaw/player/冻结状态；回归先红后修，之后一次局部普通输入领取still/orbs4+reload自然保存，导出含来源元数据的完成档。当前hp1保留，不注血。
5. 后续优先收敛C05（含pull侧廊实际指引与金属桥未验区分、burst apron门侧连接），再主线剩余塔/封印/空王；不能把脚本坐标成功当导航完成。保留全部历史失败/真机未验，更新STATUS与验收表，原权限不变，不push。连续完成已授权工作，不阶段总结停工。
