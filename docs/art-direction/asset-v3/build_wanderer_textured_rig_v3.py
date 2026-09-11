"""Build a separately-authored v3 wanderer from the immutable v1 .blend.

This deliberately does not consume v2 output.  v2 and its host logs remain
rejected evidence.  The source body topology, UVs, material slots and PBR
links are immutable; v3 changes only a narrowly classified garment surface,
adds an attached hair mesh, and authors/export-validates clips.
"""

import bpy
import hashlib
import importlib.util
import json
import math
import struct
from collections import deque
from pathlib import Path

from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "docs/art-direction/asset-v1/wanderer-textured-rig-v1.blend"
OUT = ROOT / "docs/art-direction/asset-v3"
RENDERS = OUT / "renders"
BLEND = OUT / "wanderer-textured-rig-v3.blend"
GLB = OUT / "wanderer-textured-rig-v3.glb"
REPORT = OUT / "wanderer-textured-rig-v3-report.json"
EXPECTED_CLIPS = ("Idle", "Walk", "Run", "Attack", "Climb", "Glide")
RUN_DIAGNOSTICS = {}


# Keep the host-proven Blender 5 layered-action traversal from v2.  Importing
# it as a support module cannot execute its v2 main block; v3 opens v1 itself.
_support_spec = importlib.util.spec_from_file_location(
    "wanderer_v2_compat", ROOT / "docs/art-direction/asset-v2/build_wanderer_textured_rig_v2.py"
)
v2 = importlib.util.module_from_spec(_support_spec)
_support_spec.loader.exec_module(v2)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_dirs():
    OUT.mkdir(parents=True, exist_ok=True)
    RENDERS.mkdir(parents=True, exist_ok=True)


def find_body_and_rig():
    rigs = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if len(rigs) != 1:
        raise RuntimeError("Expected exactly one v1 armature, found %d" % len(rigs))
    body = next((obj for obj in meshes if obj.name == "WandererTexturedBody"), None)
    if body is None:
        body = max(meshes, key=lambda obj: len(obj.data.vertices))
    return body, rigs[0]


def image_names_upstream(socket, seen=None):
    """Return image names feeding a shader socket, including Normal Map chains."""
    seen = set() if seen is None else seen
    names = set()
    for link in socket.links:
        node = link.from_node
        if node.as_pointer() in seen:
            continue
        seen.add(node.as_pointer())
        if node.type == "TEX_IMAGE" and node.image:
            names.add(node.image.name)
        for input_socket in node.inputs:
            names.update(image_names_upstream(input_socket, seen))
    return names


def source_pbr_bindings(body):
    """Inspect only images actually driving PBR inputs, never orphan datablocks."""
    result = {}
    for slot in body.material_slots:
        material = slot.material
        if not material or not material.node_tree:
            continue
        bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        result[material.name] = {
            "baseColor": sorted(image_names_upstream(bsdf.inputs["Base Color"])),
            "normal": sorted(image_names_upstream(bsdf.inputs["Normal"])),
            # glTF represents these two Principled inputs with one semantic slot.
            "metallicRoughness": sorted(
                image_names_upstream(bsdf.inputs["Metallic"]) | image_names_upstream(bsdf.inputs["Roughness"])
            ),
        }
    return result


def pbr_image_set(bindings):
    return sorted({image for material in bindings.values() for names in material.values() for image in names})


def mesh_snapshot(body):
    return {
        "object": body.name,
        "vertices": len(body.data.vertices),
        "polygons": len(body.data.polygons),
        "uv_layers": len(body.data.uv_layers),
        "materials": [slot.material.name if slot.material else None for slot in body.material_slots],
        "pbr_bindings": source_pbr_bindings(body),
    }


def named_weights(body, vertex_index):
    mesh = body.data
    return tuple(sorted((body.vertex_groups[item.group].name, round(item.weight, 8)) for item in mesh.vertices[vertex_index].groups))


def dominant_group(body, vertex_index):
    vertex = body.data.vertices[vertex_index]
    if not vertex.groups:
        return None
    entry = max(vertex.groups, key=lambda value: value.weight)
    return body.vertex_groups[entry.group].name


def group_weight(body, vertex_index, names):
    wanted = set(names)
    return sum(item.weight for item in body.data.vertices[vertex_index].groups if body.vertex_groups[item.group].name in wanted)


