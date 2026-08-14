import assert from "node:assert/strict";
import test from "node:test";
import { formatGraphFunction, graphLineDistance, graphLineHitsPoint, graphLineY, graphPlacementAllowed, snapGraphPoint } from "../app/graph-war-logic.ts";

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
