import test from "node:test";
import assert from "node:assert/strict";
import { AIR_HOCKEY_CENTER, AIR_HOCKEY_MATCH_SECONDS, AIR_HOCKEY_WIN_SCORE, airHockeyVelocityFromMallet, chooseAirHockeyCpuVelocity, decodeAirHockeyTrajectory, encodeAirHockeyTrajectory, moveAirHockeyCpu, simulateAirHockeyShot, stepAirHockeyLive } from "../app/air-hockey.ts";

test("air hockey uses a two-minute first-to-three match", () => {
  assert.equal(AIR_HOCKEY_MATCH_SECONDS, 120);
  assert.equal(AIR_HOCKEY_WIN_SCORE, 3);
});

test("moving the mallet creates puck velocity in the same direction", () => {
  const velocity = airHockeyVelocityFromMallet({ x: 50, y: 100 }, { x: 50, y: 90 });
  assert.ok(velocity);
  assert.equal(velocity.x, 0);
  assert.ok(velocity.y < 0);
});

test("a puck crossing the top goal scores for player one", () => {
  const shot = simulateAirHockeyShot({ x: 50, y: 8 }, { x: 0, y: -5 });
  assert.equal(shot.goal, 0);
  assert.deepEqual(shot.final, AIR_HOCKEY_CENTER);
});

test("the rail keeps every non-goal puck inside the rink", () => {
  const shot = simulateAirHockeyShot({ x: 9, y: 75 }, { x: -5, y: 1 });
  assert.equal(shot.goal, null);
  assert.ok(shot.trajectory.every((point) => point.x >= 5 && point.x <= 95));
});

test("CPU difficulty always aims toward its scoring goal", () => {
  for (const difficulty of ["easy", "normal", "hard"]) {
    const velocity = chooseAirHockeyCpuVelocity(AIR_HOCKEY_CENTER, difficulty, () => 0.5);
    assert.ok(velocity.y > 0);
    assert.ok(Math.hypot(velocity.x, velocity.y) > 3);
  }
});

test("online trajectory encoding preserves playable points", () => {
  const points = [{ x: 50, y: 75 }, { x: 44.4, y: 22.2 }];
  assert.deepEqual(decodeAirHockeyTrajectory(encodeAirHockeyTrajectory(points)), points);
});

test("live air hockey advances continuously without waiting for a turn", () => {
  const result = stepAirHockeyLive(
    { x: 50, y: 75, vx: 0, vy: -40 },
    [{ x: 50, y: 125 }, { x: 50, y: 25 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    16,
  );
  assert.equal(result.goal, null);
  assert.ok(result.puck.y < 75);
});

test("either live mallet can strike the puck", () => {
  const result = stepAirHockeyLive(
    { x: 50, y: 76, vx: 0, vy: 0 },
    [{ x: 50, y: 85 }, { x: 50, y: 25 }],
    [{ x: 0, y: -70 }, { x: 0, y: 0 }],
    16,
  );
  assert.ok(result.puck.vy < 0);
});

test("the live puck keeps moving instead of ending a turn", () => {
  const result = stepAirHockeyLive(
    { x: 40, y: 70, vx: 0.01, vy: 0.01 },
    [{ x: 50, y: 125 }, { x: 50, y: 25 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    16,
  );
  assert.ok(Math.hypot(result.puck.vx, result.puck.vy) >= 8.9);
});

test("normal CPU tracks the puck at a moderate capped speed", () => {
  const start = { x: 50, y: 27 };
  const next = moveAirHockeyCpu(start, { x: 75, y: 40, vx: 0, vy: -20 }, "normal", 1000);
  assert.ok(Math.hypot(next.x - start.x, next.y - start.y) <= 1);
  assert.ok(next.x > start.x);
});

test("a corner-trapped puck is redirected toward open ice", () => {
  const result = stepAirHockeyLive(
    { x: 7, y: 8, vx: -3, vy: -2 },
    [{ x: 50, y: 125 }, { x: 50, y: 25 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    16,
  );
  assert.ok(result.puck.vx > 0);
  assert.ok(result.puck.vy > 0);
  assert.ok(Math.hypot(result.puck.vx, result.puck.vy) >= 18);
});

test("CPU retreats instead of pinning a puck in its corner", () => {
  const mallet = { x: 14, y: 15 };
  const next = moveAirHockeyCpu(mallet, { x: 7, y: 9, vx: -12, vy: -10 }, "normal", 34);
  assert.ok(next.x > mallet.x);
  assert.ok(next.y > mallet.y);
});
