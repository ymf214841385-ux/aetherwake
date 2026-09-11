# Release zip audit (Worker 3)

`aetherwake/scripts/pack-release.mjs` is **owned by Lead** — this file only recommends excludes. Not edited here.

## What the packer does today

Command (from `pack-release.mjs`):

```
zip -r packed/aetherwake.zip aetherwake README.md packed/README.md docs
  -x 'aetherwake/node_modules/*'
  -x 'aetherwake/.vercel/*'
  -x 'aetherwake/.output/*'
  -x 'aetherwake/dist/*'
  -x 'aetherwake/.tanstack/*'
  -x '*.log'
  -x '**/.DS_Store'
  -x '**/.env'
  -x '**/.env.*'
  -x '**/*.db'
  -x '**/*.db-wal'
  -x '**/*.db-shm'
  -x '**/pglite-debug.json'
  -x 'aetherwake/.cache/*'
```

Writes `packed/aetherwake.zip` + `packed/aetherwake.zip.meta.json` (HEAD, dirty flag).

## Already excluded (good)

- `node_modules`, Vite/Nitro `dist` + `.output`, `.vercel`, `.tanstack`, `.cache`
- `.env` / `.env.*`
- `*.db` / wal / shm
- `pglite-debug.json`
- `*.log`, `.DS_Store`

PGLite in this app is **in-memory** (`new PGlite({ parsers })` in `src/lib/db.ts`) — no on-disk dataDir today. The `*.db` excludes still matter if a future dataDir is added.

## Recommended additional excludes (Lead)

| Pattern | Why |
|---|---|
| `docs/rebuild-evidence/*.webm` | Playwright route videos; currently 8× `page@*.webm`, large debug recordings, not a player-facing release. |
| `docs/rebuild-evidence/page@*.webm` | Same, explicit. |
| `**/*.webm` | Catch videos anywhere. |
| `aetherwake/.grok/*` | Preview pid/log, `qa-preview.json`, `app-env.json` (build flags). Not source. |
| `**/.grok/*` | Same at repo root if present. |
| `**/test-results/**`, `**/playwright-report/**` | If anyone runs Playwright’s default reporters. |
| `**/*credential*` `**/*secret*` `**/*.pem` `**/*.p12` | Belt-and-suspenders; `.env` already covered. |
| `aetherwake/.output/*` | Already present; keep. |
| `**/idb*` `**/*pglite*` | If a dataDir or IndexedDB dump appears later. |

Keep `docs/rebuild-evidence/*.png` and `*.json` if the zip is meant to carry acceptance evidence; drop the webms either way.

## Do not add to the zip

- Live `DATABASE_URL` or Neon connection strings
- `node_modules`
- Compiled `.output` / `dist` (recipients run `npm install` + `npm run build:app` or `npm run dev`)

`packed/README.md` already tells recipients **not** to run `npm run build` (that path still migrates DB). `build:app` is the no-migrate compile.
