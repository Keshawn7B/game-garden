import test from "node:test";
import assert from "node:assert/strict";
import { AIR_HOCKEY_CENTER, airHockeyVelocityFromPull, chooseAirHockeyCpuVelocity, decodeAirHockeyTrajectory, encodeAirHockeyTrajectory, simulateAirHockeyShot } from "../app/air-hockey.ts";

test("pulling behind the puck launches it in the opposite direction", () => {
  const velocity = airHockeyVelocityFromPull(AIR_HOCKEY_CENTER, { x: 50, y: 100 });
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
