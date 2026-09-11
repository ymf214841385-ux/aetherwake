"""Build an isolated v8 Attack-motion candidate from the preserved v6 GLB source.

Scope: retain the v6 mesh, UVs, PBR images/material bindings, weights, skeleton,
and every clip name.  Re-authoring is limited to Attack pose keys: its existing
right-hand sword arc is retained, while the hips/legs acquire an asymmetrical
weight transfer and the left hand is kept in a low, bent guard rather than next
to the ear.  This script deliberately does not claim to fix Climb/Glide grips:
the measured rig has no finger bones, and the gameplay glider/sword are runtime
attachments rather than GLB meshes.

Host Blender only.  It writes solely below the supplied --out directory and
never writes the v6 source.  A structural pass is not visual or gameplay
acceptance.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
V6_BLEND = ROOT / "docs/art-direction/asset-v6-rerun1/wanderer-textured-rig-v6.blend"
OUT = ROOT / "docs/art-direction/asset-v8-attack-weight-transfer"
EXPECTED_CLIPS = ("Idle", "Walk", "Run", "Attack", "Climb", "Glide")
REQUIRED_BONES = (
    "pelvis", "spine", "chest", "neck", "head",
    "upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R",
)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Reuse the same measured-bone solver and v6 contract used by the existing
# candidates; no global Euler-axis/sign assumptions are introduced here.
v6 = load_module("wanderer_v6_for_v8_attack", ROOT / "docs/art-direction/asset-v6/build_wanderer_textured_rig_v6.py")
v5, v3 = v6.v5, v6.v3
v4 = v5.v4


def arguments():
    tail = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--v6", type=Path, default=V6_BLEND)
    parser.add_argument("--out", type=Path, default=OUT)
    return parser.parse_args(tail)


def sha256_rows(rows):
    digest = hashlib.sha256()
    for row in rows:
        digest.update((json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8"))
    return digest.hexdigest()


def loop_normal_contract(body):
    """Normals are protected too: this candidate must retain v6's seam repair."""
    return sha256_rows([[round(value, 9) for value in loop.normal] for loop in body.data.loops])


def mix(a, b, t):
    return a * (1.0 - t) + b * t


def smooth_stage(t, start, end):
    return max(0.0, min(1.0, (t - start) / (end - start)))


def bone_point(rig, name, tail=False):
    bone = rig.pose.bones.get(name)
    if bone is None:
        raise RuntimeError("Missing pose bone " + name)
    return (bone.tail if tail else bone.head).copy()


def armature_to_pelvis_basis(rig, delta):
    """Convert a measured armature-space hip shift into the pelvis local basis."""
    rest_basis = rig.data.bones["pelvis"].matrix_local.to_3x3()
    return rest_basis.inverted() @ delta


def require_measurements(rig):
    missing = [name for name in REQUIRED_BONES if rig.pose.bones.get(name) is None]
    if missing:
        raise RuntimeError("Cannot support the candidate: missing required bones %s" % missing)
    if rig.data.bones["pelvis"].parent is not None:
        raise RuntimeError("Pelvis must be a root bone for a measured local hip translation")
    axes = v3.anatomy_axes(rig)
    lengths = {name: round(rig.data.bones[name].length, 6) for name in REQUIRED_BONES}
    if min(lengths[name] for name in ("upper_arm.L", "forearm.L", "upper_arm.R", "forearm.R", "thigh.L", "shin.L", "thigh.R", "shin.R")) <= 0.01:
        raise RuntimeError("Zero/near-zero limb measurement prevents a safe reach/stance solve: %s" % lengths)
    fingers = sorted(name for name in rig.pose.bones.keys() if "finger" in name.lower() or "thumb" in name.lower())
    return {
        "bone_count": len(rig.data.bones),
        "required_bones": list(REQUIRED_BONES),
        "lengths": lengths,
        "axes": {key: [round(value, 6) for value in axis] for key, axis in axes.items()},
        "finger_pose_available": bool(fingers),
        "finger_bones": fingers,
        "limitation": "No finger curl is authored when the rig has no finger bones; the offhand improvement is a lower, bent open-hand guard.",
    }, axes


def aim_leg(rig, axes, side, thigh_direction, shin_direction):
    """Aim both segments through their measured local bases, then settle the boot."""
    v3.aim_bone(rig, "thigh." + side, thigh_direction.normalized())
    bpy.context.view_layer.update()
    v3.aim_bone(rig, "shin." + side, shin_direction.normalized())
    bpy.context.view_layer.update()
    v3.aim_bone(rig, "foot." + side, (axes["forward"] * 0.12 - axes["up"] * 0.993).normalized())


