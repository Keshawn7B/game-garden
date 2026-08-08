import test from "node:test";
import assert from "node:assert/strict";
import { addRandom2048Tile, canMove2048, create2048Board, move2048Board, trace2048Move } from "../app/game-2048-logic.ts";

test("2048 merges each pair only once per move", () => {
  const result = move2048Board([2, 2, 2, 2, ...Array(12).fill(0)], "left");
  assert.deepEqual(result.board.slice(0, 4), [4, 4, 0, 0]);
  assert.equal(result.gained, 8);
  assert.equal(result.moved, true);
});

test("2048 moves and merges vertically", () => {
  const board = [2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0];
  const result = move2048Board(board, "down");
  assert.deepEqual([result.board[0], result.board[4], result.board[8], result.board[12]], [0, 0, 4, 8]);
  assert.equal(result.gained, 12);
});

test("2048 ignores moves that do not change the board", () => {
  const board = [2, 4, 8, 16, ...Array(12).fill(0)];
  assert.equal(move2048Board(board, "left").moved, false);
});

test("2048 adds a two or four only to an open cell", () => {
  const board = [2, ...Array(15).fill(0)];
  const next = addRandom2048Tile(board, () => 0);
  assert.equal(next[0], 2);
  assert.equal(next[1], 2);
  assert.equal(next.filter(Boolean).length, 2);
});

test("2048 starts with exactly two tiles", () => {
  assert.equal(create2048Board(() => 0.5).filter(Boolean).length, 2);
});

test("2048 recognizes a locked board", () => {
  const locked = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  assert.equal(canMove2048(locked), false);
  assert.equal(canMove2048([2, 2, ...locked.slice(2)]), true);
});

test("2048 traces visible tile travel into merge destinations", () => {
  const paths = trace2048Move([0, 2, 0, 2, ...Array(12).fill(0)], "left");
  assert.deepEqual(paths, [
    { from: 1, to: 0, merged: true },
    { from: 3, to: 0, merged: true },
  ]);
});

test("2048 traces independent tiles without creating a false merge", () => {
  const paths = trace2048Move([2, 4, 8, 0, ...Array(12).fill(0)], "right");
  assert.deepEqual(paths.map(({ from, to }) => [from, to]), [[2, 3], [1, 2], [0, 1]]);
  assert.ok(paths.every((path) => !path.merged));
});
