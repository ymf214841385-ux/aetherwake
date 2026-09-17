# 50 项验收表 — 2026-09-17 06:45 Asia/Shanghai

状态定义：**Headed通过** | **Headed部分** | **代码层** | **模拟**（非物理手机） | **未验** | **失败**

主交付：`FINAL_DELIVERY.md`；打包见 `packed/aetherwake.zip.meta.json`（SOURCE_COMMIT）。

## A 组 人物朝向（8）

| ID | 要求摘要 | 证据 | 状态 |
| --- | --- | --- | --- |
| A01 | 正式模型普通探索不倒走 | orient3 face/walk-rear；A01 orientation tests | Headed通过 |
| A02 | 四相机八方向稳态夹角 | a02-4x8：32/32 | Headed通过 |
| A03 | 急转/静止不抽搐 | a02b idle+finite yaw | Headed通过 |
| A04 | 模型/动画根不写死倒转 | orientationForAsset 证据注记 | 代码层 |
| A05 | 读档与新建朝向一致 | orientation 契约 + 无旧 π 强制 | 代码层 |
| A06 | 攀爬/滑翔朝向 | r31 安全落地；**r32 空中稳态** align≈0.99 且 yaw 变化；grounded 落地 | Headed通过 |
| A07 | 开弓侧移/收弓恢复 | a02b bow strafe | Headed通过 |
| A08 | 发版模型+读档第一步 | wanderer.glb π；**r30** post-boss 读档 + W 首步 + reload 首步 | Headed通过 |

## B 组 输入与交互（12）

| ID | 要求摘要 | 证据 | 状态 |
| --- | --- | --- | --- |
| B01 | 未锁定首击只锁鼠标 | world-click-policy + B01 tests | 代码层 |
| B02 | 物体点击/E/触控同对话 | sage 触控对话；R1 pick/handleInteract | Headed通过 |
| B03 | 触控短点/拖动只转镜头 | m4-input-cancel + playability | Headed通过 |
| B04 | NPC与容器并存不劫持 | review02/03 pick | 代码层 |
| B05 | 远距/隔墙拒绝不攻击 | review02/03 LOS+pick | 代码层 |
| B06 | 宝箱一次奖励 | short-loop + activation ledger | Headed通过 |
| B07 | 篝火烹饪同帧隔离 | E03 bag/map/cook isolation | 代码层 |
| B08 | 仅塔顶可启动 | tower candidate onTop | 代码层 |
| B09 | 灵祠进出/奖励一次 | enter/exit + altar claim | 代码层 |
| B10 | 自动拾取独立 | autoPickup 分离 | 代码层 |
| B11 | 菜单期间不操作世界 | E03 overlay isolation | 代码层 |
| B12 | 机关/装饰/敌对区分 | candidates enabled/reason | 代码层 |

## C 组 任务与路线（12）

| ID | 要求摘要 | 证据 | 状态 |
| --- | --- | --- | --- |
| C01 | 新档任务+方向 | short-loop quest 晨光塔 | Headed通过 |
| C02 | 地图点选追踪 | short-loop + r6-headed + burst-door-nav map-select | Headed通过 |
| C03 | 真实完成才推进 | towersOn/orbs/shrinesOn 源 | 代码层 |
| C04 | 塔脚≠塔顶 | nav 节点 y 分离 | 代码层 |
| C05 | 偏离重算/不穿墙 | burst 门 walk+进入；残堡外绕进门；空王 r27d | Headed通过 |
| C06 | 霜息祠冰失效 | **r33** 普通 Digit3+F 造冰 → extraSupports ice-* → 站原地等 life 耗尽 → ice 清空且 nav 再要霜息 | Headed通过 |
| C07 | 爆鸣破墙前后 | burst-seg4 + burst-door-enter-r23b | Headed通过 |
| C08 | 牵引板通路 | **R35–R37** 侧廊实时路线至祭坛附近（far z=16.612，approach d=2.51）；**领取权威=原自然 claim+reload**。单板金属桥 **未证实** | Headed通过（路线）/ 领取沿用原证 |
| C09 | 凝时窗口/过期 | **r33** 对齐 Digit5+F → walk+polyline；站岸上等 frozen 归零 → 板恢复移动且非永久桥 | Headed通过 |
| C10 | 换祠/复活/读档清旧路线 | worldId 切换 snapshot | 代码层 |
| C11 | 乱序/旧档 UX | m4-save-compat | 代码层 |
| C12 | 封印三种状态 | sealIsOpen + r27 门进 | Headed通过 |

