# Source package

Run `node aetherwake/scripts/pack-release.mjs` from a committed source tree. The generated ZIP and manifest are local ignored outputs; they are published as GitHub Release assets, not committed repeatedly.

Download: https://github.com/ymf214841385-ux/aetherwake/releases/tag/playtest-20260917

The manifest records the exact source commit, file count, size and SHA-256. Extract, then `cd aetherwake`, install dependencies, and run `npm run dev`. Safe build: `npm run build:app`. This package contains source/assets/evidence; it is not a hosted game.

Known issues: docs/CHECKPOINT_2026-09-17.md.
