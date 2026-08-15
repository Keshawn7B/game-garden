import assert from "node:assert/strict";
import test from "node:test";
import { chooseGraphBotFunction, chooseGraphBotShot, compileGraphExpression, decodeGraphFunctionShot, decodeGraphPoint, encodeGraphFunctionShot, encodeGraphPoint, formatGraphFunction, graphBotRangeSteps, graphLineDistance, graphLineHitsPoint, graphLineY, graphObstaclesForSeed, graphPlacementAllowed, randomGraphBotPoint, snapGraphPoint, traceGraphFunction } from "../app/graph-war-logic.ts";

test("Graph War evaluates linear functions", () => {
  assert.equal(graphLineY(2, -1, 3), 5);
  assert.equal(formatGraphFunction(2, -1), "y = 2x − 1");
  assert.equal(formatGraphFunction(-1, 0), "y = −x");
  assert.equal(formatGraphFunction(0, 4), "y = 4");
});

test("Graph War detects direct hits and nearby misses", () => {
  assert.equal(graphLineHitsPoint({ x: 3, y: 7 }, 2, 1), true);
  assert.equal(graphLineHitsPoint({ x: 3, y: 8 }, 2, 1), false);
  assert.ok(graphLineDistance({ x: 3, y: 8 }, 2, 1) > 0.42);
});

test("Graph War snaps placements inside the graph and keeps home zones separate", () => {
  assert.deepEqual(snapGraphPoint(-9, 8.8), { x: -7, y: 7 });
  assert.equal(graphPlacementAllowed(0, { x: -2, y: 4 }), true);
  assert.equal(graphPlacementAllowed(0, { x: 2, y: 4 }), false);
  assert.equal(graphPlacementAllowed(1, { x: 2, y: -4 }), true);
  assert.equal(graphPlacementAllowed(1, { x: -2, y: -4 }), false);
});

test("Graph War encodes online positions without losing graph coordinates", () => {
  const point = { x: -5, y: 6 };
  assert.deepEqual(decodeGraphPoint(encodeGraphPoint(point)), point);
  assert.equal(decodeGraphPoint(-1), null);
  assert.equal(decodeGraphPoint(289), null);
});

test("Graph War bot difficulty changes its chance to land a shot", () => {
  const target = { x: -4, y: 3 };
  const hard = chooseGraphBotShot(target, "hard", () => 0.1);
  const easy = chooseGraphBotShot(target, "easy", () => 0.2);
  assert.equal(graphLineHitsPoint(target, hard.slope, hard.intercept), true);
  assert.equal(graphLineHitsPoint(target, easy.slope, easy.intercept), false);
  assert.equal(graphPlacementAllowed(1, randomGraphBotPoint(() => 0.5)), true);
});

test("Graph War safely evaluates arithmetic, constants, functions, and implicit multiplication", () => {
  const evaluate = compileGraphExpression("2sin(pi/2) + sqrt(abs(-4)) + ln(e)");
  assert.ok(Math.abs(evaluate({ x: 0, y: 0, v: 0 }) - 5) < 1e-9);
  assert.equal(compileGraphExpression("2x + 3(x + 1)")({ x: 2, y: 0, v: 0 }), 13);
  assert.equal(compileGraphExpression("min(8, x^2) + max(1, y)")({ x: 3, y: -2, v: 0 }), 9);
  assert.throws(() => compileGraphExpression("alert(1)"), /Unknown/);
  assert.throws(() => compileGraphExpression("x +"), /Expected/);
});

test("Graph War traces normal, first-order, and second-order shots from the soldier", () => {
  const origin = { x: -6, y: 0 };
  const target = { x: 6, y: 6 };
  const normal = traceGraphFunction({ player: 0, mode: "normal", expression: "0.5*x", angle: 0 }, origin, target);
  const first = traceGraphFunction({ player: 0, mode: "first", expression: "0.5", angle: 0 }, origin, target);
  const second = traceGraphFunction({ player: 0, mode: "second", expression: "0", angle: Math.atan(0.5) * 180 / Math.PI }, origin, target);
  assert.equal(normal.hit, true);
  assert.equal(first.hit, true);
  assert.equal(second.hit, true);
  assert.ok(normal.points.length > 20);
});

test("Graph War obstacles and invalid values explode a trajectory", () => {
  const origin = { x: -6, y: 0 };
  const target = { x: 6, y: 6 };
  const blocked = traceGraphFunction(
    { player: 0, mode: "normal", expression: "0.5*x", angle: 0 },
    origin,
    target,
    [{ x: 0, y: 3, radius: 0.7 }],
  );
  const invalid = traceGraphFunction({ player: 0, mode: "normal", expression: "sqrt(x)", angle: 0 }, origin);
  assert.equal(blocked.exploded, true);
  assert.equal(blocked.hit, false);
  assert.equal(invalid.exploded, true);
});

test("Graph War online function shots round-trip and seeded obstacles stay deterministic", () => {
  const shot = { player: 1, mode: "second", expression: "-y + 2*x", angle: -12.34 };
  assert.deepEqual(decodeGraphFunctionShot(encodeGraphFunctionShot(shot)), { ...shot, angle: -12.3 });
  assert.equal(decodeGraphFunctionShot({ player: 0 }), null);
  assert.deepEqual(graphObstaclesForSeed("ROOM42"), graphObstaclesForSeed("ROOM42"));
  assert.notDeepEqual(graphObstaclesForSeed("ROOM42"), graphObstaclesForSeed("ROOM43"));
});

test("Graph War bot plans with normal, first-order, second-order, sine, cosine, and polynomial functions", () => {
  const origin = { x: 6, y: 2 };
  const target = { x: -5, y: -1 };
  const shots = Array.from({ length: 21 }, (_, index) => chooseGraphBotFunction(origin, target, "hard", () => index / 20, 9));
  const modes = new Set(shots.map((shot) => shot.mode));
  assert.deepEqual(modes, new Set(["normal", "first", "second"]));
  assert.ok(shots.some((shot) => shot.expression.includes("sin(")));
  assert.ok(shots.some((shot) => shot.expression.includes("cos(")));
  assert.ok(shots.some((shot) => shot.expression.includes("x^2")));
});

test("Graph War bot uses less centered randomness on harder levels and converges", () => {
  assert.deepEqual([graphBotRangeSteps("easy", 0), graphBotRangeSteps("medium", 0), graphBotRangeSteps("hard", 0)], [10, 5, 2]);
  assert.ok(graphBotRangeSteps("easy", 1) < graphBotRangeSteps("easy", 0));
  assert.equal(graphBotRangeSteps("easy", 9), 0);
  assert.equal(graphBotRangeSteps("medium", 5), 0);
  assert.equal(graphBotRangeSteps("hard", 2), 0);
});

test("Graph War bot solves around obstacles before centering its random range", () => {
  const origin = { x: 6, y: 0 };
  const target = { x: -6, y: 0 };
  const obstacles = [{ x: 0, y: 0, radius: 1 }];
  const shot = chooseGraphBotFunction(origin, target, "hard", () => 0, 9, obstacles);
  const result = traceGraphFunction({ player: 1, ...shot }, origin, target, obstacles);
  assert.match(`${shot.mode} ${shot.expression}`, /x\^2|sin\(|cos\(|first|second/);
  assert.equal(result.exploded, false);
  assert.equal(result.hit, true);
});
