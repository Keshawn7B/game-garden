"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { AIR_HOCKEY_LIVE_START, AIR_HOCKEY_MATCH_SECONDS, AIR_HOCKEY_WIN_SCORE, airHockeyPuckSpeedCap, moveAirHockeyCpu, stepAirHockeyLive, type AirHockeyBody, type AirHockeyDifficulty, type AirHockeyPlayer, type AirHockeyPoint } from "./air-hockey";

const MALLET_STARTS: [AirHockeyPoint, AirHockeyPoint] = [{ x: 50, y: 124 }, { x: 50, y: 26 }];
const ZERO_VELOCITY: AirHockeyPoint = { x: 0, y: 0 };

function servePuck(round: number): AirHockeyBody {
  const direction = round % 2 === 0 ? -1 : 1;
  return { ...AIR_HOCKEY_LIVE_START, vx: 16 * direction, vy: 28 * direction };
}

function placeAirHockeyElement(element: HTMLElement | null, point: AirHockeyPoint) {
  if (!element) return;
  element.style.left = `${point.x}%`;
  element.style.top = `${point.y / 1.5}%`;
}

function airHockeyClock(seconds: number) {
  const safe = Math.max(0, Math.min(AIR_HOCKEY_MATCH_SECONDS, Math.ceil(seconds)));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function AirHockeyFullscreenScoreboard({ scores, names, secondsLeft, onClose }: { scores: [number, number]; names: [string, string]; secondsLeft: number; onClose: () => void }) {
  return <div className="air-fullscreen-scoreboard" aria-label={`${airHockeyClock(secondsLeft)} remaining. ${names[0]} ${scores[0]}, ${names[1]} ${scores[1]}.`}>
    <div className="air-fullscreen-player player-one"><small>{names[0]}</small><strong>{scores[0]}</strong></div>
    <div className="air-fullscreen-clock"><small>FIRST TO 3</small><strong>{airHockeyClock(secondsLeft)}</strong><span>試合時間</span></div>
    <div className="air-fullscreen-player player-two"><strong>{scores[1]}</strong><small>{names[1]}</small></div>
    <button className="air-fullscreen-close" onClick={onClose} aria-label="Close rink">×</button>
  </div>;
}

export type AirHockeyMatchResult = {
  outcome: string;
  detail: string;
  draw?: boolean;
  waitingText?: string;
};

export function AirHockeyMatchOverlay({ result, onPlayAgain, onExit }: { result: AirHockeyMatchResult; onPlayAgain?: () => void; onExit: () => void }) {
  return <div className={`air-match-overlay ${result.draw ? "is-draw" : ""}`} role="alertdialog" aria-modal="true" aria-live="assertive" aria-label={result.outcome}>
    <button className="air-match-overlay-close" onClick={onExit} aria-label="Exit rink">×</button>
    <div className="air-match-card">
      <span className="air-match-seal">{result.draw ? "分" : "勝"}</span>
      <small>{result.draw ? "MATCH COMPLETE" : "MATCH WINNER"}</small>
      <h2>{result.outcome}</h2>
      <p>{result.detail}</p>
      {onPlayAgain
        ? <button className="air-match-replay" onClick={onPlayAgain}>PLAY AGAIN <span>↻</span></button>
        : <p className="air-match-waiting">{result.waitingText}</p>}
      <button className="air-match-exit" onClick={onExit}>EXIT RINK</button>
    </div>
  </div>;
}

export function AirHockeyRink({ difficulty, round, scores, secondsLeft, disabled = false, labels = ["YOU", "CPU"], result, onGoal, onPlayAgain, onLockChange }: {
  difficulty: AirHockeyDifficulty;
  round: number;
  scores: [number, number];
  secondsLeft: number;
  disabled?: boolean;
  labels?: [string, string];
  result?: AirHockeyMatchResult;
  onGoal: (scorer: AirHockeyPlayer) => void;
  onPlayAgain?: () => void;
  onLockChange?: (locked: boolean) => void;
}) {
  const rinkRef = useRef<HTMLDivElement>(null);
  const puckElementRef = useRef<HTMLSpanElement>(null);
  const playerMalletElementRef = useRef<HTMLSpanElement>(null);
  const cpuMalletElementRef = useRef<HTMLSpanElement>(null);
  const puckRef = useRef<AirHockeyBody>(servePuck(round));
  const malletsRef = useRef<[AirHockeyPoint, AirHockeyPoint]>(MALLET_STARTS.map((point) => ({ ...point })) as [AirHockeyPoint, AirHockeyPoint]);
  const velocitiesRef = useRef<[AirHockeyPoint, AirHockeyPoint]>([{ ...ZERO_VELOCITY }, { ...ZERO_VELOCITY }]);
  const playerUpdatedAtRef = useRef(0);
  const previousPointerRef = useRef<{ point: AirHockeyPoint; time: number } | null>(null);
  const pointerActiveRef = useRef(false);
  const goalLockedRef = useRef(false);
  const onGoalRef = useRef(onGoal);
  const [controlLocked, setControlLocked] = useState(false);

  useEffect(() => { onGoalRef.current = onGoal; }, [onGoal]);
  useEffect(() => {
    goalLockedRef.current = false;
    puckRef.current = servePuck(round);
    malletsRef.current = MALLET_STARTS.map((point) => ({ ...point })) as [AirHockeyPoint, AirHockeyPoint];
    velocitiesRef.current = [{ ...ZERO_VELOCITY }, { ...ZERO_VELOCITY }];
    placeAirHockeyElement(puckElementRef.current, puckRef.current);
    placeAirHockeyElement(playerMalletElementRef.current, malletsRef.current[0]);
    placeAirHockeyElement(cpuMalletElementRef.current, malletsRef.current[1]);
  }, [round]);

  useEffect(() => {
    if (!controlLocked) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => { document.body.style.overflow = previousOverflow; document.body.style.overscrollBehavior = previousOverscroll; };
  }, [controlLocked]);

  useEffect(() => {
    if (disabled || !controlLocked) return;
    let animationFrame = 0;
    let lastFrame = performance.now();
    const animate = (now: number) => {
      const elapsed = now - lastFrame;
      lastFrame = now;
      if (now - playerUpdatedAtRef.current > 120) velocitiesRef.current[0] = { ...ZERO_VELOCITY };

      const previousCpu = malletsRef.current[1];
      const cpu = moveAirHockeyCpu(previousCpu, puckRef.current, difficulty, elapsed);
      const seconds = Math.max(0.008, Math.min(0.05, elapsed / 1000));
      velocitiesRef.current[1] = { x: (cpu.x - previousCpu.x) / seconds, y: (cpu.y - previousCpu.y) / seconds };
      malletsRef.current[1] = cpu;

      const stepped = stepAirHockeyLive(puckRef.current, malletsRef.current, velocitiesRef.current, elapsed, difficulty);
      puckRef.current = stepped.puck;
      placeAirHockeyElement(puckElementRef.current, stepped.puck);
      placeAirHockeyElement(cpuMalletElementRef.current, cpu);
      if (stepped.goal != null && !goalLockedRef.current) {
        goalLockedRef.current = true;
        onGoalRef.current(stepped.goal);
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [controlLocked, difficulty, disabled]);

  const pointAt = (clientX: number, clientY: number) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(9, Math.min(91, (clientX - rect.left) / rect.width * 100)),
      y: Math.max(75, Math.min(139, (clientY - rect.top) / rect.height * 150)),
    };
  };
  const moveMalletTo = (point: AirHockeyPoint, now: number) => {
    const previous = previousPointerRef.current;
    if (previous) {
      const elapsed = Math.max(8, now - previous.time) / 1000;
      velocitiesRef.current[0] = {
        x: Math.max(-140, Math.min(140, (point.x - previous.point.x) / elapsed)),
        y: Math.max(-140, Math.min(140, (point.y - previous.point.y) / elapsed)),
      };
    }
    previousPointerRef.current = { point, time: now };
    playerUpdatedAtRef.current = now;
    malletsRef.current[0] = point;
    placeAirHockeyElement(playerMalletElementRef.current, point);
  };
  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlLocked || disabled) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerActiveRef.current = true;
    previousPointerRef.current = null;
    moveMalletTo(point, performance.now());
  };
  const moveMallet = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerActiveRef.current || disabled) return;
    const point = pointAt(event.clientX, event.clientY);
    if (point) moveMalletTo(point, performance.now());
  };
  const endMove = () => {
    pointerActiveRef.current = false;
    previousPointerRef.current = null;
  };
  const changeLock = (locked: boolean) => {
    setControlLocked(locked);
    onLockChange?.(locked);
  };

  return <div className={`air-rink-controller ${controlLocked ? "is-control-locked" : ""}`}>
    {controlLocked && <AirHockeyFullscreenScoreboard scores={scores} names={labels} secondsLeft={secondsLeft} onClose={() => changeLock(false)} />}
    <div className={`air-hockey-rink live-rink ${disabled ? "is-disabled" : ""} ${controlLocked ? "controls-active" : ""}`} ref={rinkRef} role="application" aria-label={controlLocked ? "Live air hockey rink. Move your mallet to hit and defend." : "Air hockey rink. Press Play to begin."} onPointerDown={beginMove} onPointerMove={moveMallet} onPointerUp={endMove} onPointerCancel={endMove}>
      <div className="air-hockey-goal goal-top"><span /></div><div className="air-hockey-goal goal-bottom"><span /></div>
      <i className="air-rink-line center-line" /><i className="air-rink-circle" />
      <div className="air-player-label label-top active"><i />{labels[1]}</div>
      <div className="air-player-label label-bottom active"><i />{labels[0]}</div>
      <span ref={cpuMalletElementRef} className="air-mallet mallet-top" style={{ left: `${MALLET_STARTS[1].x}%`, top: `${MALLET_STARTS[1].y / 1.5}%` }} />
      <span ref={playerMalletElementRef} className="air-mallet mallet-bottom is-controlled" style={{ left: `${MALLET_STARTS[0].x}%`, top: `${MALLET_STARTS[0].y / 1.5}%` }} />
      <span ref={puckElementRef} className="air-puck" style={{ left: `${AIR_HOCKEY_LIVE_START.x}%`, top: `${AIR_HOCKEY_LIVE_START.y / 1.5}%` }} aria-label="Air hockey puck"><i /></span>
      {controlLocked && !disabled && <div className="air-live-badge"><i /> PUCK LIVE · CPU ACTIVE</div>}
      {!controlLocked && <div className="air-lock-overlay"><button className="air-rink-play" onClick={() => changeLock(true)} aria-label="Play Air Hockey"><i aria-hidden="true">▶</i><span>PLAY<small>START LIVE AIR HOCKEY</small></span></button></div>}
      {controlLocked && disabled && result && <AirHockeyMatchOverlay result={result} onPlayAgain={onPlayAgain} onExit={() => changeLock(false)} />}
    </div>
  </div>;
}

