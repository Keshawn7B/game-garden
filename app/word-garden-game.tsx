"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { markWordGardenGuess, WORD_GARDEN_VALID_WORDS, wordGardenAnswerFor, wordGardenDailySeed, type WordGardenMark } from "./word-garden-logic";

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const MARK_PRIORITY: Record<WordGardenMark, number> = { absent: 1, present: 2, correct: 3 };
type SubmittedGuess = { word: string; marks: WordGardenMark[] };

export function WordGarden({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const dailySeed = useMemo(() => wordGardenDailySeed(), []);
  const [round, setRound] = useState(0);
  const [answer, setAnswer] = useState(() => wordGardenAnswerFor(dailySeed));
  const [currentGuess, setCurrentGuess] = useState("");
  const [guesses, setGuesses] = useState<SubmittedGuess[]>([]);
  const [message, setMessage] = useState("Find the five-letter word.");
  const [shake, setShake] = useState(0);
  const [revealingRow, setRevealingRow] = useState<number | null>(null);
  const [result, setResult] = useState<"won" | "lost" | null>(null);
  const revealTimer = useRef<number | null>(null);

  const keyboardMarks = useMemo(() => {
    const marks = new Map<string, WordGardenMark>();
    guesses.forEach((guess) => guess.word.split("").forEach((letter, index) => {
      const nextMark = guess.marks[index];
      const previousMark = marks.get(letter);
      if (!previousMark || MARK_PRIORITY[nextMark] > MARK_PRIORITY[previousMark]) marks.set(letter, nextMark);
    }));
    return marks;
  }, [guesses]);

  const reset = useCallback(() => {
    if (revealTimer.current != null) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
    const nextRound = round + 1;
    setRound(nextRound);
    setAnswer(wordGardenAnswerFor(dailySeed + nextRound * 997));
    setCurrentGuess("");
    setGuesses([]);
    setMessage("Find the five-letter word.");
    setShake(0);
    setRevealingRow(null);
    setResult(null);
  }, [dailySeed, round]);

  const rejectGuess = useCallback((reason: string) => {
    setMessage(reason);
    setShake((value) => value + 1);
  }, []);

  const submitGuess = useCallback(() => {
    if (result || revealingRow != null) return;
    const word = currentGuess.toLowerCase();
    if (word.length !== 5) {
      rejectGuess("Enter all five letters.");
      return;
    }
    if (!WORD_GARDEN_VALID_WORDS.has(word)) {
      rejectGuess("That word is not in the dictionary.");
      return;
    }

    const marks = markWordGardenGuess(answer, word);
    const nextGuesses = [...guesses, { word, marks }];
    const rowIndex = guesses.length;
    const won = word === answer;
    const lost = !won && nextGuesses.length === 6;
    setGuesses(nextGuesses);
    setCurrentGuess("");
    setRevealingRow(rowIndex);
    setMessage(won ? "Perfect read." : lost ? `The word was ${answer.toUpperCase()}.` : marks.includes("present") || marks.includes("correct") ? "Use the colors for your next guess." : "No matches yet. Keep searching.");
    revealTimer.current = window.setTimeout(() => {
      setRevealingRow(null);
      revealTimer.current = null;
      if (won) {
        setResult("won");
        onScore(nextGuesses.length);
      } else if (lost) setResult("lost");
    }, 920);
  }, [answer, currentGuess, guesses, onScore, rejectGuess, result, revealingRow]);

  useEffect(() => () => {
    if (revealTimer.current != null) window.clearTimeout(revealTimer.current);
  }, []);

  const pressKey = useCallback((key: string) => {
    if (result || revealingRow != null) return;
    if (key === "ENTER") {
      submitGuess();
      return;
    }
    if (key === "BACKSPACE") {
      setCurrentGuess((guess) => guess.slice(0, -1));
      return;
    }
    if (/^[A-Z]$/.test(key)) setCurrentGuess((guess) => guess.length < 5 ? `${guess}${key.toLowerCase()}` : guess);
  }, [result, revealingRow, submitGuess]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      if (event.key === "Enter") {
        event.preventDefault();
        pressKey("ENTER");
      } else if (event.key === "Backspace") {
        event.preventDefault();
        pressKey("BACKSPACE");
      } else if (/^[a-z]$/i.test(event.key)) pressKey(event.key.toUpperCase());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pressKey]);

  return <main className="game-shell word-garden-shell">
    <header className="game-topbar">
      <button className="back-button" onClick={onBack}>← Game menu</button>
      <span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" />
      <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Start a new Word Garden puzzle">↻</button></div>
    </header>
    <section className="word-garden-game">
      <div className="word-garden-heading">
        <div><p className="eyebrow">WORD PUZZLE · SOLO</p><h1>Word Garden</h1><p>Six guesses. Five letters. Follow the colors.</p></div>
        <span aria-hidden="true">言葉</span>
      </div>

      <div className="word-garden-legend" aria-label="Tile color guide">
        <span><i className="correct" />RIGHT SPOT</span><span><i className="present" />WRONG SPOT</span><span><i className="absent" />NOT IN WORD</span>
      </div>

      <p className="word-garden-message" key={`${message}-${shake}`} role="status" aria-live="polite">{message}</p>

      <div className="word-garden-board" role="grid" aria-label="Six row word board">
        {Array.from({ length: 6 }, (_, rowIndex) => {
          const submitted = guesses[rowIndex];
          const letters = submitted?.word ?? (rowIndex === guesses.length ? currentGuess : "");
          const isActive = rowIndex === guesses.length && !result;
          return <div className={`word-garden-row ${isActive ? "active" : ""} ${shake && isActive ? "shake" : ""}`} key={`${rowIndex}-${isActive ? shake : 0}`} role="row">
            {Array.from({ length: 5 }, (_, columnIndex) => {
              const letter = letters[columnIndex] ?? "";
              const mark = submitted?.marks[columnIndex];
              const revealing = revealingRow === rowIndex;
              return <span
                className={`word-garden-tile ${letter ? "filled" : ""} ${mark ? `is-${mark}` : ""} ${revealing ? "revealing" : ""}`}
                style={{ "--reveal-delay": `${columnIndex * 120}ms` } as CSSProperties}
                role="gridcell"
                aria-label={letter ? `${letter.toUpperCase()}${mark ? `, ${mark}` : ""}` : "Empty letter"}
                key={columnIndex}
              >{letter.toUpperCase()}</span>;
            })}
          </div>;
        })}
      </div>

      <div className="word-garden-keyboard" aria-label="On-screen keyboard">
        {KEY_ROWS.map((row, rowIndex) => <div key={row}>
          {rowIndex === 2 && <button className="wide" onClick={() => pressKey("ENTER")} disabled={Boolean(result)}>ENTER</button>}
          {row.split("").map((letter) => <button className={keyboardMarks.get(letter.toLowerCase()) ? `is-${keyboardMarks.get(letter.toLowerCase())}` : ""} onClick={() => pressKey(letter)} disabled={Boolean(result)} key={letter} aria-label={`Letter ${letter}`}>{letter}</button>)}
          {rowIndex === 2 && <button className="wide delete" onClick={() => pressKey("BACKSPACE")} disabled={Boolean(result)} aria-label="Delete letter">⌫</button>}
        </div>)}
      </div>

      {result && <GameResult
        outcome={result === "won" ? "You Win!" : answer.toUpperCase()}
        detail={result === "won" ? `Solved in ${guesses.length} ${guesses.length === 1 ? "guess" : "guesses"}.` : "The hidden word has been revealed."}
        onPlayAgain={reset}
        neutral={result === "lost"}
      />}
    </section>
  </main>;
}
