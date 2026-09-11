# Aetherwake Rebuild Status

## 当前工作基线
- 仓库：ymf214841385-ux/aetherwake
- 分支：codex/aetherwake-rebuild-v2
- 起始 HEAD：ddaea4db03dd63100187b7a649ce5d034ece23ea
- 当前 HEAD：976bea0（未推送）本轮本地提交
- 代码提交：976bea0 feat(aetherwake): skinned wanderer, durable QA, four-shrine route
- 未提交改动及归属：仅 `.grok/` 运行时 pid 与一条冗余 webm。无他人脏工作区，未 reset
- 当前阶段：`test:game` 116 pass；QA harness 58+ pass；`build:app` 无 migrate。T25 headed 600s 通过。T21 四祠通过、三塔/残堡未同趟完成。T15 未认可。不推送。
- 计划：docs/AETHERWAKE_REBUILD_PLAN.md
- 本轮权限：本地修改、安装项目依赖、隔离测试、本地提交；不推送、不部署、不强推、不访问生产数据库

## 阶段状态
| 阶段 | 状态 | 代码提交 | 测试证据 | 未完成/阻塞 |
|---|---|---|---|---|
| M0 | 已验证 | 本分支本地提交 | `npm ci`；`npm run build:app` 成功且未跑 migrate；dev :8080 | 无 |
| M1 | 已验证 | 同上 | `test:game` 40 pass：输入、存档、金属自升、跳塔 | 无 |
| M2 | 已验证（灰盒/自动） | 同上 | 状态机、相机球扫、灰盒 `?graybox=1` | 连续两分钟人工操作待用户 |
| M3 | 已验证（数值+截图） | 同上 | world-sample.json 山 52.8 / 出生 11.4；风谷路径 | 路线示意未手绘 |
| M4 | 部分 | 同上 | 原创层级骨骼角色，hero-close.png | 无授权 GLB；用户未认可美术 |
| M5 | 部分 | 同上 | 白天锁定、160 段地形、六机位截图 | 草木密度与水岸仍偏简 |
| M6 | 已实现，部分验证 | 同上 | 统一风场、引风、风桥、战斗窗口、敌人阶段 | 机关两条路线未连续录像 |
| M7 | 部分 | 同上 | 新操作表、触区绑定、竖屏提示、设置 | 真机手机未测；无录像 |
| M8 | 已迁移，部分验证 | 同上 | 三塔四祠三营八种+四术+引风+残堡规则测试 | 完整主线实爬未完成 |
| M9 | 部分 | 同上 | typecheck 0；build:app；HeadlessChrome 截图 | 真机帧率、十分钟内存、ZIP 仍为旧包 |

## 环境核验
- Node v25.9.0 / npm 11.12.1
- `DATABASE_URL`：absent
- `npm run build` 仍为 `vite build && db:migrate`（保留给部署）
- 本任务编译：`npm run build:app` → vite/nitro 成功，**没有**调用 migrate
- 预览：`cd aetherwake && npm run dev` → http://127.0.0.1:8080/

## 实际执行的验证
| 检查 | 命令/步骤 | 环境 | 退出码/结果 | 证据 |
|---|---|---|---|---|
| git 基线 | `git rev-parse HEAD` | 仓库 | ddaea4d | 本文件 |
| 依赖 | `npm ci`（aetherwake/） | 本地 | 0 | 473 packages |
| 游戏测试 | `npm run test:game` | node strip-types | 0，40 pass | 终端 |
| 地形采样 | `npm run check:world` | 同上 | 山 52.76 出生 11.4 | docs/rebuild-evidence/world-sample.json |
| 类型 | `npx tsc --noEmit` | 同上 | 0 | 终端 |
| 无迁移编译 | `npm run build:app` | DATABASE_URL unset | 0 | vite 1854 modules |
| 浏览器开局 | Playwright 点「开始探索」+ W | HeadlessChrome 153 1280×800 | 走到 z≈98.3 | title.png playing.png |
| 六机位 | `node scripts/capture-views.mjs` | 同上 | playing | spawn-vista / hero-close / cliff-lookback / glide-down / lake-shore / ruin-camp |
| 原脚本测试 | `node --test scripts/**/*.test.mjs` | 基线 | 既有 ENOENT `.grok/skills/og/references` | 非本轮引入 |

