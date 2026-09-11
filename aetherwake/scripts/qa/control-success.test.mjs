import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { controlFailureReason, isControlSuccess } from "./control-success.mjs";

describe("lifecycle-control success predicate (Review07)", () => {
  it("arrived + closed page is NOT success (was false-positive ok:true)", () => {
    const r = isControlSuccess({
      arrived: true,
      completedBudget: false,
      survivedBudget: false,
      lifecycle: {
        pageClosed: true,
        events: [{ type: "page-close", intentional: false }],
        order: "page-close",
      },
      errorMessage: "page.evaluate: Target page, context or browser has been closed",
    });
    assert.equal(r, false);
    assert.match(controlFailureReason({
      arrived: true,
      completedBudget: false,
      survivedBudget: false,
      lifecycle: { pageClosed: true, events: [{ type: "page-close", intentional: false }], order: "page-close" },
      errorMessage: "closed",
    }), /error:|unintentional-close/);
  });

  it("arrived + full budget + no close is success", () => {
    const r = isControlSuccess({
      arrived: true,
      completedBudget: true,
      survivedBudget: true,
      lifecycle: { pageClosed: false, crashed: false, browserDisconnected: false, events: [] },
      errorMessage: null,
    });
    assert.equal(r, true);
    assert.equal(controlFailureReason({
      arrived: true,
      completedBudget: true,
      survivedBudget: true,
      lifecycle: { events: [] },
    }), "ok");
  });

  it("arrived but intentional-only teardown still requires full budget", () => {
    const r = isControlSuccess({
      arrived: true,
      completedBudget: false,
      survivedBudget: false,
      lifecycle: { pageClosed: true, events: [{ type: "page-close", intentional: true }], intentionalTeardown: true },
      errorMessage: null,
    });
    assert.equal(r, false);
  });

  it("arrived + full budget but crash is not success", () => {
    const r = isControlSuccess({
      arrived: true,
      completedBudget: true,
      survivedBudget: true,
      lifecycle: { crashed: true, events: [{ type: "page-crash", intentional: false }] },
      errorMessage: null,
    });
    assert.equal(r, false);
  });
});
