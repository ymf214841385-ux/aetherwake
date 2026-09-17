# Review 22 — 2026-09-17 04:07

HEAD69c565d。R21已阻断错误climb交接，但晨光仍行走死亡无新通关。先完成原方案导航缺口，暂停新的晨光整段尝试。

1. 范围纠偏：R21 c05-guidance.test里的burst是祠内crack之后，不是要求的原野burst-apron入口。navigation.ts159注释说pad top，实际y仍hf(dx,dz)+0.28；这是地面加常量，不是实际apron top。必须检查真实原野solids与物理支持，修正门端点和门侧连接。
2. 本轮第一交付：生产原野spawn/已知corridor→shrine-door:burst，从当前navigationSnapshot/detour记录首个失败边、采样点、feet/support/rise/clearance。此前记录门侧terrain→apron约0.24可步，而正面0.731不可步。依据真实solids走门侧连接，门节点取真实支持高度；先生产回归红测，再最小修边/节点。不得把祠内crack测试当入口完成，不扩大STEP_UP，不只改变unavailable标签。完成连续验证后headed地图选择burst沿实际nav到门，可局部自然档验证但标清边界。
3. pull侧廊当前测试if(status===walk)才断言，仍可能无实际路线而通过。明确生产可行侧廊fixture必须非空walk，并完整连接当前位置→对岸→祭坛；入口可选择侧廊的提示必须对应可用路线，不能仅含“侧廊”两字验收。
4. handoff剩余问题：canHandoffToClimb声明touchingClimbable却完全忽略，还不校验目标身份。加入生产实际wall/contact结果且必须是目标塔允许的climb surface，false/远处/最近citadel不能接管dawn。测试函数与真正调用器连接（spy验证未到时runClimbExecutor调用0次）。不要用mantle距离常量声称就是climb阈值，核对生产queryWall/攀爬起始规则。
5. 上述做完再处理晨光：最新s-0在(13,-24)追击死亡；读取sentinel出生/aggro22与真实地形制定从still出口避开警戒圈的走廊，不再沿现有中线穿过警戒区；普通移动速度可脱离时不要停下来不断攻击/转向。记录首伤轨迹，单次验证，失败先定位，不扩大预算。
6. 精确日志/测试计数/PID同步STATUS。原边界全部保持，仅本地，不push/改DB/依赖/物理预算/存档奖励；继续直到本阶段真实证据完成，不阶段总结停工。
