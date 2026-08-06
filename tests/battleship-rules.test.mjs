import test from "node:test";
import assert from "node:assert/strict";
import {
  battleshipCells,
  battleshipFleetDefeated,
  chooseBattleshipCpuShot,
  decodeBattleshipFleet,
  encodeBattleshipFleet,
  placeBattleship,
  randomBattleshipFleet,
  validBattleshipFleet,
} from "../app/battleship.ts";

test("a Battleship fleet contains five valid ships and seventeen unique cells", () => {
  const fleet = randomBattleshipFleet();
  assert.equal(validBattleshipFleet(fleet), true);
  assert.equal(fleet.flat().length, 17);
  assert.equal(new Set(fleet.flat()).size, 17);
});

test("ships cannot wrap across an ocean row", () => {
  assert.equal(battleshipCells(8, 4, "h"), null);
  const fleet = randomBattleshipFleet();
  assert.equal(placeBattleship(fleet, 0, 98, "h"), null);
});

test("encoded online fleets preserve every ship position", () => {
  const fleet = randomBattleshipFleet();
  assert.deepEqual(decodeBattleshipFleet(encodeBattleshipFleet(fleet)), fleet);
});

test("a fleet is defeated only after all seventeen sections are hit", () => {
  const fleet = randomBattleshipFleet();
  const cells = fleet.flat();
  assert.equal(battleshipFleetDefeated(fleet, cells.slice(0, -1)), false);
  assert.equal(battleshipFleetDefeated(fleet, cells), true);
});

test("every CPU level selects an untried coordinate", () => {
  const fleet = randomBattleshipFleet();
  const shots = [0, 1, 2, 3, 4];
  for (const difficulty of ["easy", "normal", "hard"]) {
    const cell = chooseBattleshipCpuShot(shots, fleet, difficulty);
    assert.equal(typeof cell, "number");
    assert.equal(shots.includes(cell), false);
  }
});
