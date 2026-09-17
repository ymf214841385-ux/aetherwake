# R36 — stop reintroducing turn-timeout drive bug

You are actively running R35 headed6 after five failed movement runs. Existing production routing changes may be valid; do not alter them just to compensate for QA steering.

Root read current `r35-sidewalk-headed.mjs:walkTo`: after 24 turn steps you ALWAYS driveOnce even if decideSteer never returned drive. This recreates prior R14 forbidden drive-with-unconverged-heading defect. Headed5 actor remains around entry316,4.4 for all3 stages, so full route retry gives no evidence. Abort current loop at next safe boundary if noProgress persists.

Use already proven R32 browser native CDP touch helper + worldToStickOffset(target−player,camYaw) from walk-steer.ts. This moves toward desired world vector using actual touch joystick without waiting for camera turns; do not use page.mouse or write sim state. Follow actual returned nav polyline corners with short strides/recompute; retain all key/touch release on exit. Reuse original R32 exact helper rather than recoding it. If staying keyboard, you MUST drive only after decision drive and otherwise return timeout with err/dot/camYaw; never fallback drive.

First local1-second motion probe toward first safe waypoint: capture desired world dx/dz, computed stick dx/dy, actual pointerType/trusted/id, before/after xyz/v, distance to waypoint. Require distance decrease and grounded; if it fails stop and inspect input focus/overlay/event reception, no whole route retry. After probe succeeds continue same session along route, preserve trace and assert all rim/farshore/altar milestones. No changes to physics/arrow semantics/production orientation.

Finish R35 regression checks + typecheck/test:game/build:app after successful diagnostic. No packaging until pass or honest concrete blocker. This is execution correction, no need to rerun accepted mainline or prior acceptance.
