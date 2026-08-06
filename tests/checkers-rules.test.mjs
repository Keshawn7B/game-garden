import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECKERS_START,
  applyCheckersMove,
  checkersLegalMoves,
  checkersTurnOptions,
  checkersWinner,
  chooseCheckersCpuTurn,
} from "../app/checkers.ts";

const emptyBoard = () => Array(64).fill("");

test("Checkers starts with legal red moves and mandatory dark squares", () => {
  assert.equal(CHECKERS_START.filter((piece) => piece === "r").length, 12);
  assert.equal(CHECKERS_START.filter((piece) => piece === "b").length, 12);
  assert.equal(checkersLegalMoves(CHECKERS_START, 0).length, 7);
});

test("a capture suppresses every ordinary move", () => {
  const board = emptyBoard();
  board[42] = "r";
  board[33] = "b";
  board[46] = "r";
  const moves = checkersLegalMoves(board, 0);
  assert.deepEqual(moves, [{ from: 42, to: 24, captured: 33 }]);
});

test("multi-jumps are completed as one turn", () => {
  const board = emptyBoard();
  board[42] = "r";
  board[33] = "b";
  board[17] = "b";
  const turns = checkersTurnOptions(board, 0);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].captures, 2);
  assert.deepEqual(turns[0].moves.map((move) => move.to), [24, 10]);
});

test("reaching the far row promotes a piece to king", () => {
  const board = emptyBoard();
  board[8] = "r";
  const result = applyCheckersMove(board, { from: 8, to: 1, captured: null });
  assert.equal(result.promoted, true);
  assert.equal(result.board[1], "R");
  assert.ok(checkersLegalMoves(result.board, 0).some((move) => move.from === 1 && move.to === 10));
});

test("a player with no remaining move loses", () => {
  const board = emptyBoard();
  board[1] = "R";
  assert.equal(checkersWinner(board, 1), 0);
});

test("every CPU difficulty returns a legal complete turn", () => {
  for (const difficulty of ["easy", "normal", "hard"]) {
    const turn = chooseCheckersCpuTurn(CHECKERS_START, difficulty);
    assert.ok(turn);
    assert.ok(turn.moves.length >= 1);
    assert.equal(turn.moves[0].from, checkersLegalMoves(CHECKERS_START, 1).find((move) => move.from === turn.moves[0].from && move.to === turn.moves[0].to)?.from);
  }
});