def pose_offhand_guard(rig, axes, t):
    """A body-side relaxed hand becomes a compact chest-height guard, never an ear-side palm."""
    shoulder = bone_point(rig, "upper_arm.L")
    relaxed = shoulder + axes["left"] * 0.12 - axes["up"] * 0.29 + axes["forward"] * 0.04
    guard = shoulder + axes["right"] * 0.035 + axes["up"] * 0.025 + axes["forward"] * 0.29
    # The guard settles in recovery instead of floating upward with the sword.
    recovery = shoulder + axes["left"] * 0.035 - axes["up"] * 0.055 + axes["forward"] * 0.22
    if t < 0.28:
        target = mix(relaxed, guard, smooth_stage(t, 0.0, 0.28))
    elif t < 0.70:
        target = guard
    else:
        target = mix(guard, recovery, smooth_stage(t, 0.70, 1.0))
    v4.pose_arm_to_hand_target(rig, axes, "L", target)


def pose_weight_transfer(rig, axes, t):
    """Give the right-hand slash a measured rear-load -> lead-step -> recovery stance."""
    # Shift hips opposite the working hand during wind-up, then across onto the
    # trailing/support leg during the strike.  4.5 cm lateral / 3.5 cm fore-aft
    # is intentionally bounded below the measured shin length.
    wind_hip = axes["right"] * 0.045 - axes["forward"] * 0.030 - axes["up"] * 0.012
    strike_hip = axes["left"] * 0.045 + axes["forward"] * 0.035 + axes["up"] * 0.006
    if t < 0.32:
        hip = mix(Vector((0.0, 0.0, 0.0)), wind_hip, smooth_stage(t, 0.0, 0.32))
        q = smooth_stage(t, 0.0, 0.32)
        right_thigh = mix(-axes["up"] * 0.98, -axes["up"] * 0.94 - axes["forward"] * 0.25, q)
        left_thigh = mix(-axes["up"] * 0.98, -axes["up"] * 0.99 + axes["forward"] * 0.08, q)
    elif t < 0.70:
        q = smooth_stage(t, 0.32, 0.70)
        hip = mix(wind_hip, strike_hip, q)
        right_thigh = mix(-axes["up"] * 0.94 - axes["forward"] * 0.25, -axes["up"] * 0.92 + axes["forward"] * 0.34, q)
        left_thigh = mix(-axes["up"] * 0.99 + axes["forward"] * 0.08, -axes["up"] * 0.96 - axes["forward"] * 0.20, q)
    else:
        q = smooth_stage(t, 0.70, 1.0)
        hip = mix(strike_hip, Vector((0.0, 0.0, 0.0)), q)
        right_thigh = mix(-axes["up"] * 0.92 + axes["forward"] * 0.34, -axes["up"] * 0.98, q)
        left_thigh = mix(-axes["up"] * 0.96 - axes["forward"] * 0.20, -axes["up"] * 0.98, q)
    rig.pose.bones["pelvis"].location = armature_to_pelvis_basis(rig, hip)
    bpy.context.view_layer.update()
    # A folded front knee and almost-straight rear/support knee avoid the old
    # symmetric planted-foot silhouette without moving mesh vertices/weights.
    aim_leg(rig, axes, "R", right_thigh, -axes["up"] * 0.92 - axes["forward"] * 0.38)
    aim_leg(rig, axes, "L", left_thigh, -axes["up"] * 0.985 + axes["forward"] * 0.08)


def pose_v8(rig, clip, frame, final_frame):
    """Retain v6 poses except for the intentionally scoped Attack replacement."""
    if clip != "Attack":
        v5.pose_v5(rig, clip, frame, final_frame)
        return
    v4.reset_pose(rig)
    axes = v3.anatomy_axes(rig)
    t = (frame - 1) / max(final_frame - 1, 1)
    # Keep the host-observed raised sword / torso bend.  Then layer only the
    # contact-readable lower body and offhand corrections on top of it.
    v4.pose_attack(rig, axes, t)
    bpy.context.view_layer.update()
    pose_weight_transfer(rig, axes, t)
    bpy.context.view_layer.update()
    pose_offhand_guard(rig, axes, t)


def regenerate_actions(rig, scene):
    """Use the proven Blender-5 action writer with a one-clip substitution."""
    v3.v2.clear_prior_authored_animation(rig)
    original = (v3.v2.reset_pose, v3.v2.pose_at_frame, v3.v2.key_pose)
    try:
        v3.v2.reset_pose = v4.reset_pose
        v3.v2.pose_at_frame = pose_v8
        v3.v2.key_pose = v4.key_pose
        return v3.v2.create_actions(rig, scene)
    finally:
        v3.v2.reset_pose, v3.v2.pose_at_frame, v3.v2.key_pose = original


def world_point(rig, name):
    return rig.matrix_world @ bone_point(rig, name)


