# D2 外部 cron 清理 headless Chromium（主控已闭环）

日期：2026-09-12  
范围：仅记录与本项目 QA 相关的三条清理日志；不复制 Hermes 全量配置。

## 机制（主控查证，项目内不改）

- crontab 每 3 分钟执行 `/Users/ymf/.hermes/scripts/cleanup-browser.sh`
- 对匹配 `chrome.*--headless` 且 age>300s 的进程 `kill`（SIGTERM）
- 不识别任务归属；**禁止**修改该脚本或 cron

## 与本项目失败对齐的三条

摘自 `/tmp/browser-cleanup.log`（仅 PID/age 三行）：

| 时间 | PID | age | 对应 QA |
|------|-----|-----|---------|
| 23:21 | 94372 | 475s | 早期 play-routes / sealed 试跑 |
| 00:45 | 99784 | 419s | boss-sealed 99783 chromium |
| 02:51 | 8379 | 448s | D1.3 A headless chromium |

D1.3 A 的 `pw:browser`：02:51:00.839 Chromium exit **143**（SIGTERM）；harness 主动 `harness-close-call` 在 02:51:10。  
→ **外部 cron**，非游戏 crash、非 ppid 退出。

## 项目侧对策（只改本仓库 QA）

1. `run-durable.mjs` 默认 headed 名单增加 `boss-sealed` / `boss-resume`；显式 `QA_HEADED=0` 仍可短诊断
2. 长 QA 启动显式 `QA_HEADED=1`；确认 Chromium 无 `--headless`、非 `chrome-headless-shell`
3. 停止 A/B 重试；B 的 crown 未开印为独立导航问题
4. 主控授权：用完整 `play-routes.mjs` + `citadelFightStep` 新档跑一趟（非简化 boss-from-sealed）
