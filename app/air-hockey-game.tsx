"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { AIR_HOCKEY_CENTER, AIR_HOCKEY_WIN_SCORE, airHockeyVelocityFromMallet, chooseAirHockeyCpuVelocity, simulateAirHockeyShot, type AirHockeyDifficulty, type AirHockeyPlayer, type AirHockeyPoint } from "./air-hockey";

const AIR_MALLET_STARTS: [AirHockeyPoint, AirHockeyPoint] = [{ x: 50, y: 124 }, { x: 50, y: 26 }];

export function AirHockeyRink({ puck, trajectory = [], disabled = false, activePlayer = 0, controlledPlayer = 0, labels = ["YOU", "CPU"], onShoot }: {
  puck: AirHockeyPoint;
  trajectory?: AirHockeyPoint[];
  disabled?: boolean;
  activePlayer?: AirHockeyPlayer;
  controlledPlayer?: AirHockeyPlayer;
  labels?: [string, string];
  onShoot?: (velocity: AirHockeyPoint) => void;
}) {
  const [displayPuck, setDisplayPuck] = useState(puck);
  const [inMotion, setInMotion] = useState(false);
  const [controlLocked, setControlLocked] = useState(false);
  const [mallets, setMallets] = useState<[AirHockeyPoint, AirHockeyPoint]>(() => AIR_MALLET_STARTS.map((point) => ({ ...point })) as [AirHockeyPoint, AirHockeyPoint]);
  const rinkRef = useRef<HTMLDivElement>(null);
  const pointerActive = useRef(false);
  const previousMallet = useRef<{ point: AirHockeyPoint; time: number }>({ point: AIR_MALLET_STARTS[controlledPlayer], time: 0 });
  const shotTriggered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const start = window.setTimeout(() => {
      if (trajectory.length < 2) { setDisplayPuck(puck); setInMotion(false); return; }
      setInMotion(true);
      let frame = 0;
      const animate = () => {
        if (cancelled) return;
        setDisplayPuck(trajectory[frame]);
        frame += 1;
        if (frame < trajectory.length) timer = window.setTimeout(animate, 20);
        else timer = window.setTimeout(() => { setDisplayPuck(puck); setInMotion(false); }, 160);
      };
      animate();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(start); window.clearTimeout(timer); };
  }, [puck, trajectory]);

  useEffect(() => {
    if (!controlLocked) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => { document.body.style.overflow = previousOverflow; document.body.style.overscrollBehavior = previousOverscroll; };
  }, [controlLocked]);

  const pointAt = (clientX: number, clientY: number) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const rawY = (clientY - rect.top) / rect.height * 150;
    return {
      x: Math.max(9, Math.min(91, (clientX - rect.left) / rect.width * 100)),
      y: controlledPlayer === 0 ? Math.max(79, Math.min(139, rawY)) : Math.max(11, Math.min(71, rawY)),
    };
  };
  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlLocked || disabled || inMotion || !onShoot) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerActive.current = true;
    shotTriggered.current = false;
    previousMallet.current = { point, time: performance.now() };
    setMallets((current) => current.map((mallet, index) => index === controlledPlayer ? point : mallet) as [AirHockeyPoint, AirHockeyPoint]);
  };
  const moveMallet = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerActive.current || shotTriggered.current) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    const previous = previousMallet.current;
    const now = performance.now();
    const velocity = airHockeyVelocityFromMallet(previous.point, point, now - previous.time);
    setMallets((current) => current.map((mallet, index) => index === controlledPlayer ? point : mallet) as [AirHockeyPoint, AirHockeyPoint]);
    previousMallet.current = { point, time: now };
    const puckDistance = Math.hypot(point.x - displayPuck.x, point.y - displayPuck.y);
    const towardPuck = velocity && velocity.x * (displayPuck.x - previous.point.x) + velocity.y * (displayPuck.y - previous.point.y) > 0;
    if (velocity && towardPuck && puckDistance <= 12.5) {
      shotTriggered.current = true;
      pointerActive.current = false;
      setMallets((current) => current.map((mallet, index) => index === controlledPlayer ? { ...AIR_MALLET_STARTS[controlledPlayer] } : mallet) as [AirHockeyPoint, AirHockeyPoint]);
      onShoot?.(velocity);
    }
  };
  const endMove = () => { pointerActive.current = false; };

  const locked = disabled || inMotion;
  return <div className={`air-rink-controller ${controlLocked ? "is-control-locked" : ""}`}>
    <button className={`air-control-lock ${controlLocked ? "active" : ""}`} onClick={() => setControlLocked((current) => !current)} aria-pressed={controlLocked}><i>{controlLocked ? "×" : "⌖"}</i><span>{controlLocked ? "UNLOCK SCREEN" : "LOCK RINK"}<small>{controlLocked ? "RETURN TO GAME PAGE" : "MOVE THE MALLET FREELY"}</small></span></button>
    <div className={`air-hockey-rink ${locked ? "is-disabled" : ""} ${controlLocked ? "controls-active" : ""} player-${activePlayer + 1}`} ref={rinkRef} role="application" aria-label={controlLocked ? "Air hockey rink controls locked. Drag to move your mallet." : "Air hockey rink. Lock the rink to control your mallet."} onPointerDown={beginMove} onPointerMove={moveMallet} onPointerUp={endMove} onPointerCancel={endMove}>
      <div className="air-hockey-goal goal-top"><span /></div><div className="air-hockey-goal goal-bottom"><span /></div>
      <i className="air-rink-line center-line" /><i className="air-rink-circle" />
      <div className={`air-player-label label-top ${activePlayer === 1 ? "active" : ""}`}><i />{labels[1]}</div>
      <div className={`air-player-label label-bottom ${activePlayer === 0 ? "active" : ""}`}><i />{labels[0]}</div>
      <span className={`air-mallet mallet-top ${controlledPlayer === 1 ? "is-controlled" : ""}`} style={{ left: `${mallets[1].x}%`, top: `${mallets[1].y / 1.5}%` }} />
      <span className={`air-mallet mallet-bottom ${controlledPlayer === 0 ? "is-controlled" : ""}`} style={{ left: `${mallets[0].x}%`, top: `${mallets[0].y / 1.5}%` }} />
      <span className="air-puck" style={{ left: `${displayPuck.x}%`, top: `${displayPuck.y / 1.5}%` }} aria-label="Air hockey puck"><i /></span>
      {controlLocked && !locked && <div className="air-drag-hint"><b>✥</b><span>DRAG ANYWHERE<br />MOVE YOUR MALLET</span></div>}
      {!controlLocked && <div className="air-lock-overlay"><b>⌖</b><span>LOCK RINK TO PLAY</span></div>}
    </div>
  </div>;
}

