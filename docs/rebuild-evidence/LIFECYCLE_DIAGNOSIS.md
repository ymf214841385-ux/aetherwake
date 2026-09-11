# Lifecycle diagnosis (page.close ≠ OOM)

Worker QA-LIFECYCLE. Facts from on-disk evidence only. Absences are bugs.

## 94375 (archived `archive-20260910-1706-pid94375/`) — verified dead

Checked at 2026-09-10 17:09–17:10 CST with `kill -0` plus file mtimes. Do not describe this run as alive.

| Field | Value |
|---|---|
| harness | pid **94375 DEAD**, ppid=1, pgid=94375, `ps sess=0` (Darwin `sess` column is 0 for this shell too; not proof of missing setsid) |
| chromium | **94418 DEAD** (recorded in heartbeat; no DiagnosticReports crash dump around 17:06) |
| server | **94416 DEAD** preview `:8101` |
| timestamps | `exit-94375.json`, `heartbeat-94375.json`, `play-routes.json`, `durable-play-routes-94375.log` all **2026-09-10 17:06:00** |
| elapsedMs | 385352 (~6.4 min). Start durable header `2026-09-10T08:59:35.046Z` launcher=94374 child=94375 |
| waitpid | `{ signaled: false, signal: null, code: 1, waitpid: 256 }` — Node `process.exit(1)`, not SIGHUP 129 / SIGTERM 143 |
| signals[] | empty. `ignoreHangup: false` is the INT/TERM env flag; SIGHUP is still attached ignore:true |
| closeReason | `page.close` / `keyboard.up: Target page, context or browser has been closed` |
| stack | `hold` → `goTo` → `follow` → `solveShrine` after log `go shrine rime` |
| observed | towers=`dawn`, shrines=`pull`, orbs=1, ruinSolved=true. **Not a pass.** Grok/launcher exit 0 is not a gameplay pass |
| lastNote | `ppid-dead` with ppid=1. **Logging artifact:** `isAlive(1)` is false by design (never signal init). ppid=1 means the detach reaper is launchd, which is the intended durable shape, not a 17:06 parent death |
| headed | **not recorded** in 94375 heartbeat. `run-durable` did not set `QA_HEADED`; play-routes defaults headless unless `QA_HEADED=1` |
| watcher | `watch_play_94375.trace` size 0, mtime **17:06:27** (27s after exit JSON). Empty trace cannot prove the watcher sent a signal |
| crash reports | none for Chromium/Node at 17:06 |

Compare: 91526 elapsed 1386570 ms (~23 min) exit 1 **without** `closeReason` (harness-exit after wrong-shrine). 90227 elapsed 782833 ms harness-exit. Headed stability 68784 durationMs=607329 `closeReason=null`. 94375 matches the older ~376–385s `page.close` cluster, not those completed routes.

**Not established (do not treat as root cause):** SIGHUP to the process group; Grok monitor timeout; tool finalization of the round-19 session; GPU watchdog; headless vs headed. Wall/shrine identity edits are not evidence they caused or fixed `page.close`. Short repro lives in `scripts/qa/lifecycle-browser-repro.mjs`.


## Last 600 s stability (docs/rebuild-evidence/stability.json)

| Field | Value |
|---|---|
| ok | false |
| requestedMs | 600000 |
| durationMs | 457915 (76% of requested) |
| closeReason.kind | page.close |
| closeReason.message | `keyboard.press: Target page, context or browser has been closed` |
| memory.start / end / delta | 29400000 / 29400000 / 0 |
| pageErrors | [] |
| frames.n | 5790 |
| fps.p50 | ~10 (headless software renderer) |
| navigations | `http://127.0.0.1:8091/` (external preview, not an owned 8101–8199 port) |

`stability-run.exit` content is exactly `1`. `stability-run.done` is `DONE`. No signal name, no waitpid status, no ppid.

### Wrapper log (stability-run.log)

```
start  2026-09-09T14:11:58Z preview=http://127.0.0.1:8091/ wrapper_pid=32474 preview_pid=32167 preview_listen=32168
[stability] pid=32481 chromium=? url=http://127.0.0.1:8091/ requestedMs=600000
exit=1 at 2026-09-09T14:18:00Z          durationMs=362206

start2 2026-09-09T14:19:22Z preview=http://127.0.0.1:8091/
[stability] pid=32914 chromium=? url=http://127.0.0.1:8091/ requestedMs=600000
exit2=1 at 2026-09-09T14:27:00Z         durationMs=457917
```