export function AirHockey({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [goals, setGoals] = useState(0);
  const [round, setRound] = useState(1);
  const [difficulty, setDifficulty] = useState<AirHockeyDifficulty>("normal");
  const [secondsLeft, setSecondsLeft] = useState(AIR_HOCKEY_MATCH_SECONDS);
  const [rinkLocked, setRinkLocked] = useState(false);
  const recordedWin = useRef(false);
  const scoreWinner: AirHockeyPlayer | null = scores[0] >= AIR_HOCKEY_WIN_SCORE ? 0 : scores[1] >= AIR_HOCKEY_WIN_SCORE ? 1 : null;
  const timeWinner: AirHockeyPlayer | "draw" | null = secondsLeft === 0 ? scores[0] === scores[1] ? "draw" : scores[0] > scores[1] ? 0 : 1 : null;
  const winner = scoreWinner ?? timeWinner;

  useEffect(() => {
    if (!rinkLocked || winner != null) return;
    const timer = window.setInterval(() => setSecondsLeft((current) => {
      if (current <= 1) {
        if (scores[0] > scores[1] && !recordedWin.current) {
          recordedWin.current = true;
          onScore(AIR_HOCKEY_MATCH_SECONDS);
        }
        return 0;
      }
      return current - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [onScore, rinkLocked, scores, winner]);

  const reset = () => { setScores([0, 0]); setGoals(0); setRound((current) => current + 1); setSecondsLeft(AIR_HOCKEY_MATCH_SECONDS); recordedWin.current = false; };
  const goal = (scorer: AirHockeyPlayer) => {
    if (winner != null) return;
    const next: [number, number] = [...scores];
    next[scorer] += 1;
    setScores(next);
    setGoals((current) => current + 1);
    setRound((current) => current + 1);
    if (scorer === 0 && next[0] >= AIR_HOCKEY_WIN_SCORE && !recordedWin.current) {
      recordedWin.current = true;
      onScore(Math.max(1, AIR_HOCKEY_MATCH_SECONDS - secondsLeft));
    }
  };

  return <main className="game-shell air-hockey-shell">
    <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Air Hockey">↻</button></div></header>
    <section className="air-hockey-game">
      <div className="air-hockey-heading"><div><p className="eyebrow">ARCADE · LIVE VS CPU · {difficulty.toUpperCase()}</p><h1>Air Hockey</h1><p>Two minutes. First to three. Move your red mallet to strike and defend against the CPU.</p></div><span>氷</span></div>
      <div className="cpu-difficulty"><div><span>CPU LEVEL</span><small>難易度</small></div><div className="difficulty-options">{(["easy", "normal", "hard"] as AirHockeyDifficulty[]).map((level) => <button key={level} className={difficulty === level ? "active" : ""} onClick={() => { setDifficulty(level); reset(); }}><span>{level}</span><small>{level === "easy" ? "Slow" : level === "normal" ? "Moderate" : "Quick"} · {airHockeyPuckSpeedCap(level)} MAX</small></button>)}</div></div>
      <div className="air-scoreboard"><div className={winner == null ? "active" : ""}><small>YOU</small><strong>{scores[0]}</strong></div><b>FIRST TO 3<small>{airHockeyClock(secondsLeft)}</small></b><div className={winner == null ? "active" : ""}><strong>{scores[1]}</strong><small>CPU</small></div></div>
      <div className="air-turn-status">{winner != null ? "MATCH COMPLETE" : "PUCK LIVE — YOU AND THE CPU MOVE AT THE SAME TIME"}</div>
      <AirHockeyRink difficulty={difficulty} round={round} scores={scores} secondsLeft={secondsLeft} disabled={winner != null} result={winner != null ? { outcome: winner === "draw" ? "Draw Match" : winner === 0 ? "You Win!" : "CPU Wins!", detail: `Final score ${scores[0]}–${scores[1]} after ${goals} goals.`, draw: winner === "draw" } : undefined} onGoal={goal} onPlayAgain={reset} onLockChange={setRinkLocked} />
      {winner != null && <GameResult outcome={winner === "draw" ? "Draw Match" : winner === 0 ? "You Win!" : "CPU Wins!"} detail={`Final score ${scores[0]}–${scores[1]} after ${goals} goals.`} onPlayAgain={reset} draw={winner === "draw"} />}
    </section>
  </main>;
}
