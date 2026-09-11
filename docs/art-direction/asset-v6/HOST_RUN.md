# V6 bounded candidate — host execution and review

V6 is separate from v4 and v5. It opens v4 as an immutable input and writes
only under `docs/art-direction/asset-v6/`. It never touches the runtime,
capture files, images, v4, or the pre-decimation source.

## What v5 proved, and why it failed

The r5 topology diagnostic calls a group `head` when its **world-space**
position is in the top 24% of the body's world bounding box (`z ratio >= .76`).
V5 selected a different population: every coincident vertex had to have at
least 0.50 summed `head` + `neck` skin weight. The `x=-.24, z=1.44` examples
are coordinates in the diagnostic geometric band, not proof that every member
passes the independent skin predicate. V5 repaired 480 groups but skipped
3,583 duplicate-position groups globally, leaving 178 r5-geometric-head splits
and a 75.7264° maximum.

V6 writes `v6-normal-boundary-manifest.json`, which proves the reconciliation
for every coincident group: local and world coordinates, exact r5 region,
UV-count, loop-normal divergence, every member's head/neck share and dominant
skin group, the v5 predicate result, and v6 disposition. The manifest includes
a cross-tab for the divergent geometric-head population.

## Boundary decision

The control is not a guessed angle threshold. r5 measured the same geometric
head band in the immutable pre-decimation source: 1,441 UV-discontinuous groups,
zero split-normal groups, and only 0.1037° maximum divergence. Therefore a
v4 UV-discontinuous normal jump in that band is treated as a regression seam,
regardless of its skin blend. V6 applies custom loop normals only to that exact
set. A divergent *non-UV* head boundary has no source-control proof and is
explicitly classified as `intentionally_untouched_non_uv_boundary`; its measured
polygon-normal divergence makes it a possible authored sharp boundary or an
overlapping-surface case, not a seam V6 is authorized to smooth. Everything
below the exact head coordinate band is untouched by scope.

This is deliberately fail-closed: unknown/remaining repairable groups, changed
sharp-boundary classification, a changed protected contract, failed GLB
round-trip, or any missing/empty render fails the run. The strict r5 head metric
remains `0` split-normal groups and at most `1°`, both before and after GLB
export; it is not relaxed.

## Exact host command

Run after the active host capture has completed. Blender runs on the host, not
inside the sandbox.

```sh
cd /Users/ymf/Projects/aetherwake-rebuild-20260909/terra-visual
set -o pipefail
/Applications/Blender.app/Contents/MacOS/Blender -b \
  --python docs/art-direction/asset-v6/build_wanderer_textured_rig_v6.py -- \
  --v4 docs/art-direction/asset-v4/wanderer-textured-rig-v4.blend \
  --r5-report docs/art-direction/asset-v4/host-diagnostics/r5-bounded/v4-bounded-face-idle-diagnostic.json \
  --out docs/art-direction/asset-v6 \
  2>&1 | tee docs/art-direction/asset-v6/host-v6-build.log
```

Do not treat Blender exit alone as success. Inspect
`wanderer-textured-rig-v6-report.json`; only the explicit structural-pass status
means all bounded checks ran. That status is still not visual acceptance.

## Required review

The command must create eight non-empty, directly comparable renders:

- `v6-rest-pbr.png`, `v6-idle-pbr.png`, `v6-rest-plain-smooth.png`, and
  `v6-idle-plain-smooth.png`;
- left/right arm views at rest and Idle.

Compare face PBR and node-free plain-smooth output against r5 source and v4.
Reject a remaining comparably visible plain-shaded seam, a new smooth patch,
or changed facial character. Compare Idle arms to rest and reject A-pose
reading, collapsed forearms/hands, self-intersection, waist contact, or
asymmetry. No runtime integration follows from this build.
