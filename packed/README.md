# Source package

Run `node aetherwake/scripts/pack-release.mjs` from a committed source tree. The ZIP uses sorted committed paths, fixed ZIP timestamps and excludes local recordings, caches, credentials and databases. The metadata records the source commit and archive SHA-256. A later packaging commit contains that archive.

Extract, then `cd aetherwake`, `npm ci`, `npm run dev`. Safe build: `npm run build:app`; do not use the migration-running `build` for verification.

This is a development checkpoint. See docs/CHECKPOINT_2026-09-11.md and docs/RELEASE_VALIDATION.md for known unfinished work and test failures.
