# Review 19 — 2026-09-17 03:02

认可still-board2的过桥/领取/重载四灵核；不等于完整主线或C05。独立在隔离内存Sim复现以下生产导航错误（此探针不是headed验收，无玩家存档写入）：still index3 block居中 frozen4，player z=8/13/17.5，navigationSnapshot三者均walk且第一段都to入口z4.4。已上板甚至已到岸仍要求回头，造成冻结窗口浪费。

1. buildStillShrineRoute [entry,front,back,altar]只过滤近点不是进度裁剪。先加必失败回归：板上z13不能引回entry/front；对岸z17.5直接安全连接altar，不再回坑。依据真实支持、坑边界和当前位置选择剩余路线阶段；不能简单按全世界z排序。对岸即使石块未冻/偏移也不应提示重新凝时。所有段必须真实校验，保持合法返回路径场景。
2. r18-still-nav.test.ts前两项可空过：if(status===walk && onBoard.length)才断言；第二项空segments直接通过。改为生产已知可行居中fixture要求walk且存在期望板段/正确top，并断言非空和前向剩余路线；偏移fixture明确正确提示。证明旧实现在这些断言上失败。不得将允许action-required当作居中可走验收。
3. 顺带逐个审查rime/pull同类入口重置逻辑，当前玩家应只收到剩余路线。pull已知侧廊可通行须清楚指引该实际路线，金属搭桥仍partial不能硬标通过；burst apron门侧0.24已知可走连接仍需生产校验。此阶段优先收敛C05用户真实指引，不继续扩展QA战斗算法。
4. 一次headed验证：凝时上板与对岸截图+只读nav，确认不再回入口；自然档四灵核保留。然后从四祠完成档继续塔/封印/空王，dawn旧独立档不能拼接。更新50项表实际证据（D07/D12等旧条目同步），记录实际PID/日志，失败局部定位，勿阶段总结停工。
5. 仅MiMo写源，所有原边界保持：不改全局物理预算/不伪造进度/不push/部署/依赖/DB。
