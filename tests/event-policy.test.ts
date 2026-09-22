import assert from "node:assert/strict";
import test from "node:test";
import { boundsDiffer, NativeReflowGuard, ReflowCircuitBreaker, shouldReflowForDisplayMetrics } from "../src/event-policy";

test("ignores work-area changes caused by this appbar", () => {
  assert.equal(shouldReflowForDisplayMetrics(["workArea"]), false);
  assert.equal(shouldReflowForDisplayMetrics(["workArea", "workAreaSize"]), false);
  assert.equal(shouldReflowForDisplayMetrics(["scaleFactor"]), true);
  assert.equal(shouldReflowForDisplayMetrics(["bounds"]), true);
});

test("suppresses native feedback and coalesces a notification burst", () => {
  const guard = new NativeReflowGuard();
  guard.suppress(1000, 1000);
  assert.equal(guard.tryQueue(1500), false);
  assert.equal(guard.tryQueue(2000), true);
  assert.equal(guard.tryQueue(2001), false);
  guard.release();
  assert.equal(guard.tryQueue(2002), true);
});

test("does not write effectively identical window bounds", () => {
  const current = { x: 100, y: 0, width: 480, height: 1080 };
  assert.equal(boundsDiffer(current, { x: 101, y: 0, width: 480, height: 1080 }), false);
  assert.equal(boundsDiffer(current, { x: 104, y: 0, width: 480, height: 1080 }), true);
});

test("trips repeated reflows and recovers after reset", () => {
  const breaker = new ReflowCircuitBreaker(3, 1000);
  assert.equal(breaker.record(1000), true);
  assert.equal(breaker.record(1100), true);
  assert.equal(breaker.record(1200), true);
  assert.equal(breaker.record(1300), false);
  breaker.reset();
  assert.equal(breaker.record(1400), true);
});
