"""Build a fail-closed v6 face/Idle candidate from immutable v4.

The v5 failure was a selector mismatch, not evidence that the coordinate-band
diagnostic was wrong.  r5 calls the upper 24% of the *world-space mesh bounds*
``head``.  v5 instead required every duplicate vertex in a group to carry at
least .50 summed ``head``/``neck`` weight.  Those are deliberately reported as
separate predicates here.  In particular, skin blending must not be used as a
proxy for a diagnostic coordinate region.

v6 repairs every divergent UV seam in r5's exact geometric head band.  It does
not use skin weights to select a normal repair.  The pre-decimation source is a
required control: its same geometric head band has zero split-normal groups and
at most 0.1037 degrees of divergence.  That makes an UV-split normal jump in
this band a regression seam, not an authored hard normal boundary.  A divergent
non-UV boundary is explicitly classified as an intentionally untouched possible
sharp/overlapping-surface boundary and is left alone.  Any unknown head case
fails the build rather than being silently smoothed or accepted.

Only custom loop normals and the already-bounded Idle arm pose are changed in
memory.  No vertex position, face/loop topology, UV value, material binding,
image, or skin weight is modified.  Host Blender only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
V4_BLEND = ROOT / "docs/art-direction/asset-v4/wanderer-textured-rig-v4.blend"
R5_REPORT = ROOT / "docs/art-direction/asset-v4/host-diagnostics/r5-bounded/v4-bounded-face-idle-diagnostic.json"
OUT = ROOT / "docs/art-direction/asset-v6"
RENDERS = OUT / "renders"
BLEND = OUT / "wanderer-textured-rig-v6.blend"
GLB = OUT / "wanderer-textured-rig-v6.glb"
REPORT = OUT / "wanderer-textured-rig-v6-report.json"
MANIFEST = OUT / "v6-normal-boundary-manifest.json"
EXPECTED_CLIPS = ("Idle", "Walk", "Run", "Attack", "Climb", "Glide")
NORMAL_SPLIT_DEGREES = 1.0
RUN = {}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v5 = load_module("wanderer_v5_for_v6", ROOT / "docs/art-direction/asset-v5/build_wanderer_textured_rig_v5.py")
diagnose = load_module("v4_diagnose_for_v6", ROOT / "docs/art-direction/asset-v4/diagnose_v4_face_idle_host.py")
v3 = v5.v3


def arguments():
    tail = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--v4", type=Path, default=V4_BLEND)
    parser.add_argument("--r5-report", type=Path, default=R5_REPORT)
    parser.add_argument("--out", type=Path, default=OUT)
    return parser.parse_args(tail)


def configure_output(args):
    global OUT, RENDERS, BLEND, GLB, REPORT, MANIFEST
    OUT = args.out.resolve()
    RENDERS, BLEND, GLB = OUT / "renders", OUT / "wanderer-textured-rig-v6.blend", OUT / "wanderer-textured-rig-v6.glb"
    REPORT, MANIFEST = OUT / "wanderer-textured-rig-v6-report.json", OUT / "v6-normal-boundary-manifest.json"
    OUT.mkdir(parents=True, exist_ok=True)
    RENDERS.mkdir(parents=True, exist_ok=True)


def find_body_and_rig():
    body, rig = v3.find_body_and_rig()
    if body.name != "WandererTexturedBody":
        raise RuntimeError("Expected v4 WandererTexturedBody, got %s" % body.name)
    return body, rig


def angle(first, second):
    if first.length < 1e-9 or second.length < 1e-9:
        raise RuntimeError("Zero normal prevents a bounded normal classification")
    return math.degrees(math.acos(max(-1.0, min(1.0, first.normalized().dot(second.normalized())))))


def max_angle(normals):
    return max((angle(a, b) for i, a in enumerate(normals) for b in normals[i + 1 :]), default=0.0)


def loops_by_vertex(mesh):
    result = defaultdict(list)
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            result[mesh.loops[loop_index].vertex_index].append(loop_index)
    return result


def polygons_by_loop(mesh):
    """Return the polygon owning each loop without MeshLoop.polygon_index.

    Blender 5.2's MeshLoop exposes its vertex but no longer exposes the
    polygon index.  Polygon.loop_indices is the stable, public inverse
    relation and also works on the Blender versions used for the prior
    diagnostics.
    """
    result = {}
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            result[loop_index] = polygon.index
    if len(result) != len(mesh.loops):
        raise RuntimeError("Every mesh loop must be owned by exactly one polygon")
    return result


def coincident_groups(mesh):
    result = defaultdict(list)
    for vertex in mesh.vertices:
        result[tuple(round(value, 6) for value in vertex.co)].append(vertex.index)
    return [(position, indices) for position, indices in result.items() if len(indices) > 1]


def skin_class(body, indices):
    """Report, but do not select by, the immutable skin weights."""
    wanted = {name: body.vertex_groups[name].index for name in ("head", "neck") if body.vertex_groups.get(name)}
    if set(wanted) != {"head", "neck"}:
        raise RuntimeError("v4 must retain head and neck vertex groups")
    members = []
    for index in indices:
        weights = {body.vertex_groups[item.group].name: item.weight for item in body.data.vertices[index].groups}
        share = sum(weights.get(name, 0.0) for name in wanted)
        dominant = max(weights, key=weights.get) if weights else None
        members.append({"vertex": index, "head_neck_share": round(share, 6), "dominant_group": dominant})
    shares = [item["head_neck_share"] for item in members]
    return {
        "all_members_head_neck_ge_0_50": min(shares) >= .50,
        "any_member_head_neck_below_0_50": min(shares) < .50,
        "minimum_head_neck_share": min(shares),
        "maximum_head_neck_share": max(shares),
        "members": members,
    }


def normal_boundary_manifest(body):
    """Classify every duplicate-position group with r5's *exact* region rule.

    ``diagnose.region_for`` uses world coordinates and the world-space body
    bounds.  Positions are retained in local mesh coordinates as well so an
    example such as (-.24, .10, 1.44) can be reconciled without guessing about
    object transforms.  The two values must classify identically because the
    selection passes the same world coordinate used by r5.
    """
    mesh = body.data
    low, high = diagnose.mesh_bounds(body)
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise RuntimeError("v4 has no active UV layer")
    by_vertex = loops_by_vertex(mesh)
    by_loop = polygons_by_loop(mesh)
    entries, counts = [], Counter()
    for position, indices in coincident_groups(mesh):
        loop_indices = [loop for index in indices for loop in by_vertex[index]]
        normals = [Vector(mesh.loops[index].normal) for index in loop_indices]
        polygon_normals = [Vector(mesh.polygons[by_loop[index]].normal) for index in loop_indices]
        uvs = {tuple(round(value, 6) for value in uv_layer.data[index].uv) for index in loop_indices}
        # ``position`` is only the six-decimal duplicate key.  Region
        # classification itself must use the unrounded coordinate exactly as
        # r5 does, otherwise a vertex on the .76 boundary could be binned by
        # formatting rather than geometry.
        local = mesh.vertices[indices[0]].co.copy()
        world = body.matrix_world @ local
        region = diagnose.region_for(world, low, high)
        divergence = max_angle(normals)
        uv_split = len(uvs) > 1
        skin = skin_class(body, indices)
        # Selection is deliberately coordinate+UV+normal only.  The source
        # control establishes that an UV split here is not an authored hard
        # normal edge.  A non-UV discontinuity has no such proof and stays put.
        if region == "head" and uv_split and divergence > NORMAL_SPLIT_DEGREES:
            disposition = "repairable_geometric_head_uv_seam"
        elif region == "head" and not uv_split and divergence > NORMAL_SPLIT_DEGREES:
            # The source control cannot prove this is a v4 UV-seam regression.
            # It may be an authored hard edge or overlapping surface sheets;
            # preserve it and expose its polygon-normal evidence for review.
            disposition = "intentionally_untouched_non_uv_boundary"
        elif region == "head":
            disposition = "intentionally_untouched_already_continuous_head"
        else:
            disposition = "intentionally_untouched_outside_geometric_head_scope"
        counts[disposition] += 1
        entries.append({
            "position_local": [round(value, 6) for value in local],
            "position_world": [round(value, 6) for value in world],
            "coordinate_region_r5_exact": region,
            "vertex_indices": indices,
            "loop_indices": loop_indices,
            "uv_count": len(uvs),
            "max_normal_angle_degrees": round(divergence, 6),
            "max_polygon_normal_angle_degrees": round(max_angle(polygon_normals), 6),
            "skin_weight_classification": skin,
            "disposition": disposition,
        })
    cross_tab = Counter()
    for item in entries:
        if item["coordinate_region_r5_exact"] == "head" and item["max_normal_angle_degrees"] > NORMAL_SPLIT_DEGREES:
            cross_tab[(item["disposition"], str(item["skin_weight_classification"]["all_members_head_neck_ge_0_50"]))] += 1
    return {
        "coordinate_region_definition": "r5 exact: world-space (z - body_world_bbox_min_z) / body_world_bbox_height >= 0.76 is head; >= 0.65 is neck",
        "weight_definition": "v5 selector (reported independently): every duplicate vertex has summed head+neck skin weight >= 0.50",
        "selection_definition": "v6: r5 geometric head AND UV-discontinuous AND loop-normal divergence > 1.0 degrees; no skin-weight predicate",
        "mesh_world_bounds": {"min": [round(value, 6) for value in low], "max": [round(value, 6) for value in high]},
        "counts_by_disposition": dict(sorted(counts.items())),
        "head_divergent_cross_tab_disposition_x_v5_weight_selector": [
            {"disposition": key[0], "v5_all_members_head_neck_ge_0_50": key[1] == "True", "groups": value}
            for key, value in sorted(cross_tab.items())
        ],
        "groups": entries,
    }


def signature(item):
    return (tuple(item["vertex_indices"]), item["disposition"])


def repair_geometric_head_uv_seams(body, manifest):
    mesh = body.data
    custom = [Vector(loop.normal) for loop in mesh.loops]
    repair = [item for item in manifest["groups"] if item["disposition"] == "repairable_geometric_head_uv_seam"]
    sharp = [item for item in manifest["groups"] if item["disposition"] == "intentionally_untouched_non_uv_boundary"]
    if not repair:
        raise RuntimeError("No geometric-head UV seam qualified; refuse a no-op candidate")
    # There is no unproven broad smoothing: source r5 must be normal-continuous
    # in this exact coordinate band before any v6 loop normal is written.
    for item in repair:
        normals = [custom[index] for index in item["loop_indices"]]
        mean = sum(normals, Vector((0.0, 0.0, 0.0)))
        if mean.length < 1e-6:
            raise RuntimeError("Ambiguous opposing normals in would-be seam %s" % item["vertex_indices"])
        mean.normalize()
        for loop_index in item["loop_indices"]:
            custom[loop_index] = mean
    mesh.normals_split_custom_set(custom)
    mesh.update()
    RUN["normal_repair"] = {
        "method": "custom loop normals only; vertices, UV loops, images, material bindings and weights are immutable",
        "groups_repaired": len(repair),
        "loops_repaired": sum(len(item["loop_indices"]) for item in repair),
        "max_angle_before_degrees": round(max(item["max_normal_angle_degrees"] for item in repair), 6),
        "intentionally_untouched_non_uv_boundaries": len(sharp),
        "intentionally_untouched_outside_head_scope": manifest["counts_by_disposition"].get("intentionally_untouched_outside_geometric_head_scope", 0),
    }
    return repair, sharp


def require_source_control(r5):
    source = r5["source_before_decimation"]["topology"]["regions"]["head"]
    if source["split_normal_groups"] != 0 or source["max_normal_angle_degrees"] > NORMAL_SPLIT_DEGREES:
        raise RuntimeError("Source control does not prove a continuous geometric head band: %s" % source)
    return source


def require_image_files(render_result):
    paths = []
    def collect(value):
        if isinstance(value, str):
            paths.append(Path(value))
        elif isinstance(value, dict):
            for nested in value.values():
                collect(nested)
    collect(render_result)
    missing = [str(path) for path in paths if not path.is_file() or path.stat().st_size == 0]
    if len(paths) != 8 or missing:
        raise RuntimeError("Comparable review renders are missing/empty (expected 8): %s" % missing)
    return [str(path) for path in paths]


def render_review(body, rig):
    scene = diagnose.configure_scene(RENDERS)
    renders = {
        "rest_pbr": diagnose.face_render(body, rig, scene, RENDERS, "v6-rest-pbr", "rest"),
        "idle_pbr": diagnose.face_render(body, rig, scene, RENDERS, "v6-idle-pbr", "idle"),
        "rest_plain_smooth": diagnose.face_render(body, rig, scene, RENDERS, "v6-rest-plain-smooth", "rest", True),
        "idle_plain_smooth": diagnose.face_render(body, rig, scene, RENDERS, "v6-idle-plain-smooth", "idle", True),
        "arms_rest": diagnose.arm_side_renders(body, rig, scene, RENDERS, "rest"),
        "arms_idle": diagnose.arm_side_renders(body, rig, scene, RENDERS, "idle"),
    }
    require_image_files(renders)
    v5.set_idle_frame_31(rig)
    orientation = v5.arm_orientation(rig)
    diagnose.set_rest(rig)
    return {"renders": renders, "idle_frame_31_orientation": orientation}


def main():
    args = arguments()
    configure_output(args)
    v4_path, r5_path = args.v4.resolve(), args.r5_report.resolve()
    if not v4_path.is_file() or not r5_path.is_file():
        raise RuntimeError("Required immutable inputs absent: v4=%s r5=%s" % (v4_path, r5_path))
    r5 = json.loads(r5_path.read_text(encoding="utf-8"))
    source_control = require_source_control(r5)
    bpy.ops.wm.open_mainfile(filepath=str(v4_path))
    body, rig = find_body_and_rig()
    before = v5.exact_mesh_contract(body)
    source_bones = len(rig.data.bones)
    if not before["uv_layers"] or not v3.pbr_image_set(before["pbr_bindings"]):
        raise RuntimeError("v4 lacks UV loops or its PBR image bindings")
    before_manifest = normal_boundary_manifest(body)
    MANIFEST.write_text(json.dumps({"before": before_manifest}, indent=2) + "\n", encoding="utf-8")
    repair, sharp_before = repair_geometric_head_uv_seams(body, before_manifest)
    v5.regenerate_actions(rig, bpy.context.scene)
    v5.set_idle_frame_31(rig)
    idle_orientation = v5.arm_orientation(rig)
    if any(item["down_dot"] < v5.IDLE_DOWN_DOT_TARGET - .002 for item in idle_orientation.values()):
        raise RuntimeError("Idle arm target not reached bilaterally: %s" % idle_orientation)
    after = v5.exact_mesh_contract(body)
    if before != after:
        raise RuntimeError("Candidate changed protected geometry/UV/material/PBR/weight contract")
    after_manifest = normal_boundary_manifest(body)
    remaining_repairable = [item for item in after_manifest["groups"] if item["disposition"] == "repairable_geometric_head_uv_seam"]
    sharp_after = [item for item in after_manifest["groups"] if item["disposition"] == "intentionally_untouched_non_uv_boundary"]
    if remaining_repairable:
        raise RuntimeError("Repairable geometric-head seams remain: %d" % len(remaining_repairable))
    if {signature(item) for item in sharp_before} != {signature(item) for item in sharp_after}:
        raise RuntimeError("An intentionally untouched non-UV boundary changed classification")
    topology = diagnose.topology_report(body)
    strict_head = topology["regions"]["head"]
    if strict_head["split_normal_groups"] != 0 or strict_head["max_normal_angle_degrees"] > NORMAL_SPLIT_DEGREES:
        raise RuntimeError("r5 exact geometric head normal check remains non-continuous: %s" % strict_head)
    review = render_review(body, rig)
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    old_glb = v3.GLB
    try:
        v3.GLB = GLB
        roundtrip = v3.export_and_roundtrip(body, rig, before["pbr_bindings"])
    finally:
        v3.GLB = old_glb
    imported = v5.imported_body_after_roundtrip()
    exported_topology = diagnose.topology_report(imported)
    exported_head = exported_topology["regions"]["head"]
    missing = sorted(set(EXPECTED_CLIPS) - set(roundtrip["actions"]))
    validation = {
        "protected_geometry_uv_material_images_and_weights_exact": before == after,
        "source_control_head_has_zero_split_normal_groups": source_control["split_normal_groups"] == 0,
        "v4_geometric_head_all_repairable_uv_seams_removed": not remaining_repairable,
        "v6_geometric_head_split_normal_groups_exactly_zero": strict_head["split_normal_groups"] == 0,
        "v6_geometric_head_max_normal_angle_at_most_1_degree": strict_head["max_normal_angle_degrees"] <= NORMAL_SPLIT_DEGREES,
        "intentionally_untouched_non_uv_boundaries_unchanged": {signature(item) for item in sharp_before} == {signature(item) for item in sharp_after},
        "exported_glb_retains_strict_head_continuity": exported_head["split_normal_groups"] == 0 and exported_head["max_normal_angle_degrees"] <= NORMAL_SPLIT_DEGREES,
        "idle_bilateral_down_dot_target": all(item["down_dot"] >= v5.IDLE_DOWN_DOT_TARGET - .002 for item in idle_orientation.values()),
        "clip_names_match": not missing,
        "bone_count_match": roundtrip["bones"] == source_bones,
        "texture_semantics_match": roundtrip["pbr"]["difference"] == 0 and not roundtrip["pbr"]["missing_glb_binding_semantics"],
        "tied_hair_attachment_survives": roundtrip["tied_hair_attachment_count"] == 1,
        "all_eight_comparable_renders_present": len(require_image_files(review["renders"])) == 8,
    }
    if not all(validation.values()):
        raise RuntimeError("v6 structural validation failed: %s" % validation)
    MANIFEST.write_text(json.dumps({"before": before_manifest, "after": after_manifest}, indent=2) + "\n", encoding="utf-8")
    report = {
        "status": "passed_structural_review_required_not_visual_acceptance",
        "inputs": {"immutable_v4": str(v4_path), "r5_evidence": str(r5_path)},
        "candidate": {"blend": str(BLEND), "glb": str(GLB), "renders": review["renders"]},
        "coordinate_and_weight_proof": {"source_control": source_control, "normal_boundary_manifest": str(MANIFEST)},
        "normal_repair": RUN["normal_repair"],
        "v6_topology": topology,
        "exported_glb_topology": exported_topology,
        "idle_orientation_after": idle_orientation,
        "roundtrip": roundtrip,
        "validation": validation,
        "outstanding_visual_review": [
            "Compare source/v4/v6 PBR and the matched node-free plain-smooth face views. A structural pass does not prove the visual seam is absent.",
            "Reject if v6 changes face/neck character, introduces a new broad smooth patch, or leaves a comparably visible seam in plain shading.",
            "Compare both Idle arm side views against rest; reject A-pose reading, shoulder asymmetry, self-intersection, hand collapse, or waist intersection.",
            "This candidate is not authorized for runtime integration."
        ],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        OUT.mkdir(parents=True, exist_ok=True)
        failure = {"status": "failed", "error_type": type(error).__name__, "error": str(error), "diagnostics": RUN}
        REPORT.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        raise
