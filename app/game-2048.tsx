"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { addRandom2048Tile, canMove2048, create2048Board, GAME_2048_TARGET, move2048Board, type Game2048Direction } from "./game-2048-logic";

type Game2048Result = "won" | "lost" | null;

export function Game2048({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [board, setBoard] = useState(create2048Board);
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(0);
  const [result, setResult] = useState<Game2048Result>(null);
  const [moveSerial, setMoveSerial] = useState(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const largestTile = useMemo(() => Math.max(...board), [board]);

  const reset = useCallback(() => {
    setBoard(create2048Board());
    setScore(0);
    setMoves(0);
    setResult(null);
    setMoveSerial((current) => current + 1);
  }, []);

  const move = useCallback((direction: Game2048Direction) => {
    if (result) return;
    const shifted = move2048Board(board, direction);
    if (!shifted.moved) return;
    const nextBoard = addRandom2048Tile(shifted.board);
    const nextScore = score + shifted.gained;
    const nextLargest = Math.max(...nextBoard);
    const nextResult: Game2048Result = nextLargest >= GAME_2048_TARGET ? "won" : canMove2048(nextBoard) ? null : "lost";
    setBoard(nextBoard);
    setScore(nextScore);
    setMoves((current) => current + 1);
    setMoveSerial((current) => current + 1);
    if (nextResult) {
      setResult(nextResult);
      onScore(Math.max(1, nextScore));
    }
  }, [board, onScore, result, score]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      const directions: Partial<Record<string, Game2048Direction>> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      move(direction);
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  const finishSwipe = (x: number, y: number) => {
    if (!swipeStart.current) return;
    const deltaX = x - swipeStart.current.x;
    const deltaY = y - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 24) return;
    move(Math.abs(deltaX) > Math.abs(deltaY) ? deltaX > 0 ? "right" : "left" : deltaY > 0 ? "down" : "up");
  };

  return (
    <main className="game-shell game-2048-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" />
        <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Start a new 2048 game">↻</button></div>
      </header>
      <section className="game-2048">
        <p className="eyebrow">NUMBER PUZZLE · SOLO</p>
        <div className="game-2048-heading"><div><h1>2048</h1><p>Merge matching tiles and build the 2048 tile.</p></div><span aria-hidden="true">二〇四八</span></div>
        <div className="game-2048-scorebar" aria-label="2048 game statistics">
          <div><small>SCORE</small><strong>{score.toLocaleString()}</strong></div>
          <div><small>BEST TILE</small><strong>{largestTile}</strong></div>
          <div><small>MOVES</small><strong>{moves}</strong></div>
        </div>
        <div
          className="game-2048-board"
          role="grid"
          aria-label="2048 board. Swipe or use the arrow controls."
          onPointerDown={(event) => { swipeStart.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerUp={(event) => finishSwipe(event.clientX, event.clientY)}
          onPointerCancel={() => { swipeStart.current = null; }}
        >
          {board.map((value, index) => <span key={`${index}-${moveSerial}`} className={`game-2048-tile ${value ? "has-value" : ""}`} data-value={value || undefined} role="gridcell" aria-label={value ? `Tile ${value}` : "Empty tile"}>{value || ""}</span>)}
        </div>
        {!result && <div className="game-2048-controls" aria-label="Move tiles">
          <span />
          <button onClick={() => move("up")} aria-label="Move up">↑</button>
          <span />
          <button onClick={() => move("left")} aria-label="Move left">←</button>
          <b>SWIPE</b>
          <button onClick={() => move("right")} aria-label="Move right">→</button>
          <span />
          <button onClick={() => move("down")} aria-label="Move down">↓</button>
          <span />
        </div>}
        {!result && <p className="game-2048-hint">Swipe anywhere on the board or use the arrow controls.</p>}
        {result && <div className="game-2048-result"><button className="game-2048-exit" onClick={onBack} aria-label="Exit 2048">×</button><GameResult outcome={result === "won" ? "2048 Reached!" : "Game Over"} detail={`Final score ${score.toLocaleString()} across ${moves} moves.`} onPlayAgain={reset} neutral={result === "lost"} /></div>}
      </section>
    </main>
  );
}
