"""Bounded, read-only host diagnostic for the v4 face seams and Idle arms.

This opens the immutable pre-reduction source and v4 separately. It writes only
comparison PNGs and JSON to the requested output directory; it never saves a
blend, exports a GLB, changes source UVs, welds geometry, or alters image data.
Plain renders use a temporary smooth duplicate with no image nodes or normal map.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_V4 = ROOT / "docs/art-direction/asset-v4/wanderer-textured-rig-v4.blend"
DEFAULT_SOURCE = ROOT.parent / "asset-pipeline/wanderer-lite-textured-source.blend"


def arguments():
    tail = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--v4", type=Path, default=DEFAULT_V4)
    parser.add_argument("--out", type=Path, default=ROOT / "docs/art-direction/asset-v4/host-diagnostics/r5-bounded")
    return parser.parse_args(tail)


def find_body_and_rig(require_rig=True):
    body = bpy.data.objects.get("WandererTexturedBody") or next((obj for obj in bpy.data.objects if obj.type == "MESH"), None)
    rig = next((obj for obj in bpy.data.objects if obj.type == "ARMATURE"), None)
    if body is None or (require_rig and rig is None):
        raise RuntimeError("Expected character mesh" + (" and armature" if require_rig else ""))
    return body, rig


def mesh_bounds(obj):
    world = [obj.matrix_world @ Vector(point) for point in obj.bound_box]
    return Vector((min(p.x for p in world), min(p.y for p in world), min(p.z for p in world))), Vector((max(p.x for p in world), max(p.y for p in world), max(p.z for p in world)))


def configure_scene(out):
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    out.mkdir(parents=True, exist_ok=True)
    return scene


def clear_diagnostics():
    for obj in list(bpy.data.objects):
        if obj.name.startswith("V4BoundedDiagnostic"):
            bpy.data.objects.remove(obj, do_unlink=True)


def camera_at(scene, target, direction, distance, lens=65):
    camera = bpy.data.objects.new("V4BoundedDiagnosticCamera", bpy.data.cameras.new("V4BoundedDiagnosticCamera"))
    bpy.context.collection.objects.link(camera)
    camera.data.lens = lens
    camera.location = target + direction.normalized() * distance
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera


def render(scene, out, label):
    path = out / (label + ".png")
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return str(path)


def set_rest(rig):
    if rig.animation_data:
        rig.animation_data.action = None
        for track in rig.animation_data.nla_tracks:
            track.mute = True
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.location = (0, 0, 0)
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def set_idle(rig):
    action = bpy.data.actions.get("Idle")
    if action is None:
        raise RuntimeError("v4 has no Idle action")
    rig.animation_data_create()
    rig.animation_data.action = action
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    bpy.context.scene.frame_set(31)
    bpy.context.view_layer.update()


def face_target(body, rig=None):
    low, high = mesh_bounds(body)
    if rig and rig.pose.bones.get("head"):
        return rig.matrix_world @ rig.pose.bones["head"].head
    return Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z + (high.z - low.z) * .84))


def plain_duplicate(body):
    duplicate = body.copy()
    duplicate.data = body.data.copy()
    duplicate.name = "V4BoundedDiagnosticPlainMesh"
    bpy.context.collection.objects.link(duplicate)
    for polygon in duplicate.data.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new("V4BoundedDiagnosticPlainMaterial")
    material.use_nodes = False
    material.diffuse_color = (.58, .58, .58, 1)
    duplicate.data.materials.clear()
    duplicate.data.materials.append(material)
    duplicate.parent = None
    duplicate.matrix_world = body.matrix_world.copy()
    body.hide_render = True
    return duplicate


def face_render(body, rig, scene, out, label, pose, plain=False):
    (set_rest if pose == "rest" else set_idle)(rig)
    clear_diagnostics()
    target_body = plain_duplicate(body) if plain else body
    camera_at(scene, face_target(target_body, rig), Vector((0, -1, 0)), .92, 75)
    try:
        return render(scene, out, label)
    finally:
        if plain:
            body.hide_render = False
            bpy.data.objects.remove(target_body, do_unlink=True)


def arm_side_renders(body, rig, scene, out, pose):
    (set_rest if pose == "rest" else set_idle)(rig)
    low, high = mesh_bounds(body)
    target = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z + (high.z - low.z) * .57))
    result = {}
    for name, direction in (("left", Vector((1, 0, 0))), ("right", Vector((-1, 0, 0)))):
        clear_diagnostics()
        camera_at(scene, target, direction, 3.35, 58)
        result[name] = render(scene, out, "arms-%s-%s" % (pose, name))
    return result


def region_for(co, low, high):
    ratio = (co.z - low.z) / max(high.z - low.z, 1e-9)
    return "head" if ratio >= .76 else "neck" if ratio >= .65 else "other"


def angle_degrees(first, second):
    return math.degrees(math.acos(max(-1.0, min(1.0, first.normalized().dot(second.normalized())))))


def topology_report(body):
    """Audit the reduced mesh without changing UV splits, normals, or vertices."""
    mesh = body.data
    low, high = mesh_bounds(body)
    edges, positions, loop_data = Counter(), defaultdict(list), defaultdict(list)
    for polygon in mesh.polygons:
        vertices = polygon.vertices[:]
        for first, second in zip(vertices, vertices[1:] + vertices[:1]):
            edges[tuple(sorted((first, second)))] += 1
    uv_layer = mesh.uv_layers.active
    for vertex in mesh.vertices:
        positions[tuple(round(value, 6) for value in vertex.co)].append(vertex.index)
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            loop = mesh.loops[loop_index]
            loop_data[loop.vertex_index].append((Vector(loop.normal), tuple(round(value, 6) for value in uv_layer.data[loop_index].uv) if uv_layer else None))
    regions = {name: {"boundary_edges": 0, "nonmanifold_edges": 0, "coincident_groups": 0, "coincident_vertices": 0, "uv_discontinuous_groups": 0, "split_normal_groups": 0, "max_normal_angle_degrees": 0.0, "examples": []} for name in ("head", "neck", "other")}
    for edge, uses in edges.items():
        region = region_for(body.matrix_world @ mesh.vertices[edge[0]].co, low, high)
        if uses == 1:
            regions[region]["boundary_edges"] += 1
        if uses > 2:
            regions[region]["nonmanifold_edges"] += 1
    for position, indices in positions.items():
        if len(indices) < 2:
            continue
        region = region_for(body.matrix_world @ mesh.vertices[indices[0]].co, low, high)
        result = regions[region]
        result["coincident_groups"] += 1
        result["coincident_vertices"] += len(indices)
        uvs = {uv for index in indices for _, uv in loop_data[index]}
        normals = [normal for index in indices for normal, _ in loop_data[index]]
        maximum = max((angle_degrees(first, second) for index, first in enumerate(normals) for second in normals[index + 1 :]), default=0.0)
        uv_split, normal_split = len(uvs) > 1, maximum > 1.0
        result["uv_discontinuous_groups"] += int(uv_split)
        result["split_normal_groups"] += int(normal_split)
        result["max_normal_angle_degrees"] = max(result["max_normal_angle_degrees"], maximum)
        if (uv_split or normal_split) and len(result["examples"]) < 16:
            result["examples"].append({"position": [round(value, 6) for value in position], "vertex_indices": indices, "uv_count": len(uvs), "max_normal_angle_degrees": round(maximum, 4)})
    for result in regions.values():
        result["max_normal_angle_degrees"] = round(result["max_normal_angle_degrees"], 4)
    return {"vertices": len(mesh.vertices), "polygons": len(mesh.polygons), "uv_layers": len(mesh.uv_layers), "regions": regions}


def arm_orientation_report(rig):
    """Derive arm-down orientation from rest bones, then compare Idle frame 31."""
    set_rest(rig)
    chest, pelvis = rig.data.bones.get("chest"), rig.data.bones.get("pelvis")
    if chest is None or pelvis is None:
        raise RuntimeError("Missing chest/pelvis bones")
    up = (chest.tail_local - pelvis.head_local).normalized()
    left = (rig.data.bones["upper_arm.L"].head_local - rig.data.bones["upper_arm.R"].head_local).normalized()
    forward = left.cross(up).normalized()
    if forward.dot(Vector((0, -1, 0))) < 0:
        forward.negate()
    def measure(idle):
        values = {}
        for side in ("L", "R"):
            bone = rig.pose.bones["upper_arm." + side] if idle else rig.data.bones["upper_arm." + side]
            direction = (bone.tail - bone.head).normalized() if idle else (bone.tail_local - bone.head_local).normalized()
            lateral = left if side == "L" else -left
            values[side] = {"up_dot": round(direction.dot(up), 5), "down_dot": round(direction.dot(-up), 5), "lateral_dot": round(direction.dot(lateral), 5), "forward_dot": round(direction.dot(forward), 5)}
        return values
    rest = measure(False)
    set_idle(rig)
    return {"rest_bone_orientation": rest, "idle_frame_31_orientation": measure(True), "review_rule": "Use the measured rest_bone_orientation as arm-down reference and review both left/right renders before altering Idle. Higher positive down_dot means a more downward-hanging arm."}


def source_diagnostic(source, out):
    bpy.ops.wm.open_mainfile(filepath=str(source))
    body, _ = find_body_and_rig(False)
    scene = configure_scene(out)
    clear_diagnostics()
    camera_at(scene, face_target(body), Vector((0, -1, 0)), .92, 75)
    return {"mesh": {"vertices": len(body.data.vertices), "polygons": len(body.data.polygons), "uv_layers": len(body.data.uv_layers)}, "topology": topology_report(body), "render": render(scene, out, "source-before-decimation-rest-pbr")}


def v4_diagnostic(v4, out):
    bpy.ops.wm.open_mainfile(filepath=str(v4))
    body, rig = find_body_and_rig()
    scene = configure_scene(out)
    return {"mesh": {"vertices": len(body.data.vertices), "polygons": len(body.data.polygons), "uv_layers": len(body.data.uv_layers)}, "topology": topology_report(body), "arm_orientation": arm_orientation_report(rig), "renders": {"v4_rest_pbr": face_render(body, rig, scene, out, "v4-rest-pbr", "rest"), "v4_idle_pbr": face_render(body, rig, scene, out, "v4-idle-pbr", "idle"), "v4_rest_plain_smooth": face_render(body, rig, scene, out, "v4-rest-plain-smooth", "rest", True), "v4_idle_plain_smooth": face_render(body, rig, scene, out, "v4-idle-plain-smooth", "idle", True), "arms_rest": arm_side_renders(body, rig, scene, out, "rest"), "arms_idle": arm_side_renders(body, rig, scene, out, "idle")}}


def main():
    args = arguments()
    source, v4, out = args.source.resolve(), args.v4.resolve(), args.out.resolve()
    if not source.is_file() or not v4.is_file():
        raise RuntimeError("Required input missing: source=%s v4=%s" % (source, v4))
    out.mkdir(parents=True, exist_ok=True)
    report = {"status": "diagnostic_only_not_an_acceptance_or_asset_edit", "inputs": {"source_before_decimation": str(source), "v4": str(v4)}, "output_directory": str(out), "source_before_decimation": source_diagnostic(source, out), "v4": v4_diagnostic(v4, out), "interpretation": ["The plain-smooth renders use exactly one temporary node-free material; no image texture or normal-map node participates.", "Do not attribute a seam to decimation from one render: compare source-before-decimation-rest-pbr, v4-rest-pbr, v4-idle-pbr, plain-smooth rest/Idle, and topology counts.", "If evidence shows new v4 head seam cracks, a separate candidate must preserve UV loop discontinuities while welding only coincident positions before reduction, or protect the head from reduction; validate unchanged materials and skin groups after export.", "Do not weld UVs blindly and do not edit source images."]}
    report_path = out / "v4-bounded-face-idle-diagnostic.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