def adjacency(mesh):
    graph = [set() for _ in mesh.vertices]
    for polygon in mesh.polygons:
        ids = polygon.vertices[:]
        for index, vertex_index in enumerate(ids):
            graph[vertex_index].add(ids[index - 1])
            graph[vertex_index].add(ids[(index + 1) % len(ids)])
    return graph


def expand_surface(seed, graph, rings):
    selected = set(seed)
    frontier = set(seed)
    for _ in range(rings):
        frontier = {neighbor for index in frontier for neighbor in graph[index]} - selected
        selected.update(frontier)
    return selected


def components(vertices, graph):
    remaining = set(vertices)
    result = []
    while remaining:
        start = remaining.pop()
        component = {start}
        queue = deque([start])
        while queue:
            current = queue.popleft()
            for neighbor in graph[current]:
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.add(neighbor)
                    queue.append(neighbor)
        result.append(component)
    return result


def replace_vertex_weights(body, vertex_index, weights):
    for group in body.vertex_groups:
        group.remove([vertex_index])
    for name, weight in weights.items():
        body.vertex_groups[name].add([vertex_index], weight, "REPLACE")


def repair_garment_weights(body):
    """Repair only a torso-connected garment patch, never an altitude band.

    The old 0.27-height cylinder included dangling arms.  This classifier
    protects the arm surface first, then selects connected envelope components
    carrying torso seeds.  Pure thigh-dominant upper-trouser vertices are
    counted and skipped unless immediately adjacent to the torso garment seam.
    """
    mesh = body.data
    required = ("pelvis", "spine", "chest", "thigh.L", "thigh.R")
    missing = [name for name in required if not body.vertex_groups.get(name)]
    if missing:
        raise RuntimeError("v1 is missing weight groups: %s" % missing)
    graph = adjacency(mesh)
    arm_words = ("arm", "hand", "wrist", "finger")
    arm_dominant = {
        vertex.index for vertex in mesh.vertices
        if any(word in (dominant_group(body, vertex.index) or "").lower().replace(" ", "_") for word in arm_words)
    }
    # The mesh-connected two-ring shell covers sleeves / transitions even where
    # interpolation gave a shoulder vertex a torso-dominant name.
    protected_arm_surface = expand_surface(arm_dominant, graph, 2)
    original_arm_weights = {index: named_weights(body, index) for index in arm_dominant}

    local_z = [vertex.co.z for vertex in mesh.vertices]
    low, high = min(local_z), max(local_z)
    height = high - low
    waist_low = low + height * 0.435
    waist_high = low + height * 0.555
    torso_names = ("pelvis", "spine", "chest")
    thigh_names = ("thigh.L", "thigh.R")
    torso_indices = [
        vertex.index for vertex in mesh.vertices
        if group_weight(body, vertex.index, torso_names) >= 0.55 and vertex.index not in protected_arm_surface
    ]
    if not torso_indices:
        raise RuntimeError("No torso-weighted vertices available for garment classification")
    center_x = sum(mesh.vertices[index].co.x for index in torso_indices) / len(torso_indices)
    center_y = sum(mesh.vertices[index].co.y for index in torso_indices) / len(torso_indices)
    seed_radii = sorted(
        math.hypot(mesh.vertices[index].co.x - center_x, mesh.vertices[index].co.y - center_y)
        for index in torso_indices
        if waist_low <= mesh.vertices[index].co.z <= waist_high
    )
    if not seed_radii:
        raise RuntimeError("Torso seed did not intersect the narrow waist envelope")
    # Use the measured torso 85th percentile; this is normally far inside the
    # old 0.51 m cylinder and derives from the supplied mesh rather than scale.
    radius = min(seed_radii[int((len(seed_radii) - 1) * 0.85)] * 1.16, height * 0.18)
    envelope = {
        vertex.index for vertex in mesh.vertices
        if waist_low <= vertex.co.z <= waist_high
        and math.hypot(vertex.co.x - center_x, vertex.co.y - center_y) <= radius
        and vertex.index not in protected_arm_surface
    }
    torso_seed = {index for index in envelope if group_weight(body, index, torso_names) >= 0.55}
    garment_components = [component for component in components(envelope, graph) if component & torso_seed]
    garment_surface = set().union(*garment_components) if garment_components else set()
    if not garment_surface:
        raise RuntimeError("No torso-connected garment surface was selected")

    # A broken hem can be thigh-dominant, but only repair it when directly on a
    # torso-weighted seam.  Isolated / deeper upper trousers remain untouched.
    seam_neighbors = {
        index for index in garment_surface
        if any(group_weight(body, neighbor, torso_names) >= 0.35 for neighbor in graph[index])
    }
    trousers = {
        index for index in envelope
        if group_weight(body, index, thigh_names) >= 0.70 and group_weight(body, index, torso_names) < 0.10
    }
    repair = {
        index for index in garment_surface
        if index not in protected_arm_surface
        and (group_weight(body, index, torso_names) >= 0.12 or index in seam_neighbors)
        and not (index in trousers and index not in seam_neighbors)
    }
    if not repair:
        raise RuntimeError("Garment classifier selected no seam/torso vertices")
    for index in repair:
        z = mesh.vertices[index].co.z
        t = (z - waist_low) / max(waist_high - waist_low, 0.0001)
        if t < 0.38:
            weights = {"pelvis": 0.84, "spine": 0.16}
        elif t < 0.76:
            weights = {"pelvis": 0.54, "spine": 0.46}
        else:
            weights = {"pelvis": 0.20, "spine": 0.64, "chest": 0.16}
        replace_vertex_weights(body, index, weights)

    arm_changed = [index for index, before in original_arm_weights.items() if named_weights(body, index) != before]
    if arm_changed:
        raise RuntimeError("Arm-dominant weights changed at %d vertices (first %s)" % (len(arm_changed), arm_changed[:8]))
    forbidden = {body.vertex_groups[name].index for name in ("thigh.L", "thigh.R")}
    contamination = sum(
        any(entry.group in forbidden for entry in mesh.vertices[index].groups) for index in repair
    )
    non_normalized = sum(abs(sum(item.weight for item in mesh.vertices[index].groups) - 1.0) > 0.0001 for index in repair)
    if contamination or non_normalized:
        raise RuntimeError("Garment repair validation failed: thigh=%d non_normalized=%d" % (contamination, non_normalized))
    return {
        "method": "torso-connected narrow surface with two-ring protected arm shell",
        "coordinate_envelope": {"z_min": waist_low, "z_max": waist_high, "radius": radius},
        "arm_dominant_vertices": len(arm_dominant),
        "protected_arm_surface_vertices": len(protected_arm_surface),
        "arm_dominant_vertices_changed": len(arm_changed),
        "garment_components": len(garment_components),
        "garment_surface_vertices": len(garment_surface),
        "vertices_reweighted": len(repair),
        "upper_trouser_vertices_inspected": len(trousers),
        "upper_trouser_vertices_skipped": len(trousers - seam_neighbors),
        "thigh_weighted_vertices_after": contamination,
        "non_normalized_vertices_after": non_normalized,
    }


