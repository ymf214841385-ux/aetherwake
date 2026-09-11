# QA failures (Worker C)

Harness: `aetherwake/scripts/play-routes.mjs`, `aetherwake/scripts/stability.mjs`.
Input is keyboard/mouse only. `window.__sim` is read, never written.
`ok` is the route/stability contract, not “the browser did not throw”.

This pass is **lifecycle-only**. Full three-tower play-routes and 600 s stability were **not** run here (lead launches those via `scripts/qa/run-durable.mjs` after `build:app`). T21 / T22 / T25 stay **未验证**.

## Harness remake (this session)

| Item | Change |
|---|---|
| Isolated server | `scripts/qa/lifecycle.mjs` `spawnOwnedServer` / `stopOwnedServer`. Unique port in **8101–8199** (does not steal 8080/8081/8091). Pid file + log file **keyed on child pid**: `.grok/<name>-<pid>.pid` / `.log` / `.json`. |
| Ownership | Stop refuses pid≤1, self, parent, missing pid file, pid-file mismatch, or cmdline that is not the spawned server. Descendants of *that* pid only. Never `pkill` / never kill-by-port. |
| Detach | `qa-preview.mjs start` uses `detach:true` + `unref` so the preview **survives the start command**. In-process play-routes / stability spawn the **server** in a new session (setsid) but keep the handle (no unref). Playwright `handleSIGINT/SIGTERM/SIGHUP=false`. The remaining hole was the **tool parent** killing the harness session — see QF5. |
| Close | `classifyClose` + `unexpectedCloseFailure`. `page.close` / crash / disconnect / target-destroyed ⇒ `ok:false` with `failures[].id=close`. Intentional teardown after writing JSON is not a failure. |
| Durable session | `installHarnessLifetime` in `scripts/qa/lifecycle.mjs` (re-exported from `durable-session.mjs`). Ignores SIGHUP. Heartbeat `aetherwake/.grok/heartbeat-<pid>.json` every 5s. Exit evidence `exit-<pid>.json` (code, signal, waitpid-style, ppidAlive, stack). `run-durable.mjs` starts the harness detached (setsid) so the tool parent can return. |
| Route contract | Success requires **all** of: 3 towers, 4 shrines, orbs≥4, ruinSolved, citadel/boss ending path, save+reload restores via `window.__sim`. Missing any ⇒ `ok:false` with the actual ids. Skipping citadel is **not** success. Zero shrines cannot be `ok:true`. |
| Save+reload | End of play-routes: read localStorage envelope (read-only), `page.reload`, click **继续旅途** (never 开始探索), re-read `__sim`. |
| Climb | `climb-policy.mjs` only emits real keys (WASD, E, Space, …). No 12 m `grabRest` teleport instruction. Rest = wait on a **3-row** authored ledge (`y0=max(2.1, WATER_LEVEL+0.55-baseY)`, `yTop=38-1.55`, `y=y0+(row/2)*ySpan`, row 0..2). Re-grab = **hold W+E** (not tap E then W). Never walk into the shaft center. |
| Preview CLI | `qa-preview.mjs` no longer `stop()`s whatever is on 8091 at start. Busy preferred ports fail closed or fall through to 8101+. |

Existing compiled preview **pid 34948 on :8091** was left running (not owned by this remake’s pid files). This pass did not start a game/preview server and did not run `play-routes.mjs` / `stability.mjs`.

## QF0 — false pass (mandatory, still forbidden)

| | |
|---|---|
| Expected | `play-routes.json` `ok` true only if mode is playing/ending, 3 towers, 4 shrines, orbs≥4, ruinSolved, citadel/boss ending, and save+reload restores. |
| Actual (pre-fix file, previous session) | `"ok": true` with `towers=[]`, `shrines=[]`, `orbs=0`, `ruinSolved=false`, `bossDead=false`, `mode="title"`. |
| Actual (on-disk this rebuild) | `docs/rebuild-evidence/play-routes.json` **`ok: false`**. Observed towers=`dawn`, shrines=`[]`, orbs=0, ruinSolved=true, `closeReason.kind=page.close`. Failures: towers (mere,crown), shrines (all four), orbs. **Not a pass.** The remade contract would also fail `citadel`, `save-reload`, and `close`. |
| Cause | **Harness (historical).** `ok` was hardcoded `true`. |
| Fix | `scripts/qa/route-contract.mjs` — process exits 1 when objectives are missing. JSON still written. |

Unit evidence: `node --test scripts/qa/route-contract.test.mjs` includes “never coerces ok=true when shrines are zero”.

