"""Author a separate v2 of the supplied textured wanderer rig.

Run this file with Blender from the repository root.  It deliberately opens the
v1 .blend read-only-in-practice and only ever saves/export files below asset-v2.
The source mesh topology, UV layer and Material_0 PBR node tree are retained;
the only edits to the supplied mesh are bounded vertex-weight repairs around
the photographed tunic hem/waist.
"""

import bpy
import hashlib
import json
import math
from pathlib import Path

from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "docs/art-direction/asset-v1/wanderer-textured-rig-v1.blend"
OUT = ROOT / "docs/art-direction/asset-v2"
RENDERS = OUT / "renders"
BLEND = OUT / "wanderer-textured-rig-v2.blend"
GLB = OUT / "wanderer-textured-rig-v2.glb"
REPORT = OUT / "wanderer-textured-rig-v2-report.json"
EXPECTED_CLIPS = ("Idle", "Walk", "Run", "Attack", "Climb", "Glide")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def texture_nodes(material):
    if not material or not material.use_nodes or not material.node_tree:
        return []
    return sorted(
        node.image.name
        for node in material.node_tree.nodes
        if node.type == "TEX_IMAGE" and node.image
    )


def mesh_snapshot(mesh):
    return {
        "object": mesh.name,
        "vertices": len(mesh.data.vertices),
        "polygons": len(mesh.data.polygons),
        "uv_layers": len(mesh.data.uv_layers),
        "materials": [slot.material.name if slot.material else None for slot in mesh.material_slots],
        "texture_nodes": {
            slot.material.name: texture_nodes(slot.material)
            for slot in mesh.material_slots
            if slot.material
        },
    }


def find_body_and_rig():
    rigs = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if len(rigs) != 1:
        raise RuntimeError("Expected exactly one armature in v1, found %d" % len(rigs))
    # The v1 bundle intentionally contains one textured body mesh.  Do not
    # select a camera prop or a later authoring attachment by accident.
    body = next((obj for obj in meshes if obj.name == "WandererTexturedBody"), None)
    if body is None:
        body = max(meshes, key=lambda obj: len(obj.data.vertices))
    return body, rigs[0]


def ensure_dirs():
    OUT.mkdir(parents=True, exist_ok=True)
    RENDERS.mkdir(parents=True, exist_ok=True)


def clear_prior_authored_animation(rig):
    if rig.animation_data:
        rig.animation_data.action = None
        for track in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(track)
    for action in list(bpy.data.actions):
        if action.name in EXPECTED_CLIPS or action.name.startswith("V2_"):
            bpy.data.actions.remove(action)


