"use client";

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { chooseGraphBotShot, formatGraphFunction, GRAPH_MAX, GRAPH_MIN, graphLineHitsPoint, graphLineY, graphPlacementAllowed, randomGraphBotPoint, snapGraphPoint, type GraphBotDifficulty, type GraphPoint } from "./graph-war-logic";

type GraphPhase = "difficulty" | "place-one" | "battle" | "won";
export type GraphShot = { id: number; player: 0 | 1; slope: number; intercept: number; hit: boolean };

const GRAPH_SPAN = GRAPH_MAX - GRAPH_MIN;
const VIEW_SIZE = 640;
const coordinates = Array.from({ length: GRAPH_SPAN + 1 }, (_, index) => GRAPH_MIN + index);

function graphX(value: number) { return ((value - GRAPH_MIN) / GRAPH_SPAN) * VIEW_SIZE; }
function graphY(value: number) { return ((GRAPH_MAX - value) / GRAPH_SPAN) * VIEW_SIZE; }

export function GraphWarBoard({ positions, shots, currentPlayer, placingPlayer, preview, onPlace, labels = ["YOU", "BOT"] }: {
  positions: [GraphPoint | null, GraphPoint | null];
  shots: GraphShot[];
  currentPlayer: 0 | 1;
  placingPlayer: 0 | 1 | null;
  preview?: { slope: number; intercept: number } | null;
  onPlace?: (point: GraphPoint) => void;
  labels?: [string, string];
}) {
  const placeDot = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (placingPlayer == null || !onPlace) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onPlace(snapGraphPoint(
      GRAPH_MIN + ((event.clientX - bounds.left) / bounds.width) * GRAPH_SPAN,
      GRAPH_MAX - ((event.clientY - bounds.top) / bounds.height) * GRAPH_SPAN,
    ));
  };
  return <div className={`graph-war-board-wrap ${placingPlayer != null ? "is-placing" : ""}`}>
    <svg className="graph-war-board" viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} onClick={placeDot} role="img" aria-label="Coordinate graph from negative eight to eight on both axes">
      <defs><pattern id="graph-war-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" /></pattern><clipPath id="graph-war-clip"><rect width={VIEW_SIZE} height={VIEW_SIZE} rx="18" /></clipPath></defs>
      <g clipPath="url(#graph-war-clip)">
        <rect className="graph-war-field" width={VIEW_SIZE} height={VIEW_SIZE} />
        {placingPlayer != null && <><rect className="graph-home-zone player-one" x="40" y="40" width="200" height="560" /><rect className="graph-home-zone player-two" x="400" y="40" width="200" height="560" /></>}
        <rect className="graph-grid-lines" width={VIEW_SIZE} height={VIEW_SIZE} fill="url(#graph-war-grid)" />
        <line className="graph-axis" x1={0} y1={graphY(0)} x2={VIEW_SIZE} y2={graphY(0)} /><line className="graph-axis" x1={graphX(0)} y1={0} x2={graphX(0)} y2={VIEW_SIZE} />
        {coordinates.filter((value) => value !== 0 && value % 2 === 0).map((value) => <g key={value} className="graph-ticks"><text x={graphX(value)} y={graphY(0) + 19} textAnchor="middle">{value}</text><text x={graphX(0) - 10} y={graphY(value) + 4} textAnchor="end">{value}</text></g>)}
        {shots.map((shot) => <line key={shot.id} className={`graph-shot player-${shot.player + 1} ${shot.hit ? "is-hit" : ""}`} x1={graphX(GRAPH_MIN)} y1={graphY(graphLineY(shot.slope, shot.intercept, GRAPH_MIN))} x2={graphX(GRAPH_MAX)} y2={graphY(graphLineY(shot.slope, shot.intercept, GRAPH_MAX))} />)}
        {preview && <line className={`graph-preview player-${currentPlayer + 1}`} x1={graphX(GRAPH_MIN)} y1={graphY(graphLineY(preview.slope, preview.intercept, GRAPH_MIN))} x2={graphX(GRAPH_MAX)} y2={graphY(graphLineY(preview.slope, preview.intercept, GRAPH_MAX))} />}
        {positions.map((point, player) => point && <g key={player} className={`graph-player-dot player-${player + 1}`} transform={`translate(${graphX(point.x)} ${graphY(point.y)})`}><circle r="17" /><circle r="6" /><text y="-25" textAnchor="middle">{labels[player]}</text></g>)}
      </g>
    </svg>
  </div>;
}

