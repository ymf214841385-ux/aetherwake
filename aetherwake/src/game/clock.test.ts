import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClock, onVisibility, tickClock } from "./clock.ts";
import { enqueueCommand, resetInput, takeSimActions } from "./input.ts";
import { FIXED_DT } from "./params.ts";

describe("tickClock", () => {
  it("leaves commands queued when dt is below one step", () => {
    resetInput();
    enqueueCommand("jump");
    const clock = createClock();
    const calls: number[] = [];
    tickClock(clock, FIXED_DT * 0.4, () => calls.push(1));
    assert.equal(calls.length, 0);
    assert.equal(takeSimActions({ consumeCommands: true, consumeLook: false }).jump, true);
  });

  it("does not run steps while hidden", () => {
    resetInput();
    enqueueCommand("attack");
    const clock = createClock();
    onVisibility(clock, true);
    const calls: number[] = [];
    tickClock(clock, 1, () => calls.push(1));
    assert.equal(calls.length, 0);
  });
});