## D 组 虚拟操作（12）

| ID | 要求摘要 | 证据 | 状态 |
| --- | --- | --- | --- |
| D01 | 小屏关键按钮可见可点 | layout-hit-194821：844×390 + 667×375 | Headed通过 |
| D02 | 大屏触控/混合 | 模拟 coarse；**物理大屏未测** | 模拟 |
| D03 | 摇杆跟手/松手归中 | r6 walk/run + stick settle | Headed通过 |
| D04 | 多指并行 | m4 three pointers | 代码层 |
| D05 | 第二指不抢摇杆 | m4 second finger | 代码层 |
| D06 | cancel/blur 不粘键 | m4 cancel/blur/hidden | 代码层 |
| D07 | 转屏安全暂停 | **d07-234842**：portrait pause + landscape resume 无粘速 | Headed通过 |
| D08 | 菜单后操作层不穿 | **r32** 844×390+667×375 bag 隔离；关闭后摇杆恢复 | Headed通过 |
| D09 | 拖视角滑过按钮 | look top 30% 分离 | 代码层 |
| D10 | 弓单次切换 | touch-input bow tests | 代码层 |
| D11 | 纯触控开地图行囊 | **r32** 真 touch pointerType；关闭按钮 844×390/667×375 bbox 内可点；摇杆一致 pointerId | Headed通过 |
| D12 | 教程可跳过/重播 | **d12-235143**：visible → skip → replay | Headed通过 |

## E 组 集成与交付（6）

| ID | 要求摘要 | 证据 | 状态 |
| --- | --- | --- | --- |
| E01 | 旧档修复后加载 | m4-save-compat 3/3 | 代码层 |
| E02 | 存储失败提示 | e02 saveError 内存提示 | 代码层 |
| E03 | 单次输入一次 | 队列 + E03 历史 | 代码层 |
| E04 | 短教程 + 完整主线 | 短教程 **d12-235143**；主线 **r27d** 四祠+三塔+封印+空王 reload | Headed通过 |
| E05 | 源码包/资产哈希 | packed/aetherwake.zip.meta.json（SOURCE_COMMIT 见包） | 本地交付 |
| E06 | 性能/异常 | 无新增 pageerror；nav 缓存 | 代码层 |

## 汇总（2026-09-17 R38 最终交付）

- **Headed通过:** A01–A03,A06–A08 B02,B03,B06 C01,C02,C05–C07,C09,C12 D01,D03,D07,D08,D11,D12 E04  
- **Headed分层:** C08 路线至祭坛附近（r37-live-poly）；**领取=原自然 claim+reload**；金属桥未证实  
- **代码层:** A04,A05 B01,B04,B05,B07–B12 C03,C04,C10,C11 D04–D06,D09,D10 E01–E03,E06  
- **模拟:** D02  
- **未验:** 物理手机 **0**  
- **失败单测（game）:** 2 历史攀爬 — **不放宽**  
- **失败（scripts 套件）:** **16** — baseline `54a33655` 相同  
- **test:game:** 604/606 · **scripts:** 637/653  

**不声称 50 项全过。** R37 `altar-interact-reachable` 在 `evidence/HEADED_EVIDENCE_INDEX.md` 标 **UNSUPPORTED**（已领取档误当新互动）；raw JSON 未改。  
**诚实保留：** C08 侧廊领取、金属桥未证；D02 模拟；历史残差不删。
