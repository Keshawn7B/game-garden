import assert from "node:assert/strict";
import { test } from "node:test";
import { blackjackHandValue, blackjackPayout, createBlackjackShoe, dealerShouldHit, isNaturalBlackjack, settleBlackjack } from "../app/blackjack-logic.ts";

const card = (rank, suit = "spades") => ({ id: `${rank}-${suit}-${Math.random()}`, rank, suit });

test("blackjack shoe contains six complete decks", () => {
  const shoe = createBlackjackShoe();
  assert.equal(shoe.length, 312);
  assert.equal(shoe.filter((item) => item.rank === "A").length, 24);
});

test("aces change from eleven to one when needed", () => {
  assert.deepEqual(blackjackHandValue([card("A"), card("6")]), { total: 17, soft: true });
  assert.deepEqual(blackjackHandValue([card("A"), card("6"), card("K")]), { total: 17, soft: false });
  assert.equal(blackjackHandValue([card("A"), card("A"), card("9")]).total, 21);
});

test("natural blackjack requires exactly two cards", () => {
  assert.equal(isNaturalBlackjack([card("A"), card("K")]), true);
  assert.equal(isNaturalBlackjack([card("7"), card("7"), card("7")]), false);
});

test("dealer stands on every 17 and hits below 17", () => {
  assert.equal(dealerShouldHit([card("10"), card("6")]), true);
  assert.equal(dealerShouldHit([card("A"), card("6")]), false);
});

test("round settlement handles naturals, busts, wins, losses, and pushes", () => {
  assert.equal(settleBlackjack([card("A"), card("K")], [card("10"), card("9")]), "blackjack");
  assert.equal(settleBlackjack([card("10"), card("8"), card("7")], [card("10"), card("9")]), "lose");
  assert.equal(settleBlackjack([card("10"), card("9")], [card("10"), card("8")]), "win");
  assert.equal(settleBlackjack([card("10"), card("8")], [card("10"), card("9")]), "lose");
  assert.equal(settleBlackjack([card("10"), card("8")], [card("9"), card("9")]), "push");
});

test("casino payouts return the stake and pay blackjack three to two", () => {
  assert.equal(blackjackPayout("blackjack", 100), 250);
  assert.equal(blackjackPayout("blackjack", 25), 62.5);
  assert.equal(blackjackPayout("win", 100), 200);
  assert.equal(blackjackPayout("push", 100), 100);
  assert.equal(blackjackPayout("lose", 100), 0);
});
