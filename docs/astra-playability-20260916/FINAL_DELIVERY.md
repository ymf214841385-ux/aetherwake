# FINAL_DELIVERY — Astra Pro 可玩性修复（本地）

**日期:** 2026-09-17 06:50 Asia/Shanghai  
**分支:** `codex/mimo-playability-20260916`  
**审定源 commit（可回滚）:** `eb6e45fc50368bc617a48a8270d98981c0cbf629`  
**权威 SOURCE_COMMIT / ZIP SHA256:** 始终以 `packed/aetherwake.zip.meta.json` 为准。

---

## 1. 本地交付包（绝对路径）

| 项 | 值 |
| --- | --- |
| ZIP | `/Users/ymf/Projects/aetherwake-rebuild-20260909/mimo-playability-20260916/packed/aetherwake.zip` |
| META | `/Users/ymf/Projects/aetherwake-rebuild-20260909/mimo-playability-20260916/packed/aetherwake.zip.meta.json` |
| SOURCE_COMMIT | `eb6e45fc50368bc617a48a8270d98981c0cbf629`（见 meta） |
| 文件数 | 1166 |
| 字节 | 218417209 |
| ZIP SHA256 | `40fa7a47bdcbe04c0c45360bf31a03566157ef3f2a6dce5791b5e1299aa4b429` |
| 构建命令 | `npm run typecheck` / `npm run test:game` / `node --test 'scripts/**/*.test.mjs'` / `npm run build:app` |
| 打包命令 | `node aetherwake/scripts/pack-release.mjs`（仅 git HEAD 内容，确定性 zip；不含 dist/.vercel） |

**解包核验:** 独立临时目录解压后，`sim.ts` / `boss-combat.ts` / `walk-steer.ts` 与 `git show HEAD:` **字节一致**。  
**未纳入包:** `*.log`（gitignore + pack 脚本排除）；最终检查以 `evidence/final-checks/SUMMARY.json` 入包。  
**未删除:** 无关 probe 脚本、失败 headed 轨迹均保留在 git 树中。

---

## 2. 主线证据链（自然档，无 splice）

1. 四祠 `post-still-claimed`  
2. dawn `dawn-4sh-r24b` → `post-dawn-from-shrines`  
3. mere `mere-from-dawn-r24d` → `post-mere-from-dawn`  
4. crown `crown-from-mere-r24b` → `post-crown-from-mere`（封印开）  
5. 残堡外绕进门 `01-enter-courtyard`  
6. 空王 `boss-from-crown-r27d`：still 冻结 → punish → **bossDead** → **reload 三塔四祠+bossDead** → export `post-boss-from-crown`  
   - 胜利画面「空王已沉 / 风仍在」；HP 1.75 仍存活  
   - 脚本旧字段 `death-after-kill` 实为 victory mode；源码已改为 **win-terminal**（不回写旧 json）

---

## 3. 四项用户问题

| # | 问题 | 结果 |
| --- | --- | --- |
| 1 | 角色倒走 | **已修**（wanderer.glb π 校准；A01/A02 Headed通过） |
| 2 | 点击只攻击 | **已修**（ray pick + targetId + LOS；B02 Headed通过） |
| 3 | 无任务路线 | **已修**（地图追踪 + 原野/祠内/残堡路径 + 完整主线） |
| 4 | 触控不可用 | **已修**（摇杆+按钮；D01 844×390/667×375 Headed通过） |

---

## 4. 最终检查（详见 evidence/final-checks/）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | **0** | 通过 |
| `npm run test:game` | **1** | **585/587**；2 历史攀爬失败保留 |
| `node --test 'scripts/**/*.test.mjs'` | **1** | **637/653**；16 项与 baseline `54a33655` 相同失败 |
| `npm run build:app` | **0** | 通过 |

历史 game 失败（不放宽）：climb-detach summit；sim ledge regrab。  
scripts 16 项：brand-check(3) / grok-pwa-plugin(8) / with-app-env(3) / check-auth-invariant(1) / write-atomic(1) — 见 `BASELINE_COMPARE.md`。

---

## 5. 验收与缺口（诚实）

见 `docs/astra-playability-20260916/ACCEPTANCE.md`（一 ID 一行）。

- **Headed通过** 含完整主线 E04、D07 转屏、D12 教程  
- **Headed部分:** 攀爬朝向、读档首步、C08 **侧廊领取（非金属桥）**、D11 bag  
- **模拟:** D02 大屏  
- **未验:** **物理手机 = 0**  
- **scripts 套件:** 16 baseline 残差，不记全绿

---

## 6. 回滚

```bash
git -C /Users/ymf/Projects/aetherwake-rebuild-20260909/mimo-playability-20260916 checkout eb6e45f
# 或直接使用 packed/aetherwake.zip（SOURCE_COMMIT 见 meta）
```

**边界:** 仅本地；未 push / 未部署 / 未改 DB / 依赖 / 物理预算 / 敌人参数。等待 Codex 独立复核。

**进程清理（已核实 cwd）:** 本任务 `vite preview` **:8102** PID 72676/72677（cwd=`…/aetherwake`）**已停止**。非本任务 :8101（opencode-go）/:8091（repo）**未动**。无本任务 Playwright 长驻。
