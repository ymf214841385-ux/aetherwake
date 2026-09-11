#!/usr/bin/env node
// Deterministic package from the committed source tree, never local caches.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
mkdirSync(resolve(root, "packed"), { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const report = execFileSync("python3", ["-c", `
import subprocess,zipfile,json,hashlib
from pathlib import Path
root=Path.cwd()
names=subprocess.check_output(['git','ls-tree','-r','--name-only','-z','HEAD']).decode().split(chr(0))
selected=[]
for name in sorted(n for n in names if n):
 p=Path(name)
 if name.startswith('packed/') and name != 'packed/README.md':continue
 if any(x in p.parts for x in ['unlicensed-hold','node_modules','.grok','.git','.vercel','.output','dist','.cache','.nitro','.tanstack','__pycache__']):continue
 if p.name.startswith('.env') or p.suffix in ['.log','.webm','.db','.sqlite','.pem'] or 'storage-ckpt' in name or 'browser-save-snapshot' in name:continue
 selected.append(name)
out=root/'packed/aetherwake.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in selected:
  data=subprocess.check_output(['git','show','HEAD:'+name])
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  z.writestr(info,data)
print(json.dumps({'files':len(selected),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
`], { cwd: root, encoding: "utf8" });
const meta = { sourceCommit: head, zip: "packed/aetherwake.zip", deterministic: true, ...JSON.parse(report) };
writeFileSync(resolve(root, "packed/aetherwake.zip.meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta, null, 2));
