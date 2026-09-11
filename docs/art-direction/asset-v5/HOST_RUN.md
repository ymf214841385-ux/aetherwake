# V5 bounded candidate — host execution and review

This is a separate candidate. It opens the existing v4 blend read-only as an
input and writes only under `docs/art-direction/asset-v5/`. It does not edit the
pre-decimation source, v1, v4, images, runtime files, or capture output.

## Evidence vs. inference

Evidence from `asset-v4/host-diagnostics/r5-bounded`:

- The pre-decimation source has head/neck UV-discontinuous coincident groups
  (1,441 / 1,079) but zero split-normal groups in both regions; v4 has 658 / 449
  split-normal groups, with maximum divergences 75.73° / 55.90°.
- V4's PBR rest/Idle images visibly contain face/neck artifacts; the matched
  node-free, smooth plain images retain the geometric shading defects. The
  source PBR close-up does not exhibit the same broad face faceting.
- At Idle frame 31 both v4 upper arms change from rest down-dot 0.92097 and
  lateral-dot 0.38964 to down-dot 0.65909 and lateral-dot 0.75147. The two side
  images show the corresponding forward/lateral lift.

Inference (not a proof): the new v4 split normals are a likely material cause
of the visible face/upper-neck seams, independent of normal-map strength. The
candidate tests that mechanism by making only safe custom loop normals
continuous. It cannot prove that every visible line was caused by normals; the
matched v5 PBR/plain renders decide that. The Idle target is intentionally
between current Idle and the measured rest directions (`down_dot >= 0.86`), not
a claim that rest pose itself is the correct animation.

## Exact host command

Run only after the existing r6 browser capture has exited. Blender must run on
the host, not in the sandbox.

```sh
cd /Users/ymf/Projects/aetherwake-rebuild-20260909/terra-visual
set -o pipefail
/Applications/Blender.app/Contents/MacOS/Blender -b \
  --python docs/art-direction/asset-v5/build_wanderer_textured_rig_v5.py -- \
  --v4 docs/art-direction/asset-v4/wanderer-textured-rig-v4.blend \
  --r5-report docs/art-direction/asset-v4/host-diagnostics/r5-bounded/v4-bounded-face-idle-diagnostic.json \
  --out docs/art-direction/asset-v5 \
  2>&1 | tee docs/art-direction/asset-v5/host-v5-build.log
```

Expected successful outputs are `wanderer-textured-rig-v5.blend`,
`wanderer-textured-rig-v5.glb`, `wanderer-textured-rig-v5-report.json`, and
eight PNGs in `renders/`: four matched face close-ups plus rest/Idle left/right
arm views.

## Required structural checks

The script fails unless all of these are true:

- Vertex count, polygon and loop lists, vertex positions, every UV-loop value,
  material slots/PBR bindings, and every vertex-group weight hash equal v4.
- Only every-vertex head-or-neck-weighted (`>= 0.50`) coincident group is considered;
  vertices and UV loops are never welded. Head split-normal groups fall below
  v4's 658 and head maximum divergence is at most 1°.
- Idle uses measured `tail_local - head_local` rest axes and `aim_bone` local
  basis mapping; both upper arms reach down-dot at least 0.858 at frame 31.
- GLB reimport retains six named clips, original PBR image semantics/count,
  v4's bone count, exactly one tied-hair attachment, and the exported head
  normal-continuity threshold (not merely Blender's pre-export mesh).

## Visual comparison and failure criteria

Compare, at the same r5 framing:

- `r5-bounded/source-before-decimation-rest-pbr.png`, `v4-rest-pbr.png`, and
  v5 `renders/v5-rest-pbr.png`; then repeat for the Idle PBR image.
- v4/v5 `rest-plain-smooth` and `idle-plain-smooth`. If a face/upper-neck seam
  remains comparably visible in plain shading, reject the normal-only mechanism
  rather than increasing normal-map attenuation or welding UVs.
- v5 `arms-idle-left.png` and `arms-idle-right.png` against their rest views.
  Reject if either arm still reads as an A-pose, introduces shoulder asymmetry,
  intersects torso/waist, collapses the forearm/hand, or loses the relaxed
  bilateral silhouette.

Any script exception, changed contract hash, missing/failed texture semantics,
missing clip, failed GLB reimport, or absent PNG is a failed candidate. A
structural pass is not visual acceptance and does not authorize runtime use.
