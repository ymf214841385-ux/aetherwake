# Aetherwake 风醒

开放原野动作冒险。攀爬峭壁、滑翔过湖、点亮天瞭塔、解开灵祠，直到残堡封印打开。

灵感来自开放世界探索手感，角色、地名和故事都是原创，没有任天堂版权内容。

## 操作

| 电脑 | 手机 |
| --- | --- |
| WASD 移动 | 左摇杆 |
| 鼠标 视角 | 右侧拖动 |
| 空格 跳 / 攀 / 滑翔 | 跳 / 翔 |
| Shift 冲刺 | — |
| 左键 攻击 | 攻击 |
| 右键 弓 | — |
| E 互动 | 互动 |
| F 石板（1–4 切换） | 石板 |
| M 地图 · Tab 行囊 | — |

石板四术：爆鸣、霜息、牵引、凝时。

## 本地运行

需要 Node.js 20+。

```bash
cd aetherwake
npm install
npm run dev
```

浏览器打开终端里提示的地址。进度存在 localStorage。

也可以直接下载 [packed/aetherwake.zip](packed/aetherwake.zip)，解压后同样 `npm install && npm run dev`。

## 源码结构

| 路径 | 作用 |
| --- | --- |
| `aetherwake/src/game/sim.ts` | 移动、攀爬、滑翔、战斗、灵祠、存档 |
| `aetherwake/src/game/Scene.tsx` | 三维场景、地形、角色、敌人 |
| `aetherwake/src/game/world.ts` | 塔、祠、营地、残堡、风之种 |
| `aetherwake/src/game/height.ts` | 高度图与地表 |
| `aetherwake/src/game/input.ts` | 键盘、鼠标、触控 |
| `aetherwake/src/game/ui.tsx` | 标题、HUD、地图、行囊 |
| `aetherwake/public/` | 图标与封面图 |

## 技术

- React Three Fiber + Three.js 第三人称
- React 19 / TanStack Start / Vite / Tailwind CSS v4 / Zustand
