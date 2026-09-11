"""Prepared, fail-closed follow-up candidate for the confirmed v4 neck seams.

This is deliberately not a runtime integration script.  It takes the preserved
v6 candidate as immutable input and changes only custom loop normals on
UV-discontinuous, coincident-position groups in r5's exact *neck* band.  The
source-before-decimation neck control must prove that that same band is smooth.
No positions, topology, UVs, material bindings, images, weights, or actions are
modified.  Do not run this while a gameplay capture is queued or running.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
V6_BLEND = ROOT / "docs/art-direction/asset-v6-rerun1/wanderer-textured-rig-v6.blend"
R5_REPORT = ROOT / "docs/art-direction/asset-v4/host-diagnostics/r5-bounded/v4-bounded-face-idle-diagnostic.json"
OUT = ROOT / "docs/art-direction/asset-v7-neck"
NORMAL_SPLIT_DEGREES = 1.0


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v6 = load_module("wanderer_v6_for_v7_neck", ROOT / "docs/art-direction/asset-v6/build_wanderer_textured_rig_v6.py")
v5, v3, diagnose = v6.v5, v6.v3, v6.diagnose
bpy, Vector = v6.bpy, v6.Vector


def arguments():
    tail = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--v6", type=Path, default=V6_BLEND)
    parser.add_argument("--r5-report", type=Path, default=R5_REPORT)
    parser.add_argument("--out", type=Path, default=OUT)
    return parser.parse_args(tail)


def configure_output(path):
    path = path.resolve()
    renders = path / "renders"
    path.mkdir(parents=True, exist_ok=True)
    renders.mkdir(parents=True, exist_ok=True)
    # Reuse v6's read-only review renderer, directing all of its outputs to v7.
    v6.OUT = path
    v6.RENDERS = renders
    v6.BLEND = path / "wanderer-textured-rig-v7-neck.blend"
    v6.GLB = path / "wanderer-textured-rig-v7-neck.glb"
    v6.REPORT = path / "wanderer-textured-rig-v7-neck-report.json"
    v6.MANIFEST = path / "v7-neck-normal-boundary-manifest.json"


def require_neck_source_control(r5):
    neck = r5["source_before_decimation"]["topology"]["regions"]["neck"]
    if neck["split_normal_groups"] != 0 or neck["max_normal_angle_degrees"] > NORMAL_SPLIT_DEGREES:
        raise RuntimeError("Source control does not prove a continuous neck band: %s" % neck)
    return neck


def neck_manifest(body):
    """Return a complete duplicate-group record; select neck UV seams only."""
    mesh = body.data
    low, high = diagnose.mesh_bounds(body)
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise RuntimeError("Candidate has no active UV layer")
    by_vertex = v6.loops_by_vertex(mesh)
    by_loop = v6.polygons_by_loop(mesh)
    entries = []
    for _, indices in v6.coincident_groups(mesh):
        loop_indices = [loop for index in indices for loop in by_vertex[index]]
        normals = [Vector(mesh.loops[index].normal) for index in loop_indices]
        polygon_normals = [Vector(mesh.polygons[by_loop[index]].normal) for index in loop_indices]
        uvs = {tuple(round(value, 6) for value in uv_layer.data[index].uv) for index in loop_indices}
        local = mesh.vertices[indices[0]].co.copy()
        world = body.matrix_world @ local
        region = diagnose.region_for(world, low, high)
        divergence = v6.max_angle(normals)
        uv_split = len(uvs) > 1
        if region == "neck" and uv_split and divergence > NORMAL_SPLIT_DEGREES:
            disposition = "repairable_geometric_neck_uv_seam"
        elif region == "neck" and not uv_split and divergence > NORMAL_SPLIT_DEGREES:
            # No source evidence proves a non-UV split is safe to smooth.
            disposition = "intentionally_untouched_neck_non_uv_boundary"
        elif region == "neck":
            disposition = "intentionally_untouched_continuous_neck"
        else:
            disposition = "intentionally_untouched_outside_neck_scope"
        entries.append({
            "position_local": [round(value, 6) for value in local],
            "position_world": [round(value, 6) for value in world],
            "coordinate_region_r5_exact": region,
            "vertex_indices": indices,
            "loop_indices": loop_indices,
            "uv_count": len(uvs),
            "max_normal_angle_degrees": round(divergence, 6),
            "max_polygon_normal_angle_degrees": round(v6.max_angle(polygon_normals), 6),
            "disposition": disposition,
        })
    counts = {}
    for item in entries:
        counts[item["disposition"]] = counts.get(item["disposition"], 0) + 1
    return {
        "coordinate_region_definition": "r5 exact: world-space z ratio >= .65 and < .76 is neck",
        "selection_definition": "v7-neck: r5 geometric neck AND UV-discontinuous AND loop-normal divergence > 1.0 degrees",
        "counts_by_disposition": dict(sorted(counts.items())),
        "groups": entries,
    }


def repair_neck_uv_seams(body, manifest):
    mesh = body.data
    repair = [item for item in manifest["groups"] if item["disposition"] == "repairable_geometric_neck_uv_seam"]
    non_uv = [item for item in manifest["groups"] if item["disposition"] == "intentionally_untouched_neck_non_uv_boundary"]
    if not repair:
        raise RuntimeError("No qualified neck UV seams; refuse a no-op candidate")
    custom = [Vector(loop.normal) for loop in mesh.loops]
    for item in repair:
        mean = sum((custom[index] for index in item["loop_indices"]), Vector((0.0, 0.0, 0.0)))
        if mean.length < 1e-6:
            raise RuntimeError("Ambiguous opposing normals in neck seam %s" % item["vertex_indices"])
        mean.normalize()
        for index in item["loop_indices"]:
            custom[index] = mean
    mesh.normals_split_custom_set(custom)
    mesh.update()
    return repair, non_uv


def signature(item):
    return (tuple(item["vertex_indices"]), item["disposition"])


def main():
    args = arguments()
    configure_output(args.out)
    if not args.v6.is_file() or not args.r5_report.is_file():
        raise RuntimeError("Required immutable inputs absent: v6=%s r5=%s" % (args.v6, args.r5_report))
    r5 = json.loads(args.r5_report.read_text(encoding="utf-8"))
    source_neck = require_neck_source_control(r5)
    bpy.ops.wm.open_mainfile(filepath=str(args.v6.resolve()))
    body, rig = v6.find_body_and_rig()
    before = v5.exact_mesh_contract(body)
    source_bones = len(rig.data.bones)
    before_manifest = neck_manifest(body)
    v6.MANIFEST.write_text(json.dumps({"before": before_manifest}, indent=2) + "\n", encoding="utf-8")
    repair, non_uv_before = repair_neck_uv_seams(body, before_manifest)
    after = v5.exact_mesh_contract(body)
    if before != after:
        raise RuntimeError("Repair changed protected geometry/UV/material/PBR/weight contract")
    after_manifest = neck_manifest(body)
    remaining = [item for item in after_manifest["groups"] if item["disposition"] == "repairable_geometric_neck_uv_seam"]
    non_uv_after = [item for item in after_manifest["groups"] if item["disposition"] == "intentionally_untouched_neck_non_uv_boundary"]
    if remaining:
        raise RuntimeError("Qualified neck UV seams remain: %d" % len(remaining))
    if {signature(item) for item in non_uv_before} != {signature(item) for item in non_uv_after}:
        raise RuntimeError("A protected non-UV neck boundary changed classification")
    topology = diagnose.topology_report(body)
    neck = topology["regions"]["neck"]
    head = topology["regions"]["head"]
    if neck["split_normal_groups"] != 0 or neck["max_normal_angle_degrees"] > NORMAL_SPLIT_DEGREES:
        raise RuntimeError("Neck continuity check failed: %s" % neck)
    if head["split_normal_groups"] != 0 or head["max_normal_angle_degrees"] > NORMAL_SPLIT_DEGREES:
        raise RuntimeError("v6 head continuity regressed: %s" % head)
    review = v6.render_review(body, rig)
    bpy.ops.wm.save_as_mainfile(filepath=str(v6.BLEND))
    old_glb = v3.GLB
    try:
        v3.GLB = v6.GLB
        roundtrip = v3.export_and_roundtrip(body, rig, before["pbr_bindings"])
    finally:
        v3.GLB = old_glb
    imported = v5.imported_body_after_roundtrip()
    exported = diagnose.topology_report(imported)
    exported_neck, exported_head = exported["regions"]["neck"], exported["regions"]["head"]
    missing = sorted(set(v6.EXPECTED_CLIPS) - set(roundtrip["actions"]))
    validation = {
        "protected_geometry_uv_material_images_and_weights_exact": before == after,
        "source_control_neck_has_zero_split_normal_groups": source_neck["split_normal_groups"] == 0,
        "all_qualified_neck_uv_seams_removed": not remaining,
        "protected_non_uv_neck_boundaries_unchanged": {signature(item) for item in non_uv_before} == {signature(item) for item in non_uv_after},
        "neck_continuity_at_most_1_degree": neck["split_normal_groups"] == 0 and neck["max_normal_angle_degrees"] <= NORMAL_SPLIT_DEGREES,
        "v6_head_continuity_retained": head["split_normal_groups"] == 0 and head["max_normal_angle_degrees"] <= NORMAL_SPLIT_DEGREES,
        "exported_neck_continuity_retained": exported_neck["split_normal_groups"] == 0 and exported_neck["max_normal_angle_degrees"] <= NORMAL_SPLIT_DEGREES,
        "exported_head_continuity_retained": exported_head["split_normal_groups"] == 0 and exported_head["max_normal_angle_degrees"] <= NORMAL_SPLIT_DEGREES,
        "clip_names_match": not missing,
        "bone_count_match": roundtrip["bones"] == source_bones,
        "texture_semantics_match": roundtrip["pbr"]["difference"] == 0 and not roundtrip["pbr"]["missing_glb_binding_semantics"],
        "tied_hair_attachment_survives": roundtrip["tied_hair_attachment_count"] == 1,
        "all_eight_comparable_renders_present": len(v6.require_image_files(review["renders"])) == 8,
    }
    if not all(validation.values()):
        raise RuntimeError("v7-neck structural validation failed: %s" % validation)
    v6.MANIFEST.write_text(json.dumps({"before": before_manifest, "after": after_manifest}, indent=2) + "\n", encoding="utf-8")
    report = {
        "status": "passed_structural_review_required_not_visual_acceptance",
        "inputs": {"immutable_v6": str(args.v6.resolve()), "r5_evidence": str(args.r5_report.resolve())},
        "candidate": {"blend": str(v6.BLEND), "glb": str(v6.GLB), "renders": review["renders"]},
        "source_neck_control": source_neck,
        "normal_repair": {"method": "custom loop normals only", "groups_repaired": len(repair), "loops_repaired": sum(len(item["loop_indices"]) for item in repair), "max_angle_before_degrees": max(item["max_normal_angle_degrees"] for item in repair)},
        "topology": topology,
        "exported_topology": exported,
        "roundtrip": roundtrip,
        "validation": validation,
        "outstanding_visual_review": ["Root must compare source/v4/v6/v7 PBR and node-free plain renders; this script does not confer visual or runtime acceptance."]
    }
    v6.REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        failure = {"status": "failed", "error_type": type(error).__name__, "error": str(error)}
        v6.OUT.mkdir(parents=True, exist_ok=True)
        v6.REPORT.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        raise
