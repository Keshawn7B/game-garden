"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type GameId = "hub" | "codebreaker" | "number" | "memory";
type ColorId = "coral" | "gold" | "mint" | "blue" | "violet" | "pink";

const COLORS: { id: ColorId; label: string; hex: string }[] = [
  { id: "coral", label: "Coral", hex: "#ff6b4a" },
  { id: "gold", label: "Gold", hex: "#ffc943" },
  { id: "mint", label: "Mint", hex: "#52d6a5" },
  { id: "blue", label: "Blue", hex: "#4d8cff" },
  { id: "violet", label: "Violet", hex: "#9b6cff" },
  { id: "pink", label: "Pink", hex: "#ef6fb3" },
];

const MEMORY_SYMBOLS = ["☀", "✿", "◆", "☂", "♬", "☕", "★", "☾"];

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function makeSecret(): ColorId[] {
  return Array.from({ length: 4 }, () => COLORS[Math.floor(Math.random() * COLORS.length)].id);
}

function scoreGuess(guess: ColorId[], secret: ColorId[]) {
  let exact = 0;
  const guessedCounts: Partial<Record<ColorId, number>> = {};
  const secretCounts: Partial<Record<ColorId, number>> = {};

  guess.forEach((color, index) => {
    if (color === secret[index]) exact += 1;
    else {
      guessedCounts[color] = (guessedCounts[color] ?? 0) + 1;
      secretCounts[secret[index]] = (secretCounts[secret[index]] ?? 0) + 1;
    }
  });

  const close = COLORS.reduce(
    (total, color) => total + Math.min(guessedCounts[color.id] ?? 0, secretCounts[color.id] ?? 0),
    0,
  );
  return { exact, close };
}

function Peg({ color, small = false, hidden = false }: { color?: ColorId; small?: boolean; hidden?: boolean }) {
  const colorData = COLORS.find((item) => item.id === color);
  return (
    <span
      className={`peg ${small ? "peg-small" : ""} ${hidden ? "peg-hidden" : ""}`}
      style={colorData ? { backgroundColor: colorData.hex } : undefined}
      aria-label={hidden ? "Hidden color" : colorData?.label ?? "Empty slot"}
    >
      {hidden ? "?" : ""}
    </span>
  );
}

