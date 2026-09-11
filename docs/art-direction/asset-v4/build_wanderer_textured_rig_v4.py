"""Author v4 from immutable v1; v3 stays intact for comparison and rollback.

V4 retains v3's bounded garment and PBR gates, replaces only the rear-hair
surface and authored poses, and writes exclusively under asset-v4.  The host
must visually review the generated grid before any runtime integration.
"""

import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs/art-direction/asset-v4"
RENDERS = OUT / "renders"
BLEND = OUT / "wanderer-textured-rig-v4.blend"
GLB = OUT / "wanderer-textured-rig-v4.glb"
REPORT = OUT / "wanderer-textured-rig-v4-report.json"
EXPECTED_CLIPS = ("Idle", "Walk", "Run", "Attack", "Climb", "Glide")
# Blender v1 rest coordinates: character and climbing wall face -Y.
WALL_FORWARD = Vector((0.0, -1.0, 0.0))
WALL_Y = -0.42
RUN_DIAGNOSTICS = {}


_spec = importlib.util.spec_from_file_location(
    "wanderer_v3_base", ROOT / "docs/art-direction/asset-v3/build_wanderer_textured_rig_v3.py"
)
v3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v3)
# All inherited helpers now write v4 deliverables, never v3.
v3.OUT, v3.RENDERS, v3.BLEND, v3.GLB, v3.REPORT = OUT, RENDERS, BLEND, GLB, REPORT


def rear_occiput_anchor(body):
    """Select a centered rear-head vertex below the crown, at the occiput."""
    head = body.vertex_groups.get("head")
    if head is None:
        raise RuntimeError("v1 rig has no head vertex group")
    vertices = [v for v in body.data.vertices if any(g.group == head.index and g.weight >= .50 for g in v.groups)]
    if not vertices:
        raise RuntimeError("No head-dominant source vertices for occiput attachment")
    low, high = min(v.co.z for v in vertices), max(v.co.z for v in vertices)
    # 36--62% deliberately excludes the upper-crown band used by v3.
    band = [v for v in vertices if low + (high - low) * .36 <= v.co.z <= low + (high - low) * .62]
    if not band:
        raise RuntimeError("Measured head has no rear-occiput band")
    rear_y = max(v.co.y for v in band)
    rear = [v for v in band if v.co.y >= rear_y - .008]
    center_x = sum(v.co.x for v in band) / len(band)
    target_z = low + (high - low) * .49
    chosen = min(rear, key=lambda v: abs(v.co.x - center_x) + abs(v.co.z - target_z) * .30)
    world = body.matrix_world @ chosen.co
    return chosen.index, world, {
        "vertex": chosen.index,
        "head_weight": next(g.weight for g in chosen.groups if g.group == head.index),
        "head_z_range": [round(low, 6), round(high, 6)],
        "occiput_band_z_range": [round(low + (high - low) * .36, 6), round(low + (high - low) * .62, 6)],
        "rear_y": round(rear_y, 6),
        "world": [round(value, 6) for value in world],
    }


def transported_frames(path):
    """Parallel-transport cross sections, avoiding global-axis ribbon flips."""
    tangents = []
    for index, point in enumerate(path):
        delta = path[min(index + 1, len(path) - 1)] - path[max(index - 1, 0)]
        if delta.length < .000001:
            raise RuntimeError("Hair path contains repeated control points")
        tangents.append(delta.normalized())
    reference = Vector((1.0, 0.0, 0.0))
    if abs(reference.dot(tangents[0])) > .92:
        reference = Vector((0.0, 0.0, 1.0))
    normal = (reference - tangents[0] * reference.dot(tangents[0])).normalized()
    frames, turns = [(normal, tangents[0].cross(normal).normalized())], []
    previous = normal
    for tangent in tangents[1:]:
        projected = previous - tangent * previous.dot(tangent)
        if projected.length < .0001:
            projected = frames[-1][1].cross(tangent)
        normal = projected.normalized()
        # Keep a continuous orientation even when the path turns through a pole.
        if normal.dot(previous) < 0:
            normal.negate()
        turns.append(math.degrees(math.acos(max(-1.0, min(1.0, normal.dot(previous))))))
        frames.append((normal, tangent.cross(normal).normalized()))
        previous = normal
    return frames, {"max_cross_section_turn_degrees": round(max(turns, default=0.0), 4), "frame_flip_count": 0}


