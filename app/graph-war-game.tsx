"use client";

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { chooseGraphBotFunction, compileGraphExpression, GRAPH_MAX, GRAPH_MIN, graphModeLabel, graphObstaclesForSeed, graphPlacementAllowed, randomGraphBotPoint, snapGraphPoint, traceGraphFunction, type GraphBotDifficulty, type GraphFunctionMode, type GraphFunctionShot, type GraphObstacle, type GraphPoint } from "./graph-war-logic";

type GraphPhase = "difficulty" | "place-one" | "battle" | "won";
export type GraphShot = GraphFunctionShot & { id: number; points: GraphPoint[]; hit: boolean; exploded: boolean };

const GRAPH_SPAN = GRAPH_MAX - GRAPH_MIN;
const VIEW_SIZE = GRAPH_SPAN * 40;
const coordinates = Array.from({ length: GRAPH_SPAN + 1 }, (_, index) => GRAPH_MIN + index);
const modeDetails: { id: GraphFunctionMode; label: string; sub: string }[] = [
  { id: "normal", label: "y = f(x)", sub: "Function" },
  { id: "first", label: "y′ = f(x,y)", sub: "1st order" },
  { id: "second", label: "y″ = f(x,y,y′)", sub: "2nd order" },
];
const examples: { mode: GraphFunctionMode; expression: string; label: string }[] = [
  { mode: "normal", expression: "2x", label: "LINE" },
  { mode: "normal", expression: "(x^2)/8", label: "PARABOLA" },
  { mode: "normal", expression: "5sin(x/2)", label: "SINE" },
  { mode: "normal", expression: "2sqrt(abs(x))", label: "ROOT" },
  { mode: "normal", expression: "ln(abs(x)+1)", label: "LOG" },
  { mode: "first", expression: "-y/3", label: "1ST ODE" },
  { mode: "second", expression: "-y", label: "2ND ODE" },
];

function graphX(value: number) { return ((value - GRAPH_MIN) / GRAPH_SPAN) * VIEW_SIZE; }
function graphY(value: number) { return ((GRAPH_MAX - value) / GRAPH_SPAN) * VIEW_SIZE; }
function graphPath(points: GraphPoint[]) { return points.map((point) => `${graphX(point.x)},${graphY(point.y)}`).join(" "); }
export function graphShotText(shot: Pick<GraphFunctionShot, "mode" | "expression">) { return `${graphModeLabel(shot.mode)} = ${shot.expression.replaceAll("*", "×")}`; }