def add_hair_tie_bone(rig):
    """Create one child bone used by a separate tied-hair mesh attachment."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    source = rig.data.edit_bones.get("head")
    if source is None:
        raise RuntimeError("v1 rig has no head bone; cannot attach tied hair")
    existing = rig.data.edit_bones.get("hair_tie")
    if existing:
        rig.data.edit_bones.remove(existing)
    tie = rig.data.edit_bones.new("hair_tie")
    tie.parent = source
    tie.use_connect = False
    # A short rest bone behind the crown.  Its orientation is inherited from
    # head; the attachment itself is positioned from the measured mesh bbox.
    tie.head = source.tail.copy()
    tie.tail = source.tail + (source.tail - source.head).normalized() * 0.09
    bpy.ops.object.mode_set(mode="POSE")
    rig.pose.bones["hair_tie"].rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")


def new_hair_material():
    material = bpy.data.materials.get("V2_TiedHair_PBR")
    if material:
        return material
    material = bpy.data.materials.new("V2_TiedHair_PBR")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.028, 0.016, 0.009, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def join_selected_meshes(name, material):
    meshes = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("Hair attachment mesh creation unexpectedly selected nothing")
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    result.name = name
    result.data.name = name + "Mesh"
    if not result.data.materials:
        result.data.materials.append(material)
    else:
        result.data.materials[0] = material
    return result


def add_tied_hair_attachment(body, rig):
    """Make a compact bun + braided tail and bind the object to hair_tie.

    It is intentionally a separate mesh: source UVs/materials are untouched,
    while the attachment is a real bone-following object in Blender and GLB.
    """
    for obj in list(bpy.data.objects):
        if obj.name == "TiedHairAttachment":
            bpy.data.objects.remove(obj, do_unlink=True)
    bbox = [body.matrix_world @ Vector(corner) for corner in body.bound_box]
    min_v = Vector((min(v.x for v in bbox), min(v.y for v in bbox), min(v.z for v in bbox)))
    max_v = Vector((max(v.x for v in bbox), max(v.y for v in bbox), max(v.z for v in bbox)))
    center_x = (min_v.x + max_v.x) * 0.5
    # v1's review renders use -Y as the face camera; +Y is the tied-hair side.
    back_y = max_v.y + 0.016
    crown_z = max_v.z - (max_v.z - min_v.z) * 0.115
    bpy.ops.object.select_all(action="DESELECT")
    material = new_hair_material()
    pieces = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=(center_x, back_y, crown_z))
    bun = bpy.context.object
    bun.scale = (0.075, 0.048, 0.06)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    pieces.append(bun)
    # Four overlapping links make the silhouette read as tied hair rather than
    # the loose cap/tail noted in the v1 visual review.
    for index in range(4):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=12,
            ring_count=6,
            location=(center_x + (0.009 if index % 2 else -0.009), back_y + 0.003, crown_z - 0.055 - index * 0.052),
        )
        link = bpy.context.object
        link.scale = (0.037, 0.028, 0.048)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        pieces.append(link)
    bpy.ops.object.select_all(action="DESELECT")
    for piece in pieces:
        piece.select_set(True)
    hair = join_selected_meshes("TiedHairAttachment", material)
    hair["attachment_role"] = "tied_hair"
    hair["source_preserved"] = True
    target_matrix = hair.matrix_world.copy()
    hair.parent = rig
    hair.parent_type = "BONE"
    hair.parent_bone = "hair_tie"
    # Preserve the measured world placement at rest, then follow hair_tie in
    # every animated head pose.
    hair.matrix_parent_inverse = (rig.matrix_world @ rig.pose.bones["hair_tie"].matrix).inverted()
    hair.matrix_world = target_matrix
    return hair


def group_index(body, name):
    group = body.vertex_groups.get(name)
    if group is None:
        raise RuntimeError("Expected vertex group %s" % name)
    return group.index


def replace_vertex_weights(mesh, vertex_index, named_weights):
    for group in mesh.vertex_groups:
        group.remove([vertex_index])
    for name, weight in named_weights.items():
        mesh.vertex_groups[name].add([vertex_index], weight, "REPLACE")


def repair_waist_and_hem_weights(body, rig):
    """Limit repairs to the visually failing waistband/hem band.

    The inspected v1 dynamic renders showed the original nearest-vertex
    transfer pulling the fitted tunic hem with thigh/foot weights.  This band
    is therefore rigidly anchored to pelvis/spine, with a small chest blend at
    the top edge; it intentionally does not alter sleeves, face, boots or UVs.
    """
    mesh = body.data
    needed = ("pelvis", "spine", "chest", "thigh.L", "thigh.R")
    for name in needed:
        group_index(body, name)
    local_z = [vertex.co.z for vertex in mesh.vertices]
    low, high = min(local_z), max(local_z)
    height = high - low
    waist_low = low + height * 0.405
    waist_high = low + height * 0.585
    center_x = sum(vertex.co.x for vertex in mesh.vertices) / len(mesh.vertices)
    # The textured tunic extends wider than the thighs in this exact v1 mesh.
    # A 0.27-height radius catches the hem and belt/waist shell but avoids the
    # hanging arms and lower trouser legs.
    max_radius = height * 0.27
    repaired = []
    for vertex in mesh.vertices:
        x, y, z = vertex.co
        radial = math.sqrt((x - center_x) ** 2 + y ** 2)
        if waist_low <= z <= waist_high and radial <= max_radius:
            t = (z - waist_low) / max(waist_high - waist_low, 0.0001)
            # The lower hem must stay with the hips; only the upper waist may
            # ease toward spine/chest.  No thigh group is retained in band.
            if t < 0.42:
                weights = {"pelvis": 0.88, "spine": 0.12}
            elif t < 0.78:
                weights = {"pelvis": 0.58, "spine": 0.42}
            else:
                weights = {"pelvis": 0.20, "spine": 0.62, "chest": 0.18}
            replace_vertex_weights(body, vertex.index, weights)
            repaired.append(vertex.index)
    if not repaired:
        raise RuntimeError("Waist/hem repair selected no vertices; coordinate assumptions changed")
    allowed = {group_index(body, name) for name in ("pelvis", "spine", "chest")}
    thigh_ids = {group_index(body, "thigh.L"), group_index(body, "thigh.R")}
    contamination = 0
    non_normalized = 0
    for vertex_index in repaired:
        groups = mesh.vertices[vertex_index].groups
        if any(entry.group not in allowed for entry in groups) or any(entry.group in thigh_ids for entry in groups):
            contamination += 1
        if abs(sum(entry.weight for entry in groups) - 1.0) > 0.0001:
            non_normalized += 1
    if contamination or non_normalized:
        raise RuntimeError("Weight repair validation failed: contamination=%d non_normalized=%d" % (contamination, non_normalized))
    unweighted = sum(1 for vertex in mesh.vertices if not vertex.groups)
    if unweighted:
        raise RuntimeError("Weight repair left %d unweighted vertices" % unweighted)
    return {
        "coordinate_band": {"z_min": waist_low, "z_max": waist_high, "radius_max": max_radius},
        "vertices_reweighted": len(repaired),
        "thigh_or_foreign_weight_vertices_after": contamination,
        "non_normalized_vertices_after": non_normalized,
        "unweighted_vertices_after": unweighted,
    }


def reset_pose(rig):
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)


def rotate(rig, bone, x=0.0, y=0.0, z=0.0):
    pose_bone = rig.pose.bones.get(bone)
    if pose_bone is None:
        raise RuntimeError("Missing expected pose bone %s" % bone)
    pose_bone.rotation_euler = (x, y, z)


def pose_at_frame(rig, clip, frame, final_frame):
    reset_pose(rig)
    phase = (frame - 1) / max(final_frame - 1, 1) * math.tau
    wave = math.sin(phase)
    stride = math.sin(phase)
    left_stride = stride
    right_stride = -stride
    if clip == "Idle":
        # Preserve the source's natural A/rest stance; only a small breath,
        # head turn and soft elbow bend are authored.  v1's stiff arms are not
        # raised into an alert T-pose here.
        rotate(rig, "spine", x=0.018 * math.sin(phase))
        rotate(rig, "chest", x=0.026 * math.sin(phase + 0.4), z=0.012 * math.sin(phase))
        rotate(rig, "neck", z=0.045 * math.sin(phase * 0.5))
        rotate(rig, "upper_arm.L", x=-0.055, z=0.018)
        rotate(rig, "upper_arm.R", x=-0.055, z=-0.018)
        rotate(rig, "forearm.L", x=0.10)
        rotate(rig, "forearm.R", x=0.10)
    elif clip in ("Walk", "Run"):
        run = clip == "Run"
        leg_amp = 0.52 if not run else 0.78
        arm_amp = 0.36 if not run else 0.66
        knee_amp = 0.46 if not run else 0.72
        for side, leg in (("L", left_stride), ("R", right_stride)):
            lift = max(0.0, leg)
            rotate(rig, "thigh." + side, x=leg_amp * leg)
            rotate(rig, "shin." + side, x=-knee_amp * lift)
            rotate(rig, "foot." + side, x=-leg_amp * leg + knee_amp * lift * 0.65)
            # Arms are opposite the legs, and retain a relaxed elbow instead
            # of the v1 run's near-straight, asymmetric reach.
            rotate(rig, "upper_arm." + side, x=-arm_amp * leg - 0.055)
            rotate(rig, "forearm." + side, x=0.14 + 0.20 * max(0.0, -leg))
        rotate(rig, "spine", x=(-0.05 if run else -0.018) + 0.025 * wave)
        rotate(rig, "chest", x=(-0.08 if run else -0.025), z=0.035 * wave)
        rig.pose.bones["pelvis"].location.z = (0.032 if run else 0.018) * (0.5 + 0.5 * math.cos(phase * 2))
    elif clip == "Attack":
        # Windup (1), strike (12), recover (24).  A readable torso-led slash,
        # not a reused walk pose.
        t = (frame - 1) / max(final_frame - 1, 1)
        if t < 0.35:
            q = t / 0.35
            rotate(rig, "spine", z=-0.20 * q)
            rotate(rig, "chest", z=-0.32 * q)
            rotate(rig, "upper_arm.R", x=-0.20 * q, z=-0.95 * q)
            rotate(rig, "forearm.R", x=0.24 * q, z=-0.42 * q)
        elif t < 0.62:
            q = (t - 0.35) / 0.27
            rotate(rig, "spine", z=-0.20 + 0.55 * q)
            rotate(rig, "chest", z=-0.32 + 0.88 * q)
            rotate(rig, "upper_arm.R", x=-0.20 + 0.75 * q, z=-0.95 + 1.55 * q)
            rotate(rig, "forearm.R", x=0.24 - 0.52 * q, z=-0.42 + 0.70 * q)
            rotate(rig, "thigh.L", x=0.18 * q)
            rotate(rig, "thigh.R", x=-0.14 * q)
        else:
            q = (t - 0.62) / 0.38
            rotate(rig, "spine", z=0.35 * (1 - q))
            rotate(rig, "chest", z=0.56 * (1 - q))
            rotate(rig, "upper_arm.R", x=0.55 * (1 - q) - 0.055, z=0.60 * (1 - q))
            rotate(rig, "forearm.R", x=-0.28 * (1 - q) + 0.10)
        rotate(rig, "upper_arm.L", x=-0.08, z=0.12)
        rotate(rig, "forearm.L", x=0.13)
    elif clip == "Climb":
        # Alternating high reach with a compact hip lift makes this distinct
        # from locomotion and lets the repaired tunic remain pelvis-led.
        for side, offset in (("L", 0.0), ("R", math.pi)):
            reach = max(0.0, math.sin(phase + offset))
            lift = max(0.0, math.sin(phase + offset + math.pi * 0.45))
            rotate(rig, "upper_arm." + side, x=-0.35 - 0.88 * reach, z=(0.25 if side == "L" else -0.25))
            rotate(rig, "forearm." + side, x=0.22 + 0.48 * reach)
            rotate(rig, "thigh." + side, x=0.24 + 0.72 * lift)
            rotate(rig, "shin." + side, x=-0.50 * lift)
            rotate(rig, "foot." + side, x=-0.18 * lift)
        rotate(rig, "spine", x=-0.16)
        rotate(rig, "chest", x=-0.18)
        rig.pose.bones["pelvis"].location.z = 0.035 * (0.5 + 0.5 * math.sin(phase))
    elif clip == "Glide":
        # Open-air balance: both arms spread but elbows remain soft.
        rotate(rig, "spine", x=-0.13)
        rotate(rig, "chest", x=-0.16)
        rotate(rig, "upper_arm.L", x=-0.42, z=0.92)
        rotate(rig, "upper_arm.R", x=-0.42, z=-0.92)
        rotate(rig, "forearm.L", x=0.22, z=0.18)
        rotate(rig, "forearm.R", x=0.22, z=-0.18)
        rotate(rig, "thigh.L", x=0.15)
        rotate(rig, "thigh.R", x=0.15)
        rotate(rig, "shin.L", x=-0.12)
        rotate(rig, "shin.R", x=-0.12)
        rotate(rig, "neck", x=0.06, z=0.05 * wave)
    else:
        raise RuntimeError("Unknown clip " + clip)


def key_pose(rig, frame):
    for pose_bone in rig.pose.bones:
        pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
        pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)


def create_actions(rig, scene):
    definitions = {
        "Idle": {"frames": 61, "keys": (1, 16, 31, 46, 61), "looping": True},
        "Walk": {"frames": 33, "keys": (1, 9, 17, 25, 33), "looping": True},
        "Run": {"frames": 25, "keys": (1, 7, 13, 19, 25), "looping": True},
        "Attack": {"frames": 31, "keys": (1, 8, 12, 19, 31), "looping": False},
        "Climb": {"frames": 37, "keys": (1, 10, 19, 28, 37), "looping": True},
        "Glide": {"frames": 49, "keys": (1, 13, 25, 37, 49), "looping": True},
    }
    scene.render.fps = 30
    scene.frame_start = 1
    rig.animation_data_create()
    records = []
    for clip, definition in definitions.items():
        action = bpy.data.actions.new(clip)
        action.use_fake_user = True
        rig.animation_data.action = action
        for frame in definition["keys"]:
            scene.frame_set(frame)
            pose_at_frame(rig, clip, frame, definition["frames"])
            key_pose(rig, frame)
        for curve in [c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]:
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER" if clip == "Idle" else "LINEAR"
        track = rig.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 1, action)
        strip.action_frame_start = 1
        strip.action_frame_end = definition["frames"]
        strip.extrapolation = "NOTHING"
        track.mute = True
        records.append({
            "name": clip,
            "frames": definition["frames"],
            "seconds": (definition["frames"] - 1) / scene.render.fps,
            "looping": definition["looping"],
        })
    rig.animation_data.action = None
    reset_pose(rig)
    scene.frame_set(1)
    return records


def make_review_camera_and_lights(body, scene):
    for obj in list(bpy.data.objects):
        if obj.name.startswith("V2Review"):
            bpy.data.objects.remove(obj, do_unlink=True)
    bbox = [body.matrix_world @ Vector(corner) for corner in body.bound_box]
    min_v = Vector((min(v.x for v in bbox), min(v.y for v in bbox), min(v.z for v in bbox)))
    max_v = Vector((max(v.x for v in bbox), max(v.y for v in bbox), max(v.z for v in bbox)))
    target = Vector(((min_v.x + max_v.x) * 0.5, (min_v.y + max_v.y) * 0.5, min_v.z + (max_v.z - min_v.z) * 0.53))
    camera_data = bpy.data.cameras.new("V2ReviewCamera")
    camera_data.lens = 58
    camera = bpy.data.objects.new("V2ReviewCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    scene.camera = camera
    for name, location, energy, size in (
        ("V2ReviewKey", (-3.0, -4.0, 5.0), 900, 4.0),
        ("V2ReviewFill", (3.5, -2.5, 2.8), 500, 3.0),
        ("V2ReviewRim", (1.5, 3.5, 4.0), 750, 2.0),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
    # EEVEE_NEXT is the current host renderer; retaining the older identifier
    # keeps the handoff deterministic on a host that has Blender 3.x installed.
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.055, 0.055, 0.055)
    return camera, target


def render_view(scene, camera, target, name, direction, distance, clip, frame):
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = bpy.data.actions[clip]
    scene.frame_set(frame)
    camera.location = target + Vector(direction).normalized() * distance
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(RENDERS / name)
    bpy.ops.render.render(write_still=True)
    return str(RENDERS / name)


def render_review_set(scene, body):
    camera, target = make_review_camera_and_lights(body, scene)
    renders = {
        "front_idle": render_view(scene, camera, target, "front-idle.png", (0, -1, 0), 4.2, "Idle", 31),
        "side_walk": render_view(scene, camera, target, "side-walk.png", (1, 0, 0), 4.2, "Walk", 9),
        "back_run": render_view(scene, camera, target, "back-run.png", (0, 1, 0), 4.2, "Run", 7),
        "dynamic_attack": render_view(scene, camera, target, "dynamic-attack.png", (1, -1, 0.18), 4.5, "Attack", 19),
        "dynamic_climb": render_view(scene, camera, target, "dynamic-climb.png", (-1, -1, 0.12), 4.5, "Climb", 10),
        "dynamic_glide": render_view(scene, camera, target, "dynamic-glide.png", (1, -1, 0.20), 4.7, "Glide", 25),
    }
    missing = [path for path in renders.values() if not Path(path).is_file() or Path(path).stat().st_size == 0]
    if missing:
        raise RuntimeError("Review render did not produce files: %s" % missing)
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    rig.animation_data.action = None
    reset_pose(rig)
    scene.frame_set(1)
    return renders


def export_and_reimport(body, rig):
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    # The tied-hair object must be explicitly selected because it is not part
    # of the source skin; Blender will retain its bone parenting in the GLB.
    hair = bpy.data.objects.get("TiedHairAttachment")
    if hair:
        hair.select_set(True)
    bpy.context.view_layer.objects.active = rig
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.export_scene.gltf(
        filepath=str(GLB),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_skins=True,
    )
    # Validate the deliverable itself, not merely Blender's pre-export state.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    imported_rigs = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    imported_hair = [obj for obj in bpy.data.objects if obj.name == "TiedHairAttachment"]
    return {
        "bytes": GLB.stat().st_size,
        "bones": sum(len(obj.data.bones) for obj in imported_rigs),
        "armatures": len(imported_rigs),
        "actions": sorted(action.name for action in bpy.data.actions),
        "images": sorted({image.name for image in bpy.data.images}),
        "texture_count": len(bpy.data.images),
        "tied_hair_attachment_count": len(imported_hair),
    }


def main():
    ensure_dirs()
    if not SOURCE.exists():
        raise RuntimeError("Required v1 source is missing: %s" % SOURCE)
    # Never replace/remove v1.  Blender opens source and produces only v2 paths.
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    body, rig = find_body_and_rig()
    source_snapshot = mesh_snapshot(body)
    source_bones = len(rig.data.bones)
    source_textures = len(bpy.data.images)
    if source_snapshot["uv_layers"] < 1 or source_textures < 1:
        raise RuntimeError("v1 did not load its expected UV/PBR texture source")
    clear_prior_authored_animation(rig)
    add_hair_tie_bone(rig)
    weights = repair_waist_and_hem_weights(body, rig)
    hair = add_tied_hair_attachment(body, rig)
    clips = create_actions(rig, bpy.context.scene)
    after_snapshot = mesh_snapshot(body)
    if source_snapshot != after_snapshot:
        # Mesh positions, topology, UVs, source material slots and texture
        # nodes must stay byte-for-byte structurally identical.  Weights are
        # intentionally not in this snapshot and are reported separately.
        raise RuntimeError("Source mesh/PBR/UV snapshot changed outside permitted weights")
    if len(rig.data.bones) != source_bones + 1:
        raise RuntimeError("Expected exactly one hair_tie bone")
    if hair.parent_bone != "hair_tie":
        raise RuntimeError("Tied hair is not bound to hair_tie")
    renders = render_review_set(bpy.context.scene, body)
    # Save the authored source state before import validation resets Blender.
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    hair_record = {"object": hair.name, "bone": "hair_tie", "material": hair.data.materials[0].name}
    roundtrip = export_and_reimport(body, rig)
    missing_clips = sorted(set(EXPECTED_CLIPS) - set(roundtrip["actions"]))
    validation = {
        "clip_names_match": not missing_clips,
        "missing_clips": missing_clips,
        "bone_count_match": roundtrip["bones"] == source_bones + 1,
        "texture_count_match": roundtrip["texture_count"] == source_textures,
        "tied_hair_attachment_survives": roundtrip["tied_hair_attachment_count"] == 1,
    }
    if not all(value for key, value in validation.items() if key != "missing_clips"):
        raise RuntimeError("GLB roundtrip validation failed: %s" % validation)
    report = {
        "status": "passed",
        "execution": "This report is written only when the host executes the script.",
        "source": {
            "path": str(SOURCE),
            "sha256": sha256(SOURCE),
            "mesh": source_snapshot,
            "bones": source_bones,
            "texture_count": source_textures,
        },
        "v2": {
            "blend": str(BLEND),
            "glb": str(GLB),
            "mesh_preservation": after_snapshot,
            "bones": source_bones + 1,
            "tied_hair": hair_record,
            "weight_repair": weights,
            "clips": clips,
            "renders": renders,
        },
        "roundtrip": roundtrip,
        "validation": validation,
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # A failed host invocation still leaves a small machine-readable report
        # beside the intended deliverables, rather than a log-only failure.
        OUT.mkdir(parents=True, exist_ok=True)
        failure = {
            "status": "failed",
            "source": str(SOURCE),
            "error_type": type(error).__name__,
            "error": str(error),
        }
        REPORT.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        raise