def add_transport_tube(vertices, faces, root_index, path, radii, sides):
    if len(path) != len(radii) or radii[0] != 0:
        raise RuntimeError("Hair path/radius contract requires a zero-radius shared root")
    frames, continuity = transported_frames(path)
    rings = [[root_index]]
    for index, point in enumerate(path[1:], 1):
        normal, bitangent = frames[index]
        ring = []
        for side in range(sides):
            ring.append(len(vertices))
            angle = math.tau * side / sides
            vertices.append(point + radii[index] * (normal * math.cos(angle) + bitangent * math.sin(angle)))
        rings.append(ring)
    for side in range(sides):
        faces.append((root_index, rings[1][side], rings[1][(side + 1) % sides]))
    for ring_a, ring_b in zip(rings[1:-1], rings[2:]):
        for side in range(sides):
            faces.append((ring_a[side], ring_b[side], ring_b[(side + 1) % sides], ring_a[(side + 1) % sides]))
    # A small planar cap prevents the open, pointed-fin silhouette of v3.
    faces.append(tuple(reversed(rings[-1])))
    return continuity


def hair_material():
    material = bpy.data.materials.get("V4_TiedHair_PBR") or bpy.data.materials.new("V4_TiedHair_PBR")
    material.use_nodes = True
    bsdf = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.024, 0.012, 0.006, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.58
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def add_tied_hair(body, rig, anchor_world):
    for obj in list(bpy.data.objects):
        if obj.name == "TiedHairAttachment":
            bpy.data.objects.remove(obj, do_unlink=True)
    lateral, rear, up = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    vertices, faces, continuity = [anchor_world.copy()], [], []
    # One compact central tail plus two very fine offsets: a low, continuous
    # tie that tapers down the neck instead of forming a raised bow/ribbon.
    paths = []
    paths.append(([
        anchor_world,
        anchor_world + rear * .012 - up * .004,
        anchor_world + rear * .029 - up * .026,
        anchor_world + rear * .044 - up * .061,
        anchor_world + rear * .050 - up * .104,
        anchor_world + rear * .043 - up * .145,
    ], (0, .018, .018, .015, .010, .005), 9))
    for offset in (-.009, .009):
        paths.append(([
            anchor_world,
            anchor_world + rear * .012 + lateral * offset * .25 - up * .004,
            anchor_world + rear * .028 + lateral * offset * .70 - up * .026,
            anchor_world + rear * .042 + lateral * offset * .95 - up * .059,
            anchor_world + rear * .048 + lateral * offset * .60 - up * .099,
            anchor_world + rear * .041 + lateral * offset * .20 - up * .132,
        ], (0, .006, .006, .005, .0035, .0015), 6))
    for path, radii, sides in paths:
        continuity.append(add_transport_tube(vertices, faces, 0, path, radii, sides))
    mesh = bpy.data.meshes.new("TiedHairAttachmentMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(hair_material())
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    hair = bpy.data.objects.new("TiedHairAttachment", mesh)
    bpy.context.scene.collection.objects.link(hair)
    hair["attachment_role"], hair["root_vertex_index"] = "tied_hair", 0
    hair["cross_section_frames"] = "parallel_transport"
    hair.parent, hair.parent_type, hair.parent_bone = rig, "BONE", "hair_tie"
    parent_matrix = rig.matrix_world @ rig.pose.bones["hair_tie"].matrix
    hair.matrix_parent_inverse = parent_matrix.inverted()
    hair.matrix_world = Matrix.Identity(4)
    degenerate = sum(1 for polygon in mesh.polygons if polygon.area < .00000001)
    diagnostic = {
        "method": "parallel-transport tangent frames; capped compact center tail with two subtle strands",
        "strands": len(paths), "vertices": len(mesh.vertices), "polygons": len(mesh.polygons),
        "degenerate_polygons": degenerate, "paths": continuity,
        "max_cross_section_turn_degrees": max(item["max_cross_section_turn_degrees"] for item in continuity),
        "frame_flip_count": sum(item["frame_flip_count"] for item in continuity),
    }
    if degenerate or diagnostic["frame_flip_count"] or diagnostic["max_cross_section_turn_degrees"] > 32:
        raise RuntimeError("Hair surface continuity validation failed: %s" % diagnostic)
    return hair, diagnostic


def reset_pose(rig):
    v3.reset_pose(rig)


def armature_point(rig, bone_name, tail=False):
    bone = rig.pose.bones.get(bone_name)
    if bone is None:
        raise RuntimeError("Missing pose bone " + bone_name)
    return bone.tail.copy() if tail else bone.head.copy()


def pose_arm_to_hand_target(rig, axes, side, target):
    """Two-bone reach: solve an outward natural elbow, then aim through rests."""
    upper_name, fore_name = "upper_arm." + side, "forearm." + side
    shoulder = armature_point(rig, upper_name)
    upper_len = rig.data.bones[upper_name].length
    fore_len = rig.data.bones[fore_name].length
    to_target = target - shoulder
    distance = min(to_target.length, (upper_len + fore_len) * .94)
    if distance < abs(upper_len - fore_len) + .015:
        raise RuntimeError("Climb hand target is too close for a natural elbow")
    direction = to_target.normalized()
    along = (upper_len * upper_len - fore_len * fore_len + distance * distance) / (2 * distance)
    height = math.sqrt(max(0.0, upper_len * upper_len - along * along))
    outward = axes["left" if side == "L" else "right"] * .78 - axes["up"] * .32 - axes["forward"] * .10
    elbow_plane = outward - direction * outward.dot(direction)
    if elbow_plane.length < .001:
        elbow_plane = axes["up"].cross(direction)
    elbow = shoulder + direction * along + elbow_plane.normalized() * height
    v3.aim_bone(rig, upper_name, elbow - shoulder)
    bpy.context.view_layer.update()
    v3.aim_bone(rig, fore_name, target - armature_point(rig, fore_name))
    return {"shoulder": shoulder, "elbow": elbow, "target": target}


def pose_climb(rig, axes, phase):
    # Lean the complete torso into the -Y wall, then move hips toward it.
    rig.pose.bones["pelvis"].location = (0.0, -.105, .055 + .025 * math.sin(phase))
    v3.aim_bone(rig, "spine", (axes["up"] * .89 + WALL_FORWARD * .46).normalized())
    bpy.context.view_layer.update()
    v3.aim_bone(rig, "chest", (axes["up"] * .82 + WALL_FORWARD * .57).normalized())
    bpy.context.view_layer.update()
    reaches = {"L": .5 + .5 * math.sin(phase), "R": .5 + .5 * math.sin(phase + math.pi)}
    for side, reach in reaches.items():
        shoulder = armature_point(rig, "upper_arm." + side)
        target = Vector((shoulder.x + (.018 if side == "L" else -.018), WALL_Y, shoulder.z + .255 + .165 * reach))
        pose_arm_to_hand_target(rig, axes, side, target)
        # Raised knee travels forward to the wall, with the shin folding back.
        lift = .5 + .5 * math.sin(phase + (0 if side == "L" else math.pi))
        thigh = (WALL_FORWARD * (.64 + .10 * lift) - axes["up"] * (.77 - .12 * lift)).normalized()
        shin = (-axes["up"] * .88 - WALL_FORWARD * (.28 + .10 * lift)).normalized()
        v3.aim_bone(rig, "thigh." + side, thigh)
        bpy.context.view_layer.update()
        v3.aim_bone(rig, "shin." + side, shin)
        if rig.pose.bones.get("foot." + side):
            v3.aim_bone(rig, "foot." + side, (WALL_FORWARD * .32 - axes["up"] * .95).normalized())
    return reaches


def pose_attack(rig, axes, t):
    # Three explicit stages create a torso-led right-hand slash arc.  This does
    # not invent a weapon; the review sheet exposes hand/weapon readability.
    v3.local_rotate(rig, "spine", (0, 0, 1), -.16 + .42 * min(1.0, t * 1.9))
    v3.local_rotate(rig, "chest", (0, 0, 1), -.28 + .68 * min(1.0, t * 1.9))
    bpy.context.view_layer.update()
    right_shoulder, left_shoulder = armature_point(rig, "upper_arm.R"), armature_point(rig, "upper_arm.L")
    if t < .35:
        q = t / .35
        right_target = right_shoulder + axes["right"] * (.12 + .17 * q) + axes["up"] * (.20 + .20 * q) - axes["forward"] * (.03 + .11 * q)
    elif t < .68:
        q = (t - .35) / .33
        right_target = right_shoulder + axes["right"] * (.29 + .26 * q) + axes["up"] * (.40 - .34 * q) + axes["forward"] * (-.14 + .46 * q)
    else:
        q = (t - .68) / .32
        right_target = right_shoulder + axes["right"] * (.55 - .24 * q) + axes["up"] * (.06 - .02 * q) + axes["forward"] * (.32 - .18 * q)
    pose_arm_to_hand_target(rig, axes, "R", right_target)
    guard = left_shoulder + axes["left"] * .08 + axes["up"] * .10 + axes["forward"] * .16
    pose_arm_to_hand_target(rig, axes, "L", guard)


def pose_at_frame(rig, clip, frame, final_frame):
    reset_pose(rig)
    axes = v3.anatomy_axes(rig)
    phase = (frame - 1) / max(final_frame - 1, 1) * math.tau
    if clip == "Climb":
        pose_climb(rig, axes, phase)
    elif clip == "Attack":
        pose_attack(rig, axes, (frame - 1) / max(final_frame - 1, 1))
    else:
        # Keep the host-reviewed walk, glide, idle and run poses unchanged.
        v3.pose_at_frame(rig, clip, frame, final_frame)


def key_pose(rig, frame):
    for bone in rig.pose.bones:
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)


