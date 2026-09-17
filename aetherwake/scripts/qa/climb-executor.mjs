/**
 * Shared R10 climb executor — same phase handling as short-loop.mjs.
 * Caller supplies page + telemetry reader. No yaw writes. maxY diagnostics only.
 */
import { decideClimbAction } from '../../src/game/climb-controller.ts';

/**
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {() => Promise<any>} opts.readTelemetry
 * @param {number} opts.activateY
 * @param {number} [opts.targetX]
 * @param {number} [opts.targetZ]
 * @param {number} [opts.maxIters]
 * @param {(tag: string, sample: any, extra?: object) => void} [opts.snap]
 * @param {number} [opts.hp0]
 */
export async function runClimbExecutor(opts) {
  const {
    page,
    readTelemetry,
    activateY,
    targetX = 10,
    targetZ = 68,
    targetTowerId = 'dawn',
    maxIters = 160,
    snap = () => {},
    hp0 = 3,
  } = opts;

  let maxY = -Infinity;
  let climbingSeen = false;
  let activated = false;
  let restElapsedMs = 0;
  let failure = null;
  const trace = [];

  const tapVisible = async (sel) => {
    const loc = page.locator(sel);
    if (!(await loc.isVisible().catch(() => false))) return false;
    await loc.tap({ timeout: 500 }).catch(() => {});
    return true;
  };
  const holdStick = async (dirY, ms) => {
    const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
    if (!stick) return;
    const cx = stick.x + stick.width / 2;
    const cy = stick.y + stick.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + dirY, { steps: 3 });
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };
  const steerToward = async (tx, tz, maxSteps = 8) => {
    for (let i = 0; i < maxSteps; i++) {
      const t = await readTelemetry(page);
      const desired = Math.atan2(-(tx - t.x), -(tz - t.z));
      let err = (desired - t.camYaw) % (Math.PI * 2);
      if (err > Math.PI) err -= Math.PI * 2;
      if (err < -Math.PI) err += Math.PI * 2;
      if (Math.abs(err) < 0.28) return true;
      const key = err > 0 ? 'ArrowLeft' : 'ArrowRight';
      await page.keyboard.down(key);
      await page.waitForTimeout(35);
      await page.keyboard.up(key);
    }
    return false;
  };

  for (let i = 0; i < maxIters; i++) {
    const t0 = await readTelemetry(page);
    maxY = Math.max(maxY, t0.y);
    if (t0.towers?.includes(targetTowerId)) {
      activated = true;
      break;
    }

    // Real support / nearest climb / prompt — never hardcode shaft-only
    const dec = decideClimbAction(
      {
        state: t0.state,
        mode: t0.mode,
        y: t0.y,
        stamina: t0.stamina,
        hp: t0.hp,
        nearestClimbId: t0.nearestClimb?.id ?? null,
        prompt: t0.prompt,
        towers: t0.towers,
        interactVisible: Boolean(t0.interactVisible),
      },
      { restElapsedMs, restRecovered: 85, restTimeoutMs: 8000, activateY, targetTowerId },
    );
    trace.push({ i, phase: dec.phase, y: t0.y, stam: t0.stamina, state: t0.state, support: t0.nearestClimb?.id ?? null });

    if (dec.phase === 'DEAD' || dec.phase === 'FAIL') {
      snap(dec.phase, t0, { reason: dec.reason, i });
      failure = { phase: dec.phase, reason: dec.reason, maxY, last: t0, trace };
      break;
    }
    if (dec.phase === 'REST') {
      restElapsedMs = 200;
      snap('enter-REST', t0, { reason: dec.reason, i });
      continue;
    }
    if (dec.phase === 'REST_WAIT') {
      await page.waitForTimeout(200);
      restElapsedMs += 200;
      continue;
    }
    if (restElapsedMs > 0 && t0.state === 'grounded' && t0.stamina >= 85) {
      restElapsedMs = 0;
      snap('leave-REST', t0, { i });
    }

    if (dec.phase === 'DESCEND') {
      await holdStick(40, 250);
      const td = await readTelemetry(page);
      snap('DESCEND', td, { reason: dec.reason, i });
      maxY = Math.max(maxY, td.y);
      continue;
    }

    if (dec.phase === 'ASCEND') {
      const stick = await page.locator('[data-touch-kind="stick"]').boundingBox();
      const cx = stick.x + stick.width / 2;
      const cy = stick.y + stick.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 52, { steps: 3 });
      let broke = false;
      for (let h = 0; h < 10; h++) {
        if (dec.tryClimb) await tapVisible('[data-touch-action="climb"]');
        await page.waitForTimeout(120);
        const th = await readTelemetry(page);
        maxY = Math.max(maxY, th.y);
        if (th.state === 'climbing') climbingSeen = true;
        if (th.towers?.includes(targetTowerId)) {
          activated = true;
          await page.mouse.up();
          break;
        }
        if (th.state === 'dead' || (th.hp !== undefined && th.hp <= 0)) {
          await page.mouse.up();
          failure = { phase: 'DEAD', reason: 'died during ascend', maxY, last: th, trace };
          break;
        }
        // Re-decide every short sample — do not keep climbing past low stam / rest
        const midDec = decideClimbAction(
          {
            state: th.state,
            mode: th.mode,
            y: th.y,
            stamina: th.stamina,
            hp: th.hp,
            nearestClimbId: th.nearestClimb?.id ?? null,
            prompt: th.prompt,
            towers: th.towers,
            interactVisible: Boolean(th.interactVisible),
          },
          { restElapsedMs, restRecovered: 85, restTimeoutMs: 8000, activateY, targetTowerId },
        );
        if (midDec.phase !== 'ASCEND') {
          broke = true;
          await page.mouse.up();
          snap('ASCEND-break', th, { i, next: midDec.phase, stam: th.stamina, state: th.state });
          break;
        }
      }
      if (!broke && !activated && !failure) await page.mouse.up();
      if (activated || failure) break;
      continue;
    }

    if (dec.phase === 'APPROACH') {
      await steerToward(targetX, targetZ, 8);
      await holdStick(-48, 200);
      if (dec.tryClimb) await tapVisible('[data-touch-action="climb"]');
      const ta = await readTelemetry(page);
      snap('APPROACH', ta, { i });
      maxY = Math.max(maxY, ta.y);
      if (ta.towers?.includes(targetTowerId)) {
        activated = true;
        break;
      }
      continue;
    }

    if (dec.phase === 'SUMMIT_INTERACT') {
      if (dec.tryInteract) await tapVisible('[data-touch-action="interact"]');
      const ti = await readTelemetry(page);
      snap('SUMMIT_INTERACT', ti, { i, reason: dec.reason });
      if (ti.towers?.includes(targetTowerId)) {
        activated = true;
        break;
      }
      continue;
    }
  }

  return { activated, climbingSeen, maxY, failure, trace };
}