## QF1 — dawn tower not activated

| | |
|---|---|
| Expected | Near (10,68), climb with **local** ledge rests, prompt `启动 晨光塔`, E, `towers` includes `dawn`. |
| Actual (last browser file) | Dawn was observed on in that snapshot; mere/crown were not. Earlier runs peaked y≈24–29 then fell; `towers` stayed `[]`. |
| Cause | **Mixed.** Gameplay mantle is local (`MANTLE_REACH_XZ=1.6`). Harness must **not** depend on a 12 m snap: it only sends W/S/E/Space, rests on 3 authored rows, re-grabs with hold W+E, and walks around the shaft. |
| Owner | Lead (climb/rest feel) + C (3-row nearLedge + W+E re-grab; this pass). |

## QF2 — wind ruin (gust) — observed pass (previous compiled run)

| | |
|---|---|
| Expected | `ruinSolved===true` via gust or updraft. |
| Actual | Last file `observed.ruinSolved=true`. Earlier: `gust tick ruinSolved=true toast=风桥合拢。回程捷径已开。` |
| Cause | Standing at (28,86) facing the ruin works. |

## QF3 — shrines incomplete

| | |
|---|---|
| Expected | All four ids in `shrines`, `orbs>=4`. Altar at origin z+23, claim radius 2.2. |
| Actual (last file) | `shrines=[]`, `orbs=0` (died inside shrine 0 / rime hint). Previous compiled run: pull/rime/burst claimed, still never reached. |
| Cause | **Mixed.** Page close + altar steer. Rime pit is `|lx|<4.8`, `lz∈(8,20.4)` (not `|lx|<6.2`). Sidewalk at `origin.x±7.15`. Nav is **+X to sidewalk first**, then **+Z past 21.6**, then altar. Diagonal spawn→`(o.x+7.4, o.z+22)` crosses the pit. Burst/pull/still still fire bomb/gust/wait; sidewalk is not an auto-claim. |
| Owner | C (pit 4.8 + +X-then-+Z; this pass) + lead (reachability) + session lifetime. |

## QF4 — mere / crown / citadel

| | |
|---|---|
| Expected | Climb mere and crown. Citadel/boss ending path required for `ok:true`. Seal-closed is a failure if attempted. Skipping citadel is now a **contract failure** (`id: citadel`). |
| Actual | Last file: citadel not attempted; mere/crown missing. |
| Owner | Lead (water/frost) once the session stays alive. |

## QF5 — page / context closed mid-route (parent/session death)

| | |
|---|---|
| Expected | One owned browser + owned server for the whole route. Unexpected close ⇒ `ok:false`, `closeReason` set, never a pass. Tool parent returning must not kill the session. |
| Actual | Last play-routes: harness pid=47154, serverPid=47156 :8101, `chromium=?`, dawn then rime then `go shrine burst`, `closeReason.kind=page.close` (`keyboard.up` / `page.evaluate` target closed). Span ~381 s. Last 600 s stability: durationMs=457915, same `page.close`, heap 29400000→29400000. `stability-run.exit` is the character `1` (no signal). Wrapper pid=32474 recorded `exit2=1`. **Not a pass.** |
| Cause | **Parent/session lifetime, not OOM and not a Playwright flake.** The harness + Chromium sat in the short-lived Grok/OpenCode command’s session. Session hangup / tool parent death closes Chromium; Node’s catch writes JSON and exits 1, which *looks* like `page.close`. Evidence that was missing (ppid, sid, chromium pid, ppidAlive, waitpid status) is itself a bug — now heartbeat/exit JSON. See `docs/rebuild-evidence/LIFECYCLE_DIAGNOSIS.md`. |
| Fix | `installHarnessLifetime` (SIGHUP ignored; heartbeat every 5 s; `exit-<pid>.json`). Launch **only** via `node scripts/qa/run-durable.mjs --name <stability\|play-routes> -- scripts/<harness>.mjs` (detached setsid, launcher exits 0, child keeps running). Stop **only** with `--stop --pidFile` after ownership checks. Never kill-by-port. |

## QF6 — stability 10 min (T25 still 未验证)

| | |
|---|---|
| Expected | 600000 ms, samples, rAF percentiles. `page.close` is a failure. Duration is not lowered. |
| Actual | Last 600 s attempt: **durationMs=457915**, `ok:false`, `closeReason.kind=page.close`. `stability-run.exit`=`1`. 20 s smoke previously `ok:true`. **This worker did not re-run 600 s** (`dist/` missing; lead runs it via `run-durable` with timeout 0). |
| Cause | Same parent/session death as QF5. Headless software renderer ~10 fps is environment, not a device claim. |