def hand_contact(rig, side):
    hand = rig.pose.bones.get("hand." + side)
    return hand.head.copy() if hand else armature_point(rig, "forearm." + side, tail=True)


def climb_wall_validation(rig, scene):
    action = bpy.data.actions["Climb"]
    rig.animation_data.action = action
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    axes = v3.anatomy_axes(rig)
    samples, heights = [], {"L": [], "R": []}
    for frame in (1, 10, 19, 28):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        torso = armature_point(rig, "chest")
        values = {"frame": frame, "hands": {}, "knees": {}}
        for side in ("L", "R"):
            hand, shoulder = hand_contact(rig, side), armature_point(rig, "upper_arm." + side)
            knee, hip = armature_point(rig, "thigh." + side, tail=True), armature_point(rig, "thigh." + side)
            values["hands"][side] = {
                "wall_gap": round(abs(hand.y - WALL_Y), 5),
                "forward_from_torso": round((hand - torso).dot(WALL_FORWARD), 5),
                "above_shoulder": round((hand - shoulder).dot(axes["up"]), 5),
                "elbow_lateral": round(abs((armature_point(rig, "forearm." + side) - shoulder).dot(axes["left" if side == "L" else "right"])), 5),
            }
            values["knees"][side] = {"forward_from_hip": round((knee - hip).dot(WALL_FORWARD), 5)}
            heights[side].append(hand.z)
        values["torso"] = {
            "spine_forward_dot": round((rig.pose.bones["spine"].matrix.to_3x3() @ Vector((0, 1, 0))).normalized().dot(WALL_FORWARD), 5),
            "chest_forward_dot": round((rig.pose.bones["chest"].matrix.to_3x3() @ Vector((0, 1, 0))).normalized().dot(WALL_FORWARD), 5),
        }
        samples.append(values)
    flat_hands = [hand for sample in samples for hand in sample["hands"].values()]
    valid = all(hand["wall_gap"] <= .12 and hand["forward_from_torso"] >= .15 and hand["above_shoulder"] >= .14 and hand["elbow_lateral"] >= .025 for hand in flat_hands)
    valid = valid and all(knee["forward_from_hip"] >= .10 for sample in samples for knee in sample["knees"].values())
    valid = valid and all(sample["torso"][key] >= .18 for sample in samples for key in sample["torso"])
    # Equal heights at crossover frames 1/19 are expected. Quarter-cycle extrema must swap leaders.
    deltas = [left - right for left, right in zip(heights["L"], heights["R"])]
    alternating = deltas[1] >= .055 and deltas[3] <= -.055 and abs(deltas[0]) <= .02 and abs(deltas[2]) <= .02
    valid = valid and alternating
    result = {"wall_forward_rest": list(WALL_FORWARD), "wall_plane_y": WALL_Y, "quarter_cycle_samples": samples, "alternating_hand_heights": alternating, "valid": valid}
    if not valid:
        raise RuntimeError("Climb wall-contact validation failed: %s" % result)
    rig.animation_data.action = None
    reset_pose(rig)
    return result


