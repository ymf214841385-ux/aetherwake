# 资源缺口

本轮不购买资源，也不使用未授权第三方热链。

| 资源 | 现状 | 预期 | 受阻验收 |
|---|---|---|---|
| 主角 GLB/glTF | 原创 PBR 层级骨骼（成人约 1.78 m、连续颅骨、五指、分层旅人服装、发片、开合滑翔翼）+ 全 AnimState。隔离 FRONT/SIDE/BACK + 六动作帧见 `docs/rebuild-evidence/character/`。无第三方可再分发写实冒险者 GLB | 可本地加载的统一轴向 GLB，含待机/走/跑/跳/落/攀/翻越/滑翔/攻击/受击/死亡/游泳/瞄准 | T15 最终美术待用户认可；已不是球头圆柱，仍非扫描/LBS GLB；发帽/腰缝/靴底仍偏程序拼装 |
| 角色贴图 | 程序 PBR 画布贴图（布纹、皮革、皮肤斑驳、虹膜、发片 alpha）；仅浏览器 `document` 下生成；MeshStandardMaterial | 手绘低饱和 UV 套与布料细节 | T24 质感；无手绘贴图包 |
| 环境贴图 / 植被 | Poly Haven CC0 1k 已在 `public/assets/environment/`。模块有 splat/水/六块岩石/阔叶松/草丛。Scene 仍用圆柱球树、圆锥草、单块岩石、无 envmap | 局内远近景见 INTEGRATION.md 接线后的六机位 | T24 场景；`CAPTURE_REQUEST.md` 待 Lead 重拍 |
| 动作捕捉 | 无；控制器驱动、原地动画 | 可选 mocap，非必须 | 无 |
| 授权音乐 | 程序音垫 | 若引入外部曲库需署名 | T 音频听验仍用程序音 |
| 真机截图 | 无真实手机 | iPhone Safari / Android Chrome | T09 T10 T21 T26 |

禁止把本文件当作“最终美术已完成”的证明。
