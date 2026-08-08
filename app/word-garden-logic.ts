import safeWords from "@nkzw/safe-word-list";
import words10 from "wordlist-english/english-words-10.json" with { type: "json" };
import words20 from "wordlist-english/english-words-20.json" with { type: "json" };
import words35 from "wordlist-english/english-words-35.json" with { type: "json" };
import words40 from "wordlist-english/english-words-40.json" with { type: "json" };
import words50 from "wordlist-english/english-words-50.json" with { type: "json" };
import words55 from "wordlist-english/english-words-55.json" with { type: "json" };
import words60 from "wordlist-english/english-words-60.json" with { type: "json" };
import words70 from "wordlist-english/english-words-70.json" with { type: "json" };

export type WordGardenMark = "correct" | "present" | "absent";

const isFiveLetterWord = (word: string) => /^[a-z]{5}$/.test(word);
const blockedAnswers = new Set(["asses", "bitch", "boobs", "cocks", "dicks", "fucks", "nudes", "penis", "pussy", "raped", "raper", "rapes", "semen", "shite", "shits", "sluts", "twats", "vulva", "whore"]);

export const WORD_GARDEN_ANSWERS = Array.from(new Set([...safeWords, ...words10, ...words20]))
  .filter((word) => isFiveLetterWord(word) && !blockedAnswers.has(word))
  .sort();

export const WORD_GARDEN_VALID_WORDS = new Set(
  [...WORD_GARDEN_ANSWERS, ...words35, ...words40, ...words50, ...words55, ...words60, ...words70]
    .filter(isFiveLetterWord),
);

export function markWordGardenGuess(answer: string, guess: string): WordGardenMark[] {
  const normalizedAnswer = answer.toLowerCase();
  const normalizedGuess = guess.toLowerCase();
  if (!isFiveLetterWord(normalizedAnswer) || !isFiveLetterWord(normalizedGuess)) throw new Error("Word Garden guesses must contain exactly five letters.");

  const marks: Array<WordGardenMark | null> = Array(5).fill(null);
  const remaining = new Map<string, number>();

  for (let index = 0; index < 5; index += 1) {
    if (normalizedGuess[index] === normalizedAnswer[index]) marks[index] = "correct";
    else remaining.set(normalizedAnswer[index], (remaining.get(normalizedAnswer[index]) ?? 0) + 1);
  }

  for (let index = 0; index < 5; index += 1) {
    if (marks[index]) continue;
    const letter = normalizedGuess[index];
    const count = remaining.get(letter) ?? 0;
    if (count > 0) {
      marks[index] = "present";
      remaining.set(letter, count - 1);
    } else marks[index] = "absent";
  }

  return marks as WordGardenMark[];
}

export function wordGardenAnswerFor(seed: number) {
  const normalizedSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  return WORD_GARDEN_ANSWERS[normalizedSeed % WORD_GARDEN_ANSWERS.length];
}

export function wordGardenDailySeed(date = new Date()) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}
