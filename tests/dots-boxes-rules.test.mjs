import test from "node:test";
import assert from "node:assert/strict";
import { DOTS_BOX_COUNT, DOTS_EDGE_COUNT, applyDotsBoxesEdge, chooseDotsBoxesCpuEdge, dotsBoxEdges, dotsBoxesScores } from "../app/dots-boxes.ts";

test("a five by five dot grid has forty edges and sixteen boxes", () => {
  assert.equal(DOTS_EDGE_COUNT, 40);
  assert.equal(DOTS_BOX_COUNT, 16);
  assert.deepEqual(dotsBoxEdges(0), [0, 4, 20, 21]);
  assert.deepEqual(dotsBoxEdges(15), [15, 19, 38, 39]);
});

test("drawing the fourth side claims a box for the active player", () => {
  let edges = Array(DOTS_EDGE_COUNT).fill(0);
  let boxes = Array(DOTS_BOX_COUNT).fill(0);
  for (const edge of [0, 4, 20]) {
    const result = applyDotsBoxesEdge(edges, boxes, edge, 0);
    edges = result.edges;
    boxes = result.boxes;
  }
  const result = applyDotsBoxesEdge(edges, boxes, 21, 0);
  assert.deepEqual(result.completed, [0]);
  assert.equal(result.boxes[0], 1);
  assert.deepEqual(dotsBoxesScores(result.boxes), [1, 0]);
});

test("one line can complete two neighboring boxes", () => {
  let edges = Array(DOTS_EDGE_COUNT).fill(0);
  let boxes = Array(DOTS_BOX_COUNT).fill(0);
  for (const edge of [0, 4, 20, 1, 5, 22]) {
    const result = applyDotsBoxesEdge(edges, boxes, edge, 1);
    edges = result.edges;
    boxes = result.boxes;
  }
  const result = applyDotsBoxesEdge(edges, boxes, 21, 1);
  assert.deepEqual(result.completed, [0, 1]);
  assert.deepEqual(dotsBoxesScores(result.boxes), [0, 2]);
});

test("every CPU difficulty chooses an available edge", () => {
  const edges = Array(DOTS_EDGE_COUNT).fill(0);
  edges[0] = 1;
  const boxes = Array(DOTS_BOX_COUNT).fill(0);
  for (const difficulty of ["easy", "normal", "hard"]) {
    const edge = chooseDotsBoxesCpuEdge(edges, boxes, difficulty, () => 0.5);
    assert.equal(typeof edge, "number");
    assert.equal(edges[edge], 0);
  }
});

test("normal and hard CPU take an available box", () => {
  const edges = Array(DOTS_EDGE_COUNT).fill(0);
  [0, 4, 20].forEach((edge) => { edges[edge] = 1; });
  const boxes = Array(DOTS_BOX_COUNT).fill(0);
  for (const difficulty of ["normal", "hard"]) assert.equal(chooseDotsBoxesCpuEdge(edges, boxes, difficulty, () => 0), 21);
});