const difficultyDetails: { id: GraphBotDifficulty; label: string; hint: string; glyph: string }[] = [
  { id: "easy", label: "Easy", hint: "Wide misses, slow learning", glyph: "芽" },
  { id: "medium", label: "Medium", hint: "Sharper aim each round", glyph: "技" },
  { id: "hard", label: "Hard", hint: "Precise and fast", glyph: "極" },
];

export function GraphWar({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<GraphPhase>("difficulty");
  const [difficulty, setDifficulty] = useState<GraphBotDifficulty>("medium");
  const [positions, setPositions] = useState<[GraphPoint | null, GraphPoint | null]>([null, null]);
  const [currentPlayer, setCurrentPlayer] = useState<0 | 1>(0);
  const [slope, setSlope] = useState("0");
  const [intercept, setIntercept] = useState("0");
  const [shots, setShots] = useState<GraphShot[]>([]);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [message, setMessage] = useState("Choose how sharp the rival bot should be.");

  const parsedSlope = Number(slope);
  const parsedIntercept = Number(intercept);
  const validFunction = Number.isFinite(parsedSlope) && Number.isFinite(parsedIntercept) && Math.abs(parsedSlope) <= 6 && Math.abs(parsedIntercept) <= 12;
  const preview = useMemo(() => validFunction && phase === "battle" && currentPlayer === 0 ? { slope: parsedSlope, intercept: parsedIntercept } : null, [currentPlayer, parsedIntercept, parsedSlope, phase, validFunction]);

  const begin = (nextDifficulty = difficulty) => {
    setDifficulty(nextDifficulty); setPhase("place-one"); setPositions([null, randomGraphBotPoint()]); setCurrentPlayer(0); setSlope("0"); setIntercept("0"); setShots([]); setWinner(null); setMessage("Tap a point in the red home zone to hide your dot.");
  };
  const reset = () => { setPhase("difficulty"); setPositions([null, null]); setShots([]); setWinner(null); setMessage("Choose how sharp the rival bot should be."); };
  const placeDot = (point: GraphPoint) => {
    if (phase !== "place-one") return;
    if (!graphPlacementAllowed(0, point)) { setMessage("Choose a point inside your red left home zone."); return; }
    setPositions((current) => [point, current[1]]); setPhase("battle"); setMessage("Enter a linear function and fire at the bot dot.");
  };
  const fire = (event: FormEvent) => {
    event.preventDefault();
    if (phase !== "battle" || currentPlayer !== 0 || !validFunction) { if (!validFunction) setMessage("Use numbers from −6 to 6 for m and −12 to 12 for b."); return; }
    const target = positions[1]; if (!target) return;
    const hit = graphLineHitsPoint(target, parsedSlope, parsedIntercept);
    setShots((current) => [...current, { id: current.length + 1, player: 0, slope: parsedSlope, intercept: parsedIntercept, hit }]);
    if (hit) { setWinner(0); setPhase("won"); setMessage("Direct hit! You defeated the bot."); return; }
    setCurrentPlayer(1); setMessage(`${difficultyDetails.find((item) => item.id === difficulty)?.label} bot is calculating…`);
  };

  useEffect(() => {
    if (phase !== "battle" || currentPlayer !== 1 || !positions[0]) return;
    const delay = difficulty === "easy" ? 850 : difficulty === "medium" ? 650 : 450;
    const timer = window.setTimeout(() => {
      const botShots = shots.filter((shot) => shot.player === 1).length;
      const shot = chooseGraphBotShot(positions[0]!, difficulty, Math.random, botShots);
      const hit = graphLineHitsPoint(positions[0]!, shot.slope, shot.intercept);
      setShots((current) => [...current, { id: current.length + 1, player: 1, ...shot, hit }]);
      if (hit) { setWinner(1); setPhase("won"); setMessage("The bot found your dot. Try a new position."); }
      else { setCurrentPlayer(0); setMessage("The bot missed. Your turn—adjust the function and fire."); }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentPlayer, difficulty, phase, positions, shots]);

  return <main className="game-shell graph-war-shell">
    <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Graph War">↻</button></div></header>
    <section className="graph-war-game">
      <div className="graph-war-heading"><div><p className="eyebrow">FUNCTION BATTLE · SOLO BOT</p><h1>Graph War</h1><p>Plot your position. Fire a function. Beat the rival bot.</p></div><span aria-hidden="true">関</span></div>
      {phase === "difficulty" ? <div className="graph-difficulty"><p>SELECT BOT LEVEL</p><div>{difficultyDetails.map((item) => <button key={item.id} onClick={() => begin(item.id)}><b>{item.glyph}</b><strong>{item.label}</strong><span>{item.hint}</span></button>)}</div></div> : <>
        <div className="graph-war-turnbar" aria-label="Graph War status"><div className={currentPlayer === 0 && phase === "battle" ? "active" : ""}><small>PLAYER 1</small><strong>YOU</strong><span>{positions[0] ? `(${positions[0].x}, ${positions[0].y})` : "PLACE DOT"}</span></div><b>{phase === "battle" ? `TURN ${shots.length + 1}` : phase === "won" ? "HIT" : "SETUP"}</b><div className={currentPlayer === 1 && phase === "battle" ? "active" : ""}><small>{difficulty.toUpperCase()}</small><strong>BOT</strong><span>{positions[1] ? `(${positions[1].x}, ${positions[1].y})` : "BOT DOT"}</span></div></div>
        <p className="graph-war-message" role="status" aria-live="polite">{message}</p>
        <GraphWarBoard positions={positions} shots={shots} currentPlayer={currentPlayer} placingPlayer={phase === "place-one" ? 0 : null} preview={preview} onPlace={placeDot} />
        {(phase === "battle" || phase === "won") && <div className="graph-war-console"><form onSubmit={fire}><div className="graph-function-readout"><small>YOUR FUNCTION</small><strong>{validFunction ? formatGraphFunction(parsedSlope, parsedIntercept) : "Check your values"}</strong></div><label><span>SLOPE · m</span><input type="number" min="-6" max="6" step="0.25" value={slope} onChange={(event) => setSlope(event.target.value)} inputMode="decimal" disabled={phase === "won" || currentPlayer === 1} /></label><label><span>INTERCEPT · b</span><input type="number" min="-12" max="12" step="0.25" value={intercept} onChange={(event) => setIntercept(event.target.value)} inputMode="decimal" disabled={phase === "won" || currentPlayer === 1} /></label><button className="primary-button graph-fire" type="submit" disabled={phase === "won" || currentPlayer === 1 || !validFunction}>FIRE LINE <b>→</b></button></form><div className="graph-shot-log"><small>SHOT HISTORY</small>{shots.length ? shots.slice(-4).reverse().map((shot) => <span key={shot.id} className={`player-${shot.player + 1}`}><b>{shot.player === 0 ? "YOU" : "BOT"}</b>{formatGraphFunction(shot.slope, shot.intercept)}<em>{shot.hit ? "HIT" : "MISS"}</em></span>) : <p>No lines fired yet.</p>}</div></div>}
        {winner != null && <GameResult outcome={winner === 0 ? "You Win!" : "Bot Wins"} detail={`${formatGraphFunction(shots.at(-1)?.slope ?? 0, shots.at(-1)?.intercept ?? 0)} landed the hit in ${shots.length} ${shots.length === 1 ? "shot" : "shots"}.`} onPlayAgain={() => begin(difficulty)} />}
      </>}
    </section>
  </main>;
}
