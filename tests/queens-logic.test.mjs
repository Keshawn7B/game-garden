import assert from "node:assert/strict";
import test from "node:test";
import { cycleQueensCell, isQueensSolved, QUEENS_PUZZLES, queensConflictCells, queensSolutionCells, randomQueensPuzzleIndex } from "../app/queens-logic.ts";

function countSolutions(puzzle, limit = 2) {
  const size = puzzle.regions.length;
  let count = 0;
  const columns = new Set();
  const regions = new Set();
  const placements = [];

  function search(row) {
    if (count >= limit) return;
    if (row === size) {
      count += 1;
      return;
    }
    for (let column = 0; column < size; column += 1) {
      const region = puzzle.regions[row][column];
      if (columns.has(column) || regions.has(region) || (row > 0 && Math.abs(column - placements[row - 1]) <= 1)) continue;
      columns.add(column);
      regions.add(region);
      placements.push(column);
      search(row + 1);
      placements.pop();
      regions.delete(region);
      columns.delete(column);
    }
  }

  search(0);
  return count;
}

function regionIsConnected(puzzle, region) {
  const size = puzzle.regions.length;
  const targetCells = puzzle.regions.flatMap((row, rowIndex) => row.flatMap((value, columnIndex) => value === region ? [rowIndex * size + columnIndex] : []));
  const pending = [targetCells[0]];
  const visited = new Set(pending);
  while (pending.length) {
    const index = pending.pop();
    const row = Math.floor(index / size);
    const column = index % size;
    for (const [nextRow, nextColumn] of [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]) {
      if (nextRow < 0 || nextRow >= size || nextColumn < 0 || nextColumn >= size || puzzle.regions[nextRow][nextColumn] !== region) continue;
      const nextIndex = nextRow * size + nextColumn;
      if (!visited.has(nextIndex)) {
        visited.add(nextIndex);
        pending.push(nextIndex);
      }
    }
  }
  return visited.size === targetCells.length;
}

test("every Queens court is a connected, uniquely solvable puzzle", () => {
  for (const puzzle of QUEENS_PUZZLES) {
    const size = puzzle.regions.length;
    assert.equal(puzzle.solution.length, size);
    assert.equal(new Set(puzzle.regions.flat()).size, size);
    for (let region = 0; region < size; region += 1) assert.equal(regionIsConnected(puzzle, region), true, `${puzzle.title}, region ${region}`);
    assert.equal(countSolutions(puzzle), 1, puzzle.title);
  }
});

test("the stored solution completes each Queens court", () => {
  for (const puzzle of QUEENS_PUZZLES) {
    const cells = Array(puzzle.regions.length ** 2).fill(0);
    for (const index of queensSolutionCells(puzzle)) cells[index] = 2;
    assert.equal(isQueensSolved(puzzle.regions, cells), true, puzzle.title);
    assert.deepEqual(queensConflictCells(puzzle.regions, cells), []);
  }
});

test("Queens detects row, column, region, and neighboring crown conflicts", () => {
  const regions = [[0, 0, 1], [0, 2, 1], [2, 2, 1]];
  const cells = Array(9).fill(0);
  cells[0] = 2;
  cells[1] = 2;
  cells[3] = 2;
  assert.deepEqual(queensConflictCells(regions, cells), [0, 1, 3]);
  assert.equal(isQueensSolved(regions, cells), false);
});

test("Queens cells cycle through empty, mark, crown, and empty", () => {
  assert.equal(cycleQueensCell(0), 1);
  assert.equal(cycleQueensCell(1), 2);
  assert.equal(cycleQueensCell(2), 0);
});

test("Queens chooses random courts without immediately repeating one", () => {
  assert.equal(randomQueensPuzzleIndex(1, () => 0), 0);
  assert.equal(randomQueensPuzzleIndex(1, () => 0.999), 3);
  for (let current = 0; current < QUEENS_PUZZLES.length; current += 1) {
    for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
      const chosen = randomQueensPuzzleIndex(current, () => random);
      assert.notEqual(chosen, current);
      assert.ok(chosen >= 0 && chosen < QUEENS_PUZZLES.length);
    }
  }
});
