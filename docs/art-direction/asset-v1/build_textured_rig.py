"""Preserve source UV and PBR; create a separate reduced, weighted motion prototype."""
import bpy, json, math
from pathlib import Path
from mathutils import Vector, kdtree
p=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(p/'wanderer-lite-textured-source.blend'))
obj=next(o for o in bpy.data.objects if o.type=='MESH')
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
lo=min(v.co.z for v in obj.data.vertices)
for v in obj.data.vertices:v.co.z-=lo
obj.name='WandererTexturedBody'
before=len(obj.data.polygons)
mod=obj.modifiers.new('UV-preserving reduction','DECIMATE');mod.ratio=.34
bpy.ops.object.modifier_apply(modifier=mod.name)
with bpy.data.libraries.load(str(p/'wanderer-rig-refined.blend'),link=False) as (src,dst):
 dst.objects=src.objects
loaded=[o for o in dst.objects if o]
rig=next(o for o in loaded if o.type=='ARMATURE')
donor=next(o for o in loaded if o.type=='MESH')
bpy.context.scene.collection.objects.link(rig)
kd=kdtree.KDTree(len(donor.data.vertices))
for v in donor.data.vertices:kd.insert(donor.matrix_world@v.co,v.index)
kd.balance()
for g in donor.vertex_groups:obj.vertex_groups.new(name=g.name)
distances=[]
for v in obj.data.vertices:
 co,idx,dist=kd.find(obj.matrix_world@v.co);distances.append(dist)
 groups=sorted(donor.data.vertices[idx].groups,key=lambda x:x.weight,reverse=True)[:4]
 total=sum(g.weight for g in groups)
 for g in groups:
  if total>0:obj.vertex_groups[g.group].add([v.index],g.weight/total,'REPLACE')
obj.parent=rig
mod=obj.modifiers.new('Wanderer deformation','ARMATURE');mod.object=rig
for o in loaded:
 if o!=rig:bpy.data.objects.remove(o,do_unlink=True)
for pb in rig.pose.bones:pb.rotation_mode='XYZ';pb.rotation_euler=(0,0,0)
scene=bpy.context.scene;scene.render.fps=30;scene.frame_start=1
height=max(v.co.z for v in obj.data.vertices)
center=Vector((0,0,height/2));cam=scene.camera
report={'triangles_before':before,'triangles_after':len(obj.data.polygons),'uv_layers':len(obj.data.uv_layers),'bones':len(rig.data.bones),'nearest_weight_distance_max':max(distances),'nearest_weight_distance_mean':sum(distances)/len(distances),'unweighted':sum(not v.groups for v in obj.data.vertices),'clips':[],'status':'motion prototype requiring visual review; not accepted for release'}
assert report['unweighted']==0
assert report['nearest_weight_distance_max']<.08,report
def setpose(f,kind,n):
 phase=2*math.pi*(f-1)/(n-1)
 for b in rig.pose.bones:b.rotation_euler=(0,0,0);b.location=(0,0,0)
 if kind=='Idle':
  rig.pose.bones['chest'].rotation_euler.x=.012*math.sin(phase)
 else:
  amp=.42 if kind=='Walk' else .68
  for side,offset in [('L',0),('R',math.pi)]:
   a=phase+offset;thigh=amp*math.sin(a);knee=-max(0,math.sin(a))*(.6 if kind=='Walk' else 1.0)
   rig.pose.bones['thigh.'+side].rotation_euler.x=thigh
   rig.pose.bones['shin.'+side].rotation_euler.x=knee
   rig.pose.bones['foot.'+side].rotation_euler.x=-thigh-knee
   rig.pose.bones['upper_arm.'+side].rotation_euler.x=-thigh*.65
   rig.pose.bones['forearm.'+side].rotation_euler.x=.12 if kind=='Walk' else .45
 for b in rig.pose.bones:
  b.keyframe_insert(data_path='rotation_euler',frame=f,group=b.name)
  b.keyframe_insert(data_path='location',frame=f,group=b.name)
for kind,n in [('Idle',61),('Walk',31),('Run',23)]:
 rig.animation_data_create();rig.animation_data.action=bpy.data.actions.new(kind)
 for f in range(1,n+1):setpose(f,kind,n)
 action=rig.animation_data.action;action.use_fake_user=True
 report['clips'].append({'name':kind,'frames':n,'seconds':(n-1)/30,'looping':True})
 scene.frame_end=n;scene.frame_set(1+n//4)
 for view,direction in [('front',(0,-1,0)),('side',(1,0,0))]:
  cam.location=center+Vector(direction)*4;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
  scene.render.filepath=str(p/('textured-'+kind.lower()+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
 rig.animation_data.action=None
 track=rig.animation_data.nla_tracks.new();track.name=kind;strip=track.strips.new(kind,1,action);track.mute=True
for b in rig.pose.bones:b.rotation_euler=(0,0,0);b.location=(0,0,0)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(p/'wanderer-textured-rig-v1.blend'))
(p/'textured-rig-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
