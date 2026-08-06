import test from "node:test";
import assert from "node:assert/strict";
import { AIR_HOCKEY_CENTER, airHockeyVelocityFromMallet, chooseAirHockeyCpuVelocity, decodeAirHockeyTrajectory, encodeAirHockeyTrajectory, simulateAirHockeyShot, stepAirHockeyLive } from "../app/air-hockey.ts";

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
