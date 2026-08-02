"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createUserWithEmailAndPassword, getRedirectResult, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type User } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type PlayableGameId = "codebreaker" | "order" | "number" | "memory";
type ExternalGameId = "meducktion" | "deducktion";
type LibraryGameId = PlayableGameId | ExternalGameId;
type AppTab = "games" | "leaderboard" | "friends" | "profile";
type ThemeMode = "classic" | "sakura";
type GameId = AppTab | LibraryGameId | `${LibraryGameId}-menu`;
type ColorId = "coral" | "gold" | "mint" | "blue" | "violet" | "pink";
type AvatarId = "play" | "sakura" | "fox" | "koi" | "moon" | "crane" | "dragon" | "cat" | "ninja" | "sun" | "pink-blossom" | "pink-heart" | "pink-bunny" | "pink-fan" | "pink-peach";
type HighScores = Partial<Record<PlayableGameId, number>>;
type LeaderboardEntry = { uid: string; name: string; photoURL: string; avatarId?: AvatarId; score: number };
type Leaderboards = Partial<Record<PlayableGameId, LeaderboardEntry[]>>;
type FriendEntry = { uid: string; name: string; avatarId: AvatarId };

const AVATARS: { id: AvatarId; glyph: string; label: string }[] = [
  { id: "play", glyph: "遊", label: "Play" },
  { id: "sakura", glyph: "桜", label: "Sakura" },
  { id: "fox", glyph: "狐", label: "Fox" },
  { id: "koi", glyph: "鯉", label: "Koi" },
  { id: "moon", glyph: "月", label: "Moon" },
  { id: "crane", glyph: "鶴", label: "Crane" },
  { id: "dragon", glyph: "龍", label: "Dragon" },
  { id: "cat", glyph: "猫", label: "Cat" },
  { id: "ninja", glyph: "忍", label: "Ninja" },
  { id: "sun", glyph: "日", label: "Sun" },
  { id: "pink-blossom", glyph: "花", label: "Pink blossom" },
  { id: "pink-heart", glyph: "愛", label: "Pink heart" },
  { id: "pink-bunny", glyph: "兎", label: "Pink bunny" },
  { id: "pink-fan", glyph: "扇", label: "Pink fan" },
  { id: "pink-peach", glyph: "桃", label: "Pink peach" },
];

function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATARS.some((avatar) => avatar.id === value);
}

function friendCodeFor(uid: string) {
  return uid.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
}

