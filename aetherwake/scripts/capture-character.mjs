#!/usr/bin/env node
/**
 * Isolated character captures (not the full game, not Scene.tsx).
 * Method: Vite MPA on 127.0.0.1:8765 + Playwright Chromium WebGLRenderer.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "..");
// Keep production evidence immutable by default; visual iterations can set an
// explicit in-repository folder (for example docs/rebuild-evidence/terra-visual).
const outDir = resolve(process.env.AW_CAPTURE_OUT_DIR || resolve(repoRoot, "docs/rebuild-evidence/character"));

const SHOTS = [
  { file: "front.png", view: "front", state: "idle", label: "FRONT" },
  { file: "side.png", view: "side", state: "idle", label: "SIDE" },
  { file: "back.png", view: "back", state: "idle", label: "BACK" },
  { file: "face.png", view: "face", state: "idle", label: "FACE" },
  { file: "motion-idle.png", view: "motion", state: "idle", label: "IDLE" },
  { file: "motion-walk.png", view: "motion", state: "walk", label: "WALK" },
  { file: "motion-run.png", view: "motion", state: "run", label: "RUN" },
  { file: "motion-climb.png", view: "motion", state: "climb", label: "CLIMB" },
  { file: "motion-glide.png", view: "motion", state: "glide", label: "GLIDE" },
  { file: "motion-attack.png", view: "motion", state: "attack", label: "ATTACK" },
];

export async function runCapture({ only } = {}) {
  mkdirSync(outDir, { recursive: true });
  const port = Number(process.env.AW_CAPTURE_PORT || 8788);
  if (port === 8080 || port === 8091) {
    throw new Error("capture must not bind 8080/8091");
  }

  const server = await createServer({
    configFile: false,
    root: appRoot,
    appType: "mpa",
    publicDir: "public",
    // node_modules is deliberately a shared symlink in this visual worktree.
    // Never let Vite's optimizer mutate its default node_modules/.vite cache.
    cacheDir: resolve(repoRoot, ".vite-terra-capture"),
    server: { port, host: "127.0.0.1", strictPort: true },
    plugins: [],
    optimizeDeps: { include: ["three"] },
  });
  await server.listen();

  const base = checkedUrl(`http://127.0.0.1:${port}/scripts/capture-character.html`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 960, height: 1280 } });
  const shots = only === "motion" ? SHOTS.filter((s) => s.view === "motion") : only === "still" ? SHOTS.filter((s) => s.view !== "motion") : SHOTS;
  const written = [];

  try {
    for (const shot of shots) {
      const url = `${base}?view=${shot.view}&state=${shot.state}&label=${encodeURIComponent(shot.label)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__AW_CAPTURE_READY === true, null, { timeout: 30000 });
      await page.waitForTimeout(120);
      const path = checkedOutputPath(resolve(outDir, shot.file), [outDir]);
      await page.screenshot({ path, type: "png" });
      written.push(path);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const summary = { ok: true, method: "vite-mpa+playwright-webgl", port, written };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  runCapture().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }, null, 2));
    process.exit(1);
  });
}