def render_review_set(scene, body):
    camera, target = v3.make_review_camera_and_lights(body, scene)
    views = {"front": (0, -1, 0), "left": (-1, 0, 0), "right": (1, 0, 0), "back": (0, 1, 0)}
    renders = {}
    baseline = {
        "front_idle": ("front-idle.png", (0, -1, 0), 4.2, "Idle", 31),
        "left_side_walk": ("left-side-walk.png", (-1, 0, 0), 4.2, "Walk", 9),
        "right_side_walk": ("right-side-walk.png", (1, 0, 0), 4.2, "Walk", 9),
        "back_run": ("back-run.png", (0, 1, 0), 4.2, "Run", 7),
        "front_glide": ("front-glide.png", (0, -1, 0), 4.5, "Glide", 25),
        "dynamic_glide": ("dynamic-glide.png", (1, -1, .20), 4.7, "Glide", 25),
    }
    for name, args in baseline.items():
        renders[name] = v3.render_view(scene, camera, target, *args)
    for frame in (1, 10, 19, 28):
        for view, direction in views.items():
            name = "climb_f%02d_%s" % (frame, view)
            renders[name] = v3.render_view(scene, camera, target, "%s.png" % name, direction, 4.45, "Climb", frame)
    for frame in (8, 12, 19):
        for view, direction in views.items():
            name = "attack_f%02d_%s" % (frame, view)
            renders[name] = v3.render_view(scene, camera, target, "%s.png" % name, direction, 4.45, "Attack", frame)
    missing = [path for path in renders.values() if not Path(path).is_file() or Path(path).stat().st_size == 0]
    if missing:
        raise RuntimeError("Review render did not produce files: %s" % missing)
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    rig.animation_data.action = None
    reset_pose(rig)
    scene.frame_set(1)
    return renders


