import bpy,json
from pathlib import Path
p=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(p/'wanderer-textured-rig-v1.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
 if o.type in {'ARMATURE','MESH'}:o.select_set(True)
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(p/'wanderer-textured-rig-v1.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_skins=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(p/'wanderer-textured-rig-v1.glb'))
report={'bytes':(p/'wanderer-textured-rig-v1.glb').stat().st_size,'bones':sum(len(o.data.bones) for o in bpy.data.objects if o.type=='ARMATURE'),'actions':[a.name for a in bpy.data.actions],'images':[{'size':list(i.size),'packed':bool(i.packed_file)} for i in bpy.data.images]}
assert report['bones']==19
assert len(report['actions'])>=3
assert len(report['images'])>=3
(p/'export-roundtrip-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
