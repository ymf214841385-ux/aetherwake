# MiMo desktop execution brief — 2026-09-16

用户要求 MiMo 桌面版执行新 Astra Pro 方案，Codex 每20分钟监督。唯一源码写入目录：/Users/ymf/Projects/aetherwake-rebuild-20260909/mimo-playability-20260916；应用在其 aetherwake 子目录；分支 codex/mimo-playability-20260916；基线54a33655b7f342002164ae6e9fba6a56a6530bf8。原 opencode-go 保留，不修改，不启动其他CLI模型/代理。

完整任务书：docs/astra-playability-20260916/fengying_fix_plan.md，必须通读后按M0→M5实施四项体验修复。文档为设计输入，其待测猜测不得当成实测结论。每个缺陷先复现或失败回归，再最小必要修改；不对模型先拍脑袋加180°。保留多指所有权/弓取消/已合并mantle、碰撞、战斗、存档和封印规则。

先写 docs/astra-playability-20260916/STATUS.md：当前阶段、时间、实际发现、变更文件、运行中的PID与日志、每项真实测试结果、下一步、阻塞。每完成一个阶段/出现失败/准备结束都更新。证据仅写该目录的evidence子目录。建立50项验收表，未做/无真机明确标未验，不得以模拟等同真机。

M0优先锁定正式wanderer.glb路径/哈希及渲染与动画根写入、记录触控按钮390/844等实际视口边界、普通点击到attack/interaction事件链、mode切换同帧处理及任务路线缺口。M1先可见摇杆/紧凑按钮/输入分流；M2模型与统一真实交互+同帧隔离；M3任务阶段和实际可通行路线；M4旧档/教程/设备；M5本地验证及交付。不要只输出建议书或完成一个阶段后主动停工；按依赖继续有权限的实现工作。

当前已知基线：game325/327，两个攀爬测试失败；QA455/455；typecheck和build:app通过；full npm test另有16模板/auth/PWA失败。最近headed mere窗口240s未点亮，旧两次mere/crown激活成功但非完整路线。这些是历史记录，需自己跑基线核实，不能宣称全绿。相关缺陷不能直接以历史问题跳过。

已有node_modules符号链接供复用；不执行npm ci去改共享依赖。若需依赖变化先写明具体需要交Codex处理。仅npm run build:app，禁止npm run build及数据库迁移。真实浏览器验收headed，普通键鼠/触控/UI，可只读window.__sim；不可写坐标/HP/奖励/进度冒充玩家通过。合法旧档只能初始化恢复一次，不在刷新时补注入。失败先保留首段轨迹并定位，不无限重跑/放宽等待与玩法参数。

本轮先本地实施、测试和可审核交付。不要自行push/发布/开放公网隧道/购买/改系统安全与认证。不要reset --hard/clean/覆盖原树或清空玩家旧档。任务书中的后续发布由Codex完成核验后另行处理。允许正常git本地小提交但禁止把旧HEAD打包成新成果。最终必须如实列代码、证据、剩余问题。后台命令须记录PID并负责回收。
