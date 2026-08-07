import test from "node:test";
import assert from "node:assert/strict";
import { AIR_HOCKEY_CENTER, AIR_HOCKEY_MATCH_SECONDS, AIR_HOCKEY_WIN_SCORE, airHockeyPuckSpeedCap, airHockeyVelocityFromMallet, chooseAirHockeyCpuVelocity, decodeAirHockeyTrajectory, encodeAirHockeyTrajectory, moveAirHockeyCpu, simulateAirHockeyShot, stepAirHockeyLive } from "../app/air-hockey.ts";

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

test("normal CPU anticipates an incoming puck before it reaches the CPU half", () => {
  const start = { x: 50, y: 27 };
  const next = moveAirHockeyCpu(start, { x: 75, y: 105, vx: 0, vy: -35 }, "normal", 34);
  assert.ok(next.x > start.x);
});

test("CPU actively attacks a loose puck instead of waiting at center", () => {
  const start = { x: 50, y: 27 };
  const next = moveAirHockeyCpu(start, { x: 72, y: 58, vx: 4, vy: 8 }, "normal", 34);
  assert.ok(next.x > start.x);
  assert.ok(next.y > start.y);
});

test("harder CPU levels move more quickly", () => {
  const start = { x: 50, y: 27 };
  const puck = { x: 82, y: 55, vx: 0, vy: -20 };
  const easy = moveAirHockeyCpu(start, puck, "easy", 34);
  const normal = moveAirHockeyCpu(start, puck, "normal", 34);
  const hard = moveAirHockeyCpu(start, puck, "hard", 34);
  const distance = (point) => Math.hypot(point.x - start.x, point.y - start.y);
  assert.ok(distance(easy) < distance(normal));
  assert.ok(distance(normal) < distance(hard));
});

test("puck speed caps increase with difficulty", () => {
  assert.ok(airHockeyPuckSpeedCap("easy") < airHockeyPuckSpeedCap("normal"));
  assert.ok(airHockeyPuckSpeedCap("normal") < airHockeyPuckSpeedCap("hard"));
});

test("a faster mallet swing creates a faster puck", () => {
  const puck = { x: 50, y: 76, vx: 0, vy: 0 };
  const mallets = [{ x: 50, y: 85 }, { x: 50, y: 25 }];
  const slow = stepAirHockeyLive(puck, mallets, [{ x: 0, y: -20 }, { x: 0, y: 0 }], 16, "hard");
  const fast = stepAirHockeyLive(puck, mallets, [{ x: 0, y: -120 }, { x: 0, y: 0 }], 16, "hard");
  assert.ok(Math.hypot(fast.puck.vx, fast.puck.vy) > Math.hypot(slow.puck.vx, slow.puck.vy));
});

test("every difficulty enforces its puck speed cap", () => {
  for (const difficulty of ["easy", "normal", "hard"]) {
    const result = stepAirHockeyLive(
      { x: 50, y: 75, vx: 300, vy: -300 },
      [{ x: 50, y: 125 }, { x: 50, y: 25 }],
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      16,
      difficulty,
    );
    assert.ok(Math.hypot(result.puck.vx, result.puck.vy) <= airHockeyPuckSpeedCap(difficulty) + 0.001);
  }
});

test("the puck travels through the full corner until reaching a real rail", () => {
  const result = stepAirHockeyLive(
    { x: 15, y: 19, vx: -12, vy: -12 },
    [{ x: 50, y: 125 }, { x: 50, y: 25 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    16,
  );
  assert.ok(result.puck.x < 15);
  assert.ok(result.puck.y < 19);
  assert.ok(result.puck.vx < 0);
  assert.ok(result.puck.vy < 0);
});

test("the physical corner rails bounce both axes", () => {
  const result = stepAirHockeyLive(
    { x: 5.05, y: 5.05, vx: -20, vy: -20 },
    [{ x: 50, y: 125 }, { x: 50, y: 25 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    16,
  );
  assert.ok(result.puck.vx > 0);
  assert.ok(result.puck.vy > 0);
});

test("CPU retreats instead of pinning a puck in its corner", () => {
  const mallet = { x: 14, y: 15 };
  const next = moveAirHockeyCpu(mallet, { x: 7, y: 9, vx: -12, vy: -10 }, "normal", 34);
  assert.ok(next.x > mallet.x);
  assert.ok(next.y > mallet.y);
});
