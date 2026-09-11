# Aetherwake 风醒

开放原野动作冒险。攀爬峭壁、滑翔过湖、点亮天瞭塔、解开灵祠，直到残堡封印打开。

灵感来自开放世界探索手感，角色、地名和故事都是原创，没有任天堂版权内容。

当前分支 `codex/aetherwake-rebuild-v2` 正在按 `docs/AETHERWAKE_REBUILD_PLAN.md` 做 M0—M9 改造。美术方向见仓库外的 `USER_VISUAL_DIRECTION.md`：写实奇幻，不要卡通积木人。

## 操作

| 电脑 | 手机 |
| --- | --- |
| WASD 移动 | 左摇杆 |
| 鼠标 视角 | 右侧拖动 |
| 空格 跳 / 空中再按滑翔 | 跳 / 翔 |
| Shift 冲刺 | 摇杆外圈 |
| 左键 攻击 | 攻击 |
| 右键 弓 | 瞄准开关 |
| E 互动 / 攀爬 | 互动 |
| Ctrl 松手 / 闪避 | 上下文按钮 |
| F 石板（1–5 切换） | 石板 |
| M 地图 · Tab 行囊 · Esc 暂停 | 对应按钮 |

石板五术：引风、爆鸣、霜息、牵引、凝时。新档残堡封印需要三塔且四祠。

## 本地运行

需要 Node.js 20+。

```bash
cd aetherwake
npm install
npm run dev
```

浏览器打开终端提示的地址（默认 http://127.0.0.1:8080/）。进度存在 localStorage，键为 `aetherwake-save-v2`。

编译验证请用 `npm run build:app`（不跑数据库迁移）。`npm run build` 仍会在存在 `DATABASE_URL` 时迁移，不要对着生产库执行。

游戏测试：

```bash
cd aetherwake
npm run test:game
npm run check:world
```

真实输入路线（只读观测 `window.__sim`，不写坐标/奖励）：

```bash
cd aetherwake
npm run dev   # 另开终端
E2E_URL=http://127.0.0.1:8080/ node scripts/play-routes.mjs
```

发行包：

```bash
node aetherwake/scripts/pack-release.mjs
```

`packed/aetherwake.zip` 必须与当前源码对应；元数据见 `packed/aetherwake.zip.meta.json`。

## 源码结构

| 路径 | 作用 |
| --- | --- |
| `aetherwake/src/game/sim.ts` | 移动、攀爬、滑翔、战斗、灵祠、存档 |
| `aetherwake/src/game/Scene.tsx` | 三维场景、地形、角色、敌人 |
| `aetherwake/src/game/wandererRig.ts` | 主角骨骼与动画 |
| `aetherwake/src/game/world.ts` | 塔、祠、营地、残堡、风之种 |
| `aetherwake/src/game/height.ts` | 高度图与地表 |
| `aetherwake/src/game/input.ts` | 键盘、鼠标、触控 |
| `aetherwake/src/game/ui.tsx` | 标题、HUD、地图、行囊 |
| `aetherwake/public/` | 图标、封面与本地资产 |
| `docs/` | 改造计划、状态、验收证据 |

## 技术

- React Three Fiber + Three.js 第三人称
- React 19 / TanStack Start / Vite / Tailwind CSS v4 / Zustand

Grok 只做本地提交，不推送。Codex 独立验收后再更新 GitHub main。


## 2026-09-11 development checkpoint

See [checkpoint notes](docs/CHECKPOINT_2026-09-11.md) for integration and remaining limitations. Not final gameplay/visual acceptance. Character model created with [Meshy](https://www.meshy.ai/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [attribution](aetherwake/public/assets/character/LICENSES.md).