def rear_scalp_anchor(body):
    """Find the rear crown on *head-weighted* source vertices, never body bbox."""
    head = body.vertex_groups.get("head")
    if head is None:
        raise RuntimeError("v1 rig has no head vertex group")
    head_vertices = [v for v in body.data.vertices if any(item.group == head.index and item.weight >= 0.50 for item in v.groups)]
    if not head_vertices:
        raise RuntimeError("No head-dominant vertices available for scalp attachment")
    z_values = sorted(vertex.co.z for vertex in head_vertices)
    crown_floor = z_values[int((len(z_values) - 1) * 0.58)]
    crown = [vertex for vertex in head_vertices if vertex.co.z >= crown_floor]
    rear_y = max(vertex.co.y for vertex in crown)
    rear_band = [vertex for vertex in crown if vertex.co.y >= rear_y - max(0.006, (rear_y - min(v.co.y for v in crown)) * 0.06)]
    center_x = sum(vertex.co.x for vertex in crown) / len(crown)
    chosen = min(rear_band, key=lambda vertex: abs(vertex.co.x - center_x))
    return chosen.index, body.matrix_world @ chosen.co, {
        "vertex": chosen.index,
        "head_weight": next(item.weight for item in chosen.groups if item.group == head.index),
        "crown_floor_z": crown_floor,
        "rear_y": rear_y,
        "world": [round(value, 6) for value in (body.matrix_world @ chosen.co)],
    }


