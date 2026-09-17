# R37 — independently reproduced mid-sidewalk backtracking regression

R36 physical touch traversal establishes walkable geometry. However new production trySidewalkFallback unconditionally emits [sidewalkEntry,sidewalkFar,altar] until z>17. onSidewalk is computed but ignored when selecting wps. It regresses remaining-route behavior fixed in prior rounds.

Root ran current buildPullShrineRoute with real Sim.enterShrine(2) geometry, metals=[], extraSupports=sim.extraSupports(), player x323.15,y520.28 at z10,12,16. ALL return walk with first target (323.15,520.28,6.5), behind player. Exact reproduction verified; not speculative.

Fix in shrine-route-dynamic.ts trySidewalkFallback: if already on validated sidewalk past entrance corner, omit entry and route onward to sidewalkFar then altar; if far shore route directly altar; if not yet on sidewalk keep safe corner. Do not use global z-only filter for off-sidewalk positions that need safe approach. Reuse old onSidewalk gate with safe threshold and validator. Add failing production-geometry regression at z10/12/16 before fix; assert first target ahead and no emitted polyline doubling back toz6.5, all segments validated. Retain entry fallback tests and true bridge path.

R36 QA takes nav0 corners once, then explicit rim/far/altar. That hides live recalculation errors. Focused test must read updated navigation at each progress point, use current remaining polyline (not hardcoded altar/rim) for next movement, preserve safe corner. Short same natural pull checkpoint/CDP touch only. No need full mainline. Assert real far-shore z>16.5 before direct turn to altar, rather than calling z15.9 'past pit band' (it is not); don't relax this to make green. Final altar can use actual production interact range and must show reachable interaction.

Finish focused regressions, typecheck/test:game/build:app as needed and one final source package. No physics changes/push/deploy. Current 3f8d89b package remains checkpoint, not final accepted navigation. Do not rerun already accepted unrelated portions.
