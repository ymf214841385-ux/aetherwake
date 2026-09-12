/**
 * D4.1: only QA_FOCUS=citadel selects checkpoint restore + fightBoss.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { citadelResumePlan, v2MatchesSource } from "./citadel-resume.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CKPT =
  "docs/rebuild-evidence/runs/d31-play-routes-20260912-064544/storage-ckpt-tower-crown.json";

describe("D4.1 citadel-resume focus plan", () => {
  it("citadel focus with ckpt → resume-and-fightboss", () => {
    const p = citadelResumePlan({ focus: "citadel", ckptPath: CKPT });
    assert.equal(p.ok, true);
    assert.equal(p.mode, "citadel-resume");
    assert.equal(p.fightBoss, true);
    assert.equal(p.ckptPath, CKPT);
  });

  it("citadel focus without ckpt fails closed", () => {
    const p = citadelResumePlan({ focus: "citadel", ckptPath: null });
    assert.equal(p.ok, false);
    assert.match(p.reason, /QA_STORAGE_CHECKPOINT/);
  });

  it("other focuses do not select resume+fightBoss", () => {
    for (const focus of [null, "mere", "crown", "still", ""]) {
      const p = citadelResumePlan({ focus, ckptPath: CKPT });
      assert.equal(p.mode, "default-route", `focus=${focus}`);
      assert.equal(p.fightBoss, false);
      assert.equal(p.ok, true);
    }
  });

  it("designated ckpt v2 is sealed crown-top (source integrity)", () => {
    const raw = readFileSync(resolve(ROOT, CKPT), "utf8");
    const env = JSON.parse(JSON.parse(raw).v2);
    assert.deepEqual(env.progress.towers, ["dawn", "mere", "crown"]);
    assert.deepEqual(
      [...env.progress.shrines].sort(),
      ["burst", "pull", "rime", "still"],
    );
    assert.equal(env.progress.orbs, 4);
    assert.equal(env.progress.bossDead, false);
    assert.ok(Math.abs(env.player.x - 44.617) < 0.05);
    assert.ok(Math.abs(env.player.y - 53.46) < 0.05);
    assert.ok(Math.abs(env.player.z - -124.514) < 0.05);
    assert.ok(Math.abs(env.player.hp - 2.5) < 0.01);
  });

  it("v2MatchesSource requires exact string equality (no rewrite)", () => {
    const a = JSON.stringify({ hello: "world" });
    assert.equal(v2MatchesSource(a, a), true);
    assert.equal(v2MatchesSource(a, a + " "), false);
    assert.equal(v2MatchesSource(a, null), false);
  });
});