def add_hair_tie_bone(rig, anchor_world):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    head = rig.data.edit_bones.get("head")
    if not head:
        raise RuntimeError("v1 rig has no head bone")
    if rig.data.edit_bones.get("hair_tie"):
        rig.data.edit_bones.remove(rig.data.edit_bones["hair_tie"])
    tie = rig.data.edit_bones.new("hair_tie")
    tie.parent = head
    tie.use_connect = False
    tie.head = rig.matrix_world.inverted() @ anchor_world
    head_axis = (head.tail - head.head).normalized()
    tie.tail = tie.head + head_axis * 0.075
    bpy.ops.object.mode_set(mode="POSE")
    rig.pose.bones["hair_tie"].rotation_mode = "QUATERNION"
    bpy.ops.object.mode_set(mode="OBJECT")


def hair_material():
    material = bpy.data.materials.get("V3_TiedHair_PBR") or bpy.data.materials.new("V3_TiedHair_PBR")
    material.use_nodes = True
    bsdf = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.024, 0.012, 0.006, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.58
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def add_tube(vertices, faces, root_index, path, radii, sides=8):
    """A curved tapered strand sharing a literal root vertex with its siblings."""
    rings = []
    for i, point in enumerate(path):
        if i == 0:
            rings.append([root_index])
            continue
        tangent = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        normal = tangent.cross(Vector((0, 0, 1)))
        if normal.length < 0.001:
            normal = tangent.cross(Vector((1, 0, 0)))
        normal.normalize()
        bitangent = tangent.cross(normal).normalized()
        ring = []
        for side in range(sides):
            angle = math.tau * side / sides
            ring.append(len(vertices))
            vertices.append(point + radii[i] * (normal * math.cos(angle) + bitangent * math.sin(angle)))
        rings.append(ring)
    # fan from the shared root, then bridge every full ring.
    for side in range(sides):
        faces.append((root_index, rings[1][side], rings[1][(side + 1) % sides]))
    for ring_a, ring_b in zip(rings[1:-1], rings[2:]):
        for side in range(sides):
            faces.append((ring_a[side], ring_b[side], ring_b[(side + 1) % sides], ring_a[(side + 1) % sides]))


