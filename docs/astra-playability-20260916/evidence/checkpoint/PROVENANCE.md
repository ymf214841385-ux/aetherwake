# Checkpoint provenance — post-burst save

| 项 | 值 |
| --- | --- |
| 文件 | `docs/astra-playability-20260916/evidence/checkpoint/post-dawn.storage.json` |
| 来源 run | `headed/burst-seg4-231522`（PID 88822，已退出） |
| 写入时刻 | 该 run 成功后 `ctx.storageState()` |
| 内容 | **towers=[]**（本段 fresh，无 dawn）；**shrines=["burst"]**；**orbs=1**；player 近爆鸣祠门 (≈115.3, 10.8, 29.5) |
| 原 origin | `http://127.0.0.1:8103`（QA 端口随机会变；localStorage 按 origin 隔离） |
| 恢复方式 | 加载前把 origins[].origin 重写为**当前** server URL，**不改** save 字段 |
| 禁止 | 手工合并 dawn+burst；合成坐标/进度 |

## 独立结果（不得合并）

- **晨光塔激活 + 重载**：`short-loop-r10-224549`（另一上下文，含 dawn+chest）
- **爆鸣祠破墙/领取/重载**：`burst-seg4-231522`（本 checkpoint，无 dawn）

## 哈希

见提交时 `shasum post-dawn.storage.json`。