export function AirHockey({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [puck, setPuck] = useState<AirHockeyPoint>({ ...AIR_HOCKEY_CENTER });
  const [trajectory, setTrajectory] = useState<AirHockeyPoint[]>([]);
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [turn, setTurn] = useState<AirHockeyPlayer>(0);
  const [shots, setShots] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [difficulty, setDifficulty] = useState<AirHockeyDifficulty>("normal");
  const shotTimer = useRef<number | null>(null);
  const winner = scores[0] >= AIR_HOCKEY_WIN_SCORE ? 0 : scores[1] >= AIR_HOCKEY_WIN_SCORE ? 1 : null;

  const reset = () => { if (shotTimer.current != null) window.clearTimeout(shotTimer.current); setPuck({ ...AIR_HOCKEY_CENTER }); setTrajectory([]); setScores([0, 0]); setTurn(0); setShots(0); setAnimating(false); };
  const shoot = (velocity: AirHockeyPoint, player: AirHockeyPlayer) => {
    if (animating || winner != null || turn !== player) return;
    const result = simulateAirHockeyShot(puck, velocity);
    const nextScores: [number, number] = [...scores];
    if (result.goal != null) nextScores[result.goal] += 1;
    const nextShots = shots + 1;
    setAnimating(true);
    setTrajectory(result.trajectory);
    setShots(nextShots);
    shotTimer.current = window.setTimeout(() => {
      setPuck(result.final);
      setScores(nextScores);
      setTurn(result.goal != null ? result.goal === 0 ? 1 : 0 : result.final.y < 75 ? 1 : 0);
      setAnimating(false);
      setTrajectory([]);
      if (nextScores[0] >= AIR_HOCKEY_WIN_SCORE) onScore(nextShots);
    }, result.trajectory.length * 20 + 180);
  };

  useEffect(() => () => { if (shotTimer.current != null) window.clearTimeout(shotTimer.current); }, []);

  useEffect(() => {
    if (turn !== 1 || animating || winner != null) return;
    const timer = window.setTimeout(() => shoot(chooseAirHockeyCpuVelocity(puck, difficulty), 1), 650);
    return () => window.clearTimeout(timer);
  // shoot intentionally uses the current immutable rink state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, difficulty, puck, turn, winner]);

  return <main className="game-shell air-hockey-shell">
    <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Air Hockey">↻</button></div></header>
    <section className="air-hockey-game">
      <div className="air-hockey-heading"><div><p className="eyebrow">ARCADE · VS CPU · {difficulty.toUpperCase()}</p><h1>Air Hockey</h1><p>Lock the rink, move your red mallet, and strike the puck. Bank shots off the rails and race to five.</p></div><span>氷</span></div>
      <div className="cpu-difficulty"><div><span>CPU LEVEL</span><small>難易度</small></div><div className="difficulty-options">{(["easy", "normal", "hard"] as AirHockeyDifficulty[]).map((level) => <button key={level} className={difficulty === level ? "active" : ""} onClick={() => { setDifficulty(level); reset(); }}><span>{level}</span><small>{level === "easy" ? "Relaxed" : level === "normal" ? "Balanced" : "Sharp"}</small></button>)}</div></div>
      <div className="air-scoreboard"><div className={turn === 0 && winner == null ? "active" : ""}><small>YOU</small><strong>{scores[0]}</strong></div><b>FIRST TO 5<small>{shots} SHOTS</small></b><div className={turn === 1 && winner == null ? "active" : ""}><strong>{scores[1]}</strong><small>CPU</small></div></div>
      <div className="air-turn-status">{winner != null ? "MATCH COMPLETE" : animating ? "PUCK IN MOTION" : turn === 0 ? "YOUR SHOT — LOCK RINK AND MOVE THE MALLET" : "CPU LINING UP A SHOT"}</div>
      <AirHockeyRink puck={puck} trajectory={trajectory} activePlayer={turn} disabled={animating || turn !== 0 || winner != null} onShoot={(velocity) => shoot(velocity, 0)} />
      {winner != null && <GameResult outcome={winner === 0 ? "You Win!" : "CPU Wins!"} detail={`Final score ${scores[0]}–${scores[1]} after ${shots} shots.`} onPlayAgain={reset} />}
    </section>
  </main>;
}
