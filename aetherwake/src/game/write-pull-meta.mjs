/**
 * Checkpoint provenance updates for pull-enter (NOT claim).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..", "..");
const file = resolve(repo, "docs/astra-playability-20260916/evidence/checkpoint/post-pull-complete.storage.json");
const raw = readFileSync(file);
const sha = createHash("sha256").update(raw).digest("hex");
const state = JSON.parse(raw.toString());
const save = state.origins?.[0]?.localStorage?.find((/** @type {{name?: string}} */ x) => x.name?.includes("save"));
let progress = null;
if (save) {
  const j = JSON.parse(save.value);
  progress = {
    shrines: j.progress?.shrines,
    orbs: j.progress?.orbs,
    towers: j.progress?.towers,
    player: { x: j.player?.x, y: j.player?.y, z: j.player?.z },
  };
}
const meta = {
  file: "post-pull-complete.storage.json",
  sha256: sha,
  sourceRun: "pull-enter-014358",
  sourceCommit: "7780856",
  // Honest: enter only — pull NOT claimed, orbs still 2
  claimed: false,
  progress,
  note: "Natural enter-pull storageState. Name is historical; NOT a pull claim. Do not merge progress.",
};
writeFileSync(file.replace(".storage.json", ".meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta, null, 2));
