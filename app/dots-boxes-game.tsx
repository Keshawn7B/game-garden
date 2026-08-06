"use client";

import { useEffect, useState } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { DOTS_BOX_COUNT, DOTS_EDGE_COUNT, DOTS_GRID_SIZE, DOTS_HORIZONTAL_EDGE_COUNT, applyDotsBoxesEdge, chooseDotsBoxesCpuEdge, dotsBoxesScores, type DotsBoxesDifficulty, type DotsBoxesPlayer } from "./dots-boxes";

export function DotsBoxesBoard({ edges, boxes, onEdge, disabled = false, lastEdge = null, labels = ["一", "二"] }: {
  edges: number[];
  boxes: number[];
  onEdge?: (edge: number) => void;
  disabled?: boolean;
  lastEdge?: number | null;
  labels?: [string, string];
}) {
  return <div className="dots-boxes-board" role="grid" aria-label="Dots and Boxes board">{Array.from({ length: 81 }, (_, cell) => {
    const row = Math.floor(cell / 9);
    const column = cell % 9;
    if (row % 2 === 0 && column % 2 === 0) return <i className="dots-board-dot" key={cell} aria-hidden="true" />;
    if (row % 2 === 1 && column % 2 === 1) {
      const box = Math.floor(row / 2) * 4 + Math.floor(column / 2);
      const owner = boxes[box] ?? 0;
      return <span key={cell} className={`dots-board-box ${owner ? `owner-${owner}` : ""}`}>{owner ? labels[owner - 1] : ""}</span>;
    }
    const horizontal = row % 2 === 0;
    const edge = horizontal
      ? Math.floor(row / 2) * 4 + Math.floor(column / 2)
      : DOTS_HORIZONTAL_EDGE_COUNT + Math.floor(row / 2) * DOTS_GRID_SIZE + Math.floor(column / 2);
    const owner = edges[edge] ?? 0;
    return <button
      type="button"
      role="gridcell"
      key={cell}
      className={`dots-board-edge ${horizontal ? "horizontal" : "vertical"} ${owner ? `owner-${owner}` : ""} ${lastEdge === edge ? "last-edge" : ""}`}
      disabled={disabled || Boolean(owner) || !onEdge}
      onClick={() => onEdge?.(edge)}
      aria-label={`${horizontal ? "Horizontal" : "Vertical"} line ${edge + 1}${owner ? ", claimed" : ""}`}
    ><i /></button>;
  })}</div>;
}

export function DotsAndBoxes({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [edges, setEdges] = useState<number[]>(() => Array(DOTS_EDGE_COUNT).fill(0));
  const [boxes, setBoxes] = useState<number[]>(() => Array(DOTS_BOX_COUNT).fill(0));
  const [turn, setTurn] = useState<DotsBoxesPlayer>(0);
  const [moves, setMoves] = useState(0);
  const [difficulty, setDifficulty] = useState<DotsBoxesDifficulty>("normal");
  const [winner, setWinner] = useState<"player" | "cpu" | "draw" | null>(null);
  const [lastEdge, setLastEdge] = useState<number | null>(null);
  const [message, setMessage] = useState("Choose any line between two neighboring dots.");
  const scores = dotsBoxesScores(boxes);

  const playEdge = (edge: number, player: DotsBoxesPlayer) => {
    const result = applyDotsBoxesEdge(edges, boxes, edge, player);
    if (!result || winner) return;
    const nextMoves = moves + 1;
    const nextScores = dotsBoxesScores(result.boxes);
    const complete = result.edges.every(Boolean);
    setEdges(result.edges);
    setBoxes(result.boxes);
    setMoves(nextMoves);
    setLastEdge(edge);
    if (complete) {
      const nextWinner = nextScores[0] === nextScores[1] ? "draw" : nextScores[0] > nextScores[1] ? "player" : "cpu";
      setWinner(nextWinner);
      setMessage(nextWinner === "draw" ? "Perfect tie." : nextWinner === "player" ? "You control the board!" : "The CPU takes the board.");
      if (nextWinner === "player") onScore(nextMoves);
      return;
    }
    if (result.completed.length) {
      setMessage(`${player === 0 ? "Box captured" : "CPU captured a box"} — ${player === 0 ? "play again." : "CPU keeps the turn."}`);
      setTurn(player);
    } else {
      setTurn(player === 0 ? 1 : 0);
      setMessage(player === 0 ? "CPU is choosing a line…" : "Your turn — close a box or set a trap.");
    }
  };

  useEffect(() => {
    if (turn !== 1 || winner) return;
    const timer = window.setTimeout(() => {
      const edge = chooseDotsBoxesCpuEdge(edges, boxes, difficulty);
      if (edge != null) playEdge(edge, 1);
    }, 620);
    return () => window.clearTimeout(timer);
  // playEdge intentionally uses this render's immutable board snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, edges, boxes, difficulty, winner]);

  const reset = () => {
    setEdges(Array(DOTS_EDGE_COUNT).fill(0));
    setBoxes(Array(DOTS_BOX_COUNT).fill(0));
    setTurn(0);
    setMoves(0);
    setWinner(null);
    setLastEdge(null);
    setMessage("Choose any line between two neighboring dots.");
  };

  return <main className="game-shell dots-boxes-shell">
    <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" /><div className="game-header-actions"><HeaderChatButton inGame /><span className="menu-header-spacer" /></div></header>
    <section className="dots-boxes-game">
      <div className="dots-boxes-heading"><div><p className="eyebrow">STRATEGY · VS CPU</p><h1>Dots &amp; Boxes</h1><p>Draw one line. Close a square to claim it and play again.</p></div><span>点</span></div>
      <div className="cpu-difficulty"><div><span>CPU LEVEL</span><small>難易度</small></div><div className="difficulty-options">{(["easy", "normal", "hard"] as DotsBoxesDifficulty[]).map((level) => <button key={level} className={difficulty === level ? "active" : ""} onClick={() => { setDifficulty(level); reset(); }}><span>{level}</span><small>{level === "easy" ? "Relaxed" : level === "normal" ? "Balanced" : "Sharp"}</small></button>)}</div></div>
      <div className="dots-score-strip"><div className={turn === 0 && !winner ? "active" : ""}><small>YOU</small><strong>{scores[0]}</strong><span>RED BOXES</span></div><b>対<small>{moves}/40 LINES</small></b><div className={turn === 1 && !winner ? "active" : ""}><small>CPU</small><strong>{scores[1]}</strong><span>INK BOXES</span></div></div>
      <div className="dots-turn-status" role="status">{message}</div>
      <DotsBoxesBoard edges={edges} boxes={boxes} lastEdge={lastEdge} onEdge={(edge) => playEdge(edge, 0)} disabled={turn !== 0 || Boolean(winner)} labels={["YOU", "CPU"]} />
      {winner && <div className="dots-result"><strong>{winner === "draw" ? "DRAW" : winner === "player" ? "YOU WIN" : "CPU WINS"}</strong><span>{scores[0]} — {scores[1]}</span><button className="primary-button" onClick={reset}>Play again</button></div>}
    </section>
  </main>;
}