def add_tied_hair(body, rig, anchor_world):
    for obj in list(bpy.data.objects):
        if obj.name == "TiedHairAttachment":
            bpy.data.objects.remove(obj, do_unlink=True)
    lateral = Vector((1, 0, 0))
    rear = Vector((0, 1, 0))
    up = Vector((0, 0, 1))
    vertices, faces = [anchor_world.copy()], []
    root_index = 0
    # Five overlapping, tapered paths form a continuous tied-hair silhouette:
    # a raised compact loop feeding a curved tail behind the neck.
    for index, offset in enumerate((-0.030, -0.015, 0.0, 0.015, 0.030)):
        curve = 0.012 * math.sin(index * 1.7)
        path = [
            anchor_world,
            anchor_world + rear * 0.026 + up * 0.017 + lateral * offset,
            anchor_world + rear * 0.052 + up * (0.052 + curve) + lateral * (offset * 1.2),
            anchor_world + rear * 0.061 + up * (0.010 + curve) + lateral * (offset * 1.45),
            anchor_world + rear * 0.052 - up * (0.064 - curve) + lateral * (offset * 1.22),
            anchor_world + rear * 0.040 - up * (0.132 - curve) + lateral * (offset * 0.75),
        ]
        add_tube(vertices, faces, root_index, path, (0.0, 0.030, 0.031, 0.026, 0.019, 0.010))
    mesh = bpy.data.meshes.new("TiedHairAttachmentMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(hair_material())
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    hair = bpy.data.objects.new("TiedHairAttachment", mesh)
    bpy.context.scene.collection.objects.link(hair)
    hair["attachment_role"] = "tied_hair"
    hair["root_vertex_index"] = root_index
    hair.parent = rig
    hair.parent_type = "BONE"
    hair.parent_bone = "hair_tie"
    parent_matrix = rig.matrix_world @ rig.pose.bones["hair_tie"].matrix
    hair.matrix_parent_inverse = parent_matrix.inverted()
    hair.matrix_world = Matrix.Identity(4)
    return hair


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        bone.location = (0.0, 0.0, 0.0)


def anatomy_axes(rig):
    left = rig.data.bones.get("upper_arm.L")
    right = rig.data.bones.get("upper_arm.R")
    pelvis = rig.data.bones.get("pelvis")
    chest = rig.data.bones.get("chest")
    if not all((left, right, pelvis, chest)):
        raise RuntimeError("Expected pelvis/chest/upper-arm anatomy bones")
    lateral = (left.head_local - right.head_local).normalized()
    up = (chest.tail_local - pelvis.head_local).normalized()
    forward = lateral.cross(up).normalized()
    # v1 is authored face toward -Y; choose the equivalent perpendicular only
    # after deriving its axes from its actual bone placement.
    if forward.dot(Vector((0, -1, 0))) < 0:
        forward.negate()
    return {"left": lateral, "right": -lateral, "up": up, "forward": forward}


def aim_bone(rig, name, desired_armature_direction):
    """Map an anatomical target vector through the bone's measured local basis."""
    pose_bone = rig.pose.bones.get(name)
    if pose_bone is None:
        raise RuntimeError("Missing pose bone " + name)
    pose_bone.rotation_mode = "QUATERNION"
    pose_bone.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    current = (pose_bone.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
    target = desired_armature_direction.normalized()
    world_delta = current.rotation_difference(target)
    basis = pose_bone.matrix.to_3x3()
    local_delta = basis.inverted() @ world_delta.to_matrix() @ basis
    pose_bone.rotation_quaternion = local_delta.to_quaternion()


def local_rotate(rig, name, axis, radians):
    bone = rig.pose.bones.get(name)
    if bone is None:
        raise RuntimeError("Missing pose bone " + name)
    bone.rotation_mode = "QUATERNION"
    # A small local-space turn used only for torso breathing.  Arm directions
    # are never authored this way: aim_bone maps them through measured axes.
    bone.rotation_quaternion = Matrix.Rotation(radians, 4, axis).to_quaternion()


def arm_target(axes, side, elevation, sweep=0.0):
    return (axes[side] * math.cos(elevation) + axes["up"] * math.sin(elevation) + axes["forward"] * sweep).normalized()


def aim_arm_pair(rig, axes, elevation_left, elevation_right, sweep_left=0.0, sweep_right=0.0):
    for side, elevation, sweep in (("L", elevation_left, sweep_left), ("R", elevation_right, sweep_right)):
        direction = arm_target(axes, "left" if side == "L" else "right", elevation, sweep)
        aim_bone(rig, "upper_arm." + side, direction)
        # Forearms inherit the raised upper arm and soften toward the torso.
        aim_bone(rig, "forearm." + side, (direction - axes["up"] * 0.12 + axes["forward"] * sweep * 0.25).normalized())


def pose_at_frame(rig, clip, frame, final_frame):
    reset_pose(rig)
    axes = anatomy_axes(rig)
    phase = (frame - 1) / max(final_frame - 1, 1) * math.tau
    stride = math.sin(phase)
    if clip == "Idle":
        aim_arm_pair(rig, axes, -0.72, -0.72, 0.03, 0.03)
        local_rotate(rig, "chest", (1, 0, 0), 0.025 * math.sin(phase))
    elif clip in ("Walk", "Run"):
        run = clip == "Run"
        amp = 0.32 if not run else 0.48
        aim_arm_pair(rig, axes, -0.68 + amp * stride, -0.68 - amp * stride, -0.22 * stride, 0.22 * stride)
        rig.pose.bones["pelvis"].location.z = (0.018 if not run else 0.032) * (0.5 + 0.5 * math.cos(phase * 2))
        for side, value in (("L", stride), ("R", -stride)):
            rig.pose.bones["thigh." + side].rotation_quaternion = Matrix.Rotation((0.52 if not run else 0.78) * value, 4, "X").to_quaternion()
            rig.pose.bones["shin." + side].rotation_quaternion = Matrix.Rotation(-(0.46 if not run else 0.72) * max(0, value), 4, "X").to_quaternion()
    elif clip == "Attack":
        t = (frame - 1) / max(final_frame - 1, 1)
        aim_arm_pair(rig, axes, -0.62, -0.25 + 1.15 * math.sin(math.pi * min(t, 1.0)), 0.02, -0.55 + 0.8 * t)
    elif clip == "Climb":
        left_reach = max(0, math.sin(phase))
        right_reach = max(0, math.sin(phase + math.pi))
        aim_arm_pair(rig, axes, -0.25 + 1.25 * left_reach, -0.25 + 1.25 * right_reach, -0.10, -0.10)
        rig.pose.bones["pelvis"].location.z = 0.035 * (0.5 + 0.5 * math.sin(phase))
    elif clip == "Glide":
        # Measured basis target: arms are lateral and 34 degrees above shoulder,
        # not an Euler-sign guess.  The validation below requires both raised.
        aim_arm_pair(rig, axes, 0.60, 0.60, -0.06, -0.06)
        rig.pose.bones["thigh.L"].rotation_quaternion = Matrix.Rotation(0.15, 4, "X").to_quaternion()
        rig.pose.bones["thigh.R"].rotation_quaternion = Matrix.Rotation(0.15, 4, "X").to_quaternion()
    else:
        raise RuntimeError("Unknown clip " + clip)


def key_pose(rig, frame):
    for bone in rig.pose.bones:
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)


def glide_axis_validation(rig, scene):
    action = bpy.data.actions["Glide"]
    rig.animation_data.action = action
    scene.frame_set(25)
    bpy.context.view_layer.update()
    axes = anatomy_axes(rig)
    values = {}
    for side, axis in (("L", axes["left"]), ("R", axes["right"])):
        direction = (rig.pose.bones["upper_arm." + side].matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
        values[side] = {"up_dot": round(direction.dot(axes["up"]), 4), "lateral_dot": round(direction.dot(axis), 4)}
    values["valid"] = all(value["up_dot"] > 0.35 and value["lateral_dot"] > 0.50 for key, value in values.items() if key in ("L", "R"))
    if not values["valid"]:
        raise RuntimeError("Glide arm axis validation failed: %s" % values)
    rig.animation_data.action = None
    reset_pose(rig)
    return {"anatomy_axes": {name: [round(value, 5) for value in vector] for name, vector in axes.items()}, "glide": values}


def make_review_camera_and_lights(body, scene):
    for obj in list(bpy.data.objects):
        if obj.name.startswith("V3Review"):
            bpy.data.objects.remove(obj, do_unlink=True)
    bbox = [body.matrix_world @ Vector(corner) for corner in body.bound_box]
    minimum = Vector((min(v.x for v in bbox), min(v.y for v in bbox), min(v.z for v in bbox)))
    maximum = Vector((max(v.x for v in bbox), max(v.y for v in bbox), max(v.z for v in bbox)))
    target = Vector(((minimum.x + maximum.x) * .5, (minimum.y + maximum.y) * .5, minimum.z + (maximum.z - minimum.z) * .53))
    camera = bpy.data.objects.new("V3ReviewCamera", bpy.data.cameras.new("V3ReviewCamera"))
    camera.data.lens = 58
    bpy.context.scene.collection.objects.link(camera)
    scene.camera = camera
    for name, location, energy, size in (("V3ReviewKey", (-3, -4, 5), 900, 4), ("V3ReviewFill", (3.5, -2.5, 2.8), 500, 3), ("V3ReviewRim", (1.5, 3.5, 4), 750, 2)):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        bpy.context.scene.collection.objects.link(light)
        light.data.energy, light.data.shape, light.data.size = energy, "DISK", size
        light.location = location
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 640, 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.055, 0.055, 0.055)
    return camera, target


def render_view(scene, camera, target, filename, direction, distance, clip, frame):
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = bpy.data.actions[clip]
    scene.frame_set(frame)
    camera.location = target + Vector(direction).normalized() * distance
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(RENDERS / filename)
    bpy.ops.render.render(write_still=True)
    return str(RENDERS / filename)


def render_review_set(scene, body):
    camera, target = make_review_camera_and_lights(body, scene)
    spec = {
        "front_idle": ("front-idle.png", (0, -1, 0), 4.2, "Idle", 31),
        "left_side_walk": ("left-side-walk.png", (-1, 0, 0), 4.2, "Walk", 9),
        "right_side_walk": ("right-side-walk.png", (1, 0, 0), 4.2, "Walk", 9),
        "back_run": ("back-run.png", (0, 1, 0), 4.2, "Run", 7),
        "dynamic_attack": ("dynamic-attack.png", (1, -1, .18), 4.5, "Attack", 19),
        "front_climb": ("front-climb.png", (0, -1, 0), 4.4, "Climb", 10),
        "dynamic_climb": ("dynamic-climb.png", (-1, -1, .12), 4.5, "Climb", 10),
        "front_glide": ("front-glide.png", (0, -1, 0), 4.5, "Glide", 25),
        "dynamic_glide": ("dynamic-glide.png", (1, -1, .20), 4.7, "Glide", 25),
    }
    renders = {name: render_view(scene, camera, target, *args) for name, args in spec.items()}
    missing = [path for path in renders.values() if not Path(path).is_file() or Path(path).stat().st_size == 0]
    if missing:
        raise RuntimeError("Review render did not produce files: %s" % missing)
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    rig.animation_data.action = None
    reset_pose(rig)
    scene.frame_set(1)
    return renders


def read_glb_json(path):
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise RuntimeError("Export is not a binary glTF: %s" % path)
    json_length, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A:
        raise RuntimeError("GLB has no JSON first chunk")
    return json.loads(data[20:20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))


def glb_pbr_snapshot(path):
    gltf = read_glb_json(path)
    textures = gltf.get("textures", [])
    refs, materials = set(), []
    for material in gltf.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {})
        slots = {
            "baseColor": pbr.get("baseColorTexture"),
            "metallicRoughness": pbr.get("metallicRoughnessTexture"),
            "normal": material.get("normalTexture"),
        }
        binding = {}
        for semantic, texture_ref in slots.items():
            if texture_ref is not None:
                texture_index = texture_ref["index"]
                image_index = textures[texture_index].get("source")
                binding[semantic] = {"texture": texture_index, "image": image_index}
                if image_index is not None:
                    refs.add(image_index)
        materials.append({"name": material.get("name"), "bindings": binding})
    return {"image_count_referenced_by_pbr": len(refs), "referenced_image_indices": sorted(refs), "materials": materials, "images_declared": len(gltf.get("images", []))}