def action_pose_measurements(rig, scene, axes):
    action = bpy.data.actions.get("Attack")
    if action is None:
        raise RuntimeError("Attack action was not written")
    rig.animation_data.action = action
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    samples = {}
    for frame in (1, 12, 19, 23, 31):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        left_hand, head = world_point(rig, "hand.L"), world_point(rig, "head")
        right_foot, left_foot = world_point(rig, "foot.R"), world_point(rig, "foot.L")
        pelvis = world_point(rig, "pelvis")
        samples[str(frame)] = {
            "left_hand": [round(value, 6) for value in left_hand],
            "head": [round(value, 6) for value in head],
            "feet_forward_separation": round(abs((right_foot - left_foot).dot(axes["forward"])), 6),
            "feet_lateral_separation": round(abs((right_foot - left_foot).dot(axes["right"])), 6),
            "pelvis": [round(value, 6) for value in pelvis],
            "left_hand_below_head": round((head - left_hand).dot(axes["up"]), 6),
        }
    # Frame 19 is the authored slash, frame 23 approximates the r8 frozen
    # phase (0.75): both must retain a non-symmetric lower body and a hand below
    # the head rather than an ear-side pose.
    gate = {
        "attack_frame_19_offhand_below_head": samples["19"]["left_hand_below_head"] > 0.10,
        "attack_frame_23_offhand_below_head": samples["23"]["left_hand_below_head"] > 0.10,
        "attack_frame_19_forward_foot_separation": samples["19"]["feet_forward_separation"] > 0.055,
        "attack_frame_23_forward_foot_separation": samples["23"]["feet_forward_separation"] > 0.040,
    }
    rig.animation_data.action = None
    v4.reset_pose(rig)
    scene.frame_set(1)
    return samples, gate


def main():
    args = arguments()
    source, out = args.v6.resolve(), args.out.resolve()
    if not source.is_file():
        raise RuntimeError("Immutable v6 source is missing: %s" % source)
    out.mkdir(parents=True, exist_ok=True)
    blend, glb, report_path = out / "wanderer-textured-rig-v8-attack-weight-transfer.blend", out / "wanderer-textured-rig-v8-attack-weight-transfer.glb", out / "wanderer-textured-rig-v8-attack-weight-transfer-report.json"
    bpy.ops.wm.open_mainfile(filepath=str(source))
    body, rig = v6.find_body_and_rig()
    before, normal_before = v5.exact_mesh_contract(body), loop_normal_contract(body)
    measurements, axes = require_measurements(rig)
    clips = regenerate_actions(rig, bpy.context.scene)
    after, normal_after = v5.exact_mesh_contract(body), loop_normal_contract(body)
    if before != after or normal_before != normal_after:
        raise RuntimeError("Candidate changed protected v6 geometry/UV/PBR/weights or loop normals")
    samples, motion_gate = action_pose_measurements(rig, bpy.context.scene, axes)
    if not all(motion_gate.values()):
        raise RuntimeError("Measured Attack contact gate failed: %s" % motion_gate)
    if {entry["name"] for entry in clips} != set(EXPECTED_CLIPS):
        raise RuntimeError("Clip interface changed: %s" % clips)
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    old_glb = v3.GLB
    try:
        v3.GLB = glb
        roundtrip = v3.export_and_roundtrip(body, rig, before["pbr_bindings"])
    finally:
        v3.GLB = old_glb
    missing = sorted(set(EXPECTED_CLIPS) - set(roundtrip["actions"]))
    validation = {
        "v6_geometry_uv_material_images_and_weights_exact": before == after,
        "v6_loop_normals_exact": normal_before == normal_after,
        "clip_names_match": not missing,
        "bone_count_match": roundtrip["bones"] == measurements["bone_count"],
        "texture_semantics_match": roundtrip["pbr"]["difference"] == 0 and not roundtrip["pbr"]["missing_glb_binding_semantics"],
        "tied_hair_attachment_survives": roundtrip["tied_hair_attachment_count"] == 1,
        "attack_weight_and_offhand_measurements_pass": all(motion_gate.values()),
    }
    if not all(validation.values()):
        raise RuntimeError("v8 Attack candidate validation failed: %s" % validation)
    report = {
        "status": "passed_structural_motion_measurement_review_required_not_gameplay_acceptance",
        "scope": "Attack action only; all other v6 animation poses are regenerated identically through the existing v5/v4 measured solver.",
        "inputs": {"immutable_v6": str(source)},
        "candidate": {"blend": str(blend), "glb": str(glb), "clips": clips},
        "preservation": {"mesh_contract": before, "loop_normals_sha256": normal_before},
        "skeleton_measurements": measurements,
        "attack_samples": samples,
        "attack_motion_gate": motion_gate,
        "roundtrip": roundtrip,
        "validation": validation,
        "unresolved_runtime_contact_issues": [
            "Climb: no finger bones exist, so this asset cannot produce a real wall grasp; r8 also shows the hand-attached sword intersecting the climb gesture/wall.",
            "Glide: r8 shows arms extended without visible hand-to-handle contact; the glider is runtime chest-parented, so correct handle contact requires measured runtime attachment sockets, not a blind GLB arm edit.",
            "This candidate must be checked in a short real-time gameplay sequence; frozen fixture frames only prove the sampled pose is stable."
        ]
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        failure = {"status": "failed", "error_type": type(error).__name__, "error": str(error)}
        print(json.dumps(failure, indent=2))
        raise