## Strict success predicates (route)

`evaluateRoute` returns `ok:true` only when **all** hold:

1. `final.mode` in playing / ending / credits (not title)
2. towers include `dawn,mere,crown`
3. shrines include `pull,rime,burst,still`
4. `orbs >= 4`
5. `ruinSolved` observed on `__sim` during the run
6. citadel/boss attempted **and** `bossDead`
7. save+reload attempted, save present, 继续旅途, and towers/shrines/orbs/bossDead restored on `__sim`
8. no unexpected `closeReason`

Anything missing is listed in `failures` with `id` / `expected` / `actual`. Incomplete towers/shrines **cannot** be coerced to `ok:true`.

## QF7 — boss: static POI + death loop (80160, 78160)

| | |
|---|---|
| Starting state | Same save, three towers + four shrines, seal open, player at citadel gate. Boss spawn ≈ (6, −4.8), hp=20. |
| Normal input | WASD to approach, mouse look, left-click melee, Ctrl/C dodge, 在篝火旁醒来 on death. |
| Expected | Click starts `attack.phase` windup→active; hits that pass range/facing/occlusion drop boss hp; `bossDead=true` and ending; dodge recovers positioning; reload keeps progress. |
| Observed (80160, pre-fix harness) | Prompt `挑战空王`. swing=20 d=1.4 player hp=0.25 boss hp=16.4 (two 1.8 hits). Then d=117.8 hp=4 (respawn at spawn). Boss stayed ~ (6.36, −5.50). Later two more contact bursts (hp 16.4→12.8→9.2). `bossDead=false`. Canvas clicks while looking at static POI. |
| Cause | **Mixed.** Gameplay: melee used stale `player.yaw` (only updates while walking) while look uses `cam.yaw`. Harness: locked onto `POI.citadel` not live `enemies`; arrived at 1.4 m inside boss melee 3.4; after death walked back without sprint. Prompt/E is not combat start. |
| Regression | `sim.test.ts` camera-facing melee; static-POI miss vs live-target hit. Harness logs hp before/after, yaw, boss xz, dist, attack phase, seal. |
| Narrow fix | `handleCombat` faces `cam.yaw` on swing. `fightBoss` tracks live boss, sprint-reapproach after death, dodge on telegraph, stay 1.65–2.55 m. No invuln/damage cheats. |

## QF8 — ruinSolved true → false after 继续旅途

| | |
|---|---|
| Starting state | 80160/78945/78160: `observed.ruinSolved=true` during the run. |
| Normal input | Escape, reload, click 继续旅途. |
| Expected | Same save restores towers, shrines, orbs, wind-bridge solved, bossDead. |
| Observed | `saveReload.after.ruinSolved=false`. Envelope had no `progress.ruinSolved`. |
| Cause | **Gameplay persist miss**, not a designed reset. `captureSave` omitted the flag; `applySave` never loaded it; `resetWorldEntities(true)` remade planks at home. |
| Regression | `persistence.test.ts` + `sim.test.ts` continueSave; `saveReloadRestored` fails on drop. |
| Narrow fix | Persist `progress.ruinSolved`; dock planks on load when true. |

## What lead must run later

See `ACCEPTANCE.md` T21 / T22 / T25. Use the compiled snapshot, not live `:8080` HMR. `dist/` must exist (`npm run build:app`, not `npm run build`).

Do **not** run `node scripts/stability.mjs` / `node scripts/play-routes.mjs` under a short-lived tool command. Launch so the tool parent cannot kill them:

```
cd aetherwake
node scripts/qa/run-durable.mjs --name stability -- scripts/stability.mjs
node scripts/qa/run-durable.mjs --name play-routes -- scripts/play-routes.mjs
# launcher prints {ok,pid,logFile,pidFile} and exits 0; child keeps running.
# watch aetherwake/.grok/heartbeat-<pid>.json and docs/rebuild-evidence/<name>-run.log
# stop ONLY:
node scripts/qa/run-durable.mjs --stop --pidFile .grok/durable-stability-<pid>.pid
```

T21 / T22 / T25 stay **未验证** until that full run.

Unit evidence this pass (lifecycle; T21/T22/T25 still 未验证): `cd aetherwake && node --test 'scripts/qa/*.test.mjs'` → **58 pass, 0 fail, exit 0**.