def main():
    v3.ensure_dirs()
    if not v3.SOURCE.exists():
        raise RuntimeError("Required immutable v1 source is missing: %s" % v3.SOURCE)
    bpy.ops.wm.open_mainfile(filepath=str(v3.SOURCE))
    body, rig = v3.find_body_and_rig()
    source_mesh, source_bones, source_pbr = v3.mesh_snapshot(body), len(rig.data.bones), v3.source_pbr_bindings(body)
    RUN_DIAGNOSTICS["source_pbr"] = source_pbr
    if source_mesh["uv_layers"] < 1 or not v3.pbr_image_set(source_pbr):
        raise RuntimeError("v1 did not load UV and PBR-referenced images")
    v3.v2.clear_prior_authored_animation(rig)
    scalp_vertex, anchor, anchor_record = rear_occiput_anchor(body)
    v3.add_hair_tie_bone(rig, anchor)
    weights = v3.repair_garment_weights(body)
    hair, hair_surface = add_tied_hair(body, rig, anchor)
    v3.v2.reset_pose, v3.v2.pose_at_frame, v3.v2.key_pose = reset_pose, pose_at_frame, key_pose
    clips = v3.v2.create_actions(rig, bpy.context.scene)
    glide_axes = v3.glide_axis_validation(rig, bpy.context.scene)
    climb = climb_wall_validation(rig, bpy.context.scene)
    after_mesh = v3.mesh_snapshot(body)
    if source_mesh != after_mesh:
        raise RuntimeError("Source topology/UV/material/PBR snapshot changed outside permitted weights")
    if len(rig.data.bones) != source_bones + 1 or hair.parent_bone != "hair_tie":
        raise RuntimeError("Tied-hair bone parenting was not created correctly")
    attachment = v3.validate_hair_root(body, hair, scalp_vertex, rig, bpy.context.scene)
    renders = render_review_set(bpy.context.scene, body)
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    roundtrip = v3.export_and_roundtrip(body, rig, source_pbr)
    missing = sorted(set(EXPECTED_CLIPS) - set(roundtrip["actions"]))
    validation = {
        "clip_names_match": not missing, "missing_clips": missing,
        "bone_count_match": roundtrip["bones"] == source_bones + 1,
        "texture_count_match": roundtrip["pbr"]["difference"] == 0 and not roundtrip["pbr"]["missing_glb_binding_semantics"],
        "tied_hair_attachment_survives": roundtrip["tied_hair_attachment_count"] == 1,
        "glide_axes_valid": glide_axes["glide"]["valid"], "climb_wall_valid": climb["valid"],
        "hair_root_attachment_valid": attachment["valid"],
        "hair_surface_continuity_valid": hair_surface["degenerate_polygons"] == 0 and hair_surface["frame_flip_count"] == 0,
        "arm_dominant_weights_unchanged": weights["arm_dominant_vertices_changed"] == 0,
    }
    if not all(value for key, value in validation.items() if key != "missing_clips"):
        raise RuntimeError("GLB roundtrip validation failed: %s" % validation)
    report = {
        "status": "passed_structural_review_required", "execution": "Host Blender execution only; this is not visual or weapon-slash acceptance.",
        "source": {"path": str(v3.SOURCE), "sha256": v3.sha256(v3.SOURCE), "mesh": source_mesh, "bones": source_bones, "pbr_image_count": len(v3.pbr_image_set(source_pbr))},
        "v4": {"blend": str(BLEND), "glb": str(GLB), "mesh_preservation": after_mesh, "bones": source_bones + 1,
               "weight_repair": weights, "rear_occiput_anchor": anchor_record, "hair_surface_continuity": hair_surface,
               "hair_root_attachment": attachment, "anatomy_axis_validation": glide_axes, "climb_wall_validation": climb,
               "clips": clips, "renders": renders},
        "roundtrip": roundtrip, "validation": validation,
        "outstanding_visual_review": [
            "Review the full four-view, four-phase climb grid: both hands must read on the -Y wall plane, elbows bent, knees forward, and torso pitched into the wall.",
            "Review low occiput hair in both walk sides and climb/back frames: it must read as a small downward bundle without bow, fins, or visible root lift.",
            "Review the three-stage, four-view attack grid for a readable hand/visible-weapon slash. This script makes no weapon acceptance claim and adds no gameplay object.",
            "Retain v1 runtime and do not integrate v4 until this review explicitly accepts it."
        ],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        OUT.mkdir(parents=True, exist_ok=True)
        failure = {"status": "failed", "source": str(v3.SOURCE), "error_type": type(error).__name__, "error": str(error), "diagnostics": RUN_DIAGNOSTICS}
        REPORT.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        raise
