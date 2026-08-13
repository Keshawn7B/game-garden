"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { cycleQueensCell, isQueensSolved, QUEENS_PUZZLES, queensConflictCells, queensSolutionCells, type QueensCellState } from "./queens-logic";

const HINT_PENALTY_SECONDS = 15;

function dailyPuzzleIndex() {
  const now = new Date();
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  return day % QUEENS_PUZZLES.length;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function Queens({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [puzzleIndex, setPuzzleIndex] = useState(dailyPuzzleIndex);
  const puzzle = QUEENS_PUZZLES[puzzleIndex];
  const size = puzzle.regions.length;
  const [cells, setCells] = useState<QueensCellState[]>(() => Array(size * size).fill(0));
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const [message, setMessage] = useState("Place one crown in every row, column, and color.");
  const [hintedCell, setHintedCell] = useState<number | null>(null);
  const scored = useRef(false);
  const conflicts = useMemo(() => new Set(queensConflictCells(puzzle.regions, cells)), [cells, puzzle]);
  const crownCount = cells.filter((state) => state === 2).length;

  useEffect(() => {
    if (result != null) return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [result, startedAt]);

  const reset = useCallback((nextPuzzleIndex = puzzleIndex) => {
    const nextSize = QUEENS_PUZZLES[nextPuzzleIndex].regions.length;
    setCells(Array(nextSize * nextSize).fill(0));
    setStartedAt(Date.now());
    setElapsed(0);
    setPenalty(0);
    setResult(null);
    setMessage("Place one crown in every row, column, and color.");
    setHintedCell(null);
    scored.current = false;
  }, [puzzleIndex]);

  const finishIfSolved = useCallback((nextCells: QueensCellState[], addedPenalty = 0) => {
    if (!isQueensSolved(puzzle.regions, nextCells)) return;
    const totalPenalty = penalty + addedPenalty;
    const score = Math.max(1, Math.floor((Date.now() - startedAt) / 1000) + totalPenalty);
    setElapsed(Math.max(0, score - totalPenalty));
    setResult(score);
    setMessage("Every court has its queen.");
    if (!scored.current) {
      scored.current = true;
      onScore(score);
    }
  }, [onScore, penalty, puzzle, startedAt]);

  const pressCell = (index: number) => {
    if (result != null) return;
    const next = [...cells];
    next[index] = cycleQueensCell(next[index]);
    setCells(next);
    setHintedCell(null);
    const nextConflicts = queensConflictCells(puzzle.regions, next);
    setMessage(nextConflicts.length ? "Those crowns clash. Check the row, column, color, or neighboring cells." : "No crown conflicts so far.");
    finishIfSolved(next);
  };

  const useHint = () => {
    if (result != null) return;
    const solutionCells = queensSolutionCells(puzzle);
    const target = solutionCells.find((index) => cells[index] !== 2);
    if (target == null) return;
    const next = [...cells];
    next[target] = 2;
    setCells(next);
    setPenalty((value) => value + HINT_PENALTY_SECONDS);
    setHintedCell(target);
    setMessage("A crown was revealed. 15 seconds were added.");
    finishIfSolved(next, HINT_PENALTY_SECONDS);
  };

  const nextPuzzle = () => {
    const nextIndex = (puzzleIndex + 1) % QUEENS_PUZZLES.length;
    setPuzzleIndex(nextIndex);
    reset(nextIndex);
  };

  return <main className="game-shell queens-shell">
    <header className="game-topbar">
      <button className="back-button" onClick={onBack}>← Game menu</button>
      <span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" />
      <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={() => reset()} aria-label="Restart Queens puzzle">↻</button></div>
    </header>

    <section className="queens-game">
      <div className="queens-heading">
        <div><p className="eyebrow">LOGIC PUZZLE · SOLO</p><h1>Queens</h1><p>One court. Seven crowns. No neighbors.</p></div>
        <span aria-hidden="true">女王</span>
      </div>

      <div className="queens-scorebar" aria-label="Puzzle progress">
        <div><small>TIME</small><strong>{formatTime(elapsed + penalty)}</strong></div>
        <div><small>CROWNS</small><strong>{crownCount}<span>/{size}</span></strong></div>
        <div><small>COURT</small><strong>{puzzleIndex + 1}<span>/{QUEENS_PUZZLES.length}</span></strong></div>
      </div>

      <div className="queens-puzzle-title"><span>{puzzle.title}</span><small>Tap: empty → × → crown</small></div>
      <p className={`queens-message ${conflicts.size ? "has-error" : ""}`} role="status" aria-live="polite">{message}</p>

      <div className="queens-board" role="grid" aria-label={`${size} by ${size} Queens puzzle`} style={{ "--queens-size": size } as CSSProperties}>
        {cells.map((state, index) => {
          const row = Math.floor(index / size);
          const column = index % size;
          const region = puzzle.regions[row][column];
          const edgeTop = row > 0 && puzzle.regions[row - 1][column] !== region;
          const edgeRight = column < size - 1 && puzzle.regions[row][column + 1] !== region;
          const edgeBottom = row < size - 1 && puzzle.regions[row + 1][column] !== region;
          const edgeLeft = column > 0 && puzzle.regions[row][column - 1] !== region;
          const stateLabel = state === 2 ? "crown" : state === 1 ? "marked" : "empty";
          return <button
            key={index}
            className={`queens-cell region-${region} ${state === 2 ? "has-crown" : state === 1 ? "has-mark" : ""} ${conflicts.has(index) ? "is-conflict" : ""} ${hintedCell === index ? "is-hint" : ""} ${edgeTop ? "edge-top" : ""} ${edgeRight ? "edge-right" : ""} ${edgeBottom ? "edge-bottom" : ""} ${edgeLeft ? "edge-left" : ""}`}
            onClick={() => pressCell(index)}
            disabled={result != null}
            role="gridcell"
            aria-label={`Row ${row + 1}, column ${column + 1}, color ${region + 1}, ${stateLabel}`}
          >{state === 2 ? <span aria-hidden="true">♛</span> : state === 1 ? <i aria-hidden="true">×</i> : null}</button>;
        })}
      </div>

      <div className="queens-legend" aria-label="Queens rules">
        <span><b>1</b> PER ROW</span><span><b>1</b> PER COLUMN</span><span><b>1</b> PER COLOR</span><span><b>↗</b> NO TOUCHING</span>
      </div>

      {!result && <div className="queens-actions"><button className="secondary-button" onClick={useHint}>Hint <small>+15s</small></button><button className="secondary-button" onClick={() => reset()}>Clear board</button></div>}
      {result != null && <GameResult outcome="Court Complete!" detail={`Solved ${puzzle.title} in ${formatTime(result)}${penalty ? ` with ${penalty} seconds of hints` : ""}.`} onPlayAgain={nextPuzzle} />}
    </section>
  </main>;
}
