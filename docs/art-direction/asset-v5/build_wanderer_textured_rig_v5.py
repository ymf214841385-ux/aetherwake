"""Build a bounded v5 candidate from immutable v4.

v5 changes only two things in an in-memory copy of v4:
  * custom *loop normals* for safe, head-weighted coincident-position groups;
  * the authored Idle arm direction, aimed from measured rest-bone axes.

It does not merge vertices, weld UVs, change positions/faces/materials/images,
or edit weights.  It writes exclusively under asset-v5 and always round-trips
the exported GLB before reporting a structural pass.  Host Blender only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
V4_BLEND = ROOT / "docs/art-direction/asset-v4/wanderer-textured-rig-v4.blend"
R5_REPORT = ROOT / "docs/art-direction/asset-v4/host-diagnostics/r5-bounded/v4-bounded-face-idle-diagnostic.json"
OUT = ROOT / "docs/art-direction/asset-v5"
RENDERS = OUT / "renders"
BLEND = OUT / "wanderer-textured-rig-v5.blend"
GLB = OUT / "wanderer-textured-rig-v5.glb"
REPORT = OUT / "wanderer-textured-rig-v5-report.json"
EXPECTED_CLIPS = ("Idle", "Walk", "Run", "Attack", "Climb", "Glide")
SKIN_BONE_WEIGHT_MINIMUM = 0.50
IDLE_DOWN_DOT_TARGET = 0.86
RUN_DIAGNOSTICS = {}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v4 = load_module("wanderer_v4_for_v5", ROOT / "docs/art-direction/asset-v4/build_wanderer_textured_rig_v4.py")
diagnose = load_module("v4_diagnose_for_v5", ROOT / "docs/art-direction/asset-v4/diagnose_v4_face_idle_host.py")
v3 = v4.v3


def arguments():
    tail = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--v4", type=Path, default=V4_BLEND)
    parser.add_argument("--r5-report", type=Path, default=R5_REPORT)
    parser.add_argument("--out", type=Path, default=OUT)
    return parser.parse_args(tail)


def configure_output(args):
    global OUT, RENDERS, BLEND, GLB, REPORT
    OUT = args.out.resolve()
    RENDERS = OUT / "renders"
    BLEND = OUT / "wanderer-textured-rig-v5.blend"
    GLB = OUT / "wanderer-textured-rig-v5.glb"
    REPORT = OUT / "wanderer-textured-rig-v5-report.json"
    OUT.mkdir(parents=True, exist_ok=True)
    RENDERS.mkdir(parents=True, exist_ok=True)


def find_body_and_rig():
    body, rig = v3.find_body_and_rig()
    if body.name != "WandererTexturedBody":
        raise RuntimeError("Expected the v4 body mesh, got %s" % body.name)
    return body, rig


def sha256_rows(rows):
    digest = hashlib.sha256()
    for row in rows:
        digest.update((json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8"))
    return digest.hexdigest()


def exact_mesh_contract(body):
    """Hash all geometry/UV/material/weight data that this candidate may not change."""
    mesh = body.data
    uv_layers = []
    for layer in mesh.uv_layers:
        uv_layers.append({"name": layer.name, "values_sha256": sha256_rows([[round(value, 9) for value in item.uv] for item in layer.data])})
    return {
        "vertices": len(mesh.vertices),
        "polygons": len(mesh.polygons),
        "loops": len(mesh.loops),
        "vertex_coordinates_sha256": sha256_rows([[round(value, 9) for value in vertex.co] for vertex in mesh.vertices]),
        "polygon_indices_sha256": sha256_rows([list(polygon.vertices) for polygon in mesh.polygons]),
        "uv_layers": uv_layers,
        "material_slots": [slot.material.name if slot.material else None for slot in body.material_slots],
        "pbr_bindings": v3.source_pbr_bindings(body),
        "weights_sha256": sha256_rows([
            [[body.vertex_groups[group.group].name, round(group.weight, 9)] for group in sorted(vertex.groups, key=lambda item: body.vertex_groups[item.group].name)]
            for vertex in mesh.vertices
        ]),
    }


def head_or_neck_weight(body, vertex_index):
    """Return the skin-driving head/neck share, deliberately excluding collar."""
    groups = [body.vertex_groups.get(name) for name in ("head", "neck")]
    if any(group is None for group in groups):
        raise RuntimeError("v4 body lacks required head/neck vertex groups")
    wanted = {group.index for group in groups}
    return sum(entry.weight for entry in body.data.vertices[vertex_index].groups if entry.group in wanted)


def coincident_groups(body):
    groups = defaultdict(list)
    for vertex in body.data.vertices:
        # This intentionally matches r5's six-decimal position equivalence.
        groups[tuple(round(value, 6) for value in vertex.co)].append(vertex.index)
    return [indices for indices in groups.values() if len(indices) > 1]


def normal_angle(first, second):
    return math.degrees(math.acos(max(-1.0, min(1.0, first.normalized().dot(second.normalized())))))


def apply_safe_head_custom_normals(body):
    """Synchronize normals, never vertices or UV loops, in safe face/upper-neck groups.

    A group is eligible only where *every* coincident vertex remains at least
    50% head/neck-weighted.  This excludes garment/collar contacts even if
    their positions happen to coincide with the neck.  UV islands remain separate:
    their loop UV values are never read for writing, merged, or reassigned.
    """
    mesh = body.data
    loop_normals = [Vector(loop.normal) for loop in mesh.loops]
    loops_by_vertex = defaultdict(list)
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            loops_by_vertex[mesh.loops[loop_index].vertex_index].append(loop_index)
    eligible, skipped, before_max = [], 0, 0.0
    for indices in coincident_groups(body):
        if min(head_or_neck_weight(body, index) for index in indices) < SKIN_BONE_WEIGHT_MINIMUM:
            skipped += 1
            continue
        loop_indices = [loop for index in indices for loop in loops_by_vertex[index]]
        normals = [loop_normals[index] for index in loop_indices]
        divergence = max((normal_angle(first, second) for index, first in enumerate(normals) for second in normals[index + 1 :]), default=0.0)
        if divergence <= 1.0:
            continue
        mean = sum(normals, Vector((0.0, 0.0, 0.0))).normalized()
        if mean.length < 0.000001:
            raise RuntimeError("Cannot define continuous normal for coincident head group %s" % indices)
        for loop_index in loop_indices:
            loop_normals[loop_index] = mean
        before_max = max(before_max, divergence)
        eligible.append({"vertices": indices, "loop_count": len(loop_indices), "max_angle_before": round(divergence, 4)})
    if not eligible:
        raise RuntimeError("No divergent head-weighted coincident normal groups qualified; refusing a no-op v5")
    try:
        mesh.normals_split_custom_set(loop_normals)
    except AttributeError as error:
        raise RuntimeError("Host Blender lacks normals_split_custom_set; do not substitute a UV weld") from error
    mesh.update()
    RUN_DIAGNOSTICS["normal_repair"] = {
        "method": "custom loop normals only; no vertex/UV weld",
        "head_or_neck_weight_minimum": SKIN_BONE_WEIGHT_MINIMUM,
        "coincident_groups_considered": len(coincident_groups(body)),
        "coincident_groups_skipped_not_all_head_weighted": skipped,
        "groups_repaired": len(eligible),
        "loops_repaired": sum(item["loop_count"] for item in eligible),
        "max_angle_before_degrees": round(before_max, 4),
    }
    return RUN_DIAGNOSTICS["normal_repair"]


def rest_direction(rig, bone_name):
    bone = rig.data.bones.get(bone_name)
    if bone is None:
        raise RuntimeError("Missing rest bone " + bone_name)
    return (bone.tail_local - bone.head_local).normalized()


def pose_direction(rig, bone_name):
    bone = rig.pose.bones.get(bone_name)
    if bone is None:
        raise RuntimeError("Missing pose bone " + bone_name)
    return (bone.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()


def arm_axes(rig):
    chest, pelvis = rig.data.bones.get("chest"), rig.data.bones.get("pelvis")
    left_arm, right_arm = rig.data.bones.get("upper_arm.L"), rig.data.bones.get("upper_arm.R")
    if not all((chest, pelvis, left_arm, right_arm)):
        raise RuntimeError("Missing chest/pelvis/upper-arm bones")
    up = (chest.tail_local - pelvis.head_local).normalized()
    left = (left_arm.head_local - right_arm.head_local).normalized()
    forward = left.cross(up).normalized()
    if forward.dot(Vector((0, -1, 0))) < 0:
        forward.negate()
    return {"up": up, "left": left, "forward": forward}


def lower_target(current, rest, up, down_dot_target):
    """Move toward the measured rest axis only as far as the down-dot requires."""
    if current.dot(-up) >= down_dot_target:
        return current, 0.0
    if rest.dot(-up) < down_dot_target:
        raise RuntimeError("Measured rest arm does not satisfy down-dot target")
    low, high = 0.0, 1.0
    for _ in range(28):
        middle = (low + high) * .5
        candidate = ((1 - middle) * current + middle * rest).normalized()
        if candidate.dot(-up) < down_dot_target:
            low = middle
        else:
            high = middle
    return ((1 - high) * current + high * rest).normalized(), high


def pose_v5(rig, clip, frame, final_frame):
    """Retain every v4 clip except for measured, bilateral Idle arm lowering."""
    v4.pose_at_frame(rig, clip, frame, final_frame)
    if clip != "Idle":
        return
    axes = arm_axes(rig)
    original = {name: pose_direction(rig, name) for name in ("upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R")}
    adjustments = {}
    for side in ("L", "R"):
        upper_name, fore_name = "upper_arm." + side, "forearm." + side
        target, blend = lower_target(original[upper_name], rest_direction(rig, upper_name), axes["up"], IDLE_DOWN_DOT_TARGET)
        # aim_bone maps the desired armature direction through the actual local
        # pose basis; no global Euler axis/sign is assumed.
        v3.aim_bone(rig, upper_name, target)
        bpy.context.view_layer.update()
        # Preserve a relaxed elbow by moving its measured axis by the same
        # bounded proportion, then solve it after its parent has moved.
        fore_target = ((1 - blend) * original[fore_name] + blend * rest_direction(rig, fore_name)).normalized()
        v3.aim_bone(rig, fore_name, fore_target)
        adjustments[side] = {"upper_rest_blend": round(blend, 6), "upper_target_down_dot": round(target.dot(-axes["up"]), 6)}
    RUN_DIAGNOSTICS["idle_arm_adjustments"] = adjustments


def arm_orientation(rig):
    axes = arm_axes(rig)
    output = {}
    for side in ("L", "R"):
        direction = pose_direction(rig, "upper_arm." + side)
        lateral = axes["left"] if side == "L" else -axes["left"]
        output[side] = {
            "down_dot": round(direction.dot(-axes["up"]), 5),
            "lateral_dot": round(direction.dot(lateral), 5),
            "forward_dot": round(direction.dot(axes["forward"]), 5),
        }
    return output


def regenerate_actions(rig, scene):
    """Use the host-proven layered-action writer, changing only Idle pose data."""
    v3.v2.clear_prior_authored_animation(rig)
    original = (v3.v2.reset_pose, v3.v2.pose_at_frame, v3.v2.key_pose)
    try:
        v3.v2.reset_pose, v3.v2.pose_at_frame, v3.v2.key_pose = v4.reset_pose, pose_v5, v4.key_pose
        return v3.v2.create_actions(rig, scene)
    finally:
        v3.v2.reset_pose, v3.v2.pose_at_frame, v3.v2.key_pose = original


def set_idle_frame_31(rig):
    action = bpy.data.actions.get("Idle")
    if action is None:
        raise RuntimeError("v5 did not create Idle")
    rig.animation_data_create()
    rig.animation_data.action = action
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    bpy.context.scene.frame_set(31)
    bpy.context.view_layer.update()


def render_bounded_review(body, rig):
    """Reuse r5 framing so PBR/plain and both sides can be compared directly."""
    scene = diagnose.configure_scene(RENDERS)
    topology = diagnose.topology_report(body)
    renders = {
        "rest_pbr": diagnose.face_render(body, rig, scene, RENDERS, "v5-rest-pbr", "rest"),
        "idle_pbr": diagnose.face_render(body, rig, scene, RENDERS, "v5-idle-pbr", "idle"),
        "rest_plain_smooth": diagnose.face_render(body, rig, scene, RENDERS, "v5-rest-plain-smooth", "rest", True),
        "idle_plain_smooth": diagnose.face_render(body, rig, scene, RENDERS, "v5-idle-plain-smooth", "idle", True),
    }
    renders["arms_rest"] = diagnose.arm_side_renders(body, rig, scene, RENDERS, "rest")
    renders["arms_idle"] = diagnose.arm_side_renders(body, rig, scene, RENDERS, "idle")
    set_idle_frame_31(rig)
    orientation = arm_orientation(rig)
    diagnose.set_rest(rig)
    return {"topology": topology, "renders": renders, "idle_frame_31_orientation": orientation}


def verify_normal_result(body):
    report = diagnose.topology_report(body)
    # The repair scope is a head-weighted subset, so r5's whole geometric neck
    # band is a comparison metric, not a promised zero.  Head must improve.
    head = report["regions"]["head"]
    if head["split_normal_groups"] >= 658 or head["max_normal_angle_degrees"] > 1.0:
        raise RuntimeError("Head split-normal repair did not eliminate the measured v4 head discontinuities: %s" % head)
    return report


def imported_body_after_roundtrip():
    body = bpy.data.objects.get("WandererTexturedBody")
    if body is None:
        meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
        if not meshes:
            raise RuntimeError("GLB reimport produced no mesh for normal verification")
        body = max(meshes, key=lambda obj: len(obj.data.vertices))
    return body


def main():
    args = arguments()
    configure_output(args)
    if not args.v4.is_file() or not args.r5_report.is_file():
        raise RuntimeError("Required immutable v4/r5 input missing: v4=%s r5=%s" % (args.v4, args.r5_report))
    r5 = json.loads(args.r5_report.read_text(encoding="utf-8"))
    bpy.ops.wm.open_mainfile(filepath=str(args.v4))
    body, rig = find_body_and_rig()
    before = exact_mesh_contract(body)
    source_bones = len(rig.data.bones)
    if before["uv_layers"] == [] or not v3.pbr_image_set(before["pbr_bindings"]):
        raise RuntimeError("v4 lacks its original UV/PBR bindings")
    normals = apply_safe_head_custom_normals(body)
    clips = regenerate_actions(rig, bpy.context.scene)
    set_idle_frame_31(rig)
    idle_orientation = arm_orientation(rig)
    if any(value["down_dot"] < IDLE_DOWN_DOT_TARGET - .002 for value in idle_orientation.values()):
        raise RuntimeError("Idle arms did not meet bilateral down-dot target: %s" % idle_orientation)
    after = exact_mesh_contract(body)
    if before != after:
        raise RuntimeError("v5 changed geometry, UV loops, material/PBR bindings, or weights: before=%s after=%s" % (before, after))
    topology = verify_normal_result(body)
    bounded = render_bounded_review(body, rig)
    # The review has temporarily changed animation state only; retain all NLA
    # tracks for GLB export, then save only to v5 paths.
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    old_glb = v3.GLB
    try:
        v3.GLB = GLB
        roundtrip = v3.export_and_roundtrip(body, rig, before["pbr_bindings"])
    finally:
        v3.GLB = old_glb
    exported_topology = verify_normal_result(imported_body_after_roundtrip())
    missing = sorted(set(EXPECTED_CLIPS) - set(roundtrip["actions"]))
    validation = {
        "geometry_uv_material_pbr_weights_exact": before == after,
        "head_split_normals_reduced_from_r5_v4": topology["regions"]["head"]["split_normal_groups"] < r5["v4"]["topology"]["regions"]["head"]["split_normal_groups"],
        "head_max_normal_divergence_at_most_1_degree": topology["regions"]["head"]["max_normal_angle_degrees"] <= 1.0,
        "exported_glb_keeps_head_normal_continuity": exported_topology["regions"]["head"]["split_normal_groups"] < r5["v4"]["topology"]["regions"]["head"]["split_normal_groups"] and exported_topology["regions"]["head"]["max_normal_angle_degrees"] <= 1.0,
        "idle_bilateral_down_dot_target": all(value["down_dot"] >= IDLE_DOWN_DOT_TARGET - .002 for value in idle_orientation.values()),
        "clip_names_match": not missing,
        "missing_clips": missing,
        # export_and_roundtrip resets Blender to verify a real GLB reimport, so
        # compare against the count captured before that destructive-in-memory
        # verification operation rather than dereferencing the old RNA object.
        "bone_count_match": roundtrip["bones"] == source_bones,
        "texture_count_match": roundtrip["pbr"]["difference"] == 0 and not roundtrip["pbr"]["missing_glb_binding_semantics"],
        "tied_hair_attachment_survives": roundtrip["tied_hair_attachment_count"] == 1,
    }
    if not all(value for key, value in validation.items() if key != "missing_clips"):
        raise RuntimeError("v5 structural validation failed: %s" % validation)
    report = {
        "status": "passed_structural_review_required_not_visual_acceptance",
        "inputs": {"immutable_v4": str(args.v4), "r5_evidence": str(args.r5_report)},
        "candidate": {"blend": str(BLEND), "glb": str(GLB), "renders": bounded["renders"], "clips": clips},
        "evidence_copied_from_r5": {
            "source_head_split_normal_groups": r5["source_before_decimation"]["topology"]["regions"]["head"]["split_normal_groups"],
            "v4_head_split_normal_groups": r5["v4"]["topology"]["regions"]["head"]["split_normal_groups"],
            "v4_neck_split_normal_groups": r5["v4"]["topology"]["regions"]["neck"]["split_normal_groups"],
            "v4_idle_upper_arm_down_dot": r5["v4"]["arm_orientation"]["idle_frame_31_orientation"],
        },
        "normal_repair": normals,
        "v5_topology_after_custom_normals": topology,
        "exported_glb_topology_after_reimport": exported_topology,
        "idle_orientation_after": idle_orientation,
        "bounded_review": bounded,
        "roundtrip": roundtrip,
        "validation": validation,
        "outstanding_visual_review": [
            "Compare all four v5 face images directly against r5 source/v4 PBR and plain-smooth images. Structural normal counts do not prove a visual seam is gone.",
            "Inspect both v5 Idle side renders against v5 rest: arms should hang naturally without forearm collapse, hand/waist intersection, or asymmetric shoulder lift.",
            "Do not integrate v5 into the runtime until the source/v4/v5 comparison is reviewed and accepted."
        ],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        OUT.mkdir(parents=True, exist_ok=True)
        failure = {"status": "failed", "error_type": type(error).__name__, "error": str(error), "diagnostics": RUN_DIAGNOSTICS}
        REPORT.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        raise
