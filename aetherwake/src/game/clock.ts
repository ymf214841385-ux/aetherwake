import type { Actions } from "./input.ts";
import { takeSimActions } from "./input.ts";
import { FIXED_DT, MAX_SIM_STEPS } from "./params.ts";

export type ClockState = {
  acc: number;
  overflow: number;
  paused: boolean;
  hidden: boolean;
};

export function createClock(): ClockState {
  return { acc: 0, overflow: 0, paused: false, hidden: false };
}

export function pauseClock(clock: ClockState) {
  clock.paused = true;
  clock.acc = 0;
}

export function resumeClock(clock: ClockState) {
  clock.paused = false;
  clock.acc = 0;
}

export function onVisibility(clock: ClockState, hidden: boolean) {
  clock.hidden = hidden;
  if (hidden) {
    clock.acc = 0;
  }
}

/** Advance a fixed-step simulation. One-shot commands and look apply only on the first step of this frame. */
export function tickClock(
  clock: ClockState,
  dt: number,
  step: (fixed: number, actions: Actions) => void,
): { steps: number; overflowed: boolean } {
  if (clock.paused || clock.hidden) {
    clock.acc = 0;
    return { steps: 0, overflowed: false };
  }
  clock.acc += Math.min(Math.max(dt, 0), 0.1);
  let steps = 0;
  let first = true;
  while (clock.acc >= FIXED_DT && steps < MAX_SIM_STEPS) {
    const actions = takeSimActions({ consumeCommands: first, consumeLook: first });
    step(FIXED_DT, actions);
    clock.acc -= FIXED_DT;
    steps += 1;
    first = false;
  }
  let overflowed = false;
  if (steps >= MAX_SIM_STEPS && clock.acc >= FIXED_DT) {
    clock.overflow += 1;
    clock.acc = 0;
    overflowed = true;
  }
  return { steps, overflowed };
}