def validate_hair_root(body, hair, scalp_vertex, rig, scene):
    tests = [("neutral", None, 1), ("idle", "Idle", 31), ("climb", "Climb", 10), ("glide", "Glide", 25)]
    values = []
    for label, action_name, frame in tests:
        rig.animation_data.action = bpy.data.actions.get(action_name) if action_name else None
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        scalp = body.evaluated_get(depsgraph).matrix_world @ body.evaluated_get(depsgraph).data.vertices[scalp_vertex].co
        evaluated_hair = hair.evaluated_get(depsgraph)
        root = evaluated_hair.matrix_world @ evaluated_hair.data.vertices[hair["root_vertex_index"]].co
        values.append({"pose": label, "distance": round((root - scalp).length, 6)})
    maximum = max(value["distance"] for value in values)
    valid = maximum <= 0.040
    if not valid:
        raise RuntimeError("Evaluated tied-hair root detached from scalp: %s" % values)
    rig.animation_data.action = None
    reset_pose(rig)
    return {"samples": values, "max_distance": maximum, "limit": 0.040, "valid": valid}


def export_and_roundtrip(body, rig, source_bindings):
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    hair = bpy.data.objects.get("TiedHairAttachment")
    if hair:
        hair.select_set(True)
    bpy.context.view_layer.objects.active = rig
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format="GLB", use_selection=True, export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_skins=True)
    glb_pbr = glb_pbr_snapshot(GLB)
    expected_count = len(pbr_image_set(source_bindings))
    source_semantics = sorted({semantic for binding in source_bindings.values() for semantic, images in binding.items() if images})
    glb_semantics = sorted({semantic for material in glb_pbr["materials"] for semantic in material["bindings"]})
    texture_check = {
        "source_referenced_pbr_images": pbr_image_set(source_bindings),
        "expected_source_referenced_pbr_image_count": expected_count,
        "actual_glb_referenced_pbr_image_count": glb_pbr["image_count_referenced_by_pbr"],
        "difference": glb_pbr["image_count_referenced_by_pbr"] - expected_count,
        "source_binding_semantics": source_semantics,
        "glb_binding_semantics": glb_semantics,
        "missing_glb_binding_semantics": sorted(set(source_semantics) - set(glb_semantics)),
        "source_bindings": source_bindings,
        "glb_bindings": glb_pbr,
    }
    RUN_DIAGNOSTICS["texture_validation_before_roundtrip"] = texture_check
    if texture_check["difference"] != 0 or texture_check["missing_glb_binding_semantics"]:
        raise RuntimeError("GLB PBR image mismatch before import: %s" % texture_check)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    imported_rigs = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    imported_hair = [obj for obj in bpy.data.objects if obj.name == "TiedHairAttachment"]
    return {"bytes": GLB.stat().st_size, "bones": sum(len(obj.data.bones) for obj in imported_rigs), "actions": sorted(action.name for action in bpy.data.actions), "tied_hair_attachment_count": len(imported_hair), "pbr": texture_check}