Recorded:

- wrapper_pid=32474 (first run only)
- harness pid=32481 then 32914
- preview_pid=32167 / preview_listen=32168 (pre-existing :8091, not spawned by this harness)
- Node **did** catch the close, write JSON, and `process.exit(1)` — so the harness was **not** SIGKILL’d. Exit code 1 is not a signal (SIGHUP would be 129, SIGTERM 143).

Not recorded (logging hole, now fixed):

- harness ppid / pgid / sid
- whether ppid was still alive at close
- parent cmdline (was the parent a Grok/OpenCode tool wrapper?)
- Chromium pid (`chromium=?` on every line)
- Playwright driver pid
- heartbeat timestamps
- `aetherwake/.grok/exit-<pid>.json`

## Last play-routes (docs/rebuild-evidence/play-routes.json)

| Field | Value |
|---|---|
| ok | false |
| harness pid | 47154 |
| chromium | `?` (same logging hole) |
| serverPid / port | 47156 / 8101 (owned, unique) |
| last log | `go shrine burst` after dawn + rime attempt |
| closeReason | page.close / `keyboard.up: Target page, context or browser has been closed` |
| observed | towers=dawn, shrines=[], orbs=0, ruinSolved=true |
| failures | towers, shrines, orbs, citadel, save-reload, **close** |

Time span from first log `t=1788973806730` to `go shrine burst` `t=1788974187893` = **381163 ms** (~6.4 min).

Earlier play-routes-run.log (pid=44724, server=44725): dawn + rime claimed, then `page.evaluate: Target page, context or browser has been closed` while going to burst. Span ~376 s.

## What is known (on-disk)

- Headed 600 s (`stability.json` this tree): `ok:true`, `durationMs=607329`, `closeReason=null`, renderer `headed-chromium`, fps p50≈60, context restore recovered. Harness pid 68784, ppid=1, chromium 68927, owned server :8102. JS heap 29.5M → 51.7M (not flat). **Preserve this pass.**
- Older headless 600 s: `ok:false`, `durationMs=457915`, `closeReason.kind=page.close`, JS heap 29.4M → 29.4M, fps p50≈10 (swiftshader). `stability-run.exit` is the character `1` (Node catch + `process.exit(1)`), not a signal number.
- Older play-routes also died with `page.close` around 6.3 min, `chromium=?` (logging hole).

## What is not established

- **SIGHUP / tool-parent hangup is a hypothesis, not a captured cause.** No `exit-<pid>.json` from those old runs recorded signal, ppidAlive, or waitpid status. Exit code 1 is not SIGHUP (129) or SIGTERM (143). Lack of SIGHUP evidence does not prove hangup, and does not disprove it.
- **Flat JS heap does not rule out browser/native memory trouble.** Playwright `memory` samples are V8 heap, not Chromium GPU/renderer RSS. A native leak or GPU watchdog can close the page with a flat JS heap. classifyClose returning `page.close` rather than `oom` only means the OOM detector did not fire.
- Headless software rendering at ~10 fps is a different environment from the headed 60 fps pass. A headed pass does **not** explain why headless closed at 458 s.

## What is plausible (keep as mitigation, not as proof)

The harness + Chromium sitting in a short-lived tool session remains a plausible way to get `page.close` with Node still able to write JSON. `installHarnessLifetime` (ignore SIGHUP, heartbeat, exit JSON) and `run-durable.mjs` (detached setsid, ppid=1) are still the right launch path. The headed 607 s run used that path and passed. That is correlation with a working launcher, not a root-cause proof for the earlier headless closes.

## Fix landed this pass (does not weaken pass gates)

- `installHarnessLifetime` always ignores SIGHUP; writes heartbeat every 5 s; writes exit evidence (code, signal, waitpid-style status, ppidAlive, stack, last heartbeat).
- Owned preview server is spawned with `detached`/`setsid` (new session) but **not** unref’d in-process.
- `browserProcessInfo` falls back to a descendant scan so logs cannot print `chromium=?` once Chrome exists.
- `scripts/qa/run-durable.mjs` starts the harness detached, prints `{ok,pid,logFile,pidFile}`, exits 0; the child keeps running. Stop only via `--pidFile` + ownership checks. Never kill-by-port.
- 600 000 ms remains the stability contract. `page.close` remains `ok: false`. Route contract untouched.

T21 / T25 stay **未验证** until lead runs the full route/600 s via `run-durable.mjs`.