async function syncPublicProfile(user: User, name: string, avatarId: AvatarId) {
  await setDoc(doc(db, "publicProfiles", user.uid), {
    uid: user.uid,
    name: name.trim() || user.displayName || "Player One",
    avatarId,
    friendCode: friendCodeFor(user.uid),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

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

async function saveCloudScore(user: User, gameId: PlayableGameId, score: number, profileName: string, avatarId: AvatarId) {
  const entryRef = doc(db, "leaderboards", gameId, "entries", user.uid);
  const profileRef = doc(db, "users", user.uid);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(entryRef);
    const previousScore = current.exists() ? Number(current.data().score) : Number.POSITIVE_INFINITY;
    const bestScore = Math.min(previousScore, score);
    transaction.set(entryRef, {
      uid: user.uid,
      name: profileName.trim() || user.displayName || "Player One",
      photoURL: "",
      avatarId,
      score: bestScore,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.set(profileRef, { highScores: { [gameId]: bestScore }, avatarId, updatedAt: serverTimestamp() }, { merge: true });
  });
}

function AvatarGlyph({ avatarId, className = "" }: { avatarId: AvatarId; className?: string }) {
  const avatar = AVATARS.find((option) => option.id === avatarId) ?? AVATARS[0];
  return <span className={`${className} avatar-style-${avatar.id}`} aria-hidden="true"><b>{avatar.glyph}</b></span>;
}

function PlayerAvatar({ small = false, avatarId }: { small?: boolean; avatarId: AvatarId }) {
  return <AvatarGlyph avatarId={avatarId} className={`player-avatar ${small ? "avatar-small" : ""}`} />;
}

function AppHome({
  activeTab,
  theme,
  onThemeToggle,
  onTabChange,
  onSelect,
  highScores,
  profileName,
  avatarId,
  onProfileNameChange,
  onAvatarChange,
  onProfileSave,
  firebaseUser,
  authLoading,
  authError,
  onSignIn,
  onEmailSignIn,
  onEmailCreate,
  onSignOut,
  leaderboards,
  friends,
  friendCode,
  onAddFriend,
  onRemoveFriend,
}: {
  activeTab: AppTab;
  theme: ThemeMode;
  onThemeToggle: () => void;
  onTabChange: (tab: AppTab) => void;
  onSelect: (game: LibraryGameId) => void;
  highScores: HighScores;
  profileName: string;
  avatarId: AvatarId;
  onProfileNameChange: (name: string) => void;
  onAvatarChange: (avatarId: AvatarId) => void;
  onProfileSave: () => void;
  firebaseUser: User | null;
  authLoading: boolean;
  authError: string;
  onSignIn: () => void;
  onEmailSignIn: (email: string, password: string) => void;
  onEmailCreate: (email: string, password: string) => void;
  onSignOut: () => void;
  leaderboards: Leaderboards;
  friends: FriendEntry[];
  friendCode: string;
  onAddFriend: (code: string) => Promise<string>;
  onRemoveFriend: (uid: string) => void;
}) {
  const completedGames = Object.keys(highScores).length;
  const scoredGames = GAMES.filter((game) => game.scoreGame) as Array<(typeof GAMES)[number] & { scoreGame: PlayableGameId }>;
  const [rankGame, setRankGame] = useState<PlayableGameId>("codebreaker");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [friendInput, setFriendInput] = useState("");
  const [friendMessage, setFriendMessage] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const activeRanks = leaderboards[rankGame] ?? [];

  const submitFriend = async () => {
    setFriendBusy(true);
    setFriendMessage("");
    try {
      const message = await onAddFriend(friendInput);
      setFriendMessage(message);
      setFriendInput("");
    } finally {
      setFriendBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="wordmark"><span className="brand-dot">G</span><span><b>GAME GARDEN</b><small>ゲームガーデン</small></span></div>
        <div className="header-actions">
          <button className="theme-toggle" onClick={onThemeToggle} aria-label="Toggle Sakura Mode" aria-pressed={theme === "sakura"}><b>桜</b><span>MODE</span></button>
          <button className="header-profile" onClick={() => onTabChange("profile")} aria-label="Open profile">
            <PlayerAvatar small avatarId={avatarId} />
          </button>
        </div>
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
              <span className="rank-number">YOU</span><PlayerAvatar avatarId={avatarId} />
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
                  <AvatarGlyph avatarId={isAvatarId(entry.avatarId) ? entry.avatarId : "play"} className="rank-avatar" />
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
              <PlayerAvatar avatarId={avatarId} />
              <p>PLAYER PROFILE <span>プロフィール</span></p>
              <div className="avatar-picker" role="group" aria-label="Choose a profile picture">
                {AVATARS.map((avatar) => (
                  <button key={avatar.id} className={avatarId === avatar.id ? "selected" : ""} onClick={() => onAvatarChange(avatar.id)} aria-label={`${avatar.label} profile picture`} aria-pressed={avatarId === avatar.id}>
                    <AvatarGlyph avatarId={avatar.id} className="avatar-option" />
                  </button>
                ))}
              </div>
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

        {activeTab === "friends" && (
          <section className="app-panel friends-panel">
            <div className="app-title"><div><p>SOCIAL</p><h1>Friends <span>友達</span></h1></div><strong>{friends.length}<small>FRIENDS</small></strong></div>
            {!firebaseUser ? (
              <div className="friends-signin-card">
                <AvatarGlyph avatarId="pink-blossom" className="friend-hero-avatar" />
                <h2>Sign in to add friends.</h2>
                <button className="primary-button" onClick={() => onTabChange("profile")}>Open profile</button>
              </div>
            ) : <>
              <div className="friend-code-card">
                <span>YOUR FRIEND CODE</span>
                <strong>{friendCode}</strong>
                <small>Share this code with another player.</small>
              </div>
              <div className="friend-add-card">
                <label htmlFor="friend-code">ADD A FRIEND <span>友達を追加</span></label>
                <div><input id="friend-code" value={friendInput} maxLength={8} onChange={(event) => setFriendInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="FRIEND CODE" /><button className="primary-button" onClick={submitFriend} disabled={friendBusy || friendInput.length !== 8}>{friendBusy ? "Adding…" : "Add"}</button></div>
                {friendMessage && <p role="status">{friendMessage}</p>}
              </div>
              <div className="friend-list">
                <div className="friend-list-heading"><span>Friend list</span><span>フレンド</span></div>
                {friends.length ? friends.map((friend) => (
                  <div className="friend-row" key={friend.uid}>
                    <AvatarGlyph avatarId={isAvatarId(friend.avatarId) ? friend.avatarId : "play"} className="friend-avatar" />
                    <strong>{friend.name}</strong>
                    <button onClick={() => onRemoveFriend(friend.uid)} aria-label={`Remove ${friend.name}`}>×</button>
                  </div>
                )) : <p className="empty-friends">No friends added yet.</p>}
              </div>
            </>}
          </section>
        )}
      </div>

      <nav className="bottom-nav" aria-label="App navigation">
        <button className={activeTab === "games" ? "active" : ""} onClick={() => onTabChange("games")}><b>遊</b><span>Games</span></button>
        <button className={activeTab === "leaderboard" ? "active" : ""} onClick={() => onTabChange("leaderboard")}><b>冠</b><span>Ranks</span></button>
        <button className={activeTab === "friends" ? "active" : ""} onClick={() => onTabChange("friends")}><b>友</b><span>Friends</span></button>
        <button className={activeTab === "profile" ? "active" : ""} onClick={() => onTabChange("profile")}><b>人</b><span>Profile</span></button>
      </nav>
    </main>
  );
}

export default function Home() {
  const [game, setGame] = useState<GameId>("games");
  const [highScores, setHighScores] = useState<HighScores>({});
  const [profileName, setProfileName] = useState("Player One");
  const [avatarId, setAvatarId] = useState<AvatarId>("play");
  const [theme, setTheme] = useState<ThemeMode>("classic");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [leaderboards, setLeaderboards] = useState<Leaderboards>({});
  const [friends, setFriends] = useState<FriendEntry[]>([]);

  useEffect(() => {
    const onPopState = () => setGame((window.location.hash.slice(1) as GameId) || "games");
    onPopState();
    try {
      const savedScores = window.localStorage.getItem("pocket-play-scores");
      const savedName = window.localStorage.getItem("pocket-play-name");
      const savedAvatar = window.localStorage.getItem("game-garden-avatar");
      const savedTheme = window.localStorage.getItem("game-garden-theme");
      if (savedScores) setHighScores(JSON.parse(savedScores));
      if (savedName) setProfileName(savedName);
      if (isAvatarId(savedAvatar)) setAvatarId(savedAvatar);
      if (savedTheme === "sakura") {
        setTheme("sakura");
        document.documentElement.dataset.theme = "sakura";
      } else delete document.documentElement.dataset.theme;
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
        const savedAvatar = window.localStorage.getItem("game-garden-avatar");
        const cloudAvatar: AvatarId = isAvatarId(data?.avatarId) ? data.avatarId : isAvatarId(savedAvatar) ? savedAvatar : "play";
        const cloudScores = data?.highScores && typeof data.highScores === "object" ? data.highScores as HighScores : {};
        const savedScores = window.localStorage.getItem("pocket-play-scores");
        const localScores = savedScores ? JSON.parse(savedScores) as HighScores : {};
        const mergedScores = { ...cloudScores };
        for (const gameId of ["codebreaker", "order", "number", "memory"] as PlayableGameId[]) {
          const local = localScores[gameId];
          const cloud = cloudScores[gameId];
          if (local != null && (cloud == null || local < cloud)) {
            mergedScores[gameId] = local;
            await saveCloudScore(user, gameId, local, cloudName, cloudAvatar);
          }
        }
        setProfileName(cloudName);
        setAvatarId(cloudAvatar);
        setHighScores(mergedScores);
        window.localStorage.setItem("pocket-play-name", cloudName);
        window.localStorage.setItem("pocket-play-scores", JSON.stringify(mergedScores));
        window.localStorage.setItem("game-garden-avatar", cloudAvatar);
        await setDoc(profileRef, {
          uid: user.uid,
          displayName: cloudName,
          photoURL: user.photoURL || "",
          avatarId: cloudAvatar,
          updatedAt: serverTimestamp(),
          ...(profile.exists() ? {} : { createdAt: serverTimestamp() }),
        }, { merge: true });
        await syncPublicProfile(user, cloudName, cloudAvatar);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Could not load the cloud profile.");
      }
    });
  }, []);

  useEffect(() => {
    if (!firebaseUser) {
      setFriends([]);
      return;
    }
    return onSnapshot(collection(db, "users", firebaseUser.uid, "friends"), (snapshot) => {
      setFriends(snapshot.docs.map((friend) => friend.data() as FriendEntry).sort((a, b) => a.name.localeCompare(b.name)));
    }, () => setAuthError("Could not load the friend list."));
  }, [firebaseUser]);

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
    if (firebaseUser) void saveCloudScore(firebaseUser, gameId, score, profileName, avatarId).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not save the score online."));
  }, [firebaseUser, profileName, avatarId]);

  const updateProfileName = useCallback((name: string) => {
    setProfileName(name);
    try { window.localStorage.setItem("pocket-play-name", name); } catch { /* Device storage may be unavailable. */ }
  }, []);

  const updateAvatar = useCallback((nextAvatar: AvatarId) => {
    setAvatarId(nextAvatar);
    try { window.localStorage.setItem("game-garden-avatar", nextAvatar); } catch { /* Device storage may be unavailable. */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: ThemeMode = current === "sakura" ? "classic" : "sakura";
      if (next === "sakura") document.documentElement.dataset.theme = "sakura";
      else delete document.documentElement.dataset.theme;
      try { window.localStorage.setItem("game-garden-theme", next); } catch { /* Device storage may be unavailable. */ }
      return next;
    });
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
        avatarId,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await syncPublicProfile(firebaseUser, displayName, avatarId);
      await updateProfile(firebaseUser, { displayName });
      const batch = writeBatch(db);
      for (const [gameId, score] of Object.entries(highScores) as [PlayableGameId, number][]) {
        batch.set(doc(db, "leaderboards", gameId, "entries", firebaseUser.uid), {
          uid: firebaseUser.uid,
          name: displayName,
          photoURL: "",
          avatarId,
          score,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      window.localStorage.setItem("pocket-play-name", displayName);
      window.localStorage.setItem("game-garden-avatar", avatarId);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not save the profile.");
    }
  }, [firebaseUser, highScores, profileName, avatarId]);

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
        avatarId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await syncPublicProfile(credential.user, displayName, avatarId);
      setProfileName(displayName);
    } catch (error) {
      setAuthError(friendlyAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  }, [profileName, avatarId]);

  const signOutProfile = useCallback(() => {
    void signOut(auth).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not sign out."));
  }, []);

  const addFriend = useCallback(async (rawCode: string) => {
    if (!firebaseUser) return "Sign in before adding friends.";
    const code = rawCode.trim().toUpperCase();
    if (code === friendCodeFor(firebaseUser.uid)) return "That is your own friend code.";
    try {
      const matches = await getDocs(query(collection(db, "publicProfiles"), where("friendCode", "==", code), limit(1)));
      if (matches.empty) return "No player was found with that code.";
      const profile = matches.docs[0].data();
      const friendUid = String(profile.uid || matches.docs[0].id);
      const friendName = typeof profile.name === "string" ? profile.name : "Player";
      const friendAvatar: AvatarId = isAvatarId(profile.avatarId) ? profile.avatarId : "play";
      await setDoc(doc(db, "users", firebaseUser.uid, "friends", friendUid), {
        uid: friendUid,
        name: friendName,
        avatarId: friendAvatar,
        addedAt: serverTimestamp(),
      });
      return `${friendName} was added.`;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not add that friend.");
      return "Could not add that friend.";
    }
  }, [firebaseUser]);

  const removeFriend = useCallback((friendUid: string) => {
    if (!firebaseUser) return;
    void deleteDoc(doc(db, "users", firebaseUser.uid, "friends", friendUid)).catch(() => setAuthError("Could not remove that friend."));
  }, [firebaseUser]);

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
    const activeTab: AppTab = game === "leaderboard" || game === "friends" || game === "profile" ? game : "games";
    return <AppHome activeTab={activeTab} theme={theme} onThemeToggle={toggleTheme} onTabChange={selectGame} onSelect={(selected) => selectGame(`${selected}-menu`)} highScores={highScores} profileName={profileName} avatarId={avatarId} onProfileNameChange={updateProfileName} onAvatarChange={updateAvatar} onProfileSave={saveProfile} firebaseUser={firebaseUser} authLoading={authLoading} authError={authError} onSignIn={signIn} onEmailSignIn={emailSignIn} onEmailCreate={emailCreate} onSignOut={signOutProfile} leaderboards={leaderboards} friends={friends} friendCode={firebaseUser ? friendCodeFor(firebaseUser.uid) : ""} onAddFriend={addFriend} onRemoveFriend={removeFriend} />;
  }, [game, theme, highScores, profileName, avatarId, recordScore, toggleTheme, updateProfileName, updateAvatar, saveProfile, firebaseUser, authLoading, authError, signIn, emailSignIn, emailCreate, signOutProfile, leaderboards, friends, addFriend, removeFriend]);

  return view;
}
