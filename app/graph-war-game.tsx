"use client";

import { useMemo, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { formatGraphFunction, GRAPH_MAX, GRAPH_MIN, graphLineHitsPoint, graphLineY, graphPlacementAllowed, snapGraphPoint, type GraphPoint } from "./graph-war-logic";

type GraphPhase = "place-one" | "place-two" | "battle" | "won";
type GraphShot = { id: number; player: 0 | 1; slope: number; intercept: number; hit: boolean };

const GRAPH_SPAN = GRAPH_MAX - GRAPH_MIN;
const VIEW_SIZE = 640;
const coordinates = Array.from({ length: GRAPH_SPAN + 1 }, (_, index) => GRAPH_MIN + index);

function graphX(value: number) {
  return ((value - GRAPH_MIN) / GRAPH_SPAN) * VIEW_SIZE;
}

function graphY(value: number) {
  return ((GRAPH_MAX - value) / GRAPH_SPAN) * VIEW_SIZE;
}

export function GraphWar({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<GraphPhase>("place-one");
  const [positions, setPositions] = useState<[GraphPoint | null, GraphPoint | null]>([null, null]);
  const [currentPlayer, setCurrentPlayer] = useState<0 | 1>(0);
  const [slope, setSlope] = useState("0");
  const [intercept, setIntercept] = useState("0");
  const [shots, setShots] = useState<GraphShot[]>([]);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [message, setMessage] = useState("Player 1: tap a point in the red home zone.");

  const parsedSlope = Number(slope);
  const parsedIntercept = Number(intercept);
  const validFunction = Number.isFinite(parsedSlope) && Number.isFinite(parsedIntercept) && Math.abs(parsedSlope) <= 6 && Math.abs(parsedIntercept) <= 12;
  const preview = useMemo(() => validFunction ? {
    x1: graphX(GRAPH_MIN),
    y1: graphY(graphLineY(parsedSlope, parsedIntercept, GRAPH_MIN)),
    x2: graphX(GRAPH_MAX),
    y2: graphY(graphLineY(parsedSlope, parsedIntercept, GRAPH_MAX)),
  } : null, [parsedIntercept, parsedSlope, validFunction]);

  const reset = () => {
    setPhase("place-one");
    setPositions([null, null]);
    setCurrentPlayer(0);
    setSlope("0");
    setIntercept("0");
    setShots([]);
    setWinner(null);
    setMessage("Player 1: tap a point in the red home zone.");
  };

  const placeDot = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (phase !== "place-one" && phase !== "place-two") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = snapGraphPoint(
      GRAPH_MIN + ((event.clientX - bounds.left) / bounds.width) * GRAPH_SPAN,
      GRAPH_MAX - ((event.clientY - bounds.top) / bounds.height) * GRAPH_SPAN,
    );
    const player: 0 | 1 = phase === "place-one" ? 0 : 1;
    if (!graphPlacementAllowed(player, point)) {
      setMessage(`Player ${player + 1}: choose a point inside your ${player === 0 ? "red left" : "gold right"} home zone.`);
      return;
    }
    if (player === 0) {
      setPositions([point, null]);
      setPhase("place-two");
      setMessage("Player 2: tap a point in the gold home zone.");
      return;
    }
    setPositions((current) => [current[0], point]);
    setPhase("battle");
    setCurrentPlayer(0);
    setMessage("Player 1: enter a linear function and fire.");
  };

  const fire = (event: FormEvent) => {
    event.preventDefault();
    if (phase !== "battle" || !validFunction) {
      if (!validFunction) setMessage("Use numbers from −6 to 6 for m and −12 to 12 for b.");
      return;
    }
    const target = positions[currentPlayer === 0 ? 1 : 0];
    if (!target) return;
    const hit = graphLineHitsPoint(target, parsedSlope, parsedIntercept);
    setShots((current) => [...current, { id: current.length + 1, player: currentPlayer, slope: parsedSlope, intercept: parsedIntercept, hit }]);
    if (hit) {
      setWinner(currentPlayer);
      setPhase("won");
      setMessage(`Direct hit! Player ${currentPlayer + 1} wins.`);
      return;
    }
    const nextPlayer: 0 | 1 = currentPlayer === 0 ? 1 : 0;
    setCurrentPlayer(nextPlayer);
    setMessage(`Missed. Player ${nextPlayer + 1}, enter your function.`);
  };

  return <main className="game-shell graph-war-shell">
    <header className="game-topbar">
      <button className="back-button" onClick={onBack}>← Game menu</button>
      <span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" />
      <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Graph War">↻</button></div>
    </header>

    <section className="graph-war-game">
      <div className="graph-war-heading"><div><p className="eyebrow">FUNCTION BATTLE · LOCAL VERSUS</p><h1>Graph War</h1><p>Plot your position. Fire a function. Hit the rival dot.</p></div><span aria-hidden="true">関</span></div>

      <div className="graph-war-turnbar" aria-label="Graph War status">
        <div className={currentPlayer === 0 && phase === "battle" ? "active" : ""}><small>PLAYER 1</small><strong>RED</strong><span>{positions[0] ? `(${positions[0].x}, ${positions[0].y})` : "PLACE DOT"}</span></div>
        <b>{phase === "battle" ? `TURN ${shots.length + 1}` : phase === "won" ? "HIT" : "SETUP"}</b>
        <div className={currentPlayer === 1 && phase === "battle" ? "active" : ""}><small>PLAYER 2</small><strong>GOLD</strong><span>{positions[1] ? `(${positions[1].x}, ${positions[1].y})` : "PLACE DOT"}</span></div>
      </div>

      <p className="graph-war-message" role="status" aria-live="polite">{message}</p>

      <div className={`graph-war-board-wrap ${phase.startsWith("place") ? "is-placing" : ""}`}>
        <svg className="graph-war-board" viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} onClick={placeDot} role="img" aria-label="Coordinate graph from negative eight to eight on both axes">
          <defs><pattern id="graph-war-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" /></pattern><clipPath id="graph-war-clip"><rect width={VIEW_SIZE} height={VIEW_SIZE} rx="18" /></clipPath></defs>
          <g clipPath="url(#graph-war-clip)">
            <rect className="graph-war-field" width={VIEW_SIZE} height={VIEW_SIZE} />
            {(phase === "place-one" || phase === "place-two") && <><rect className="graph-home-zone player-one" x="40" y="40" width="200" height="560" /><rect className="graph-home-zone player-two" x="400" y="40" width="200" height="560" /></>}
            <rect className="graph-grid-lines" width={VIEW_SIZE} height={VIEW_SIZE} fill="url(#graph-war-grid)" />
            <line className="graph-axis" x1={0} y1={graphY(0)} x2={VIEW_SIZE} y2={graphY(0)} /><line className="graph-axis" x1={graphX(0)} y1={0} x2={graphX(0)} y2={VIEW_SIZE} />
            {coordinates.filter((value) => value !== 0 && value % 2 === 0).map((value) => <g key={value} className="graph-ticks"><text x={graphX(value)} y={graphY(0) + 19} textAnchor="middle">{value}</text><text x={graphX(0) - 10} y={graphY(value) + 4} textAnchor="end">{value}</text></g>)}
            {shots.map((shot) => <line key={shot.id} className={`graph-shot player-${shot.player + 1} ${shot.hit ? "is-hit" : ""}`} x1={graphX(GRAPH_MIN)} y1={graphY(graphLineY(shot.slope, shot.intercept, GRAPH_MIN))} x2={graphX(GRAPH_MAX)} y2={graphY(graphLineY(shot.slope, shot.intercept, GRAPH_MAX))} />)}
            {phase === "battle" && preview && <line className={`graph-preview player-${currentPlayer + 1}`} {...preview} />}
            {positions.map((point, player) => point && <g key={player} className={`graph-player-dot player-${player + 1}`} transform={`translate(${graphX(point.x)} ${graphY(point.y)})`}><circle r="17" /><circle r="6" /><text y="-25" textAnchor="middle">P{player + 1}</text></g>)}
          </g>
        </svg>
      </div>

      {(phase === "battle" || phase === "won") && <div className="graph-war-console">
        <form onSubmit={fire}>
          <div className="graph-function-readout"><small>PLAYER {currentPlayer + 1} FUNCTION</small><strong>{validFunction ? formatGraphFunction(parsedSlope, parsedIntercept) : "Check your values"}</strong></div>
          <label><span>SLOPE · m</span><input type="number" min="-6" max="6" step="0.25" value={slope} onChange={(event) => setSlope(event.target.value)} inputMode="decimal" disabled={phase === "won"} /></label>
          <label><span>INTERCEPT · b</span><input type="number" min="-12" max="12" step="0.25" value={intercept} onChange={(event) => setIntercept(event.target.value)} inputMode="decimal" disabled={phase === "won"} /></label>
          <button className="primary-button graph-fire" type="submit" disabled={phase === "won" || !validFunction}>FIRE LINE <b>→</b></button>
        </form>
        <div className="graph-shot-log"><small>SHOT HISTORY</small>{shots.length ? shots.slice(-4).reverse().map((shot) => <span key={shot.id} className={`player-${shot.player + 1}`}><b>P{shot.player + 1}</b>{formatGraphFunction(shot.slope, shot.intercept)}<em>{shot.hit ? "HIT" : "MISS"}</em></span>) : <p>No lines fired yet.</p>}</div>
      </div>}

      {winner != null && <GameResult outcome={`Player ${winner + 1} Wins!`} detail={`${formatGraphFunction(shots.at(-1)?.slope ?? 0, shots.at(-1)?.intercept ?? 0)} hit Player ${winner === 0 ? 2 : 1}'s dot in ${shots.length} ${shots.length === 1 ? "shot" : "shots"}.`} onPlayAgain={reset} />}
    </section>
  </main>;
}