export function GraphWarBoard({ positions, shots, obstacles, currentPlayer, placingPlayer, preview, onPlace, labels = ["YOU", "BOT"] }: {
  positions: [GraphPoint | null, GraphPoint | null]; shots: GraphShot[]; obstacles: GraphObstacle[]; currentPlayer: 0 | 1;
  placingPlayer: 0 | 1 | null; preview?: GraphPoint[] | null; onPlace?: (point: GraphPoint) => void; labels?: [string, string];
}) {
  const placeDot = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (placingPlayer == null || !onPlace) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onPlace(snapGraphPoint(GRAPH_MIN + ((event.clientX - bounds.left) / bounds.width) * GRAPH_SPAN, GRAPH_MAX - ((event.clientY - bounds.top) / bounds.height) * GRAPH_SPAN));
  };
  return <div className={`graph-war-board-wrap ${placingPlayer != null ? "is-placing" : ""}`}>
    <svg className="graph-war-board" viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} onClick={placeDot} role="img" aria-label={`Coordinate battlefield from ${GRAPH_MIN} to ${GRAPH_MAX} on both axes`}>
      <defs><pattern id="graph-war-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" /></pattern><clipPath id="graph-war-clip"><rect width={VIEW_SIZE} height={VIEW_SIZE} rx="18" /></clipPath></defs>
      <g clipPath="url(#graph-war-clip)">
        <rect className="graph-war-field" width={VIEW_SIZE} height={VIEW_SIZE} />
        {placingPlayer != null && <><rect className="graph-home-zone player-one" x={graphX(GRAPH_MIN + 1)} y={graphY(GRAPH_MAX - 1)} width={graphX(-2) - graphX(GRAPH_MIN + 1)} height={graphY(GRAPH_MIN + 1) - graphY(GRAPH_MAX - 1)} /><rect className="graph-home-zone player-two" x={graphX(2)} y={graphY(GRAPH_MAX - 1)} width={graphX(GRAPH_MAX - 1) - graphX(2)} height={graphY(GRAPH_MIN + 1) - graphY(GRAPH_MAX - 1)} /></>}
        <rect className="graph-grid-lines" width={VIEW_SIZE} height={VIEW_SIZE} fill="url(#graph-war-grid)" />
        <line className="graph-axis" x1={0} y1={graphY(0)} x2={VIEW_SIZE} y2={graphY(0)} /><line className="graph-axis" x1={graphX(0)} y1={0} x2={graphX(0)} y2={VIEW_SIZE} />
        {coordinates.filter((value) => value !== 0 && value % 2 === 0 && value > GRAPH_MIN && value < GRAPH_MAX).map((value) => <g key={value} className="graph-ticks"><text x={graphX(value)} y={graphY(0) + 19} textAnchor="middle">{value}</text><text x={graphX(0) - 10} y={graphY(value) + 4} textAnchor="end">{value}</text></g>)}
        {obstacles.map((obstacle, index) => <g className="graph-obstacle" key={index} transform={`translate(${graphX(obstacle.x)} ${graphY(obstacle.y)})`}><circle r={obstacle.radius * 40} /><path transform={`scale(${obstacle.radius / 0.7})`} d="M-14-9 14 9M-13 12 10-13" /></g>)}
        {shots.slice(-1).map((shot) => <g className="graph-shot-visual" key={shot.id}><polyline className={`graph-shot player-${shot.player + 1} ${shot.hit ? "is-hit" : ""}`} points={graphPath(shot.points)} />{shot.exploded && <circle className="graph-explosion" cx={graphX(shot.points.at(-1)?.x ?? 0)} cy={graphY(shot.points.at(-1)?.y ?? 0)} r="15" />}</g>)}
        {preview && preview.length > 1 && <polyline className={`graph-preview player-${currentPlayer + 1}`} points={graphPath(preview)} />}
        {positions.map((point, player) => point && <g key={player} className={`graph-player-dot player-${player + 1}`} transform={`translate(${graphX(point.x)} ${graphY(point.y)})`}><circle r="17" /><circle r="6" /><text y="-25" textAnchor="middle">{labels[player]}</text></g>)}
      </g>
    </svg>
  </div>;
}

export function GraphFunctionConsole({ mode, expression, angle, disabled, history, playerIndex = 0, onMode, onExpression, onAngle, onFire }: {
  mode: GraphFunctionMode; expression: string; angle: number; disabled: boolean; history: GraphShot[]; playerIndex?: 0 | 1;
  onMode: (mode: GraphFunctionMode) => void; onExpression: (value: string) => void; onAngle: (value: number) => void; onFire: () => void;
}) {
  let error = "";
  try { compileGraphExpression(expression); } catch (caught) { error = caught instanceof Error ? caught.message : "Check the function."; }
  return <div className="graph-war-console graph-war-console-full">
    <div className="graph-function-panel">
      <div className="graph-mode-picker">{modeDetails.map((item) => <button type="button" key={item.id} className={mode === item.id ? "active" : ""} onClick={() => onMode(item.id)} disabled={disabled}><strong>{item.label}</strong><span>{item.sub}</span></button>)}</div>
      <div className="graph-equation-row"><span>{graphModeLabel(mode)} =</span><input aria-label="Graph War function" value={expression} onChange={(event) => onExpression(event.target.value.replaceAll("**", "^").replaceAll("*", "×"))} disabled={disabled} autoComplete="off" spellCheck={false} placeholder={mode === "normal" ? "5sin(x/2)" : mode === "first" ? "-y/3" : "-y + 2x"} /><button className="primary-button graph-fire" type="button" disabled={disabled || Boolean(error)} onClick={onFire}>FIRE <b>→</b></button></div>
      {mode === "second" && <label className="graph-angle"><span>FIRING ANGLE <b>{angle}°</b></span><input type="range" min="-70" max="70" step="1" value={angle} onChange={(event) => onAngle(Number(event.target.value))} disabled={disabled} /></label>}
      <div className="graph-example-row" aria-label="Function examples">{examples.map((example) => <button type="button" key={`${example.mode}-${example.label}`} onClick={() => { onMode(example.mode); onExpression(example.expression); }} disabled={disabled}>{example.label}</button>)}</div>
      <p className={error ? "graph-function-help is-error" : "graph-function-help"}>{error || "Use x, y, y′ · + − × ÷ ^ · sin cos tan sqrt log ln abs exp min max"}</p>
    </div>
    <div className="graph-shot-log"><small>SHOT HISTORY</small>{history.length ? history.slice(-5).reverse().map((shot) => <span key={shot.id} className={`player-${shot.player + 1}`}><b>{shot.player === playerIndex ? "YOU" : playerIndex === 0 ? "BOT" : "RIVAL"}</b><i>{graphShotText(shot)}</i><em>{shot.hit ? "HIT" : shot.exploded ? "BOOM" : "MISS"}</em></span>) : <p>No functions fired yet.</p>}</div>
  </div>;
}