## 决策日志
- 碰撞：不引入 Rapier。解析高度场 + 塔/台/金属实体共用运动学胶囊。
- 构建：保留 `build`（含迁移），新增 `build:app`。
- 存档：v2 键 `aetherwake-save-v2`，读取 v1 时备份，不覆盖原文；合法 0 保留。
- 引风为第 5 项能力（键 5 / 默认），1–4 仍为旧四术；旧档 art+1。
- 新档封印：三塔且四祠。旧档 `legacy-orbs` 或已通关不撤销。
- 主角：原创层级骨骼（非换色占位），无付费 GLB。见 ASSET_GAPS.md。
- 昼夜默认锁定早晨 `0.22`，避免验收被循环打坏。

## 缺陷 B01—B13
| 编号 | 状态 | 说明 |
|---|---|---|
| B01 | 已验证 | 键盘与触控冲刺分离 |
| B02 | 已验证 | 无步进不消费；多步进一次；100 次短按 |
| B03 | 已验证 | 支撑排除自身 |
| B04 | 已验证 | 塔柱不可站顶，跳入不吸顶 |
| B05 | 已修复待真机 | 触区按元素身份；resetInput 覆盖失焦/隐藏/取消 |
| B06 | 已修复待长测 | 攀爬用身体前方墙；相机球扫 |
| B07 | 已验证数值 | 沿岸衰减不再压平主山；气候分区 |
| B08 | 已验证 | 有效帧命中，同挥击一次 |
| B09 | 部分 | 角色重做但仍为程序几何 |
| B10 | 已验证 | continue 不先 startNew |
| B11 | 已验证 | 装备稳定 ID |
| B12 | 已验证同源 | 高度函数与网格同公式；塔为实体 |
| B13 | 已验证 | `build:app` 无迁移 |

## 未验证项与阻塞
- 真机 iOS/Android：T09/T10/T26 不能标完成。
- 用户认可美术：T15/T24 未通过。孤立 FRONT 仍偏玩具。
- 浏览器主线：四祠四核+风桥已实跑；三塔从未同趟点亮；残堡未进。`play-routes.json` ok=false。
- T25 十分钟 headed 稳定性已通过（607s，~60fps，上下文恢复）。headless 仍会 ~457s 关页。
- 原仓库脚本测试缺少 `.grok/skills/og/references`（基线问题）。

## 下一项明确动作（续跑）
1. 镜湖塔水面起爬 / 晨光中段 rest 循环：让同一趟 play-routes 点亮三塔后进残堡。
2. 人工验收角色近景（T15 未过）。
3. Codex 独立验收后再推 GitHub main。本会话不推送。

## 运行与演示
```bash
cd aetherwake
npm install   # 已用 npm ci
npm run dev   # http://127.0.0.1:8080/
npm run build:app
npm run test:game
npm run check:world
```
开发灰盒：`http://127.0.0.1:8080/?graybox=1` 后点开始。
证据目录：`docs/rebuild-evidence/`
内容盘点：`docs/CONTENT_INVENTORY.md`
资源缺口：`docs/ASSET_GAPS.md`
验收矩阵：`docs/rebuild-evidence/ACCEPTANCE.md`


## Codex interruption checkpoint — 2026-09-09 23:42 CST
Grok Build quota exhausted (HTTP402), round7 exited. Implementation and verification incomplete. Current task-owned working changes preserved; no GitHub upload. Independent normal-direction check confirms head/torso/arms now outward. Terrain shader type fix present; actual visual/route/600s stability acceptance remains outstanding. Resume details: task-root GROK_QUOTA_CHECKPOINT.md.
