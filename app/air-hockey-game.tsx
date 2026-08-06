"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { AIR_HOCKEY_CENTER, AIR_HOCKEY_WIN_SCORE, airHockeyVelocityFromPull, chooseAirHockeyCpuVelocity, simulateAirHockeyShot, type AirHockeyDifficulty, type AirHockeyPlayer, type AirHockeyPoint } from "./air-hockey";

export function AirHockeyRink({ puck, trajectory = [], disabled = false, activePlayer = 0, labels = ["YOU", "CPU"], onShoot }: {
  puck: AirHockeyPoint;
  trajectory?: AirHockeyPoint[];
  disabled?: boolean;
  activePlayer?: AirHockeyPlayer;
  labels?: [string, string];
  onShoot?: (velocity: AirHockeyPoint) => void;
}) {
  const [displayPuck, setDisplayPuck] = useState(puck);
  const [pull, setPull] = useState<AirHockeyPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [inMotion, setInMotion] = useState(false);
  const rinkRef = useRef<HTMLDivElement>(null);

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

  const pointAt = (clientX: number, clientY: number) => {
    const rect = rinkRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: Math.max(3, Math.min(97, (clientX - rect.left) / rect.width * 100)), y: Math.max(3, Math.min(147, (clientY - rect.top) / rect.height * 150)) };
  };
  const beginPull = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || inMotion || !onShoot) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setPull(pointAt(event.clientX, event.clientY));
  };
  const movePull = (event: ReactPointerEvent<HTMLButtonElement>) => { if (dragging) setPull(pointAt(event.clientX, event.clientY)); };
  const releasePull = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const release = pointAt(event.clientX, event.clientY) ?? pull;
    setDragging(false);
    setPull(null);
    if (!release) return;
    const velocity = airHockeyVelocityFromPull(displayPuck, release);
    if (velocity) onShoot?.(velocity);
  };
  const pullDistance = pull ? Math.min(26, Math.hypot(displayPuck.x - pull.x, displayPuck.y - pull.y)) : 0;
  const pullAngle = pull ? Math.atan2(pull.y - displayPuck.y, pull.x - displayPuck.x) * 180 / Math.PI : 0;

  const locked = disabled || inMotion;
  return <div className={`air-hockey-rink ${locked ? "is-disabled" : ""} player-${activePlayer + 1}`} ref={rinkRef}>
    <div className="air-hockey-goal goal-top"><span /></div><div className="air-hockey-goal goal-bottom"><span /></div>
    <i className="air-rink-line center-line" /><i className="air-rink-circle" />
    <div className={`air-player-label label-top ${activePlayer === 1 ? "active" : ""}`}><i />{labels[1]}</div>
    <div className={`air-player-label label-bottom ${activePlayer === 0 ? "active" : ""}`}><i />{labels[0]}</div>
    <span className="air-mallet mallet-top" /><span className="air-mallet mallet-bottom" />
    {pull && <><span className="air-aim-line" style={{ left: `${displayPuck.x}%`, top: `${displayPuck.y / 1.5}%`, width: `${pullDistance}%`, transform: `rotate(${pullAngle}deg)` }} /><span className="air-pull-mallet" style={{ left: `${pull.x}%`, top: `${pull.y / 1.5}%` }} /></>}
    <button className={`air-puck ${dragging ? "is-aiming" : ""}`} disabled={locked || !onShoot} style={{ left: `${displayPuck.x}%`, top: `${displayPuck.y / 1.5}%` }} onPointerDown={beginPull} onPointerMove={movePull} onPointerUp={releasePull} onPointerCancel={() => { setDragging(false); setPull(null); }} aria-label={locked ? "Air hockey puck, wait for your turn" : "Pull back and release the puck to shoot"}><i /></button>
    {!locked && !dragging && <div className="air-drag-hint"><b>↙</b><span>PULL PUCK<br />TO AIM</span></div>}
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
      setTurn(player === 0 ? 1 : 0);
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
      <div className="air-hockey-heading"><div><p className="eyebrow">ARCADE · VS CPU · {difficulty.toUpperCase()}</p><h1>Air Hockey</h1><p>Pull back from the puck and release. Bank shots off the rails and race to five.</p></div><span>氷</span></div>
      <div className="cpu-difficulty"><div><span>CPU LEVEL</span><small>難易度</small></div><div className="difficulty-options">{(["easy", "normal", "hard"] as AirHockeyDifficulty[]).map((level) => <button key={level} className={difficulty === level ? "active" : ""} onClick={() => { setDifficulty(level); reset(); }}><span>{level}</span><small>{level === "easy" ? "Relaxed" : level === "normal" ? "Balanced" : "Sharp"}</small></button>)}</div></div>
      <div className="air-scoreboard"><div className={turn === 0 && winner == null ? "active" : ""}><small>YOU</small><strong>{scores[0]}</strong></div><b>FIRST TO 5<small>{shots} SHOTS</small></b><div className={turn === 1 && winner == null ? "active" : ""}><strong>{scores[1]}</strong><small>CPU</small></div></div>
      <div className="air-turn-status">{winner != null ? "MATCH COMPLETE" : animating ? "PUCK IN MOTION" : turn === 0 ? "YOUR SHOT — PULL AND RELEASE" : "CPU LINING UP A SHOT"}</div>
      <AirHockeyRink puck={puck} trajectory={trajectory} activePlayer={turn} disabled={animating || turn !== 0 || winner != null} onShoot={(velocity) => shoot(velocity, 0)} />
      {winner != null && <GameResult outcome={winner === 0 ? "You Win!" : "CPU Wins!"} detail={`Final score ${scores[0]}–${scores[1]} after ${shots} shots.`} onPlayAgain={reset} />}
    </section>
  </main>;
}