function Codebreaker({ onBack }: { onBack: () => void }) {
  const [secret, setSecret] = useState<ColorId[]>(makeSecret);
  const [current, setCurrent] = useState<ColorId[]>([]);
  const [guesses, setGuesses] = useState<{ colors: ColorId[]; exact: number; close: number }[]>([]);
  const won = guesses.some((guess) => guess.exact === 4);
  const lost = guesses.length >= 8 && !won;

  const reset = () => {
    setSecret(makeSecret());
    setCurrent([]);
    setGuesses([]);
  };

  const submit = () => {
    if (current.length !== 4 || won || lost) return;
    const result = scoreGuess(current, secret);
    setGuesses((previous) => [...previous, { colors: current, ...result }]);
    setCurrent([]);
  };

  return (
    <main className="game-shell codebreaker-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← All games</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> POCKET PLAY</div>
        <button className="icon-button" onClick={reset} aria-label="Start a new code">↻</button>
      </header>

      <section className="game-intro">
        <p className="eyebrow">LOGIC · 1 PLAYER</p>
        <h1>Crack the color code.</h1>
        <p>Find four hidden colors in eight guesses. Colors can repeat.</p>
        <div className="legend" aria-label="Feedback key">
          <span><i className="key-dot exact-dot" /> Right color, right spot</span>
          <span><i className="key-dot close-dot" /> Right color, wrong spot</span>
        </div>
      </section>

      <section className="code-board" aria-label="Codebreaker board">
        <div className="secret-row">
          <span>SECRET CODE</span>
          <div className="peg-row">
            {secret.map((color, index) => <Peg key={index} color={color} hidden={!won && !lost} />)}
          </div>
          <strong>{won ? "CRACKED!" : lost ? "REVEALED" : "HIDDEN"}</strong>
        </div>

        <div className="attempts">
          {Array.from({ length: 8 }, (_, index) => {
            const guess = guesses[index];
            const isCurrent = index === guesses.length && !won && !lost;
            return (
              <div className={`attempt-row ${isCurrent ? "active-attempt" : ""}`} key={index}>
                <span className="attempt-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="peg-row">
                  {Array.from({ length: 4 }, (__, pegIndex) => (
                    <Peg key={pegIndex} color={guess?.colors[pegIndex] ?? (isCurrent ? current[pegIndex] : undefined)} />
                  ))}
                </div>
                <div className="feedback" aria-label={guess ? `${guess.exact} exact and ${guess.close} close` : "No feedback yet"}>
                  {guess ? (
                    <>
                      <span className="feedback-count exact-count">● {guess.exact}</span>
                      <span className="feedback-count close-count">● {guess.close}</span>
                    </>
                  ) : <span className="feedback-empty">—</span>}
                </div>
              </div>
            );
          })}
        </div>

        {won || lost ? (
          <div className="result-panel" role="status">
            <div><strong>{won ? "Code cracked!" : "So close."}</strong><span>{won ? `Solved in ${guesses.length} ${guesses.length === 1 ? "guess" : "guesses"}.` : "The secret slipped away this round."}</span></div>
            <button className="primary-button" onClick={reset}>Play again</button>
          </div>
        ) : (
          <div className="picker-panel">
            <p>Choose a color <span>{current.length}/4</span></p>
            <div className="color-picker">
              {COLORS.map((color) => (
                <button
                  key={color.id}
                  className="color-choice"
                  style={{ backgroundColor: color.hex }}
                  aria-label={`Add ${color.label}`}
                  onClick={() => current.length < 4 && setCurrent((value) => [...value, color.id])}
                />
              ))}
            </div>
            <div className="picker-actions">
              <button className="text-button" onClick={() => setCurrent((value) => value.slice(0, -1))} disabled={!current.length}>Undo</button>
              <button className="primary-button" onClick={submit} disabled={current.length !== 4}>Check code</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function NumberHunt({ onBack }: { onBack: () => void }) {
  const [target, setTarget] = useState(() => Math.floor(Math.random() * 100) + 1);
  const [value, setValue] = useState(50);
  const [history, setHistory] = useState<number[]>([]);
  const latest = history.at(-1);
  const won = latest === target;
  const lost = history.length >= 7 && !won;

  const reset = () => {
    setTarget(Math.floor(Math.random() * 100) + 1);
    setValue(50);
    setHistory([]);
  };

  const submit = () => {
    if (!won && !lost) setHistory((items) => [...items, value]);
  };

  const message = latest == null ? "Make your first guess" : won ? "You found it!" : lost ? `It was ${target}` : latest < target ? "Go higher ↑" : "Go lower ↓";

  return (
    <main className="game-shell number-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← All games</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> POCKET PLAY</div>
        <button className="icon-button" onClick={reset} aria-label="Start a new number game">↻</button>
      </header>
      <section className="number-game">
        <p className="eyebrow">QUICK · 1 PLAYER</p>
        <h1>Find the secret number.</h1>
        <p>I picked a number from 1–100. You get seven guesses.</p>
        <div className={`number-orb ${won ? "number-win" : ""}`} aria-live="polite">
          <span>{won || lost ? target : "?"}</span>
        </div>
        <h2>{message}</h2>
        <input aria-label="Your number guess" type="range" min="1" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} disabled={won || lost} />
        <div className="number-input-row">
          <button onClick={() => setValue((number) => Math.max(1, number - 1))} disabled={won || lost}>−</button>
          <output>{value}</output>
          <button onClick={() => setValue((number) => Math.min(100, number + 1))} disabled={won || lost}>+</button>
        </div>
        <button className="primary-button wide-button" onClick={won || lost ? reset : submit}>{won || lost ? "Play again" : "Lock in guess"}</button>
        <div className="guess-trail">
          {Array.from({ length: 7 }, (_, index) => <span key={index} className={history[index] === target ? "trail-win" : ""}>{history[index] ?? "·"}</span>)}
        </div>
      </section>
    </main>
  );
}

function MemoryGame({ onBack }: { onBack: () => void }) {
  const makeDeck = useCallback(() => shuffle([...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS]).map((symbol, index) => ({ id: `${symbol}-${index}`, symbol })), []);
  const [cards, setCards] = useState(makeDeck);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const complete = matched.length === cards.length;

  const reset = () => {
    setCards(makeDeck());
    setOpen([]);
    setMatched([]);
    setMoves(0);
  };

  const flip = (index: number) => {
    if (open.length >= 2 || open.includes(index) || matched.includes(index)) return;
    const next = [...open, index];
    setOpen(next);
    if (next.length === 2) {
      setMoves((count) => count + 1);
      if (cards[next[0]].symbol === cards[next[1]].symbol) {
        window.setTimeout(() => {
          setMatched((items) => [...items, ...next]);
          setOpen([]);
        }, 450);
      } else window.setTimeout(() => setOpen([]), 750);
    }
  };

  return (
    <main className="game-shell memory-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← All games</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> POCKET PLAY</div>
        <button className="icon-button" onClick={reset} aria-label="Shuffle and restart">↻</button>
      </header>
      <section className="memory-game">
        <div className="memory-heading">
          <div><p className="eyebrow">MEMORY · 1 PLAYER</p><h1>Meet your match.</h1><p>Flip two tiles. Find every pair.</p></div>
          <div className="moves"><strong>{moves}</strong><span>moves</span></div>
        </div>
        <div className="memory-grid">
          {cards.map((card, index) => {
            const visible = open.includes(index) || matched.includes(index);
            return (
              <button
                className={`memory-card ${visible ? "is-open" : ""} ${matched.includes(index) ? "is-matched" : ""}`}
                key={card.id}
                aria-label={visible ? card.symbol : `Hidden card ${index + 1}`}
                onClick={() => flip(index)}
              ><span>{visible ? card.symbol : ""}</span></button>
            );
          })}
        </div>
        {complete && <div className="result-panel" role="status"><div><strong>Perfect pairs!</strong><span>You cleared the board in {moves} moves.</span></div><button className="primary-button" onClick={reset}>Play again</button></div>}
      </section>
    </main>
  );
}

function Hub({ onSelect }: { onSelect: (game: GameId) => void }) {
  const games = [
    { id: "codebreaker" as const, number: "01", name: "Codebreaker", blurb: "Crack the hidden color sequence.", meta: "1 PLAYER · LOGIC", color: "coral", glyph: "••••" },
    { id: "number" as const, number: "02", name: "Number Hunt", blurb: "Zero in with higher and lower clues.", meta: "1 PLAYER · QUICK", color: "blue", glyph: "42" },
    { id: "memory" as const, number: "03", name: "Memory Flip", blurb: "Find every matching pair.", meta: "1 PLAYER · MEMORY", color: "violet", glyph: "✦" },
  ];

  return (
    <main className="hub-shell">
      <nav className="hub-nav">
        <div className="wordmark"><span className="brand-dot" /> POCKET PLAY</div>
        <span className="nav-note">A TINY ARCADE FOR CURIOUS MINDS</span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">THREE GAMES. ZERO DOWNLOADS.</p>
          <h1>Small games.<br /><em>Big “aha!”</em></h1>
          <p className="hero-text">A cozy collection of clever little games for your next break, brain stretch, or friendly challenge.</p>
          <button className="primary-button hero-button" onClick={() => onSelect("codebreaker")}>Play today’s pick <span>→</span></button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-card card-left"><span>✿</span></div>
          <div className="floating-card card-main"><span className="art-pegs"><i /><i /><i /><i /></span><b>CRACK<br />THE CODE</b></div>
          <div className="floating-card card-right"><span>42</span></div>
          <div className="spark spark-one">✦</div><div className="spark spark-two">✦</div>
        </div>
      </section>

      <section className="collection">
        <div className="section-heading"><div><p className="eyebrow">THE COLLECTION</p><h2>Pick a game</h2></div><p>Fast to learn. Surprisingly hard to put down.</p></div>
        <div className="game-grid">
          {games.map((game) => (
            <button className={`game-card theme-${game.color}`} key={game.id} onClick={() => onSelect(game.id)}>
              <span className="game-number">{game.number}</span>
              <div className="game-glyph">{game.glyph}</div>
              <p>{game.meta}</p>
              <h3>{game.name}</h3>
              <span className="game-blurb">{game.blurb}</span>
              <span className="play-link">PLAY NOW <b>↗</b></span>
            </button>
          ))}
          <div className="game-card coming-card">
            <span className="game-number">04</span>
            <div className="coming-plus">+</div>
            <p>NEXT UP</p><h3>Your next favorite</h3><span className="game-blurb">More pocket-sized games are on the way.</span><span className="play-link">COMING SOON</span>
          </div>
        </div>
      </section>

      <footer><div className="wordmark"><span className="brand-dot" /> POCKET PLAY</div><p>Built for tiny breaks and bright ideas.</p><span>© 2026</span></footer>
    </main>
  );
}

export default function Home() {
  const [game, setGame] = useState<GameId>("hub");

  useEffect(() => {
    const onPopState = () => setGame((window.location.hash.slice(1) as GameId) || "hub");
    onPopState();
    window.addEventListener("hashchange", onPopState);
    return () => window.removeEventListener("hashchange", onPopState);
  }, []);

  const selectGame = (next: GameId) => {
    setGame(next);
    window.location.hash = next === "hub" ? "" : next;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const view = useMemo(() => {
    if (game === "codebreaker") return <Codebreaker onBack={() => selectGame("hub")} />;
    if (game === "number") return <NumberHunt onBack={() => selectGame("hub")} />;
    if (game === "memory") return <MemoryGame onBack={() => selectGame("hub")} />;
    return <Hub onSelect={selectGame} />;
  }, [game]);

  return view;
}
