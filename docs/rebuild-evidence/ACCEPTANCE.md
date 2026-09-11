# 验收矩阵（本轮实测）

环境：macOS，Node v25.9.0，HeadlessChrome 153，窗口 1280×800，DPR 1，HEAD 见 git。`DATABASE_URL` absent。

| 编号 | 结果 | 证据 |
|---|---|---|
| T01 | 已验证（自动化） | `npm run test:game` B01 |
| T02 | 已验证（自动化，100 次×5 刷新率） | input.test.ts |
| T03 | 已验证（自动化） | clock.test.ts / input look |
| T04 | 已验证（自动化 60s 查询） | physics.test.ts / sim.test.ts metal |
| T05 | 已验证（自动化跳塔）+ 灰盒代码 | sim.test.ts jump tower；灰盒 `?graybox=1` |
| T06 | 已验证（控制器代码+灰盒墙） | physics wall/climb；真机连续操作待验收 |
| T07 | 部分：滑翔切换与风场采样有测试；入水/侧风连续操作待浏览器长测 | wind.test.ts |
| T08 | 部分：球扫遮挡已实现；菜单指针锁在浏览器实机待更长操作 | Scene + sim.updateCamera |
| T09 | 移动模拟：触区按元素绑定；真机待验证 | GameClient.tsx |
| T10 | 后台 resetInput + 竖屏提示；真机待验证 | input.ts / ui portrait-hint |
| T11 | 已验证 | persistence.test.ts |
| T12 | 部分：重生用检查点地面已测；塔顶实爬现有 sim.test 晨光塔登顶 | sim.test.ts mainline climb |
| T13 | 已验证 | persistence weapon ids |
| T14 | 已验证数值 | world-sample.json：山 52.8，出生 11.4，雪点 67 |
| T15 | 部分：真 SkinnedMesh + skeleton 序 skinIndex；孤立 FRONT 仍是椭圆脸/玩具感。无付费 GLB。**用户未认可。** | character/front.png；VISUAL_REVIEW.md |
| T16 | 已验证采样一致性；隔墙 gust 有 occlusion | wind.test.ts |
| T17 | 部分：浏览器实跑 `ruinSolved=true`（gust 风桥）；侧翼滑翔路径在 harness 里是后备。未连续录像。 | play-routes-run.log gust tick |
| T18 | 已验证 | combat.test.ts |
| T19 | 敌人状态机已实现；录像未交付 | sim.updateEnemies |
| T20 | 瞄准+左键射击，松右键不放箭 | sim.handleCombat |
| T21 | 未通过：80160 同一新档 dawn+mere+crown+四祠+四核+风桥，残堡已进，`bossDead=false`（死在近身、从出生点走回）。78160 同样三塔+prompt 挑战空王未击杀。不得把 78160 塔与 80160 战斗拼成一趟。 | archive-20260910-131805-pid80160-final；durable-play-routes-80160.log |
| T22 | 部分：80160/78160 浏览器同档点亮三塔。78945 镜湖 wall-hug xz=4.5 被当成 shaft 未点。Node 主线仍绿。3× mere-focus / 3× crown-focus 待本轮验证。 | 80160 log；QF1/QF4；mere-focus.json |
| T23 | 封印规则已测。80160 封印已开并进残堡，未击杀。melee 现用 cam.yaw；harness 追 live boss。完整 ending 仍未验证。 | sim.test.ts live-target；play-routes fightBoss |
| T24 | 有实机截图；美术待用户认可，非占位通关 | docs/rebuild-evidence/*.png |
| T25 | 已验证（headed Chromium，非真机）：`run-durable` 子进程 ppid=1，durationMs=607329，ok=true，closeReason=null，contextRestore.recovered=true。fps p50≈60。headless-swiftshader 仍会在 ~457s page.close，不能当成这趟 60fps 结果。 | stability.json；exit-68784.json |
| T26 | headed 桌面 ~60fps；headless software ~10fps。**不是** iPhone/Android 真机。T09/T10 真机仍未测。 | stability.json fps；QA_FAILURES.md |
| T27 | 存档损坏路径已测。600s 稳定性含 lose+restore，`recovered=true`。`ruinSolved` 现写入 `progress`（Node continueSave 绿）。浏览器 继续旅途 仍待下一趟全路线。 | persistence.test.ts；sim.test.ts ruinSolved save schema |
| T28 | `node --test 'scripts/qa/*.test.mjs'` **67 pass**。`test:game` **127 pass**。`build:app` 无 migrate。character `weightPower` 仍有 tsc 噪声（视觉 worker 文件）。 | QA_FAILURES.md |
| T29 | 用 `scripts/pack-release.mjs` 从当前脏树重打 zip；排除 secrets/DBs/node_modules/.grok/webm；未知 albedo 已移出 public。 | packed/aetherwake.zip.meta.json |
| T30 | 本地提交，无凭据，未推送 | git log |

软件渲染/无头浏览器结果不得写成 iPhone 真机。
