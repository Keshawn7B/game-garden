import assert from "node:assert/strict";
import test from "node:test";

import { markWordGardenGuess, WORD_GARDEN_ANSWERS, WORD_GARDEN_VALID_WORDS, wordGardenAnswerFor } from "../app/word-garden-logic.ts";

test("Word Garden marks exact, present, and absent letters", () => {
  assert.deepEqual(markWordGardenGuess("crane", "cared"), ["correct", "present", "present", "present", "absent"]);
});

test("Word Garden handles duplicate letters without over-crediting", () => {
  assert.deepEqual(markWordGardenGuess("apple", "allee"), ["correct", "present", "absent", "absent", "correct"]);
  assert.deepEqual(markWordGardenGuess("civic", "cacao"), ["correct", "absent", "present", "absent", "absent"]);
});

test("Word Garden ships a large safe answer and accepted-guess library", () => {
  assert.ok(WORD_GARDEN_ANSWERS.length >= 1000);
  assert.ok(WORD_GARDEN_VALID_WORDS.size >= 6000);
  assert.ok(WORD_GARDEN_ANSWERS.every((word) => /^[a-z]{5}$/.test(word)));
  assert.ok(WORD_GARDEN_ANSWERS.every((word) => WORD_GARDEN_VALID_WORDS.has(word)));
});

test("Word Garden answer selection is deterministic", () => {
  assert.equal(wordGardenAnswerFor(125), wordGardenAnswerFor(125));
  assert.ok(WORD_GARDEN_VALID_WORDS.has(wordGardenAnswerFor(125)));
});