const difficultyDetails: { id: GraphBotDifficulty; label: string; hint: string; glyph: string }[] = [
  { id: "easy", label: "Easy", hint: "Simple functions, wide misses", glyph: "芽" },
  { id: "medium", label: "Medium", hint: "Curves and differential shots", glyph: "技" },
  { id: "hard", label: "Hard", hint: "Precise calculus attacks", glyph: "極" },
];

export function GraphWar({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<GraphPhase>("difficulty");
  const [difficulty, setDifficulty] = useState<GraphBotDifficulty>("medium");
  const [positions, setPositions] = useState<[GraphPoint | null, GraphPoint | null]>([null, null]);
  const [currentPlayer, setCurrentPlayer] = useState<0 | 1>(0);
  const [mode, setMode] = useState<GraphFunctionMode>("normal");
  const [expression, setExpression] = useState("2x");
  const [angle, setAngle] = useState(0);
  const [shots, setShots] = useState<GraphShot[]>([]);
  const [obstacles, setObstacles] = useState<GraphObstacle[]>([]);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [message, setMessage] = useState("Choose how sharp the rival bot should be.");
  const [matchNumber, setMatchNumber] = useState(0);

  const preview = useMemo(() => {
    if (difficulty !== "easy" || phase !== "battle" || currentPlayer !== 0 || !positions[0]) return null;
    const result = traceGraphFunction({ player: 0, mode, expression, angle }, positions[0], null, obstacles);
    return result.exploded && result.points.length === 1 ? null : result.points;
  }, [angle, currentPlayer, difficulty, expression, mode, obstacles, phase, positions]);

  const begin = (nextDifficulty = difficulty) => {
    const nextMatch = matchNumber + 1;
    const nextObstacles = graphObstaclesForSeed(`${nextDifficulty}-${nextMatch}`);
    setMatchNumber(nextMatch); setDifficulty(nextDifficulty); setPhase("place-one"); setPositions([null, randomGraphBotPoint(Math.random, nextObstacles)]); setCurrentPlayer(0); setMode("normal"); setExpression("2x"); setAngle(0); setShots([]); setObstacles(nextObstacles); setWinner(null); setMessage("Tap a point in the red home zone to deploy your soldier.");
  };
  const reset = () => { setPhase("difficulty"); setPositions([null, null]); setShots([]); setObstacles([]); setWinner(null); setMessage("Choose how sharp the rival bot should be."); };
  const placeDot = (point: GraphPoint) => {
    if (phase !== "place-one") return;
    if (!graphPlacementAllowed(0, point)) { setMessage("Choose a point inside your red left home zone."); return; }
    if (obstacles.some((obstacle) => Math.hypot(point.x - obstacle.x, point.y - obstacle.y) <= obstacle.radius + 0.5)) { setMessage("That position is too close to an obstacle."); return; }
    setPositions((current) => [point, current[1]]); setPhase("battle"); setMessage("Build any supported function and fire from your soldier.");
  };
  const fire = () => {
    if (phase !== "battle" || currentPlayer !== 0 || !positions[0] || !positions[1]) return;
    const functionShot: GraphFunctionShot = { player: 0, mode, expression: expression.trim(), angle };
    const result = traceGraphFunction(functionShot, positions[0], positions[1], obstacles);
    if (result.points.length === 1 && result.exploded) { setMessage("Invalid function—the shot exploded at launch."); return; }
    setShots((current) => [...current, { id: current.length + 1, ...functionShot, ...result }]);
    if (result.hit) { setWinner(0); setPhase("won"); setMessage("Direct hit! Your function defeated the bot."); return; }
    setCurrentPlayer(1); setMessage(`${difficultyDetails.find((item) => item.id === difficulty)?.label} bot is calculating a counter-function…`);
  };

  useEffect(() => {
    if (phase !== "battle" || currentPlayer !== 1 || !positions[0] || !positions[1]) return;
    const timer = window.setTimeout(() => {
      const botFunction = chooseGraphBotFunction(positions[1]!, positions[0]!, difficulty, Math.random, shots.filter((shot) => shot.player === 1).length, obstacles);
      const functionShot: GraphFunctionShot = { player: 1, ...botFunction };
      const result = traceGraphFunction(functionShot, positions[1]!, positions[0]!, obstacles);
      setShots((current) => [...current, { id: current.length + 1, ...functionShot, ...result }]);
      if (result.hit) { setWinner(1); setPhase("won"); setMessage("The bot hit your soldier. Try a new position or function family."); }
      else { setCurrentPlayer(0); setMessage(result.exploded ? "The bot hit an obstacle. Your turn." : "The bot missed. Your turn—bend a function around the obstacles."); }
    }, difficulty === "easy" ? 900 : difficulty === "medium" ? 680 : 480);
    return () => window.clearTimeout(timer);
  }, [currentPlayer, difficulty, obstacles, phase, positions, shots]);

  return <main className="game-shell graph-war-shell">
    <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Graph War">↻</button></div></header>
    <section className="graph-war-game">
      <div className="graph-war-heading"><div><p className="eyebrow">MATHEMATICAL ARTILLERY · SOLO BOT</p><h1>Graph War</h1><p>Functions, differential equations, obstacles, and precision shots.</p></div><span aria-hidden="true">関</span></div>
      {phase === "difficulty" ? <div className="graph-difficulty">
        <p>QUICK FUNCTION GUIDE</p>
        <div className="graph-function-guide" aria-label="Basic examples of each Graph War function type">
          <article><span>FUNCTION</span><strong>y = 2x</strong><small>A straight line</small></article>
          <article><span>1ST ORDER</span><strong>y′ = 1</strong><small>A constant slope</small></article>
          <article><span>2ND ORDER</span><strong>y″ = −0.2</strong><small>A downward curve</small></article>
        </div>
        <p>SELECT BOT LEVEL</p>
        <div className="graph-difficulty-levels">{difficultyDetails.map((item) => <button key={item.id} onClick={() => begin(item.id)}><b>{item.glyph}</b><strong>{item.label}</strong><span>{item.hint}</span></button>)}</div>
      </div> : <>
        <div className="graph-war-turnbar" aria-label="Graph War status"><div className={currentPlayer === 0 && phase === "battle" ? "active" : ""}><small>RED TEAM</small><strong>YOU</strong><span>{positions[0] ? `(${positions[0].x}, ${positions[0].y})` : "DEPLOY"}</span></div><b>{phase === "battle" ? `TURN ${shots.length + 1}` : phase === "won" ? "HIT" : "SETUP"}</b><div className={currentPlayer === 1 && phase === "battle" ? "active" : ""}><small>{difficulty.toUpperCase()}</small><strong>BOT</strong><span>{positions[1] ? `(${positions[1].x}, ${positions[1].y})` : "DEPLOY"}</span></div></div>
        <p className="graph-war-message" role="status" aria-live="polite">{message}</p>
        <GraphWarBoard positions={positions} shots={shots} obstacles={obstacles} currentPlayer={currentPlayer} placingPlayer={phase === "place-one" ? 0 : null} preview={preview} onPlace={placeDot} />
        {(phase === "battle" || phase === "won") && <GraphFunctionConsole mode={mode} expression={expression} angle={angle} disabled={phase === "won" || currentPlayer === 1} history={shots} onMode={setMode} onExpression={setExpression} onAngle={setAngle} onFire={fire} />}
        {winner != null && <GameResult outcome={winner === 0 ? "You Win!" : "Bot Wins"} detail={`${graphShotText(shots.at(-1) ?? { mode: "normal", expression: "0" })} landed the hit after ${shots.length} ${shots.length === 1 ? "shot" : "shots"}.`} onPlayAgain={() => begin(difficulty)} />}
      </>}
    </section>
  </main>;
}
