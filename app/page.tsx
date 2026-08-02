"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PlayableGameId = "codebreaker" | "number" | "memory";
type GameId = "hub" | PlayableGameId | `${PlayableGameId}-menu`;
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
        <button className="back-button" onClick={onBack}>← Game menu</button>
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
        <button className="back-button" onClick={onBack}>← Game menu</button>
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
        <button className="back-button" onClick={onBack}>← Game menu</button>
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

const GAME_MENUS: Record<PlayableGameId, {
  title: string;
  japanese: string;
  category: string;
  glyph: string;
  color: string;
  rules: string[];
}> = {
  codebreaker: {
    title: "Codebreaker",
    japanese: "コードブレイカー",
    category: "Logic",
    glyph: "••••",
    color: "coral",
    rules: [
      "Choose four colors. Colors can repeat.",
      "Use the exact and close clues after each guess.",
      "Crack the hidden code within eight guesses.",
    ],
  },
  number: {
    title: "Number Hunt",
    japanese: "ナンバーハント",
    category: "Quick play",
    glyph: "42",
    color: "blue",
    rules: [
      "Pick a number from 1 to 100.",
      "Use the higher or lower clue after each guess.",
      "Find the secret number within seven guesses.",
    ],
  },
  memory: {
    title: "Memory Flip",
    japanese: "メモリーフリップ",
    category: "Memory",
    glyph: "✦",
    color: "violet",
    rules: [
      "Flip two cards at a time.",
      "Matching cards stay open; other cards flip back.",
      "Clear every pair in as few moves as possible.",
    ],
  },
};

function GameMenu({ game, onPlay, onBack }: { game: PlayableGameId; onPlay: () => void; onBack: () => void }) {
  const details = GAME_MENUS[game];

  return (
    <main className="game-menu-shell">
      <header className="game-topbar menu-topbar">
        <button className="back-button" onClick={onBack}>← Games</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> POCKET PLAY</div>
        <span className="menu-header-spacer" aria-hidden="true" />
      </header>
      <section className="game-menu">
        <div className="menu-card">
          <button className="menu-close" onClick={onBack} aria-label="Close game menu">×</button>
          <span className={`app-icon menu-game-icon theme-${details.color}`}><i>{details.glyph}</i></span>
          <p className="menu-japanese">{details.japanese}</p>
          <h1>{details.title}</h1>
          <div className="menu-meta"><span>1 Player</span><span>{details.category}</span></div>
          <div className="menu-rules">
            <h2>How to play <span>遊び方</span></h2>
            <ol>{details.rules.map((rule, index) => <li key={rule}><b>{index + 1}</b><span>{rule}</span></li>)}</ol>
          </div>
          <button className="primary-button menu-start" onClick={onPlay}>Start Game <span>→</span></button>
        </div>
      </section>
    </main>
  );
}

function Hub({ onSelect }: { onSelect: (game: PlayableGameId) => void }) {
  const games = [
    { id: "codebreaker" as const, number: "01", name: "Codebreaker", blurb: "Crack the hidden color sequence in eight guesses.", meta: "LOGIC", color: "coral", glyph: "••••" },
    { id: "number" as const, number: "02", name: "Number Hunt", blurb: "Chase the secret number with higher and lower clues.", meta: "QUICK PLAY", color: "blue", glyph: "42" },
    { id: "memory" as const, number: "03", name: "Memory Flip", blurb: "Flip the tiles and find every matching pair.", meta: "MEMORY", color: "violet", glyph: "✦" },
  ];

  return (
    <main className="hub-shell">
      <nav className="hub-nav">
        <div className="wordmark"><span className="brand-dot">P</span><span><b>POCKET PLAY</b><small>ポケットプレイ</small></span></div>
        <span className="header-jp">ゲーム</span>
      </nav>

      <section className="collection library-only">
        <div className="section-heading"><h1>Games <span>ゲーム</span></h1></div>
        <div className="app-shelf">
          {games.map((game) => (
            <button className="app-item" key={game.id} onClick={() => onSelect(game.id)}>
              <span className={`app-icon theme-${game.color}`}><i>{game.glyph}</i><b>{game.number}</b></span>
              <strong>{game.name}</strong>
            </button>
          ))}
        </div>
      </section>
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
    if (game === "codebreaker-menu") return <GameMenu game="codebreaker" onPlay={() => selectGame("codebreaker")} onBack={() => selectGame("hub")} />;
    if (game === "number-menu") return <GameMenu game="number" onPlay={() => selectGame("number")} onBack={() => selectGame("hub")} />;
    if (game === "memory-menu") return <GameMenu game="memory" onPlay={() => selectGame("memory")} onBack={() => selectGame("hub")} />;
    if (game === "codebreaker") return <Codebreaker onBack={() => selectGame("codebreaker-menu")} />;
    if (game === "number") return <NumberHunt onBack={() => selectGame("number-menu")} />;
    if (game === "memory") return <MemoryGame onBack={() => selectGame("memory-menu")} />;
    return <Hub onSelect={(selected) => selectGame(`${selected}-menu`)} />;
  }, [game]);

  return view;
}