def main():
    ensure_dirs()
    if not SOURCE.exists():
        raise RuntimeError("Required immutable v1 source is missing: %s" % SOURCE)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    body, rig = find_body_and_rig()
    source_mesh = mesh_snapshot(body)
    source_bones = len(rig.data.bones)
    source_pbr = source_pbr_bindings(body)
    RUN_DIAGNOSTICS["source_pbr"] = source_pbr
    if source_mesh["uv_layers"] < 1 or not pbr_image_set(source_pbr):
        raise RuntimeError("v1 did not load UV and PBR-referenced images")
    v2.clear_prior_authored_animation(rig)  # retains the Blender 5 compatibility fix
    scalp_vertex, scalp_anchor, scalp_record = rear_scalp_anchor(body)
    add_hair_tie_bone(rig, scalp_anchor)
    weights = repair_garment_weights(body)
    hair = add_tied_hair(body, rig, scalp_anchor)
    # Retain the host-fixed Blender 5 layered-action fcurve path, but use v3's
    # local-axis pose/keying implementation.
    v2.reset_pose, v2.pose_at_frame, v2.key_pose = reset_pose, pose_at_frame, key_pose
    clips = v2.create_actions(rig, bpy.context.scene)
    glide_axes = glide_axis_validation(rig, bpy.context.scene)
    after_mesh = mesh_snapshot(body)
    if source_mesh != after_mesh:
        raise RuntimeError("Source topology/UV/material/PBR snapshot changed outside permitted weights")
    if len(rig.data.bones) != source_bones + 1 or hair.parent_bone != "hair_tie":
        raise RuntimeError("Tied-hair bone parenting was not created correctly")
    hair_attachment = validate_hair_root(body, hair, scalp_vertex, rig, bpy.context.scene)
    renders = render_review_set(bpy.context.scene, body)
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    roundtrip = export_and_roundtrip(body, rig, source_pbr)
    missing_clips = sorted(set(EXPECTED_CLIPS) - set(roundtrip["actions"]))
    validation = {
        "clip_names_match": not missing_clips,
        "missing_clips": missing_clips,
        "bone_count_match": roundtrip["bones"] == source_bones + 1,
        "texture_count_match": roundtrip["pbr"]["difference"] == 0 and not roundtrip["pbr"]["missing_glb_binding_semantics"],
        "tied_hair_attachment_survives": roundtrip["tied_hair_attachment_count"] == 1,
        "glide_axes_valid": glide_axes["glide"]["valid"],
        "hair_root_attachment_valid": hair_attachment["valid"],
        "arm_dominant_weights_unchanged": weights["arm_dominant_vertices_changed"] == 0,
    }
    if not all(value for key, value in validation.items() if key != "missing_clips"):
        raise RuntimeError("GLB roundtrip validation failed: %s" % validation)
    report = {
        "status": "passed_structural_review_required",
        "execution": "Written only by a host Blender execution; structural pass is not visual acceptance.",
        "source": {"path": str(SOURCE), "sha256": sha256(SOURCE), "mesh": source_mesh, "bones": source_bones, "pbr_image_count": len(pbr_image_set(source_pbr))},
        "v3": {"blend": str(BLEND), "glb": str(GLB), "mesh_preservation": after_mesh, "bones": source_bones + 1, "weight_repair": weights, "rear_scalp_anchor": scalp_record, "hair_root_attachment": hair_attachment, "anatomy_axis_validation": glide_axes, "clips": clips, "renders": renders},
        "roundtrip": roundtrip,
        "validation": validation,
        "outstanding_visual_review": ["Confirm no forearm/hand-to-waist stretch in both walk side views and dynamic glide.", "Confirm tapered tied-hair silhouette is connected in front/side/back review frames.", "Confirm climb and glide front renders visibly raise both arms; structural axis checks do not substitute visual sign-off.", "Do not integrate v3 or rejected v2 into the runtime asset path until this review is accepted."],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        ensure_dirs()
        failure = {"status": "failed", "source": str(SOURCE), "error_type": type(error).__name__, "error": str(error), "diagnostics": RUN_DIAGNOSTICS}
        REPORT.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        raise
