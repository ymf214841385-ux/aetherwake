# MiMo Continuation Progress

工作树：`/Users/ymf/Projects/aetherwake-rebuild-20260909/opencode-go`  
基线 HEAD：`265cc80716e01c734f76b4ce1e1805ce9a144e6c`  
分支：`codex/glm53flash-optimization-20260911`  
执行计划：`docs/CONTINUATION_PLAN_2026-09-11.md`（P0→P1→P2）

---

## 批次 12 — D1 A/B 采样 + D1.1 退出契约修复

### D1 A/B（本轮无效，不推断 headless 真因）
| 轮 | PID | 模式 | 结果 |
|----|-----|------|------|
| A | 1495 | headless `QA_HEADED=0` | `locator.click` 超时；SIGTERM `elapsedMs=331616`（**未跑满 10 分钟**） |
| B | 1911 | headed `QA_HEADED=1` | 吃料理成功；crown climb **未开印** y=30.6 seal=false |

- 证据：`docs/rebuild-evidence/runs/d1-ab-20260912-005518/`
- HEAD `eb39ade`；save sha256 `49bc8c4b…72ceb`；bundle `index-CHvVuW7R.js` sha256 `56891bc…878d2f40`
- B 原始 exit：`B-exit-1911.json` **`error=flushed is not defined`** stack `boss-from-sealed.mjs:624`
- 此 ReferenceError 为 **本工具引入**，**不是** 99783 旧 page-close 死因
- 1911/2018 已 owned-stop；未动其它 PID

### D1.1 修复（仅测试工具）
1. 删除 `flushed = true` 死赋值；不恢复 first-flush
2. finally：报告 write 失败仍走有界 cleanup；`writeExit`；`dispose`；非零退出
3. 意外 close 的 10s 采样 Promise 由 finally `await`（12s 上限），再 cleanup
4. 新增 `harness-exit-contract.test.mjs`：成功/抛错/报告失败子进程均限期退出
5. ESLint：changed JS **0 errors**（no-undef 类源断言在测试内）

### 验证
- `node --test harness-exit-contract lifecycle` **25 pass**
- 未启动新完整 A/B（待主控审核）

### 未完成
- Boss 击杀 / ending / UI 保存刷新
- 99783 page-close 根因（证据不足，标 unknown）
