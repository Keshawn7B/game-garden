"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createUserWithEmailAndPassword, getRedirectResult, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type User } from "firebase/auth";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type PlayableGameId = "codebreaker" | "order" | "number" | "memory";
type ExternalGameId = "meducktion" | "deducktion";
type LibraryGameId = PlayableGameId | ExternalGameId;
type AppTab = "games" | "leaderboard" | "profile";
type GameId = AppTab | LibraryGameId | `${LibraryGameId}-menu`;
type ColorId = "coral" | "gold" | "mint" | "blue" | "violet" | "pink";
type HighScores = Partial<Record<PlayableGameId, number>>;
type LeaderboardEntry = { uid: string; name: string; photoURL: string; score: number };
type Leaderboards = Partial<Record<PlayableGameId, LeaderboardEntry[]>>;

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

const ORDER_COLORS: ColorId[] = ["coral", "gold", "mint", "blue"];

function makeOrderRound() {
  const target = shuffle(ORDER_COLORS);
  let objects = shuffle(ORDER_COLORS);
  while (objects.every((color, index) => color === target[index])) objects = shuffle(ORDER_COLORS);
  return { target, objects };
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

function Codebreaker({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
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
    if (result.exact === 4) onScore(guesses.length + 1);
    setGuesses((previous) => [...previous, { colors: current, ...result }]);
    setCurrent([]);
  };

  return (
    <main className="game-shell codebreaker-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> GAME GARDEN</div>
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

function OrderMatch({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [round, setRound] = useState(makeOrderRound);
  const [selected, setSelected] = useState<number | null>(null);
  const [checks, setChecks] = useState<number[]>([]);
  const exact = checks.at(-1) ?? 0;
  const won = exact === 4;
  const lost = checks.length >= 8 && !won;

  const reset = () => {
    setRound(makeOrderRound());
    setSelected(null);
    setChecks([]);
  };

  const switchObject = (index: number) => {
    if (won || lost) return;
    if (selected == null) {
      setSelected(index);
      return;
    }
    if (selected === index) {
      setSelected(null);
      return;
    }
    setRound((currentRound) => {
      const objects = [...currentRound.objects];
      [objects[selected], objects[index]] = [objects[index], objects[selected]];
      return { ...currentRound, objects };
    });
    setSelected(null);
  };

  const checkOrder = () => {
    if (won || lost) return;
    const matches = round.objects.filter((color, index) => color === round.target[index]).length;
    if (matches === 4) onScore(checks.length + 1);
    setChecks((previous) => [...previous, matches]);
  };

  return (
    <main className="game-shell order-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> GAME GARDEN</div>
        <button className="icon-button" onClick={reset} aria-label="Start a new order">↻</button>
      </header>

      <section className="order-game">
        <p className="eyebrow">LOGIC · 1 PLAYER</p>
        <h1>Match the hidden order.</h1>
        <p>Tap two objects to switch their places, then check your row.</p>

        <div className="order-board">
          <div className="order-secret">
            <span>HIDDEN ORDER</span>
            <div className="order-row" aria-label={won || lost ? "Revealed correct order" : "Hidden correct order"}>
              {round.target.map((color, index) => <Peg key={index} color={color} hidden={!won && !lost} />)}
            </div>
          </div>

          <div className="order-status" aria-live="polite">
            <strong>{checks.length ? `${exact} / 4` : "— / 4"}</strong>
            <span>{won ? "ORDER MATCHED" : lost ? "ORDER REVEALED" : checks.length ? "IN THE CORRECT PLACE" : "CHECK WHEN READY"}</span>
          </div>

          <div className="order-play-area">
            <p>YOUR ORDER <span>{selected == null ? "SELECT AN OBJECT" : "SELECT ITS NEW PLACE"}</span></p>
            <div className="order-row player-order">
              {round.objects.map((color, index) => {
                const colorData = COLORS.find((item) => item.id === color)!;
                return (
                  <button
                    key={color}
                    className={`order-object ${selected === index ? "is-selected" : ""}`}
                    style={{ backgroundColor: colorData.hex }}
                    onClick={() => switchObject(index)}
                    aria-label={`${colorData.label} object in position ${index + 1}${selected === index ? ", selected" : ""}`}
                    disabled={won || lost}
                  >{index + 1}</button>
                );
              })}
            </div>

            <div className="order-actions">
              <div className="check-history" aria-label={`${checks.length} of 8 checks used`}>
                {Array.from({ length: 8 }, (_, index) => <i key={index} className={index < checks.length ? "used" : ""} />)}
              </div>
              <button className="primary-button" onClick={won || lost ? reset : checkOrder}>
                {won || lost ? "Play again" : "Check order"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function NumberHunt({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
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
    if (!won && !lost) {
      if (value === target) onScore(history.length + 1);
      setHistory((items) => [...items, value]);
    }
  };

  const message = latest == null ? "Make your first guess" : won ? "You found it!" : lost ? `It was ${target}` : latest < target ? "Go higher ↑" : "Go lower ↓";

  return (
    <main className="game-shell number-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> GAME GARDEN</div>
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

function MemoryGame({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
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
          setMatched((items) => {
            const nextMatched = [...items, ...next];
            if (nextMatched.length === cards.length) onScore(moves + 1);
            return nextMatched;
          });
          setOpen([]);
        }, 450);
      } else window.setTimeout(() => setOpen([]), 750);
    }
  };

  return (
    <main className="game-shell memory-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> GAME GARDEN</div>
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

const GAME_MENUS: Record<LibraryGameId, {
  title: string;
  japanese: string;
  category: string;
  glyph: string;
  color: string;
  players: string;
  rules: string[];
}> = {
  codebreaker: {
    title: "Codebreaker",
    japanese: "コードブレイカー",
    category: "Logic",
    glyph: "••••",
    color: "coral",
    players: "1 Player",
    rules: [
      "Choose four colors. Colors can repeat.",
      "Use the exact and close clues after each guess.",
      "Crack the hidden code within eight guesses.",
    ],
  },
  order: {
    title: "Order Match",
    japanese: "並べ替え",
    category: "Logic",
    glyph: "↔",
    color: "order",
    players: "1 Player",
    rules: [
      "A hidden row uses the same four colored objects.",
      "Tap any two objects to switch their positions.",
      "Check your row and match all four places within eight checks.",
    ],
  },
  number: {
    title: "Number Hunt",
    japanese: "ナンバーハント",
    category: "Quick play",
    glyph: "42",
    color: "blue",
    players: "1 Player",
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
    players: "1 Player",
    rules: [
      "Flip two cards at a time.",
      "Matching cards stay open; other cards flip back.",
      "Clear every pair in as few moves as possible.",
    ],
  },
  meducktion: {
    title: "Meducktion",
    japanese: "医学推理",
    category: "Card game",
    glyph: "診",
    color: "meducktion",
    players: "1–4 Players",
    rules: [
      "Choose one Ask, Check, or Test question each round.",
      "Use the YES and NO clues to narrow eight conditions.",
      "Diagnose the fictional case before your opponents.",
    ],
  },
  deducktion: {
    title: "Deducktion",
    japanese: "正体推理",
    category: "Card game",
    glyph: "探",
    color: "deducktion",
    players: "Multiplayer",
    rules: [
      "Create a room or join friends with a four-letter code.",
      "Reveal clues about your hidden animal, accessory, and background.",
      "Be the first player to correctly guess your full identity.",
    ],
  },
};

function GameMenu({ game, onPlay, onBack }: { game: LibraryGameId; onPlay: () => void; onBack: () => void }) {
  const details = GAME_MENUS[game];

  return (
    <main className="game-menu-shell">
      <header className="game-topbar menu-topbar">
        <button className="back-button" onClick={onBack}>← Games</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> GAME GARDEN</div>
        <span className="menu-header-spacer" aria-hidden="true" />
      </header>
      <section className="game-menu">
        <div className="menu-card">
          <button className="menu-close" onClick={onBack} aria-label="Close game menu">×</button>
          <span className={`game-cover menu-game-cover art-${game}`}><i>{details.glyph}</i>{game === "deducktion" && <b className="deducktion-cover-title">DEDUCKTION</b>}</span>
          <p className="menu-japanese">{details.japanese}</p>
          <h1>{details.title}</h1>
          <div className="menu-meta"><span>{details.players}</span><span>{details.category}</span></div>
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

const EXTERNAL_GAMES: Record<ExternalGameId, { title: string; url: string }> = {
  meducktion: { title: "Meducktion", url: "https://keshawn7b.github.io/Meducktion/" },
  deducktion: { title: "Deducktion", url: "https://keshawn7b.github.io/deduction-game/" },
};

function EmbeddedGame({ game, onBack }: { game: ExternalGameId; onBack: () => void }) {
  const details = EXTERNAL_GAMES[game];
  return (
    <main className="embedded-game-shell">
      <header className="game-topbar embedded-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <div className="wordmark small-wordmark"><span className="brand-dot" /> {details.title.toUpperCase()}</div>
        <a className="icon-button embedded-open" href={details.url} target="_blank" rel="noreferrer" aria-label={`Open ${details.title} in a new tab`}>↗</a>
      </header>
      <iframe className="embedded-game" src={details.url} title={details.title} allow="fullscreen" />
    </main>
  );
}

const GAMES: { id: LibraryGameId; number: string; name: string; japanese: string; meta: string; scoreGame?: PlayableGameId }[] = [
  { id: "codebreaker", number: "01", name: "Codebreaker", japanese: "コードブレイカー", meta: "LOGIC", scoreGame: "codebreaker" },
  { id: "order", number: "02", name: "Order Match", japanese: "並べ替え", meta: "LOGIC", scoreGame: "order" },
  { id: "number", number: "03", name: "Number Hunt", japanese: "数字探し", meta: "QUICK", scoreGame: "number" },
  { id: "memory", number: "04", name: "Memory Flip", japanese: "記憶", meta: "MEMORY", scoreGame: "memory" },
  { id: "meducktion", number: "05", name: "Meducktion", japanese: "医学推理", meta: "CARD GAME" },
  { id: "deducktion", number: "06", name: "Deducktion", japanese: "正体推理", meta: "CARD GAME" },
];

function formatScore(game: PlayableGameId, score?: number) {
  if (score == null) return "—";
  const unit = game === "memory" ? "moves" : game === "order" ? "checks" : "guesses";
  return `${score} ${score === 1 ? unit.slice(0, -1) : unit}`;
}

function friendlyAuthError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "auth/email-already-in-use") return "That email already has an account. Sign in instead.";
  if (code === "auth/invalid-credential") return "The email or password is incorrect.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") return "Use a password with at least 6 characters.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a moment and try again.";
  if (code === "auth/unauthorized-domain") return "This Game Garden address must be added to Firebase authorized domains.";
  if (code === "auth/operation-not-allowed") return "This sign-in method still needs to be enabled in Firebase.";
  return error instanceof Error ? error.message : "Could not sign in.";
}

async function saveCloudScore(user: User, gameId: PlayableGameId, score: number, profileName: string) {
  const entryRef = doc(db, "leaderboards", gameId, "entries", user.uid);
  const profileRef = doc(db, "users", user.uid);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(entryRef);
    const previousScore = current.exists() ? Number(current.data().score) : Number.POSITIVE_INFINITY;
    const bestScore = Math.min(previousScore, score);
    if (bestScore < previousScore) {
      transaction.set(entryRef, {
        uid: user.uid,
        name: profileName.trim() || user.displayName || "Player One",
        photoURL: user.photoURL || "",
        score: bestScore,
        updatedAt: serverTimestamp(),
      });
    }
    transaction.set(profileRef, { highScores: { [gameId]: bestScore }, updatedAt: serverTimestamp() }, { merge: true });
  });
}

function PlayerAvatar({ small = false, user }: { small?: boolean; user?: User | null }) {
  return <span className={`player-avatar ${small ? "avatar-small" : ""}`} aria-hidden="true">{user?.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <b>遊</b>}</span>;
}

function AppHome({
  activeTab,
  onTabChange,
  onSelect,
  highScores,
  profileName,
  onProfileNameChange,
  onProfileSave,
  firebaseUser,
  authLoading,
  authError,
  onSignIn,
  onEmailSignIn,
  onEmailCreate,
  onSignOut,
  leaderboards,
}: {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onSelect: (game: LibraryGameId) => void;
  highScores: HighScores;
  profileName: string;
  onProfileNameChange: (name: string) => void;
  onProfileSave: () => void;
  firebaseUser: User | null;
  authLoading: boolean;
  authError: string;
  onSignIn: () => void;
  onEmailSignIn: (email: string, password: string) => void;
  onEmailCreate: (email: string, password: string) => void;
  onSignOut: () => void;
  leaderboards: Leaderboards;
}) {
  const completedGames = Object.keys(highScores).length;
  const scoredGames = GAMES.filter((game) => game.scoreGame) as Array<(typeof GAMES)[number] & { scoreGame: PlayableGameId }>;
  const [rankGame, setRankGame] = useState<PlayableGameId>("codebreaker");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const activeRanks = leaderboards[rankGame] ?? [];

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="wordmark"><span className="brand-dot">G</span><span><b>GAME GARDEN</b><small>ゲームガーデン</small></span></div>
        <button className="header-profile" onClick={() => onTabChange("profile")} aria-label="Open profile">
          <PlayerAvatar small user={firebaseUser} />
        </button>
      </header>

      <div className="app-content">
        {activeTab === "games" && (
          <section className="app-panel games-panel">
            <div className="app-title"><div><p>PLAY</p><h1>Games <span>ゲーム</span></h1></div><strong>{GAMES.length}<small>GAMES</small></strong></div>
            <div className="game-app-grid">
              {GAMES.map((game) => (
                <button className="game-app-card" key={game.id} onClick={() => onSelect(game.id)}>
                  <span className={`game-cover art-${game.id}`}><i>{game.number}</i>{game.id === "deducktion" && <b className="deducktion-cover-title">DEDUCKTION</b>}</span>
                  <span className="game-card-copy">
                    <strong>{game.name}</strong>
                    <small>{game.japanese}</small>
                    <em>{game.scoreGame && highScores[game.scoreGame] != null ? `BEST · ${formatScore(game.scoreGame, highScores[game.scoreGame])}` : game.meta}</em>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {activeTab === "leaderboard" && (
          <section className="app-panel rank-panel">
            <div className="app-title"><div><p>GLOBAL</p><h1>Leaderboard <span>ランキング</span></h1></div></div>
            <div className="player-rank-card">
              <span className="rank-number">YOU</span><PlayerAvatar user={firebaseUser} />
              <div><strong>{profileName || "Player One"}</strong><small>{firebaseUser ? "CLOUD PROFILE" : "GUEST PLAYER"}</small></div>
              <b>{completedGames}<small>BESTS</small></b>
            </div>
            <div className="rank-game-tabs" aria-label="Choose leaderboard game">
              {scoredGames.map((game) => <button key={game.id} className={rankGame === game.scoreGame ? "active" : ""} onClick={() => setRankGame(game.scoreGame)}>{game.name}</button>)}
            </div>
            <div className="global-rank-list">
              {activeRanks.length ? activeRanks.map((entry, index) => (
                <div className="global-rank-row" key={entry.uid}>
                  <strong>{String(index + 1).padStart(2, "0")}</strong>
                  <span className="rank-avatar">{entry.photoURL ? <img src={entry.photoURL} alt="" referrerPolicy="no-referrer" /> : "遊"}</span>
                  <span>{entry.name}</span>
                  <b>{formatScore(rankGame, entry.score)}</b>
                </div>
              )) : <p className="empty-ranks">No scores yet. Set the first one.</p>}
            </div>
            <div className="score-list">
              <div className="score-list-heading"><span>Your high scores</span><span>ハイスコア</span></div>
              {scoredGames.map((game) => (
                <div className="score-row" key={game.id}>
                  <span className={`score-art art-${game.id}`} />
                  <div><strong>{game.name}</strong><small>{game.meta}</small></div>
                  <b className={highScores[game.scoreGame] == null ? "no-score" : ""}>{formatScore(game.scoreGame, highScores[game.scoreGame])}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "profile" && (
          <section className="app-panel profile-panel">
            <div className="profile-card">
              <PlayerAvatar user={firebaseUser} />
              <p>PLAYER PROFILE <span>プロフィール</span></p>
              <input
                value={profileName}
                maxLength={18}
                onChange={(event) => onProfileNameChange(event.target.value)}
                aria-label="Player name"
                placeholder="Player One"
              />
              {firebaseUser?.email && <small className="profile-email">{firebaseUser.email}</small>}
              <span className="local-badge">{firebaseUser ? "CLOUD PROFILE" : "GUEST PROFILE"}</span>
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <div className="profile-actions">
                {firebaseUser ? <><button className="primary-button" onClick={onProfileSave}>Save profile</button><button className="text-button" onClick={onSignOut}>Sign out</button></> : <>
                  <div className="email-auth-fields">
                    <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email address" aria-label="Email address" autoComplete="email" />
                    <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" minLength={6} />
                  </div>
                  <div className="email-auth-actions">
                    <button className="primary-button" onClick={() => onEmailSignIn(authEmail, authPassword)} disabled={authLoading || !authEmail || authPassword.length < 6}>Sign in</button>
                    <button className="secondary-button" onClick={() => onEmailCreate(authEmail, authPassword)} disabled={authLoading || !authEmail || authPassword.length < 6}>Create account</button>
                  </div>
                  <span className="auth-divider">OR</span>
                  <button className="primary-button google-button" onClick={onSignIn} disabled={authLoading}>{authLoading ? "Connecting…" : "Continue with Google"}</button>
                </>}
              </div>
            </div>
            <div className="profile-stats">
              <div><strong>{completedGames}</strong><span>HIGH SCORES</span></div>
              <div><strong>{GAMES.length}</strong><span>GAMES</span></div>
            </div>
            <div className="profile-scores">
              <h2>Your best <span>自己ベスト</span></h2>
              {scoredGames.map((game) => <p key={game.id}><span>{game.name}</span><strong>{formatScore(game.scoreGame, highScores[game.scoreGame])}</strong></p>)}
            </div>
          </section>
        )}
      </div>

      <nav className="bottom-nav" aria-label="App navigation">
        <button className={activeTab === "games" ? "active" : ""} onClick={() => onTabChange("games")}><b>遊</b><span>Games</span></button>
        <button className={activeTab === "leaderboard" ? "active" : ""} onClick={() => onTabChange("leaderboard")}><b>冠</b><span>Ranks</span></button>
        <button className={activeTab === "profile" ? "active" : ""} onClick={() => onTabChange("profile")}><b>人</b><span>Profile</span></button>
      </nav>
    </main>
  );
}

export default function Home() {
  const [game, setGame] = useState<GameId>("games");
  const [highScores, setHighScores] = useState<HighScores>({});
  const [profileName, setProfileName] = useState("Player One");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [leaderboards, setLeaderboards] = useState<Leaderboards>({});

  useEffect(() => {
    const onPopState = () => setGame((window.location.hash.slice(1) as GameId) || "games");
    onPopState();
    try {
      const savedScores = window.localStorage.getItem("pocket-play-scores");
      const savedName = window.localStorage.getItem("pocket-play-name");
      if (savedScores) setHighScores(JSON.parse(savedScores));
      if (savedName) setProfileName(savedName);
    } catch { /* Device storage may be unavailable. */ }
    window.addEventListener("hashchange", onPopState);
    return () => window.removeEventListener("hashchange", onPopState);
  }, []);

  useEffect(() => {
    void getRedirectResult(auth).catch((error: unknown) => setAuthError(friendlyAuthError(error)));
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
      setAuthError("");
      if (!user) return;

      try {
        const profileRef = doc(db, "users", user.uid);
        const profile = await getDoc(profileRef);
        const data = profile.data();
        const cloudName = typeof data?.displayName === "string" ? data.displayName : user.displayName || "Player One";
        const cloudScores = data?.highScores && typeof data.highScores === "object" ? data.highScores as HighScores : {};
        const savedScores = window.localStorage.getItem("pocket-play-scores");
        const localScores = savedScores ? JSON.parse(savedScores) as HighScores : {};
        const mergedScores = { ...cloudScores };
        for (const gameId of ["codebreaker", "order", "number", "memory"] as PlayableGameId[]) {
          const local = localScores[gameId];
          const cloud = cloudScores[gameId];
          if (local != null && (cloud == null || local < cloud)) {
            mergedScores[gameId] = local;
            await saveCloudScore(user, gameId, local, cloudName);
          }
        }
        setProfileName(cloudName);
        setHighScores(mergedScores);
        window.localStorage.setItem("pocket-play-name", cloudName);
        window.localStorage.setItem("pocket-play-scores", JSON.stringify(mergedScores));
        await setDoc(profileRef, {
          uid: user.uid,
          displayName: cloudName,
          photoURL: user.photoURL || "",
          updatedAt: serverTimestamp(),
          ...(profile.exists() ? {} : { createdAt: serverTimestamp() }),
        }, { merge: true });
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Could not load the cloud profile.");
      }
    });
  }, []);

  useEffect(() => {
    const games: PlayableGameId[] = ["codebreaker", "order", "number", "memory"];
    const unsubscribers = games.map((gameId) => onSnapshot(
      query(collection(db, "leaderboards", gameId, "entries"), orderBy("score", "asc"), limit(10)),
      (snapshot) => setLeaderboards((previous) => ({ ...previous, [gameId]: snapshot.docs.map((entry) => entry.data() as LeaderboardEntry) })),
      () => undefined,
    ));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const selectGame = (next: GameId) => {
    setGame(next);
    window.location.hash = next === "games" ? "" : next;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const recordScore = useCallback((gameId: PlayableGameId, score: number) => {
    setHighScores((previous) => {
      if (previous[gameId] != null && previous[gameId]! <= score) return previous;
      const next = { ...previous, [gameId]: score };
      try { window.localStorage.setItem("pocket-play-scores", JSON.stringify(next)); } catch { /* Device storage may be unavailable. */ }
      return next;
    });
    if (firebaseUser) void saveCloudScore(firebaseUser, gameId, score, profileName).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not save the score online."));
  }, [firebaseUser, profileName]);

  const updateProfileName = useCallback((name: string) => {
    setProfileName(name);
    try { window.localStorage.setItem("pocket-play-name", name); } catch { /* Device storage may be unavailable. */ }
  }, []);

  const saveProfile = useCallback(async () => {
    if (!firebaseUser) return;
    const displayName = profileName.trim() || firebaseUser.displayName || "Player One";
    setProfileName(displayName);
    setAuthError("");
    try {
      await setDoc(doc(db, "users", firebaseUser.uid), {
        uid: firebaseUser.uid,
        displayName,
        photoURL: firebaseUser.photoURL || "",
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await updateProfile(firebaseUser, { displayName });
      const batch = writeBatch(db);
      for (const [gameId, score] of Object.entries(highScores) as [PlayableGameId, number][]) {
        batch.set(doc(db, "leaderboards", gameId, "entries", firebaseUser.uid), {
          uid: firebaseUser.uid,
          name: displayName,
          photoURL: firebaseUser.photoURL || "",
          score,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      window.localStorage.setItem("pocket-play-name", displayName);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not save the profile.");
    }
  }, [firebaseUser, highScores, profileName]);

  const signIn = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "auth/popup-blocked") await signInWithRedirect(auth, googleProvider);
      else setAuthError(friendlyAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const emailSignIn = useCallback(async (email: string, password: string) => {
    setAuthLoading(true);
    setAuthError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      setAuthError(friendlyAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const emailCreate = useCallback(async (email: string, password: string) => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const displayName = profileName.trim() || email.split("@")[0] || "Player One";
      await updateProfile(credential.user, { displayName });
      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid,
        displayName,
        photoURL: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProfileName(displayName);
    } catch (error) {
      setAuthError(friendlyAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  }, [profileName]);

  const signOutProfile = useCallback(() => {
    void signOut(auth).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not sign out."));
  }, []);

  const view = useMemo(() => {
    if (game === "codebreaker-menu") return <GameMenu game="codebreaker" onPlay={() => selectGame("codebreaker")} onBack={() => selectGame("games")} />;
    if (game === "order-menu") return <GameMenu game="order" onPlay={() => selectGame("order")} onBack={() => selectGame("games")} />;
    if (game === "number-menu") return <GameMenu game="number" onPlay={() => selectGame("number")} onBack={() => selectGame("games")} />;
    if (game === "memory-menu") return <GameMenu game="memory" onPlay={() => selectGame("memory")} onBack={() => selectGame("games")} />;
    if (game === "meducktion-menu") return <GameMenu game="meducktion" onPlay={() => selectGame("meducktion")} onBack={() => selectGame("games")} />;
    if (game === "deducktion-menu") return <GameMenu game="deducktion" onPlay={() => selectGame("deducktion")} onBack={() => selectGame("games")} />;
    if (game === "codebreaker") return <Codebreaker onBack={() => selectGame("codebreaker-menu")} onScore={(score) => recordScore("codebreaker", score)} />;
    if (game === "order") return <OrderMatch onBack={() => selectGame("order-menu")} onScore={(score) => recordScore("order", score)} />;
    if (game === "number") return <NumberHunt onBack={() => selectGame("number-menu")} onScore={(score) => recordScore("number", score)} />;
    if (game === "memory") return <MemoryGame onBack={() => selectGame("memory-menu")} onScore={(score) => recordScore("memory", score)} />;
    if (game === "meducktion") return <EmbeddedGame game="meducktion" onBack={() => selectGame("meducktion-menu")} />;
    if (game === "deducktion") return <EmbeddedGame game="deducktion" onBack={() => selectGame("deducktion-menu")} />;
    const activeTab: AppTab = game === "leaderboard" || game === "profile" ? game : "games";
    return <AppHome activeTab={activeTab} onTabChange={selectGame} onSelect={(selected) => selectGame(`${selected}-menu`)} highScores={highScores} profileName={profileName} onProfileNameChange={updateProfileName} onProfileSave={saveProfile} firebaseUser={firebaseUser} authLoading={authLoading} authError={authError} onSignIn={signIn} onEmailSignIn={emailSignIn} onEmailCreate={emailCreate} onSignOut={signOutProfile} leaderboards={leaderboards} />;
  }, [game, highScores, profileName, recordScore, updateProfileName, saveProfile, firebaseUser, authLoading, authError, signIn, emailSignIn, emailCreate, signOutProfile, leaderboards]);

  return view;
}
