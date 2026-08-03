"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUserWithEmailAndPassword, getRedirectResult, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type User } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type PlayableGameId = "codebreaker" | "order" | "number" | "memory" | "tictactoe" | "connect4" | "rps" | "dice";
type ExternalGameId = "meducktion" | "deducktion";
type LibraryGameId = PlayableGameId | ExternalGameId;
type AppTab = "games" | "leaderboard" | "friends" | "profile";
type ThemeMode = "classic" | "sakura";
type GameMode = "solo" | "multi";
type GameId = AppTab | LibraryGameId | `${LibraryGameId}-menu` | `${PlayableGameId}-lobby`;
type ColorId = "coral" | "gold" | "mint" | "blue" | "violet" | "pink";
type AvatarId = "play" | "sakura" | "fox" | "koi" | "moon" | "crane" | "dragon" | "cat" | "ninja" | "sun" | "pink-blossom" | "pink-heart" | "pink-bunny" | "pink-fan" | "pink-peach";
type HighScores = Partial<Record<PlayableGameId, number>>;
type LeaderboardEntry = { uid: string; name: string; photoURL: string; avatarId?: AvatarId; score: number };
type Leaderboards = Partial<Record<PlayableGameId, LeaderboardEntry[]>>;
type FriendEntry = { uid: string; name: string; avatarId: AvatarId; highScores?: HighScores };
type InviteStatus = "pending" | "accepted" | "declined" | "cancelled";
type GameInvite = {
  id: string;
  fromUid: string;
  fromName: string;
  fromAvatar: AvatarId;
  toUid: string;
  toName: string;
  toAvatar: AvatarId;
  gameId: PlayableGameId;
  gameName: string;
  status: InviteStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  expiresAt?: Timestamp;
  roomCode?: string;
};
type GameRoom = {
  code: string;
  gameId: PlayableGameId;
  gameName: string;
  hostUid: string;
  hostName: string;
  hostAvatar: AvatarId;
  guestUid?: string;
  guestName?: string;
  guestAvatar?: AvatarId;
  status: "open" | "ready" | "playing";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  expiresAt?: Timestamp;
};
type NumberOnlineState = {
  gameId: "number";
  roomCode: string;
  round: 1 | 2;
  phase: "setting" | "guessing" | "pending" | "round-result" | "match-result";
  keeperUid: string;
  keeperName: string;
  guesserUid: string;
  guesserName: string;
  guesses: number[];
  pendingGuess: number | null;
  lastGuess: number | null;
  lastClue: "none" | "higher" | "lower" | "correct";
  scores: [number | null, number | null];
  revealedSecrets: [number | null, number | null];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const HEADER_META: Record<AppTab, { label: string; japanese: string; glyph: string }> = {
  games: { label: "ARCADE", japanese: "ゲーム", glyph: "遊" },
  leaderboard: { label: "RANKS", japanese: "ランキング", glyph: "冠" },
  friends: { label: "SOCIAL", japanese: "フレンド", glyph: "友" },
  profile: { label: "PLAYER", japanese: "プロフィール", glyph: "人" },
};

const AVATARS: { id: AvatarId; glyph?: string; label: string }[] = [
  { id: "play", glyph: "遊", label: "Play kanji" },
  { id: "sakura", label: "Sakura bloom" },
  { id: "fox", label: "Fox mask" },
  { id: "koi", label: "Koi fish" },
  { id: "moon", label: "Crescent moon" },
  { id: "crane", label: "Flying crane" },
  { id: "dragon", glyph: "龍", label: "Dragon kanji" },
  { id: "cat", label: "Lucky cat" },
  { id: "ninja", label: "Ninja mask" },
  { id: "sun", label: "Rising sun" },
  { id: "pink-blossom", label: "Pink blossom" },
  { id: "pink-heart", label: "Pink heart" },
  { id: "pink-bunny", label: "Pink bunny" },
  { id: "pink-fan", label: "Pink fan" },
  { id: "pink-peach", label: "Pink peach" },
];

function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATARS.some((avatar) => avatar.id === value);
}

function friendCodeFor(uid: string) {
  return uid.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
}

function friendCodeFromUrl() {
  if (typeof window === "undefined") return "";
  const code = new URLSearchParams(window.location.search).get("friend")?.toUpperCase() ?? "";
  return /^[A-Z0-9]{8}$/.test(code) ? code : "";
}

function roomCodeFromUrl() {
  if (typeof window === "undefined") return "";
  const code = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
  return /^[A-Z2-9]{6}$/.test(code) ? code : "";
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function inviteIdFor(fromUid: string, toUid: string, gameId: PlayableGameId, roomCode?: string) {
  return `${fromUid}--${toUid}--${gameId}${roomCode ? `--${roomCode}` : ""}`;
}

function inviteIsLive(invite: GameInvite) {
  return invite.status === "pending" && (invite.expiresAt?.toMillis() ?? Number.POSITIVE_INFINITY) > Date.now();
}

function inviteTimeLeft(invite: GameInvite) {
  const remaining = Math.max(0, (invite.expiresAt?.toMillis() ?? Date.now()) - Date.now());
  const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1000)));
  return `${hours}h left`;
}

async function syncPublicProfile(user: User, name: string, avatarId: AvatarId, highScores: HighScores) {
  await setDoc(doc(db, "publicProfiles", user.uid), {
    uid: user.uid,
    name: name.trim() || user.displayName || "Player One",
    avatarId,
    friendCode: friendCodeFor(user.uid),
    highScores,
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

function TurnBanner({ mode, currentPlayer, scores }: { mode: GameMode; currentPlayer: 0 | 1; scores?: [number, number] }) {
  if (mode === "solo") return null;
  return (
    <div className="turn-banner" aria-live="polite">
      <span>LOCAL VERSUS</span>
      <strong>PLAYER {currentPlayer + 1}&apos;S TURN</strong>
      {scores && <small>P1 {scores[0]} · {scores[1]} P2</small>}
    </div>
  );
}

function Codebreaker({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [secret, setSecret] = useState<ColorId[]>(makeSecret);
  const [current, setCurrent] = useState<ColorId[]>([]);
  const [guesses, setGuesses] = useState<{ colors: ColorId[]; exact: number; close: number; player: 0 | 1 }[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<0 | 1>(0);
  const won = guesses.some((guess) => guess.exact === 4);
  const lost = guesses.length >= 8 && !won;
  const winner = guesses.find((guess) => guess.exact === 4)?.player;

  const reset = () => {
    setSecret(makeSecret());
    setCurrent([]);
    setGuesses([]);
    setCurrentPlayer(0);
  };

  const submit = () => {
    if (current.length !== 4 || won || lost) return;
    const result = scoreGuess(current, secret);
    if (result.exact === 4 && mode === "solo") onScore(guesses.length + 1);
    setGuesses((previous) => [...previous, { colors: current, ...result, player: currentPlayer }]);
    setCurrent([]);
    if (mode === "multi" && result.exact !== 4) setCurrentPlayer((player) => player === 0 ? 1 : 0);
  };

  return (
    <main className="game-shell codebreaker-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <HeaderLogo compact />
        <button className="icon-button" onClick={reset} aria-label="Start a new code">↻</button>
      </header>

      <section className="game-intro">
        <p className="eyebrow">LOGIC · {mode === "multi" ? "2 PLAYERS" : "1 PLAYER"}</p>
        <h1>Crack the color code.</h1>
        <p>{mode === "multi" ? "Take turns. The first player to crack the shared code wins." : "Find four hidden colors in eight guesses. Colors can repeat."}</p>
        <div className="legend" aria-label="Feedback key">
          <span><i className="key-dot exact-dot" /> Right color, right spot</span>
          <span><i className="key-dot close-dot" /> Right color, wrong spot</span>
        </div>
      </section>

      {!won && !lost && <TurnBanner mode={mode} currentPlayer={currentPlayer} />}

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
                <span className="attempt-number">{guess && mode === "multi" ? `P${guess.player + 1}` : String(index + 1).padStart(2, "0")}</span>
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
            <div><strong>{won ? mode === "multi" ? `Player ${(winner ?? 0) + 1} wins!` : "Code cracked!" : mode === "multi" ? "Draw game." : "So close."}</strong><span>{won ? `Solved in ${guesses.length} ${guesses.length === 1 ? "guess" : "guesses"}.` : "The secret slipped away this round."}</span></div>
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

function OrderMatch({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [round, setRound] = useState(makeOrderRound);
  const [selected, setSelected] = useState<number | null>(null);
  const [checks, setChecks] = useState<number[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<0 | 1>(0);
  const exact = checks.at(-1) ?? 0;
  const won = exact === 4;
  const lost = checks.length >= 8 && !won;

  const reset = () => {
    setRound(makeOrderRound());
    setSelected(null);
    setChecks([]);
    setCurrentPlayer(0);
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
    if (matches === 4 && mode === "solo") onScore(checks.length + 1);
    setChecks((previous) => [...previous, matches]);
    if (mode === "multi" && matches !== 4) setCurrentPlayer((player) => player === 0 ? 1 : 0);
  };

  return (
    <main className="game-shell order-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <HeaderLogo compact />
        <button className="icon-button" onClick={reset} aria-label="Start a new order">↻</button>
      </header>

      <section className="order-game">
        <p className="eyebrow">LOGIC · {mode === "multi" ? "2 PLAYERS" : "1 PLAYER"}</p>
        <h1>Match the hidden order.</h1>
        <p>{mode === "multi" ? "Take turns switching objects. The first player to match the row wins." : "Tap two objects to switch their places, then check your row."}</p>

        {!won && !lost && <TurnBanner mode={mode} currentPlayer={currentPlayer} />}

        <div className="order-board">
          <div className="order-secret">
            <span>HIDDEN ORDER</span>
            <div className="order-row" aria-label={won || lost ? "Revealed correct order" : "Hidden correct order"}>
              {round.target.map((color, index) => <Peg key={index} color={color} hidden={!won && !lost} />)}
            </div>
          </div>

          <div className="order-status" aria-live="polite">
            <strong>{checks.length ? `${exact} / 4` : "— / 4"}</strong>
            <span>{won ? mode === "multi" ? `PLAYER ${currentPlayer + 1} WINS` : "ORDER MATCHED" : lost ? "ORDER REVEALED" : checks.length ? "IN THE CORRECT PLACE" : "CHECK WHEN READY"}</span>
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

type NumberVersusPhase = "set-secret" | "handoff" | "guessing" | "round-result" | "match-result";

function NumberHunt({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [target, setTarget] = useState(() => Math.floor(Math.random() * 100) + 1);
  const [value, setValue] = useState(50);
  const [history, setHistory] = useState<number[]>([]);
  const [phase, setPhase] = useState<NumberVersusPhase>(mode === "multi" ? "set-secret" : "guessing");
  const [round, setRound] = useState<1 | 2>(1);
  const [roundScores, setRoundScores] = useState<[number | null, number | null]>([null, null]);
  const [roundSecrets, setRoundSecrets] = useState<[number | null, number | null]>([null, null]);
  const guessLimit = 7;
  const secretKeeper = round === 1 ? 1 : 2;
  const guesser = round === 1 ? 2 : 1;
  const latest = history.at(-1);
  const won = latest === target;
  const lost = history.length >= guessLimit && !won;

  const reset = () => {
    setTarget(Math.floor(Math.random() * 100) + 1);
    setValue(50);
    setHistory([]);
    setPhase(mode === "multi" ? "set-secret" : "guessing");
    setRound(1);
    setRoundScores([null, null]);
    setRoundSecrets([null, null]);
  };

  const adjustValue = (amount: number) => setValue((number) => Math.min(100, Math.max(1, number + amount)));

  const lockSecret = () => {
    setTarget(value);
    setRoundSecrets((secrets) => secrets.map((secret, index) => index === round - 1 ? value : secret) as [number | null, number | null]);
    setValue(50);
    setHistory([]);
    setPhase("handoff");
  };

  const submit = () => {
    if (won || lost || (mode === "multi" && phase !== "guessing")) return;
    const nextHistory = [...history, value];
    const found = value === target;
    setHistory(nextHistory);
    if (mode === "solo") {
      if (found) onScore(nextHistory.length);
      return;
    }
    if (found || nextHistory.length >= guessLimit) {
      const result = found ? nextHistory.length : guessLimit + 1;
      setRoundScores((scores) => scores.map((score, index) => index === guesser - 1 ? result : score) as [number | null, number | null]);
      setPhase(round === 1 ? "round-result" : "match-result");
    }
  };

  const swapRoles = () => {
    setRound(2);
    setValue(50);
    setHistory([]);
    setPhase("set-secret");
  };

  const scoreLabel = (score: number | null) => score == null ? "—" : score > guessLimit ? "MISSED" : `${score} ${score === 1 ? "GUESS" : "GUESSES"}`;
  const playerOneScore = roundScores[0] ?? guessLimit + 1;
  const playerTwoScore = roundScores[1] ?? guessLimit + 1;
  const matchTitle = playerOneScore === playerTwoScore ? "Draw match!" : `Player ${playerOneScore < playerTwoScore ? 1 : 2} wins!`;
  const message = latest == null ? "Make your first guess" : won ? "You found it!" : lost ? `It was ${target}` : latest < target ? "Go higher ↑" : "Go lower ↓";

  const numberControl = (label: string, disabled = false) => (
    <>
      <input aria-label={label} type="range" min="1" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} disabled={disabled} />
      <div className="number-input-row">
        <button onClick={() => adjustValue(-1)} disabled={disabled}>−</button>
        <output>{value}</output>
        <button onClick={() => adjustValue(1)} disabled={disabled}>+</button>
      </div>
    </>
  );

  return (
    <main className="game-shell number-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <HeaderLogo compact />
        <button className="icon-button" onClick={reset} aria-label="Start a new number game">↻</button>
      </header>
      <section className={`number-game ${mode === "multi" ? "number-versus" : ""}`}>
        {mode === "multi" && <div className="number-versus-progress" aria-label={`Round ${round} of 2`}><span className={round === 1 ? "active" : "complete"}><b>01</b>P1 HIDES</span><i>交代</i><span className={round === 2 ? "active" : ""}><b>02</b>P2 HIDES</span></div>}

        {mode === "multi" && phase === "set-secret" ? (
          <div className="number-role-card secret-setup">
            <span className="number-role-kanji">秘</span>
            <p className="eyebrow">ROUND {round} · PLAYER {secretKeeper}</p>
            <h1>Choose the secret.</h1>
            <p>Player {guesser}, look away. Pick any number from 1–100 and lock it before handing over the device.</p>
            <div className="number-orb secret-orb"><span>{value}</span></div>
            {numberControl("Secret number")}
            <button className="primary-button wide-button" onClick={lockSecret}>Lock Secret <span>→</span></button>
          </div>
        ) : mode === "multi" && phase === "handoff" ? (
          <div className="number-role-card handoff-card">
            <span className="handoff-lock">✓</span>
            <p className="eyebrow">SECRET LOCKED · 秘密</p>
            <h1>Pass to Player {guesser}.</h1>
            <p>The number is hidden. Player {secretKeeper} gives only the higher and lower clues shown by the game.</p>
            <div className="handoff-players"><span>P{secretKeeper}<small>KEEPER</small></span><b>→</b><span>P{guesser}<small>GUESSER</small></span></div>
            <button className="primary-button wide-button" onClick={() => setPhase("guessing")}>I&apos;m Ready to Guess</button>
          </div>
        ) : mode === "multi" && phase === "round-result" ? (
          <div className="number-role-card round-result-card">
            <span className="number-role-kanji">解</span>
            <p className="eyebrow">ROUND 1 COMPLETE</p>
            <h1>{won ? `Player ${guesser} found it!` : `Player ${guesser} missed it.`}</h1>
            <div className="round-secret-reveal"><small>PLAYER {secretKeeper}&apos;S NUMBER</small><strong>{target}</strong><span>{scoreLabel(roundScores[guesser - 1])}</span></div>
            <p>Now swap roles. Player 2 chooses a new secret for Player 1.</p>
            <button className="primary-button wide-button" onClick={swapRoles}>Swap Roles <span>→</span></button>
          </div>
        ) : mode === "multi" && phase === "match-result" ? (
          <div className="number-role-card number-match-card">
            <span className="number-role-kanji">勝</span>
            <p className="eyebrow">MATCH COMPLETE · 結果</p>
            <h1>{matchTitle}</h1>
            <p>Fewest guesses wins. A missed round ranks behind any successful guess count.</p>
            <div className="number-match-scores"><div className={playerOneScore < playerTwoScore ? "winner" : ""}><small>PLAYER 1</small><strong>{scoreLabel(roundScores[0])}</strong><span>Secret was {roundSecrets[1]}</span></div><b>VS</b><div className={playerTwoScore < playerOneScore ? "winner" : ""}><small>PLAYER 2</small><strong>{scoreLabel(roundScores[1])}</strong><span>Secret was {roundSecrets[0]}</span></div></div>
            <button className="primary-button wide-button" onClick={reset}>Play Again</button>
          </div>
        ) : (
          <>
            <p className="eyebrow">QUICK · {mode === "multi" ? `ROUND ${round} · PLAYER ${guesser} GUESSES` : "1 PLAYER"}</p>
            <h1>{mode === "multi" ? `Find Player ${secretKeeper}'s number.` : "Find the secret number."}</h1>
            <p>{mode === "multi" ? `Player ${guesser} gets seven guesses. Player ${secretKeeper}, keep the secret.` : "I picked a number from 1–100. You get seven guesses."}</p>
            {mode === "multi" && <div className="number-role-strip"><span>P{secretKeeper}<small>SECRET KEEPER</small></span><b>VS</b><span>P{guesser}<small>GUESSER</small></span></div>}
            <div className={`number-orb ${won ? "number-win" : ""}`} aria-live="polite"><span>{won || lost ? target : "?"}</span></div>
            <h2>{message}</h2>
            {numberControl("Your number guess", won || lost)}
            <button className="primary-button wide-button" onClick={mode === "solo" && (won || lost) ? reset : submit}>{mode === "solo" && (won || lost) ? "Play again" : "Lock in guess"}</button>
            <div className="guess-trail">{Array.from({ length: guessLimit }, (_, index) => <span key={index} className={history[index] === target ? "trail-win" : ""}>{history[index] ?? "·"}</span>)}</div>
          </>
        )}
      </section>
    </main>
  );
}

function OnlineNumberHunt({ room, user, onLeave }: { room: GameRoom; user: User; onLeave: () => Promise<void> }) {
  const [match, setMatch] = useState<NumberOnlineState | null>(null);
  const [value, setValue] = useState(50);
  const [keeperSecret, setKeeperSecret] = useState<number | null>(null);
  const [error, setError] = useState("");
  const resolving = useRef("");
  const stateRef = useMemo(() => doc(db, "rooms", room.code, "numberHunt", "state"), [room.code]);

  useEffect(() => onSnapshot(stateRef, (snapshot) => {
    if (snapshot.exists()) setMatch(snapshot.data() as NumberOnlineState);
  }, () => setError("The online match lost connection.")), [stateRef]);

  useEffect(() => {
    if (!match || match.keeperUid !== user.uid) return;
    const secretRef = doc(db, "rooms", room.code, "numberHunt", `secret-${match.round}`);
    return onSnapshot(secretRef, (snapshot) => {
      if (snapshot.exists() && snapshot.data().keeperUid === user.uid) setKeeperSecret(Number(snapshot.data().value));
    }, () => setError("Could not load your private secret."));
  }, [match, room.code, user.uid]);

  useEffect(() => {
    if (!match || match.phase !== "pending" || match.keeperUid !== user.uid || match.pendingGuess == null || keeperSecret == null) return;
    const token = `${match.round}-${match.guesses.length}-${match.pendingGuess}`;
    if (resolving.current === token) return;
    resolving.current = token;
    const clue: NumberOnlineState["lastClue"] = match.pendingGuess === keeperSecret ? "correct" : match.pendingGuess < keeperSecret ? "higher" : "lower";
    const guesses = [...match.guesses, match.pendingGuess];
    const roundFinished = clue === "correct" || guesses.length >= 7;
    const scores: [number | null, number | null] = [...match.scores];
    const revealedSecrets: [number | null, number | null] = [...match.revealedSecrets];
    if (roundFinished) {
      const guesserIndex = match.guesserUid === room.hostUid ? 0 : 1;
      scores[guesserIndex] = clue === "correct" ? guesses.length : 8;
      revealedSecrets[match.round - 1] = keeperSecret;
    }
    void updateDoc(stateRef, {
      phase: roundFinished ? match.round === 1 ? "round-result" : "match-result" : "guessing",
      guesses,
      pendingGuess: null,
      lastGuess: match.pendingGuess,
      lastClue: clue,
      scores,
      revealedSecrets,
      updatedAt: serverTimestamp(),
    }).catch(() => {
      resolving.current = "";
      setError("Could not send the clue to your opponent.");
    });
  }, [keeperSecret, match, room.hostUid, stateRef, user.uid]);

  const adjustValue = (amount: number) => setValue((number) => Math.min(100, Math.max(1, number + amount)));

  const lockSecret = async () => {
    if (!match || match.phase !== "setting" || match.keeperUid !== user.uid) return;
    setError("");
    const batch = writeBatch(db);
    batch.set(doc(db, "rooms", room.code, "numberHunt", `secret-${match.round}`), { keeperUid: user.uid, round: match.round, value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.update(stateRef, { phase: "guessing", pendingGuess: null, lastGuess: null, lastClue: "none", guesses: [], updatedAt: serverTimestamp() });
    try {
      await batch.commit();
      setKeeperSecret(value);
      setValue(50);
    } catch { setError("Could not lock your secret."); }
  };

  const submitGuess = async () => {
    if (!match || match.phase !== "guessing" || match.guesserUid !== user.uid) return;
    setError("");
    try { await updateDoc(stateRef, { phase: "pending", pendingGuess: value, updatedAt: serverTimestamp() }); }
    catch { setError("Could not send your guess."); }
  };

  const startRoundTwo = async () => {
    if (!match || match.phase !== "round-result" || user.uid !== room.guestUid) return;
    setKeeperSecret(null);
    setValue(50);
    try {
      await updateDoc(stateRef, {
        round: 2,
        phase: "setting",
        keeperUid: room.guestUid,
        keeperName: room.guestName,
        guesserUid: room.hostUid,
        guesserName: room.hostName,
        guesses: [],
        pendingGuess: null,
        lastGuess: null,
        lastClue: "none",
        updatedAt: serverTimestamp(),
      });
    } catch { setError("Could not start round two."); }
  };

  const restartMatch = async () => {
    if (user.uid !== room.hostUid || !room.guestUid || !room.guestName) return;
    setKeeperSecret(null);
    setValue(50);
    const batch = writeBatch(db);
    batch.delete(doc(db, "rooms", room.code, "numberHunt", "secret-1"));
    batch.delete(doc(db, "rooms", room.code, "numberHunt", "secret-2"));
    batch.set(stateRef, {
      gameId: "number",
      roomCode: room.code,
      round: 1,
      phase: "setting",
      keeperUid: room.hostUid,
      keeperName: room.hostName,
      guesserUid: room.guestUid,
      guesserName: room.guestName,
      guesses: [],
      pendingGuess: null,
      lastGuess: null,
      lastClue: "none",
      scores: [null, null],
      revealedSecrets: [null, null],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    try { await batch.commit(); }
    catch { setError("Could not restart the match."); }
  };

  const scoreLabel = (score: number | null) => score == null ? "—" : score > 7 ? "MISSED" : `${score} ${score === 1 ? "GUESS" : "GUESSES"}`;
  const clueMessage = match?.lastClue === "higher" ? "Go higher ↑" : match?.lastClue === "lower" ? "Go lower ↓" : match?.lastClue === "correct" ? "Correct!" : "Make your first guess";
  const playerOneScore = match?.scores[0] ?? 8;
  const playerTwoScore = match?.scores[1] ?? 8;
  const isKeeper = match?.keeperUid === user.uid;
  const isGuesser = match?.guesserUid === user.uid;

  return (
    <main className="game-shell number-shell">
      <header className="game-topbar"><button className="back-button" onClick={() => void onLeave()}>← Leave room</button><HeaderLogo compact /><span className="online-room-pill">● {room.code}</span></header>
      <section className="number-game number-versus number-online">
        <div className="online-match-heading"><span>LIVE MATCH</span><strong>{room.hostName}</strong><b>VS</b><strong>{room.guestName}</strong></div>
        {!match ? <div className="number-role-card online-waiting-card"><span className="waiting-pulse">接</span><h1>Connecting match…</h1><p>Synchronizing both players.</p></div> : (
          <>
            <div className="number-versus-progress" aria-label={`Round ${match.round} of 2`}><span className={match.round === 1 ? "active" : "complete"}><b>01</b>{room.hostName} HIDES</span><i>交代</i><span className={match.round === 2 ? "active" : ""}><b>02</b>{room.guestName} HIDES</span></div>
            {match.phase === "setting" && isKeeper ? (
              <div className="number-role-card secret-setup"><span className="number-role-kanji">秘</span><p className="eyebrow">YOUR PRIVATE SCREEN · SECRET KEEPER</p><h1>Choose the secret.</h1><p>Only your account can read this number. Your opponent is waiting on their own device.</p><div className="number-orb secret-orb"><span>{value}</span></div><input aria-label="Secret number" type="range" min="1" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} /><div className="number-input-row"><button onClick={() => adjustValue(-1)}>−</button><output>{value}</output><button onClick={() => adjustValue(1)}>+</button></div><button className="primary-button wide-button" onClick={() => void lockSecret()}>Lock Secret <span>→</span></button></div>
            ) : match.phase === "setting" ? (
              <div className="number-role-card online-waiting-card"><span className="waiting-pulse">秘</span><p className="eyebrow">OPPONENT CHOOSING</p><h1>{match.keeperName} is setting the secret.</h1><p>Stay on this screen. Your guessing board will open automatically when the number is locked.</p></div>
            ) : (match.phase === "guessing" || match.phase === "pending") && isGuesser ? (
              <div className="online-guess-board"><p className="eyebrow">ROUND {match.round} · YOU ARE GUESSING</p><h1>Find {match.keeperName}&apos;s number.</h1><p>You have seven guesses. Every clue arrives live from your opponent&apos;s private number.</p><div className="number-role-strip"><span>{match.keeperName}<small>SECRET KEEPER</small></span><b>LIVE</b><span>YOU<small>GUESSER</small></span></div><div className="number-orb" aria-live="polite"><span>?</span></div><h2>{match.phase === "pending" ? `Checking ${match.pendingGuess}…` : clueMessage}</h2><input aria-label="Your number guess" type="range" min="1" max="100" value={value} onChange={(event) => setValue(Number(event.target.value))} disabled={match.phase === "pending"} /><div className="number-input-row"><button onClick={() => adjustValue(-1)} disabled={match.phase === "pending"}>−</button><output>{value}</output><button onClick={() => adjustValue(1)} disabled={match.phase === "pending"}>+</button></div><button className="primary-button wide-button" disabled={match.phase === "pending"} onClick={() => void submitGuess()}>{match.phase === "pending" ? "Waiting for clue…" : "Send Guess"}</button><div className="guess-trail">{Array.from({ length: 7 }, (_, index) => <span key={index} className={match.guesses[index] === match.revealedSecrets[match.round - 1] ? "trail-win" : ""}>{match.guesses[index] ?? "·"}</span>)}</div></div>
            ) : (match.phase === "guessing" || match.phase === "pending") ? (
              <div className="number-role-card online-waiting-card"><span className="waiting-pulse">待</span><p className="eyebrow">LIVE · YOU ARE SECRET KEEPER</p><h1>{match.phase === "pending" ? `Checking ${match.pendingGuess}…` : `Waiting for ${match.guesserName}.`}</h1><p>Your private number is locked. Higher and lower clues are sent automatically when your opponent guesses.</p><div className="keeper-secret-chip"><small>YOUR SECRET</small><strong>{keeperSecret ?? "••"}</strong></div></div>
            ) : match.phase === "round-result" ? (
              <div className="number-role-card round-result-card"><span className="number-role-kanji">解</span><p className="eyebrow">ROUND 1 COMPLETE · LIVE</p><h1>{match.scores[1] != null && match.scores[1]! <= 7 ? `${room.guestName} found it!` : `${room.guestName} missed it.`}</h1><div className="round-secret-reveal"><small>{room.hostName}&apos;S NUMBER</small><strong>{match.revealedSecrets[0]}</strong><span>{scoreLabel(match.scores[1])}</span></div>{user.uid === room.guestUid ? <button className="primary-button wide-button" onClick={() => void startRoundTwo()}>Choose My Secret <span>→</span></button> : <p className="online-wait-copy">Waiting for {room.guestName} to start round two…</p>}</div>
            ) : (
              <div className="number-role-card number-match-card"><span className="number-role-kanji">勝</span><p className="eyebrow">ONLINE MATCH COMPLETE · 結果</p><h1>{playerOneScore === playerTwoScore ? "Draw match!" : `${playerOneScore < playerTwoScore ? room.hostName : room.guestName} wins!`}</h1><p>Fewest guesses wins. Both secret rounds were synchronized between your devices.</p><div className="number-match-scores"><div className={playerOneScore < playerTwoScore ? "winner" : ""}><small>{room.hostName}</small><strong>{scoreLabel(match.scores[0])}</strong><span>Secret was {match.revealedSecrets[1]}</span></div><b>VS</b><div className={playerTwoScore < playerOneScore ? "winner" : ""}><small>{room.guestName}</small><strong>{scoreLabel(match.scores[1])}</strong><span>Secret was {match.revealedSecrets[0]}</span></div></div>{user.uid === room.hostUid ? <button className="primary-button wide-button" onClick={() => void restartMatch()}>Play Again</button> : <p className="online-wait-copy">Waiting for {room.hostName} to restart the match…</p>}</div>
            )}
          </>
        )}
        {error && <p className="online-game-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}

function MemoryGame({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const makeDeck = useCallback(() => shuffle([...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS]).map((symbol, index) => ({ id: `${symbol}-${index}`, symbol })), []);
  const [cards, setCards] = useState(makeDeck);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [currentPlayer, setCurrentPlayer] = useState<0 | 1>(0);
  const [pairScores, setPairScores] = useState<[number, number]>([0, 0]);
  const complete = matched.length === cards.length;

  const reset = () => {
    setCards(makeDeck());
    setOpen([]);
    setMatched([]);
    setMoves(0);
    setCurrentPlayer(0);
    setPairScores([0, 0]);
  };

  const flip = (index: number) => {
    if (open.length >= 2 || open.includes(index) || matched.includes(index)) return;
    const next = [...open, index];
    setOpen(next);
    if (next.length === 2) {
      setMoves((count) => count + 1);
      if (cards[next[0]].symbol === cards[next[1]].symbol) {
        window.setTimeout(() => {
          if (mode === "multi") setPairScores(([playerOne, playerTwo]) => currentPlayer === 0 ? [playerOne + 1, playerTwo] : [playerOne, playerTwo + 1]);
          setMatched((items) => {
            const nextMatched = [...items, ...next];
            if (nextMatched.length === cards.length && mode === "solo") onScore(moves + 1);
            return nextMatched;
          });
          setOpen([]);
        }, 450);
      } else window.setTimeout(() => {
        setOpen([]);
        if (mode === "multi") setCurrentPlayer((player) => player === 0 ? 1 : 0);
      }, 750);
    }
  };

  return (
    <main className="game-shell memory-shell">
      <header className="game-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <HeaderLogo compact />
        <button className="icon-button" onClick={reset} aria-label="Shuffle and restart">↻</button>
      </header>
      <section className="memory-game">
        <div className="memory-heading">
          <div><p className="eyebrow">MEMORY · {mode === "multi" ? "2 PLAYERS" : "1 PLAYER"}</p><h1>Meet your match.</h1><p>{mode === "multi" ? "Take turns. Find a pair to keep your turn and score a point." : "Flip two tiles. Find every pair."}</p></div>
          <div className="moves"><strong>{moves}</strong><span>moves</span></div>
        </div>
        {!complete && <TurnBanner mode={mode} currentPlayer={currentPlayer} scores={pairScores} />}
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
        {complete && <div className="result-panel" role="status"><div><strong>{mode === "multi" ? pairScores[0] === pairScores[1] ? "Draw game!" : `Player ${pairScores[0] > pairScores[1] ? 1 : 2} wins!` : "Perfect pairs!"}</strong><span>{mode === "multi" ? `Final score ${pairScores[0]}–${pairScores[1]}.` : `You cleared the board in ${moves} moves.`}</span></div><button className="primary-button" onClick={reset}>Play again</button></div>}
      </section>
    </main>
  );
}

type TicMark = "" | "X" | "O";
const TIC_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function ticWinner(board: TicMark[]) {
  for (const [a, b, c] of TIC_LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return "";
}

function cpuTicMove(board: TicMark[]) {
  const open = board.map((mark, index) => mark ? -1 : index).filter((index) => index >= 0);
  for (const mark of ["O", "X"] as TicMark[]) {
    const winning = open.find((index) => ticWinner(board.map((cell, cellIndex) => cellIndex === index ? mark : cell)) === mark);
    if (winning != null) return winning;
  }
  if (!board[4]) return 4;
  const corners = open.filter((index) => [0, 2, 6, 8].includes(index));
  return (corners.length ? corners : open)[Math.floor(Math.random() * (corners.length ? corners.length : open.length))];
}

function TicTacToe({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [board, setBoard] = useState<TicMark[]>(Array(9).fill(""));
  const [turn, setTurn] = useState<TicMark>("X");
  const winner = ticWinner(board);
  const draw = !winner && board.every(Boolean);

  const reset = () => { setBoard(Array(9).fill("")); setTurn("X"); };
  const play = (index: number) => {
    if (board[index] || winner || draw) return;
    const next = board.map((cell, cellIndex) => cellIndex === index ? turn : cell);
    if (mode === "multi") {
      setBoard(next);
      setTurn(turn === "X" ? "O" : "X");
      return;
    }
    if (ticWinner(next) === "X") {
      setBoard(next);
      onScore(next.filter((mark) => mark === "X").length);
      return;
    }
    const cpuIndex = cpuTicMove(next);
    setBoard(cpuIndex == null ? next : next.map((cell, cellIndex) => cellIndex === cpuIndex ? "O" : cell));
  };

  return (
    <main className="game-shell simple-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><button className="icon-button" onClick={reset} aria-label="Restart tic tac toe">↻</button></header>
      <section className="simple-game tic-game">
        <p className="eyebrow">STRATEGY · {mode === "multi" ? "2 PLAYERS" : "VS CPU"}</p>
        <h1>Tic Tac Toe</h1>
        <p>Make three in a row before your opponent.</p>
        {!winner && !draw && <TurnBanner mode={mode} currentPlayer={turn === "X" ? 0 : 1} />}
        <div className="tic-board" aria-label="Tic tac toe board">
          {board.map((mark, index) => <button key={index} className={mark ? `tic-${mark.toLowerCase()}` : ""} onClick={() => play(index)} aria-label={`Square ${index + 1}${mark ? `: ${mark}` : ""}`}>{mark}</button>)}
        </div>
        <div className="simple-status" role="status"><strong>{winner ? mode === "multi" ? `Player ${winner === "X" ? 1 : 2} wins!` : winner === "X" ? "You win!" : "CPU wins." : draw ? "Draw game." : mode === "multi" ? `Player ${turn === "X" ? 1 : 2}'s turn` : "You are X"}</strong><span>{winner || draw ? "Ready for another round?" : "Tap an open square."}</span></div>
        {(winner || draw) && <button className="primary-button simple-reset" onClick={reset}>Play again</button>}
      </section>
    </main>
  );
}

type ConnectPiece = 0 | 1 | 2;
type ConnectWin = { player: 1 | 2; cells: number[] };
const CONNECT_ROWS = 6;
const CONNECT_COLUMNS = 7;
const CONNECT_COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];
const CONNECT_WINDOWS: number[][] = (() => {
  const windows: number[][] = [];
  for (let row = 0; row < CONNECT_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_COLUMNS; column += 1) {
      if (column <= CONNECT_COLUMNS - 4) windows.push([0, 1, 2, 3].map((step) => row * CONNECT_COLUMNS + column + step));
      if (row <= CONNECT_ROWS - 4) windows.push([0, 1, 2, 3].map((step) => (row + step) * CONNECT_COLUMNS + column));
      if (row <= CONNECT_ROWS - 4 && column <= CONNECT_COLUMNS - 4) windows.push([0, 1, 2, 3].map((step) => (row + step) * CONNECT_COLUMNS + column + step));
      if (row <= CONNECT_ROWS - 4 && column >= 3) windows.push([0, 1, 2, 3].map((step) => (row + step) * CONNECT_COLUMNS + column - step));
    }
  }
  return windows;
})();

function emptyConnectBoard(): ConnectPiece[] {
  return Array<ConnectPiece>(CONNECT_ROWS * CONNECT_COLUMNS).fill(0);
}

function connectWinner(board: ConnectPiece[]): ConnectWin | null {
  for (const cells of CONNECT_WINDOWS) {
    const player = board[cells[0]];
    if (player && cells.every((index) => board[index] === player)) return { player, cells };
  }
  return null;
}

function dropConnectPiece(board: ConnectPiece[], column: number, player: 1 | 2) {
  for (let row = CONNECT_ROWS - 1; row >= 0; row -= 1) {
    const index = row * CONNECT_COLUMNS + column;
    if (!board[index]) {
      const next = [...board];
      next[index] = player;
      return { board: next, index };
    }
  }
  return null;
}

function connectPositionScore(board: ConnectPiece[]) {
  let score = 0;
  for (let row = 0; row < CONNECT_ROWS; row += 1) {
    if (board[row * CONNECT_COLUMNS + 3] === 2) score += 7;
    if (board[row * CONNECT_COLUMNS + 3] === 1) score -= 7;
  }
  for (const cells of CONNECT_WINDOWS) {
    const values = cells.map((index) => board[index]);
    const cpu = values.filter((piece) => piece === 2).length;
    const player = values.filter((piece) => piece === 1).length;
    const empty = 4 - cpu - player;
    if (cpu && player) continue;
    if (cpu === 3 && empty === 1) score += 110;
    else if (cpu === 2 && empty === 2) score += 16;
    else if (cpu === 1 && empty === 3) score += 2;
    if (player === 3 && empty === 1) score -= 135;
    else if (player === 2 && empty === 2) score -= 18;
    else if (player === 1 && empty === 3) score -= 2;
  }
  return score;
}

function connectMinimax(board: ConnectPiece[], depth: number, alpha: number, beta: number, maximizing: boolean): number {
  const winner = connectWinner(board);
  if (winner?.player === 2) return 100000 + depth;
  if (winner?.player === 1) return -100000 - depth;
  if (depth === 0 || board.every(Boolean)) return connectPositionScore(board);

  if (maximizing) {
    let best = Number.NEGATIVE_INFINITY;
    for (const column of CONNECT_COLUMN_ORDER) {
      const move = dropConnectPiece(board, column, 2);
      if (!move) continue;
      best = Math.max(best, connectMinimax(move.board, depth - 1, alpha, beta, false));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = Number.POSITIVE_INFINITY;
  for (const column of CONNECT_COLUMN_ORDER) {
    const move = dropConnectPiece(board, column, 1);
    if (!move) continue;
    best = Math.min(best, connectMinimax(move.board, depth - 1, alpha, beta, true));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

function connectCpuMove(board: ConnectPiece[]) {
  const openColumns = CONNECT_COLUMN_ORDER.filter((column) => !board[column]);
  const winning = openColumns.find((column) => connectWinner(dropConnectPiece(board, column, 2)!.board)?.player === 2);
  if (winning != null) return winning;
  const blocking = openColumns.find((column) => connectWinner(dropConnectPiece(board, column, 1)!.board)?.player === 1);
  if (blocking != null) return blocking;

  let bestColumn = openColumns[0] ?? 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const column of openColumns) {
    const move = dropConnectPiece(board, column, 2)!;
    const score = connectMinimax(move.board, 4, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, false);
    if (score > bestScore) {
      bestScore = score;
      bestColumn = column;
    }
  }
  return bestColumn;
}

function ConnectFour({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [board, setBoard] = useState<ConnectPiece[]>(emptyConnectBoard);
  const [turn, setTurn] = useState<1 | 2>(1);
  const [moves, setMoves] = useState(0);
  const [lastDrop, setLastDrop] = useState<number | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const [matchScore, setMatchScore] = useState<[number, number]>([0, 0]);
  const [round, setRound] = useState(1);
  const winner = useMemo(() => connectWinner(board), [board]);
  const winningCells = useMemo(() => new Set(winner?.cells ?? []), [winner]);
  const draw = !winner && board.every(Boolean);
  const cpuThinking = mode === "solo" && turn === 2 && !winner && !draw;
  const previewDrop = useMemo(() => hoveredColumn == null ? null : dropConnectPiece(board, hoveredColumn, turn)?.index ?? null, [board, hoveredColumn, turn]);

  const resetRound = () => {
    setBoard(emptyConnectBoard());
    setTurn(1);
    setMoves(0);
    setLastDrop(null);
    setHoveredColumn(null);
    setRound((value) => value + 1);
  };

  const resetMatch = () => {
    setMatchScore([0, 0]);
    setRound(1);
    setBoard(emptyConnectBoard());
    setTurn(1);
    setMoves(0);
    setLastDrop(null);
    setHoveredColumn(null);
  };

  const playColumn = useCallback((column: number) => {
    if (winner || draw || cpuThinking) return;
    const move = dropConnectPiece(board, column, turn);
    if (!move) return;
    const nextMoves = moves + 1;
    const nextWinner = connectWinner(move.board);
    setBoard(move.board);
    setLastDrop(move.index);
    setHoveredColumn(null);
    setMoves(nextMoves);
    if (nextWinner) {
      setMatchScore((scores) => scores.map((score, index) => index === nextWinner.player - 1 ? score + 1 : score) as [number, number]);
      if (mode === "solo" && nextWinner.player === 1) onScore(move.board.filter((piece) => piece === 1).length);
      return;
    }
    setTurn(turn === 1 ? 2 : 1);
  }, [board, cpuThinking, draw, mode, moves, onScore, turn, winner]);

  useEffect(() => {
    if (!cpuThinking) return;
    const timer = window.setTimeout(() => {
      const move = dropConnectPiece(board, connectCpuMove(board), 2);
      if (!move) return;
      const nextWinner = connectWinner(move.board);
      setBoard(move.board);
      setLastDrop(move.index);
      setMoves((value) => value + 1);
      if (nextWinner) setMatchScore((scores) => [scores[0], scores[1] + 1]);
      else setTurn(1);
    }, 460);
    return () => window.clearTimeout(timer);
  }, [board, cpuThinking]);

  const turnName = mode === "solo" ? turn === 1 ? "YOUR TURN" : "CPU THINKING" : `PLAYER ${turn}'S TURN`;
  const resultTitle = winner ? mode === "solo" ? winner.player === 1 ? "You connected four!" : "CPU connected four." : `Player ${winner.player} wins!` : draw ? "Board locked. Draw game." : turnName;

  return (
    <main className="game-shell simple-game-shell connect-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><button className="icon-button" onClick={resetMatch} aria-label="Restart Connect Four match">↻</button></header>
      <section className="connect-game">
        <div className="connect-heading"><div><p className="eyebrow">STRATEGY · {mode === "multi" ? "2 PLAYERS" : "VS CPU"}</p><h1>Connect Four</h1><p>Build a line across, down, or diagonally before your opponent.</p></div><span><b>四</b><small>四目並べ</small></span></div>
        {mode === "multi" && !winner && !draw && <TurnBanner mode={mode} currentPlayer={turn === 1 ? 0 : 1} scores={matchScore} />}
        <div className="connect-scoreboard" aria-label="Match score">
          <div className={`connect-player player-one ${turn === 1 && !winner ? "is-active" : ""} ${winner?.player === 1 ? "is-winner" : ""}`}><i /><span><small>{mode === "solo" ? "YOU" : "PLAYER 1"}</small><strong>{matchScore[0]}</strong></span></div>
          <div className="connect-round"><small>ROUND</small><strong>{String(round).padStart(2, "0")}</strong><span>{moves} MOVES</span></div>
          <div className={`connect-player player-two ${turn === 2 && !winner ? "is-active" : ""} ${winner?.player === 2 ? "is-winner" : ""}`}><span><small>{mode === "solo" ? "CPU" : "PLAYER 2"}</small><strong>{matchScore[1]}</strong></span><i /></div>
        </div>
        <div className={`connect-stage ${winner ? "has-winner" : ""}`}>
          <div className="connect-column-controls" aria-label="Choose a column">
            {Array.from({ length: CONNECT_COLUMNS }, (_, column) => <button key={column} className={hoveredColumn === column ? "is-preview" : ""} disabled={Boolean(board[column]) || Boolean(winner) || draw || cpuThinking} onMouseEnter={() => setHoveredColumn(column)} onMouseLeave={() => setHoveredColumn(null)} onFocus={() => setHoveredColumn(column)} onBlur={() => setHoveredColumn(null)} onClick={() => playColumn(column)} aria-label={`Drop a piece in column ${column + 1}`}><span>▼</span><b>{column + 1}</b></button>)}
          </div>
          <div className="connect-board" role="grid" aria-label="Connect Four board">
            {board.map((piece, index) => {
              const column = index % CONNECT_COLUMNS;
              const occupant = piece ? mode === "solo" && piece === 2 ? "CPU" : `Player ${piece}` : "empty";
              return <button type="button" role="gridcell" disabled={Boolean(board[column]) || Boolean(winner) || draw || cpuThinking} onMouseEnter={() => setHoveredColumn(column)} onMouseLeave={() => setHoveredColumn(null)} onFocus={() => setHoveredColumn(column)} onBlur={() => setHoveredColumn(null)} onClick={() => playColumn(column)} aria-label={`Drop in column ${column + 1}. Row ${Math.floor(index / CONNECT_COLUMNS) + 1} is ${occupant}.`} className={`connect-cell ${piece ? `piece-${piece}` : ""} ${index === lastDrop ? "last-drop" : ""} ${winningCells.has(index) ? "winning-piece" : ""} ${index === previewDrop ? `preview-slot preview-${turn}` : ""}`} key={index}><i /></button>;
            })}
          </div>
          <div className="connect-feet" aria-hidden="true"><i /><i /></div>
        </div>
        <div className={`connect-status ${winner || draw ? "is-finished" : ""}`} role="status"><span>{winner ? "勝負あり" : draw ? "引き分け" : cpuThinking ? "思考中" : "あなたの番"}</span><div><strong>{resultTitle}</strong><small>{winner || draw ? "The match score stays for your rematch." : board.filter((piece) => !piece).length + " open spaces"}</small></div>{(winner || draw) && <button className="primary-button" onClick={resetRound}>Rematch <span>→</span></button>}</div>
      </section>
    </main>
  );
}

const RPS_CHOICES = [
  { id: "rock", symbol: "✊", label: "Rock", japanese: "石" },
  { id: "paper", symbol: "✋", label: "Paper", japanese: "紙" },
  { id: "scissors", symbol: "✌", label: "Scissors", japanese: "鋏" },
] as const;
type RpsChoice = (typeof RPS_CHOICES)[number]["id"];
type RpsRound = { player: RpsChoice; opponent: RpsChoice; result: -1 | 0 | 1 };

function rpsWinner(first: RpsChoice, second: RpsChoice) {
  if (first === second) return -1;
  return (first === "rock" && second === "scissors") || (first === "paper" && second === "rock") || (first === "scissors" && second === "paper") ? 0 : 1;
}

function randomRpsChoice(): RpsChoice {
  return RPS_CHOICES[Math.floor(Math.random() * RPS_CHOICES.length)].id;
}

function RockPaperScissors({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [pending, setPending] = useState<RpsChoice | null>(null);
  const [rounds, setRounds] = useState(0);
  const [lastRound, setLastRound] = useState<RpsRound | null>(null);
  const [history, setHistory] = useState<RpsRound[]>([]);
  const [message, setMessage] = useState(mode === "multi" ? "Player 1, choose in secret." : "Choose your move.");
  const gameOver = scores[0] >= 3 || scores[1] >= 3;

  const reset = () => { setScores([0, 0]); setPending(null); setRounds(0); setLastRound(null); setHistory([]); setMessage(mode === "multi" ? "Player 1, choose in secret." : "Choose your move."); };
  const choose = (choice: RpsChoice) => {
    if (gameOver) return;
    if (mode === "multi" && !pending) {
      setPending(choice);
      setLastRound(null);
      setMessage("Choice locked. Pass to Player 2.");
      return;
    }
    const opponent = mode === "multi" ? choice : randomRpsChoice();
    const player = mode === "multi" ? pending! : choice;
    const result = rpsWinner(player, opponent);
    const nextScores: [number, number] = [...scores];
    if (result >= 0) nextScores[result] += 1;
    const playerLabel = RPS_CHOICES.find((item) => item.id === player)!.label;
    const opponentLabel = RPS_CHOICES.find((item) => item.id === opponent)!.label;
    setScores(nextScores);
    setRounds((count) => count + 1);
    setPending(null);
    const completedRound: RpsRound = { player, opponent, result };
    setLastRound(completedRound);
    setHistory((previous) => [completedRound, ...previous].slice(0, 5));
    setMessage(result < 0 ? `${playerLabel} ties ${opponentLabel}.` : mode === "multi" ? `Player ${result + 1} wins: ${playerLabel} vs ${opponentLabel}.` : result === 0 ? `${playerLabel} beats ${opponentLabel}.` : `${opponentLabel} beats ${playerLabel}.`);
    if (mode === "solo" && nextScores[0] === 3) onScore(rounds + 1);
  };

  const leftMove = RPS_CHOICES.find((choice) => choice.id === lastRound?.player);
  const rightMove = RPS_CHOICES.find((choice) => choice.id === lastRound?.opponent);
  const leftWon = lastRound?.result === 0;
  const rightWon = lastRound?.result === 1;

  return (
    <main className="game-shell simple-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><button className="icon-button" onClick={reset} aria-label="Restart rock paper scissors">↻</button></header>
      <section className="simple-game rps-game">
        <p className="eyebrow">QUICK · {mode === "multi" ? "2 PLAYERS" : "VS CPU"}</p>
        <h1>Rock Paper Scissors</h1>
        <p>First to three points wins the match.</p>
        {!gameOver && <TurnBanner mode={mode} currentPlayer={pending ? 1 : 0} scores={scores} />}
        <div className={`rps-arena ${lastRound ? "has-reveal" : "is-waiting"}`} key={`round-${rounds}-${pending ? "locked" : "open"}`} aria-live="polite">
          <div className={`rps-fighter fighter-left ${leftWon ? "is-winner" : lastRound && rightWon ? "is-loser" : ""}`}>
            <span className="rps-fighter-label">{mode === "multi" ? "PLAYER 1" : "YOU"}</span>
            <div className="rps-hand-shell"><b className="rps-hand">{leftMove?.symbol ?? (pending ? "✓" : "?")}</b><i>{leftMove?.label ?? (pending ? "LOCKED" : "CHOOSE")}</i></div>
            <div className="rps-score-pips" aria-label={`${scores[0]} points`}>{[0, 1, 2].map((point) => <i className={scores[0] > point ? "filled" : ""} key={point} />)}</div>
          </div>
          <div className="rps-impact"><strong>{lastRound ? lastRound.result < 0 ? "相" : leftWon ? "勝" : "敗" : "対"}</strong><span>{lastRound ? lastRound.result < 0 ? "DRAW" : "IMPACT" : "VERSUS"}</span></div>
          <div className={`rps-fighter fighter-right ${rightWon ? "is-winner" : lastRound && leftWon ? "is-loser" : ""}`}>
            <span className="rps-fighter-label">{mode === "multi" ? "PLAYER 2" : "CPU"}</span>
            <div className="rps-hand-shell"><b className="rps-hand">{rightMove?.symbol ?? "?"}</b><i>{rightMove?.label ?? (pending ? "CHOOSE" : "WAITING")}</i></div>
            <div className="rps-score-pips" aria-label={`${scores[1]} points`}>{[0, 1, 2].map((point) => <i className={scores[1] > point ? "filled" : ""} key={point} />)}</div>
          </div>
        </div>
        <div className="rps-prompt"><span>{pending ? "PLAYER 2 · MAKE YOUR MOVE" : gameOver ? "MATCH COMPLETE" : "CHOOSE YOUR HAND"}</span><i>じゃんけん</i></div>
        <div className="rps-choices">{RPS_CHOICES.map((choice) => <button className={`rps-choice-card choice-${choice.id}`} key={choice.id} onClick={() => choose(choice.id)} disabled={gameOver} aria-label={`Choose ${choice.label}`}><i aria-hidden="true" /><b>{choice.symbol}</b><span><em>{choice.japanese}</em><strong>{choice.label}</strong></span></button>)}</div>
        {history.length > 0 && <div className="rps-round-history" aria-label="Recent rounds"><span>RECENT</span>{history.map((round, index) => { const first = RPS_CHOICES.find((choice) => choice.id === round.player)!; const second = RPS_CHOICES.find((choice) => choice.id === round.opponent)!; return <i className={round.result < 0 ? "tie" : round.result === 0 ? "win" : "loss"} key={`${rounds}-${index}`}>{first.symbol}<b>×</b>{second.symbol}</i>; })}</div>}
        <div className="simple-status" role="status"><strong>{gameOver ? scores[0] > scores[1] ? mode === "multi" ? "Player 1 wins!" : "You win!" : mode === "multi" ? "Player 2 wins!" : "CPU wins." : message}</strong><span>{gameOver ? `Final score ${scores[0]}–${scores[1]}.` : `Round ${rounds + 1}`}</span></div>
        {gameOver && <button className="primary-button simple-reset" onClick={reset}>Play again</button>}
      </section>
    </main>
  );
}

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function DiceRace({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [positions, setPositions] = useState<[number, number]>([0, 0]);
  const [faces, setFaces] = useState<[number, number]>([0, 0]);
  const [currentPlayer, setCurrentPlayer] = useState<0 | 1>(0);
  const [rolls, setRolls] = useState(0);
  const winner = positions[0] >= 20 ? 0 : positions[1] >= 20 ? 1 : null;

  const reset = () => { setPositions([0, 0]); setFaces([0, 0]); setCurrentPlayer(0); setRolls(0); };
  const roll = () => {
    if (winner != null) return;
    const playerRoll = rollDie();
    if (mode === "multi") {
      const next: [number, number] = [...positions];
      next[currentPlayer] += playerRoll;
      setPositions(next);
      setFaces((previous) => currentPlayer === 0 ? [playerRoll, previous[1]] : [previous[0], playerRoll]);
      setRolls((count) => count + 1);
      setCurrentPlayer(currentPlayer === 0 ? 1 : 0);
      return;
    }
    const nextPlayer = positions[0] + playerRoll;
    const nextRolls = rolls + 1;
    if (nextPlayer >= 20) {
      setPositions([nextPlayer, positions[1]]);
      setFaces([playerRoll, faces[1]]);
      setRolls(nextRolls);
      onScore(nextRolls);
      return;
    }
    const cpuRoll = rollDie();
    setPositions([nextPlayer, positions[1] + cpuRoll]);
    setFaces([playerRoll, cpuRoll]);
    setRolls(nextRolls);
  };

  return (
    <main className="game-shell simple-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><button className="icon-button" onClick={reset} aria-label="Restart dice race">↻</button></header>
      <section className="simple-game dice-game">
        <p className="eyebrow">LUCK · {mode === "multi" ? "2 PLAYERS" : "VS CPU"}</p>
        <h1>Dice Race</h1>
        <p>Roll to race to 20. The first player across wins.</p>
        {winner == null && <TurnBanner mode={mode} currentPlayer={currentPlayer} />}
        <div className="dice-racers">
          {positions.map((position, index) => <div key={index}><span>{mode === "solo" && index === 1 ? "CPU" : `PLAYER ${index + 1}`}</span><b>{faces[index] ? DICE_FACES[faces[index] - 1] : "□"}</b><strong>{Math.min(position, 20)}<small>/20</small></strong><i><em style={{ width: `${Math.min(position / 20 * 100, 100)}%` }} /></i></div>)}
        </div>
        <button className="primary-button dice-roll" onClick={winner == null ? roll : reset}>{winner == null ? `Roll ${mode === "multi" ? `for Player ${currentPlayer + 1}` : "the dice"}` : "Play again"}</button>
        <div className="simple-status" role="status"><strong>{winner == null ? mode === "multi" ? `Player ${currentPlayer + 1}'s roll` : "Your roll also rolls for the CPU." : mode === "solo" ? winner === 0 ? "You win!" : "CPU wins." : `Player ${winner + 1} wins!`}</strong><span>{rolls} {rolls === 1 ? "roll" : "rolls"} played</span></div>
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
    players: "1–2 Players",
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
    players: "1–2 Players",
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
    players: "1–2 Players",
    rules: [
      "Solo mode chooses a number; in Versus, one player locks a secret.",
      "The guesser gets seven tries using higher and lower clues.",
      "Swap roles for round two. The fewest guesses wins.",
    ],
  },
  memory: {
    title: "Memory Flip",
    japanese: "メモリーフリップ",
    category: "Memory",
    glyph: "✦",
    color: "violet",
    players: "1–2 Players",
    rules: [
      "Flip two cards at a time.",
      "Matching cards stay open; other cards flip back.",
      "Clear every pair in as few moves as possible.",
    ],
  },
  tictactoe: {
    title: "Tic Tac Toe",
    japanese: "三目並べ",
    category: "Strategy",
    glyph: "X○",
    color: "tic",
    players: "1–2 Players",
    rules: [
      "Place your mark in any open square.",
      "Make a row of three across, down, or diagonally.",
      "Play against the CPU or pass the device to a friend.",
    ],
  },
  connect4: {
    title: "Connect Four",
    japanese: "四目並べ",
    category: "Strategy",
    glyph: "四",
    color: "connect",
    players: "1–2 Players",
    rules: [
      "Choose a column to drop your piece into the lowest open space.",
      "Build a line of four across, down, or diagonally.",
      "Play the tactical CPU or open a Versus room for a friend.",
    ],
  },
  rps: {
    title: "Rock Paper Scissors",
    japanese: "じゃんけん",
    category: "Quick play",
    glyph: "RPS",
    color: "rps",
    players: "1–2 Players",
    rules: [
      "Rock beats scissors, scissors beat paper, and paper beats rock.",
      "In Versus mode, each player chooses in secret.",
      "The first player to score three points wins.",
    ],
  },
  dice: {
    title: "Dice Race",
    japanese: "サイコロ競走",
    category: "Luck",
    glyph: "⚄",
    color: "dice",
    players: "1–2 Players",
    rules: [
      "Roll the die to move along the race track.",
      "Solo mode automatically rolls once for the CPU.",
      "Be the first player to reach 20 spaces.",
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

function GameMenu({ game, onPlay, onBack }: { game: LibraryGameId; onPlay: (mode: GameMode) => void; onBack: () => void }) {
  const details = GAME_MENUS[game];
  const [selectedMode, setSelectedMode] = useState<GameMode>("solo");
  const supportsLocalMultiplayer = game !== "meducktion" && game !== "deducktion";

  return (
    <main className="game-menu-shell">
      <header className="game-topbar menu-topbar">
        <button className="back-button" onClick={onBack}>← Games</button>
        <HeaderLogo compact />
        <span className="menu-header-spacer" aria-hidden="true" />
      </header>
      <section className="game-menu">
        <div className="menu-card">
          <button className="menu-close" onClick={onBack} aria-label="Close game menu">×</button>
          <span className={`game-cover menu-game-cover art-${game}`}><i>{details.glyph}</i>{game === "deducktion" && <b className="deducktion-cover-title">DEDUCKTION</b>}</span>
          <p className="menu-japanese">{details.japanese}</p>
          <h1>{details.title}</h1>
          <div className="menu-meta"><span>{details.players}</span><span>{details.category}</span></div>
          {supportsLocalMultiplayer && (
            <div className="mode-picker" aria-label="Choose game mode">
              <button className={selectedMode === "solo" ? "active" : ""} onClick={() => setSelectedMode("solo")}><b>一</b><span>SOLO<small>1 PLAYER</small></span></button>
              <button className={selectedMode === "multi" ? "active" : ""} onClick={() => setSelectedMode("multi")}><b>対</b><span>VERSUS<small>2 PLAYERS</small></span></button>
            </div>
          )}
          <div className="menu-rules">
            <h2>How to play <span>遊び方</span></h2>
            <ol>{details.rules.map((rule, index) => <li key={rule}><b>{index + 1}</b><span>{rule}</span></li>)}</ol>
          </div>
          <button className="primary-button menu-start" onClick={() => onPlay(selectedMode)}>{supportsLocalMultiplayer && selectedMode === "multi" ? "Open Lobby" : "Start Game"} <span>→</span></button>
        </div>
      </section>
    </main>
  );
}

function GameLobby({
  game,
  firebaseUser,
  profileName,
  friends,
  outgoingInvites,
  roomCode,
  room,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onSendInvite,
  onCancelInvite,
  onStart,
  onBack,
  onOpenFriends,
}: {
  game: PlayableGameId;
  firebaseUser: User | null;
  profileName: string;
  friends: FriendEntry[];
  outgoingInvites: GameInvite[];
  roomCode: string;
  room: GameRoom | null;
  onCreateRoom: (gameId: PlayableGameId, guestName: string) => Promise<string>;
  onJoinRoom: (code: string, guestName: string) => Promise<string>;
  onLeaveRoom: () => Promise<void>;
  onSendInvite: (friend: FriendEntry, gameId: PlayableGameId, roomCode: string) => Promise<string>;
  onCancelInvite: (invite: GameInvite) => Promise<void>;
  onStart: () => Promise<void>;
  onBack: () => void;
  onOpenFriends: () => void;
}) {
  const details = GAME_MENUS[game];
  const [busyFriend, setBusyFriend] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [guestName, setGuestName] = useState(firebaseUser?.isAnonymous ? profileName : "Guest");
  const [joinCode, setJoinCode] = useState(roomCode);
  const [message, setMessage] = useState("");
  const isHost = Boolean(room && firebaseUser && room.hostUid === firebaseUser.uid);
  const roomReady = room?.status === "ready" && Boolean(room.guestUid);
  const activeInvite = outgoingInvites.find((invite) => invite.gameId === game && invite.roomCode === room?.code && (inviteIsLive(invite) || invite.status === "accepted"));

  const createRoom = async () => {
    setBusyAction(true);
    setMessage("");
    try { setMessage(await onCreateRoom(game, guestName)); }
    finally { setBusyAction(false); }
  };

  const joinRoom = async () => {
    setBusyAction(true);
    setMessage("");
    try { setMessage(await onJoinRoom(joinCode, guestName)); }
    finally { setBusyAction(false); }
  };

  const inviteFriend = async (friend: FriendEntry) => {
    if (!room) return;
    setBusyFriend(friend.uid);
    setMessage("");
    setMessage(await onSendInvite(friend, game, room.code));
    setBusyFriend(null);
  };

  const makeRoomLink = () => {
    if (!room) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.code);
    url.hash = `${room.gameId}-lobby`;
    return url.toString();
  };

  const copyRoomLink = async () => {
    try {
      await navigator.clipboard.writeText(makeRoomLink());
      setMessage("Invite link copied.");
    } catch { setMessage("Could not copy the link."); }
  };

  const shareRoomLink = async () => {
    const url = makeRoomLink();
    if (!navigator.share) { await copyRoomLink(); return; }
    try { await navigator.share({ title: `${details.title} · Game Garden`, text: `Join my ${details.title} room.`, url }); }
    catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) await copyRoomLink(); }
  };

  return (
    <main className="game-menu-shell game-lobby-shell">
      <header className="game-topbar menu-topbar">
        <button className="back-button" onClick={onBack}>← Game menu</button>
        <HeaderLogo compact />
        <span className="menu-header-spacer" aria-hidden="true" />
      </header>
      <section className="game-lobby">
        <div className="lobby-card">
          <button className="menu-close" onClick={onBack} aria-label="Close versus lobby">×</button>
          <div className="lobby-heading">
            <span className={`game-cover lobby-game-cover art-${game}`}><i>{details.glyph}</i></span>
            <div><p>VERSUS LOBBY · 対戦ロビー</p><h1>{details.title}</h1><span>Create a room or join with a six-character code.</span></div>
          </div>

          {!room ? (
            <div className="lobby-entry-grid">
              <div className="lobby-entry-card"><b>主</b><small>HOST</small><h2>Create room</h2><span>Get a code and invite link instantly.</span>{(!firebaseUser || firebaseUser.isAnonymous) && <input value={guestName} maxLength={18} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest name" aria-label="Guest name" />}<button className="primary-button" disabled={busyAction || guestName.trim().length < 2} onClick={() => void createRoom()}>{busyAction ? "CREATING…" : "CREATE ROOM"}</button></div>
              <div className="lobby-entry-card"><b>入</b><small>JOIN</small><h2>Enter code</h2><span>No account is required to join.</span>{(!firebaseUser || firebaseUser.isAnonymous) && <input value={guestName} maxLength={18} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest name" aria-label="Guest name for joining" />}<input className="room-code-input" value={joinCode} maxLength={6} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} placeholder="ABC234" aria-label="Room code" /><button className="secondary-button" disabled={busyAction || joinCode.length !== 6 || guestName.trim().length < 2} onClick={() => void joinRoom()}>{busyAction ? "JOINING…" : "JOIN ROOM"}</button></div>
            </div>
          ) : (
            <>
              <div className="room-share-card"><div><small>ROOM CODE</small><strong>{room.code}</strong><span>{roomReady ? "Two players ready" : "Waiting for player two"}</span></div><div><button onClick={() => void shareRoomLink()}>SHARE LINK</button><button onClick={() => void copyRoomLink()}>COPY LINK</button></div></div>
              <div className="lobby-players" aria-label="Lobby players">
                <div className="lobby-player ready"><AvatarGlyph avatarId={room.hostAvatar} className="lobby-avatar" /><span><small>HOST</small><strong>{room.hostName}</strong><em>READY</em></span></div>
                <b>VS</b>
                <div className={`lobby-player ${roomReady ? "ready" : "waiting"}`}>{room.guestUid && room.guestAvatar ? <AvatarGlyph avatarId={room.guestAvatar} className="lobby-avatar" /> : <span className="lobby-empty-avatar">?</span>}<span><small>GUEST</small><strong>{room.guestName || "Waiting for guest"}</strong><em>{roomReady ? "READY" : "OPEN"}</em></span></div>
              </div>
              {isHost && !roomReady && friends.length > 0 && !firebaseUser?.isAnonymous && <div className="lobby-friends"><div className="lobby-section-title"><span>Invite friends</span><span>友達を招待</span></div>{friends.map((friend) => <div className="lobby-friend" key={friend.uid}><AvatarGlyph avatarId={isAvatarId(friend.avatarId) ? friend.avatarId : "play"} className="lobby-friend-avatar" /><strong>{friend.name}</strong><button onClick={() => void inviteFriend(friend)} disabled={busyFriend !== null || Boolean(activeInvite)}>{busyFriend === friend.uid ? "SENDING…" : activeInvite?.toUid === friend.uid ? "SENT" : "INVITE"}</button></div>)}</div>}
              {isHost && !roomReady && !friends.length && !firebaseUser?.isAnonymous && <div className="lobby-empty-state"><strong>Share the link or invite a friend.</strong><span>Your friend list is currently empty.</span><button className="primary-button" onClick={onOpenFriends}>Add Friends</button></div>}
              {!isHost && roomReady && <p className="lobby-message host-start-message" role="status">Both players are ready. Waiting for the host to start.</p>}
              <div className="lobby-room-actions room-footer-actions">{roomReady && isHost && <button className="primary-button" onClick={() => void onStart()}>Start Online Versus</button>}{activeInvite && inviteIsLive(activeInvite) && <button className="secondary-button" onClick={() => void onCancelInvite(activeInvite)}>Cancel Friend Invite</button>}<button className="secondary-button" onClick={() => void onLeaveRoom()}>Leave Room</button></div>
            </>
          )}
          {message && <p className="lobby-message" role="status">{message}</p>}
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
        <HeaderLogo compact />
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
  { id: "tictactoe", number: "05", name: "Tic Tac Toe", japanese: "三目並べ", meta: "STRATEGY", scoreGame: "tictactoe" },
  { id: "connect4", number: "06", name: "Connect Four", japanese: "四目並べ", meta: "STRATEGY", scoreGame: "connect4" },
  { id: "rps", number: "07", name: "Rock Paper Scissors", japanese: "じゃんけん", meta: "QUICK", scoreGame: "rps" },
  { id: "dice", number: "08", name: "Dice Race", japanese: "サイコロ競走", meta: "LUCK", scoreGame: "dice" },
  { id: "meducktion", number: "09", name: "Meducktion", japanese: "医学推理", meta: "CARD GAME" },
  { id: "deducktion", number: "10", name: "Deducktion", japanese: "正体推理", meta: "CARD GAME" },
];

const SCORE_GAME_IDS: PlayableGameId[] = ["codebreaker", "order", "number", "memory", "tictactoe", "connect4", "rps", "dice"];

function formatScore(game: PlayableGameId, score?: number) {
  if (score == null) return "—";
  const unit = game === "memory" || game === "tictactoe" || game === "connect4" ? "moves" : game === "order" ? "checks" : game === "rps" ? "rounds" : game === "dice" ? "rolls" : "guesses";
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
  const publicProfileRef = doc(db, "publicProfiles", user.uid);
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
    transaction.set(publicProfileRef, {
      uid: user.uid,
      name: profileName.trim() || user.displayName || "Player One",
      avatarId,
      friendCode: friendCodeFor(user.uid),
      highScores: { [gameId]: bestScore },
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

function AvatarGlyph({ avatarId, className = "" }: { avatarId: AvatarId; className?: string }) {
  const avatar = AVATARS.find((option) => option.id === avatarId) ?? AVATARS[0];
  return <span className={`${className} avatar-style-${avatar.id}`} aria-hidden="true">{avatar.glyph && <b className="avatar-mark">{avatar.glyph}</b>}</span>;
}

function PlayerAvatar({ small = false, avatarId }: { small?: boolean; avatarId: AvatarId }) {
  return <AvatarGlyph avatarId={avatarId} className={`player-avatar ${small ? "avatar-small" : ""}`} />;
}

function HeaderLogo({ compact = false }: { compact?: boolean }) {
  return <span className={`header-title-logo ${compact ? "game-header-logo" : ""}`} role="img" aria-label="Game Garden" />;
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
  friendLinkCode,
  onAddFriend,
  onRemoveFriend,
  incomingInvites,
  outgoingInvites,
  onSendInvite,
  onRespondInvite,
  onCancelInvite,
  onCloseInvite,
  onJoinLobby,
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
  friendLinkCode: string;
  onAddFriend: (code: string) => Promise<string>;
  onRemoveFriend: (uid: string) => void;
  incomingInvites: GameInvite[];
  outgoingInvites: GameInvite[];
  onSendInvite: (friend: FriendEntry, gameId: PlayableGameId) => Promise<string>;
  onRespondInvite: (invite: GameInvite, response: "accepted" | "declined") => Promise<void>;
  onCancelInvite: (invite: GameInvite) => Promise<void>;
  onCloseInvite: (invite: GameInvite) => Promise<void>;
  onJoinLobby: (gameId: PlayableGameId, roomCode?: string) => void;
}) {
  const completedGames = Object.keys(highScores).length;
  const scoredGames = GAMES.filter((game) => game.scoreGame) as Array<(typeof GAMES)[number] & { scoreGame: PlayableGameId }>;
  const [rankGame, setRankGame] = useState<PlayableGameId>("codebreaker");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [friendInput, setFriendInput] = useState(friendLinkCode);
  const [friendMessage, setFriendMessage] = useState(friendLinkCode ? "Friend link loaded. Tap Add to connect." : "");
  const [shareMessage, setShareMessage] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);
  const [inviteGame, setInviteGame] = useState<PlayableGameId>("codebreaker");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const activeRanks = leaderboards[rankGame] ?? [];
  const liveIncoming = incomingInvites.filter(inviteIsLive);
  const liveOutgoing = outgoingInvites.filter(inviteIsLive);
  const readyInvites = [...incomingInvites, ...outgoingInvites].filter((invite, index, all) => invite.status === "accepted" && all.findIndex((item) => item.id === invite.id) === index);
  const currentHeader = HEADER_META[activeTab];

  const submitFriend = async () => {
    setFriendBusy(true);
    setFriendMessage("");
    try {
      const message = await onAddFriend(friendInput);
      setFriendMessage(message);
      if (message.endsWith(" was added.")) {
        setFriendInput("");
        const url = new URL(window.location.href);
        url.searchParams.delete("friend");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } finally {
      setFriendBusy(false);
    }
  };

  const makeFriendLink = () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("friend", friendCode);
    url.hash = "friends";
    return url.toString();
  };

  const copyFriendLink = async () => {
    const link = makeFriendLink();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = link;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setShareMessage("Friend link copied. Send it anywhere you like.");
    } catch {
      setShareMessage("Could not copy the link. Try the Share button.");
    }
  };

  const shareFriendLink = async () => {
    const link = makeFriendLink();
    if (!navigator.share) {
      await copyFriendLink();
      return;
    }
    try {
      await navigator.share({
        title: "Game Garden",
        text: `Add ${profileName || "me"} as a friend on Game Garden.`,
        url: link,
      });
      setShareMessage("Friend link shared.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyFriendLink();
    }
  };

  const submitInvite = async (friend: FriendEntry) => {
    setInviteBusy(true);
    setInviteMessage("");
    try {
      setInviteMessage(await onSendInvite(friend, inviteGame));
      setInviteTarget(null);
    } finally {
      setInviteBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="header-brand" onClick={() => onTabChange("games")} aria-label="Open Game Garden games">
          <HeaderLogo />
        </button>
        <div className="header-context" aria-label={`${currentHeader.label} section`}><span>{currentHeader.glyph}</span><div><small>{currentHeader.japanese}</small><strong>{currentHeader.label}</strong></div></div>
        <div className="header-actions">
          {firebaseUser && <span className="header-online"><i />{firebaseUser.isAnonymous ? "GUEST" : "ONLINE"}</span>}
          {liveIncoming.length > 0 && <button className="header-invites" onClick={() => onTabChange("friends")} aria-label={`${liveIncoming.length} pending game invites`}><b>招</b><span>{liveIncoming.length}</span></button>}
          <button className="theme-toggle" onClick={onThemeToggle} aria-label="Change color mode" aria-pressed={theme === "sakura"}><span>MODE</span></button>
          <button className="header-profile" onClick={() => onTabChange("profile")} aria-label="Open profile">
            <PlayerAvatar small avatarId={avatarId} />
          </button>
        </div>
      </header>

      <div className="app-content">
        {activeTab !== "friends" && liveIncoming.length > 0 && (
          <button className="invite-alert" onClick={() => onTabChange("friends")}>
            <AvatarGlyph avatarId={liveIncoming[0].fromAvatar} className="invite-alert-avatar" />
            <span><b>GAME INVITE</b><strong>{liveIncoming[0].fromName} wants to play {liveIncoming[0].gameName}.</strong></span>
            <em>VIEW</em>
          </button>
        )}
        {authError && activeTab !== "profile" && <p className="app-error-banner" role="alert"><b>!</b><span>{authError}</span></p>}
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
              <span className="local-badge">{firebaseUser && !firebaseUser.isAnonymous ? "CLOUD PROFILE" : "GUEST PROFILE"}</span>
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <div className="profile-actions">
                {firebaseUser && !firebaseUser.isAnonymous ? <><button className="primary-button" onClick={onProfileSave}>Save profile</button><button className="text-button" onClick={onSignOut}>Sign out</button></> : <>
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
            {!firebaseUser || firebaseUser.isAnonymous ? (
              <div className="friends-signin-card">
                <AvatarGlyph avatarId="pink-blossom" className="friend-hero-avatar" />
                <h2>Sign in to add friends.</h2>
                <button className="primary-button" onClick={() => onTabChange("profile")}>Open profile</button>
              </div>
            ) : <>
              <div className="invite-center">
                <div className="invite-center-heading"><span>Game invites</span><span>対戦招待</span></div>
                {liveIncoming.map((invite) => (
                  <div className="invite-card incoming-invite" key={invite.id}>
                    <AvatarGlyph avatarId={invite.fromAvatar} className="invite-avatar" />
                    <div><small>INVITED YOU · {inviteTimeLeft(invite)}</small><strong>{invite.fromName}</strong><span>{invite.gameName} · Online match</span></div>
                    <div className="invite-actions"><button className="primary-button" onClick={() => void onRespondInvite(invite, "accepted").then(() => onJoinLobby(invite.gameId, invite.roomCode))}>Accept</button><button className="secondary-button" onClick={() => void onRespondInvite(invite, "declined")}>Decline</button></div>
                  </div>
                ))}
                {readyInvites.map((invite) => {
                  const isHost = invite.fromUid === firebaseUser.uid;
                  return (
                    <div className="invite-card ready-invite" key={invite.id}>
                      <AvatarGlyph avatarId={isHost ? invite.toAvatar : invite.fromAvatar} className="invite-avatar" />
                      <div><small>ROOM READY · #{invite.roomCode || invite.id.slice(-8).toUpperCase()}</small><strong>{invite.gameName}</strong><span>You + {isHost ? invite.toName : invite.fromName}</span></div>
                      <div className="invite-actions ready-actions"><button className="primary-button" onClick={() => onJoinLobby(invite.gameId, invite.roomCode)}>Join Lobby</button><button className="invite-close" onClick={() => void onCloseInvite(invite)} aria-label={`Close ${invite.gameName} room`}>×</button></div>
                    </div>
                  );
                })}
                {liveOutgoing.map((invite) => (
                  <div className="invite-card outgoing-invite" key={invite.id}>
                    <AvatarGlyph avatarId={invite.toAvatar} className="invite-avatar" />
                    <div><small>WAITING · {inviteTimeLeft(invite)}</small><strong>{invite.toName}</strong><span>{invite.gameName}</span></div>
                    <button className="secondary-button invite-cancel" onClick={() => void onCancelInvite(invite)}>Cancel</button>
                  </div>
                ))}
                {!liveIncoming.length && !liveOutgoing.length && !readyInvites.length && <p className="empty-invites">No active invites. Challenge a friend below.</p>}
              </div>
              <div className="friend-code-card">
                <span>YOUR FRIEND CODE</span>
                <strong>{friendCode}</strong>
                <small>Send a direct link or share this code.</small>
                <div className="friend-link-actions">
                  <button className="friend-share-button" onClick={() => void shareFriendLink()}>Share friend link</button>
                  <button className="friend-copy-button" onClick={() => void copyFriendLink()}>Copy link</button>
                </div>
                {shareMessage && <p className="friend-share-message" role="status">{shareMessage}</p>}
              </div>
              <div className="friend-add-card">
                <label htmlFor="friend-code">ADD A FRIEND <span>友達を追加</span></label>
                <div><input id="friend-code" value={friendInput} maxLength={8} onChange={(event) => setFriendInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="FRIEND CODE" /><button className="primary-button" onClick={submitFriend} disabled={friendBusy || friendInput.length !== 8}>{friendBusy ? "Adding…" : "Add"}</button></div>
                {friendMessage && <p role="status">{friendMessage}</p>}
              </div>
              <div className="friend-list">
                <div className="friend-list-heading"><span>Friend list</span><span>フレンド</span></div>
                {inviteMessage && <p className="invite-message" role="status">{inviteMessage}</p>}
                {friends.length ? friends.map((friend) => (
                  <div className="friend-row" key={friend.uid}>
                    <div className="friend-row-head">
                      <AvatarGlyph avatarId={isAvatarId(friend.avatarId) ? friend.avatarId : "play"} className="friend-avatar" />
                      <strong>{friend.name}</strong>
                      <div className="friend-row-actions"><button className="friend-invite-button" onClick={() => { setInviteTarget((current) => current === friend.uid ? null : friend.uid); setInviteMessage(""); }}>INVITE</button><button className="friend-remove-button" onClick={() => onRemoveFriend(friend.uid)} aria-label={`Remove ${friend.name}`}>×</button></div>
                    </div>
                    {inviteTarget === friend.uid && (
                      <div className="friend-invite-picker">
                        <span>CHOOSE A GAME</span>
                        <div>{scoredGames.map((game) => <button key={game.id} className={inviteGame === game.scoreGame ? "active" : ""} onClick={() => setInviteGame(game.scoreGame)}>{game.name}</button>)}</div>
                        <button className="primary-button" disabled={inviteBusy} onClick={() => void submitInvite(friend)}>{inviteBusy ? "Sending…" : `Invite ${friend.name}`}</button>
                      </div>
                    )}
                    <div className="friend-score-grid" aria-label={`${friend.name} high scores`}>
                      {scoredGames.map((game) => (
                        <div key={game.id}>
                          <span>{game.name}</span>
                          <b>{formatScore(game.scoreGame, friend.highScores?.[game.scoreGame])}</b>
                        </div>
                      ))}
                    </div>
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
        <button className={activeTab === "friends" ? "active" : ""} onClick={() => onTabChange("friends")}><b>友{liveIncoming.length > 0 && <i className="nav-invite-badge">{liveIncoming.length}</i>}</b><span>Friends</span></button>
        <button className={activeTab === "profile" ? "active" : ""} onClick={() => onTabChange("profile")}><b>人</b><span>Profile</span></button>
      </nav>
    </main>
  );
}

export default function Home() {
  const [game, setGame] = useState<GameId>("games");
  const [friendLinkCode] = useState(friendCodeFromUrl);
  const [roomCode, setRoomCode] = useState(roomCodeFromUrl);
  const [activeRoom, setActiveRoom] = useState<GameRoom | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>("solo");
  const [highScores, setHighScores] = useState<HighScores>({});
  const [profileName, setProfileName] = useState("Player One");
  const [avatarId, setAvatarId] = useState<AvatarId>("play");
  const [theme, setTheme] = useState<ThemeMode>("classic");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [leaderboards, setLeaderboards] = useState<Leaderboards>({});
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, FriendEntry>>({});
  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<GameInvite[]>([]);

  useEffect(() => {
    const onPopState = () => setGame((window.location.hash.slice(1) as GameId) || "games");
    onPopState();
    const restoreTimer = window.setTimeout(() => {
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
    }, 0);
    window.addEventListener("hashchange", onPopState);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("hashchange", onPopState);
    };
  }, []);

  useEffect(() => {
    void getRedirectResult(auth).catch((error: unknown) => setAuthError(friendlyAuthError(error)));
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
      setAuthError("");
      if (!user) {
        setFriends([]);
        setFriendProfiles({});
        setIncomingInvites([]);
        setOutgoingInvites([]);
        setActiveRoom(null);
        return;
      }

      if (user.isAnonymous) {
        const savedGuestName = window.localStorage.getItem("game-garden-guest-name") || `Guest ${user.uid.slice(0, 4).toUpperCase()}`;
        const savedAvatar = window.localStorage.getItem("game-garden-avatar");
        setProfileName(savedGuestName);
        if (isAvatarId(savedAvatar)) setAvatarId(savedAvatar);
        setFriends([]);
        setFriendProfiles({});
        setIncomingInvites([]);
        setOutgoingInvites([]);
        return;
      }

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
        for (const gameId of SCORE_GAME_IDS) {
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
        await syncPublicProfile(user, cloudName, cloudAvatar, mergedScores);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Could not load the cloud profile.");
      }
    });
  }, []);

  useEffect(() => {
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    return onSnapshot(collection(db, "users", firebaseUser.uid, "friends"), (snapshot) => {
      setFriends(snapshot.docs.map((friend) => friend.data() as FriendEntry).sort((a, b) => a.name.localeCompare(b.name)));
    }, () => setAuthError("Could not load the friend list."));
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser || !roomCode) return;
    return onSnapshot(doc(db, "rooms", roomCode), (snapshot) => {
      if (!snapshot.exists()) {
        setActiveRoom(null);
        return;
      }
      const nextRoom = snapshot.data() as GameRoom;
      const isParticipant = nextRoom.hostUid === firebaseUser.uid || nextRoom.guestUid === firebaseUser.uid;
      setActiveRoom(isParticipant ? nextRoom : null);
      if (isParticipant && nextRoom.status === "playing" && nextRoom.gameId === "number") {
        setGameMode("multi");
        setGame("number");
        window.location.hash = "number";
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, () => setAuthError("Could not load that room."));
  }, [firebaseUser, roomCode]);

  useEffect(() => {
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    const byNewest = (left: GameInvite, right: GameInvite) => (right.updatedAt?.toMillis() ?? 0) - (left.updatedAt?.toMillis() ?? 0);
    const incomingUnsubscribe = onSnapshot(query(collection(db, "invites"), where("toUid", "==", firebaseUser.uid)), (snapshot) => {
      setIncomingInvites(snapshot.docs.map((invite) => ({ ...invite.data(), id: invite.id } as GameInvite)).sort(byNewest));
    }, () => setAuthError("Could not load incoming invitations."));
    const outgoingUnsubscribe = onSnapshot(query(collection(db, "invites"), where("fromUid", "==", firebaseUser.uid)), (snapshot) => {
      setOutgoingInvites(snapshot.docs.map((invite) => ({ ...invite.data(), id: invite.id } as GameInvite)).sort(byNewest));
    }, () => setAuthError("Could not load sent invitations."));
    return () => {
      incomingUnsubscribe();
      outgoingUnsubscribe();
    };
  }, [firebaseUser]);

  useEffect(() => {
    if (!friends.length) return;
    const unsubscribers = friends.map((friend) => onSnapshot(doc(db, "publicProfiles", friend.uid), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      setFriendProfiles((previous) => ({
        ...previous,
        [friend.uid]: {
          uid: friend.uid,
          name: typeof data.name === "string" ? data.name : friend.name,
          avatarId: isAvatarId(data.avatarId) ? data.avatarId : friend.avatarId,
          highScores: data.highScores && typeof data.highScores === "object" ? data.highScores as HighScores : {},
        },
      }));
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [friends]);

  useEffect(() => {
    const unsubscribers = SCORE_GAME_IDS.map((gameId) => onSnapshot(
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
    if (firebaseUser && !firebaseUser.isAnonymous) void saveCloudScore(firebaseUser, gameId, score, profileName, avatarId).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not save the score online."));
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
    if (!firebaseUser || firebaseUser.isAnonymous) return;
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
      await syncPublicProfile(firebaseUser, displayName, avatarId, highScores);
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
      await syncPublicProfile(credential.user, displayName, avatarId, {});
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
    if (!firebaseUser || firebaseUser.isAnonymous) return "Sign in before adding friends.";
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
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    void deleteDoc(doc(db, "users", firebaseUser.uid, "friends", friendUid)).catch(() => setAuthError("Could not remove that friend."));
  }, [firebaseUser]);

  const roomIdentity = useCallback(async (requestedName: string) => {
    let user = auth.currentUser;
    if (!user) user = (await signInAnonymously(auth)).user;
    const preferredName = user.isAnonymous ? requestedName.trim().slice(0, 18) : (profileName.trim() || user.displayName || "Player One").slice(0, 18);
    const name = preferredName.length >= 2 ? preferredName : user.isAnonymous ? `Guest ${user.uid.slice(0, 4).toUpperCase()}` : "Player One";
    if (user.isAnonymous) {
      window.localStorage.setItem("game-garden-guest-name", name);
      setProfileName(name);
    }
    return { user, name };
  }, [profileName]);

  const rememberRoom = useCallback((code: string, gameId: PlayableGameId) => {
    setRoomCode(code);
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    url.hash = `${gameId}-lobby`;
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setGame(`${gameId}-lobby`);
  }, []);

  const createRoom = useCallback(async (gameId: PlayableGameId, requestedName: string) => {
    try {
      const { user, name } = await roomIdentity(requestedName);
      const gameDetails = GAMES.find((item) => item.id === gameId)!;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const code = makeRoomCode();
        const roomRef = doc(db, "rooms", code);
        if ((await getDoc(roomRef)).exists()) continue;
        const nextRoom: Omit<GameRoom, "createdAt" | "updatedAt" | "expiresAt"> = { code, gameId, gameName: gameDetails.name, hostUid: user.uid, hostName: name, hostAvatar: avatarId, status: "open" };
        await setDoc(roomRef, { ...nextRoom, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + INVITE_LIFETIME_MS) });
        setActiveRoom(nextRoom);
        rememberRoom(code, gameId);
        return `Room ${code} is ready to share.`;
      }
      return "Could not find an open room code. Try again.";
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not create the room.");
      return "Could not create the room.";
    }
  }, [avatarId, rememberRoom, roomIdentity]);

  const joinRoom = useCallback(async (rawCode: string, requestedName: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return "Enter a valid six-character room code.";
    try {
      const { user, name } = await roomIdentity(requestedName);
      const roomRef = doc(db, "rooms", code);
      const snapshot = await getDoc(roomRef);
      if (!snapshot.exists()) return "That room was not found.";
      const foundRoom = snapshot.data() as GameRoom;
      if ((foundRoom.expiresAt?.toMillis() ?? 0) <= Date.now()) return "That room has expired.";
      if (foundRoom.hostUid !== user.uid && foundRoom.guestUid && foundRoom.guestUid !== user.uid) return "That room already has two players.";
      if (foundRoom.hostUid !== user.uid && foundRoom.guestUid !== user.uid) {
        await updateDoc(roomRef, { guestUid: user.uid, guestName: name, guestAvatar: avatarId, status: "ready", updatedAt: serverTimestamp() });
      }
      const joinedRoom: GameRoom = foundRoom.hostUid === user.uid ? foundRoom : { ...foundRoom, guestUid: user.uid, guestName: name, guestAvatar: avatarId, status: "ready" };
      setActiveRoom(joinedRoom);
      rememberRoom(code, foundRoom.gameId);
      return `Joined room ${code}.`;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not join the room.");
      return "Could not join the room.";
    }
  }, [avatarId, rememberRoom, roomIdentity]);

  const startVersus = useCallback(async (gameId: PlayableGameId) => {
    const user = auth.currentUser;
    if (gameId !== "number") {
      setGameMode("multi");
      setGame(gameId);
      window.location.hash = gameId;
      return;
    }
    if (!user || !activeRoom || activeRoom.hostUid !== user.uid || !activeRoom.guestUid || !activeRoom.guestName) {
      setAuthError("The host can start after both online players are ready.");
      return;
    }
    const batch = writeBatch(db);
    batch.set(doc(db, "rooms", activeRoom.code, "numberHunt", "state"), {
      gameId: "number",
      roomCode: activeRoom.code,
      round: 1,
      phase: "setting",
      keeperUid: activeRoom.hostUid,
      keeperName: activeRoom.hostName,
      guesserUid: activeRoom.guestUid,
      guesserName: activeRoom.guestName,
      guesses: [],
      pendingGuess: null,
      lastGuess: null,
      lastClue: "none",
      scores: [null, null],
      revealedSecrets: [null, null],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "rooms", activeRoom.code), { status: "playing", updatedAt: serverTimestamp() });
    try { await batch.commit(); }
    catch { setAuthError("Could not start the online match."); }
  }, [activeRoom]);

  const leaveRoom = useCallback(async () => {
    const user = auth.currentUser;
    const code = roomCode;
    try {
      if (user && code) {
        const roomRef = doc(db, "rooms", code);
        const snapshot = await getDoc(roomRef);
        if (snapshot.exists()) {
          const data = snapshot.data() as GameRoom;
          if (data.hostUid === user.uid || data.guestUid === user.uid) {
            if (data.gameId === "number") {
              const batch = writeBatch(db);
              batch.delete(doc(db, "rooms", code, "numberHunt", "state"));
              batch.delete(doc(db, "rooms", code, "numberHunt", "secret-1"));
              batch.delete(doc(db, "rooms", code, "numberHunt", "secret-2"));
              batch.delete(roomRef);
              await batch.commit();
            } else await deleteDoc(roomRef);
          }
        }
        const relatedInvites = [...incomingInvites, ...outgoingInvites].filter((invite, index, all) => invite.roomCode === code && all.findIndex((item) => item.id === invite.id) === index);
        for (const invite of relatedInvites) {
          if (invite.status === "pending" && invite.fromUid === user.uid) await updateDoc(doc(db, "invites", invite.id), { status: "cancelled", respondedAt: serverTimestamp(), updatedAt: serverTimestamp() });
          else if (invite.status !== "pending") await deleteDoc(doc(db, "invites", invite.id));
        }
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not close the room.");
    } finally {
      setActiveRoom(null);
      setRoomCode("");
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [incomingInvites, outgoingInvites, roomCode]);

  const sendInvite = useCallback(async (friend: FriendEntry, gameId: PlayableGameId, activeRoomCode = "") => {
    if (!firebaseUser) return "Sign in before sending an invite.";
    if (firebaseUser.isAnonymous) return "Create an account to invite saved friends, or share the room link.";
    const duplicate = outgoingInvites.find((invite) => invite.toUid === friend.uid && invite.gameId === gameId && invite.roomCode === (activeRoomCode || undefined) && (inviteIsLive(invite) || invite.status === "accepted"));
    if (duplicate?.status === "accepted") return `Your ${duplicate.gameName} room with ${friend.name} is already ready.`;
    if (duplicate) return `${friend.name} already has that invitation.`;
    const gameDetails = GAMES.find((game) => game.id === gameId)!;
    const inviteId = inviteIdFor(firebaseUser.uid, friend.uid, gameId, activeRoomCode);
    try {
      await setDoc(doc(db, "invites", inviteId), {
        fromUid: firebaseUser.uid,
        fromName: profileName.trim() || firebaseUser.displayName || "Player One",
        fromAvatar: avatarId,
        toUid: friend.uid,
        toName: friend.name,
        toAvatar: isAvatarId(friend.avatarId) ? friend.avatarId : "play",
        gameId,
        gameName: gameDetails.name,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + INVITE_LIFETIME_MS),
        ...(activeRoomCode ? { roomCode: activeRoomCode } : {}),
      });
      return `Invitation sent to ${friend.name}.`;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not send the invitation.");
      return "Could not send the invitation.";
    }
  }, [firebaseUser, outgoingInvites, profileName, avatarId]);

  const respondInvite = useCallback(async (invite: GameInvite, response: "accepted" | "declined") => {
    try {
      await updateDoc(doc(db, "invites", invite.id), { status: response, respondedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not respond to the invitation.");
    }
  }, []);

  const cancelInvite = useCallback(async (invite: GameInvite) => {
    try {
      await updateDoc(doc(db, "invites", invite.id), { status: "cancelled", respondedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not cancel the invitation.");
    }
  }, []);

  const closeInvite = useCallback(async (invite: GameInvite) => {
    try {
      await deleteDoc(doc(db, "invites", invite.id));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not close the room.");
    }
  }, []);

  const visibleFriends = useMemo(() => friends.map((friend) => ({
    ...friend,
    ...friendProfiles[friend.uid],
    uid: friend.uid,
  })), [friends, friendProfiles]);

  const view = useMemo(() => {
    const playFromMenu = (gameId: PlayableGameId, mode: GameMode) => {
      if (mode === "multi") {
        if (activeRoom && activeRoom.gameId !== gameId) {
          setActiveRoom(null);
          setRoomCode("");
          const url = new URL(window.location.href);
          url.searchParams.delete("room");
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
        selectGame(`${gameId}-lobby`);
        return;
      }
      setGameMode("solo");
      selectGame(gameId);
    };
    const lobbyGame = SCORE_GAME_IDS.find((gameId) => game === `${gameId}-lobby`);
    if (lobbyGame) return <GameLobby game={lobbyGame} firebaseUser={firebaseUser} profileName={profileName} friends={visibleFriends} outgoingInvites={outgoingInvites} roomCode={roomCode} room={activeRoom?.gameId === lobbyGame ? activeRoom : null} onCreateRoom={createRoom} onJoinRoom={joinRoom} onLeaveRoom={leaveRoom} onSendInvite={sendInvite} onCancelInvite={cancelInvite} onStart={() => startVersus(lobbyGame)} onBack={() => selectGame(`${lobbyGame}-menu`)} onOpenFriends={() => selectGame("friends")} />;
    if (game === "codebreaker-menu") return <GameMenu game="codebreaker" onPlay={(mode) => playFromMenu("codebreaker", mode)} onBack={() => selectGame("games")} />;
    if (game === "order-menu") return <GameMenu game="order" onPlay={(mode) => playFromMenu("order", mode)} onBack={() => selectGame("games")} />;
    if (game === "number-menu") return <GameMenu game="number" onPlay={(mode) => playFromMenu("number", mode)} onBack={() => selectGame("games")} />;
    if (game === "memory-menu") return <GameMenu game="memory" onPlay={(mode) => playFromMenu("memory", mode)} onBack={() => selectGame("games")} />;
    if (game === "tictactoe-menu") return <GameMenu game="tictactoe" onPlay={(mode) => playFromMenu("tictactoe", mode)} onBack={() => selectGame("games")} />;
    if (game === "connect4-menu") return <GameMenu game="connect4" onPlay={(mode) => playFromMenu("connect4", mode)} onBack={() => selectGame("games")} />;
    if (game === "rps-menu") return <GameMenu game="rps" onPlay={(mode) => playFromMenu("rps", mode)} onBack={() => selectGame("games")} />;
    if (game === "dice-menu") return <GameMenu game="dice" onPlay={(mode) => playFromMenu("dice", mode)} onBack={() => selectGame("games")} />;
    if (game === "meducktion-menu") return <GameMenu game="meducktion" onPlay={() => selectGame("meducktion")} onBack={() => selectGame("games")} />;
    if (game === "deducktion-menu") return <GameMenu game="deducktion" onPlay={() => selectGame("deducktion")} onBack={() => selectGame("games")} />;
    if (game === "codebreaker") return <Codebreaker mode={gameMode} onBack={() => selectGame("codebreaker-menu")} onScore={(score) => recordScore("codebreaker", score)} />;
    if (game === "order") return <OrderMatch mode={gameMode} onBack={() => selectGame("order-menu")} onScore={(score) => recordScore("order", score)} />;
    if (game === "number") return gameMode === "multi" && activeRoom?.gameId === "number" && firebaseUser ? <OnlineNumberHunt room={activeRoom} user={firebaseUser} onLeave={leaveRoom} /> : <NumberHunt mode="solo" onBack={() => selectGame("number-menu")} onScore={(score) => recordScore("number", score)} />;
    if (game === "memory") return <MemoryGame mode={gameMode} onBack={() => selectGame("memory-menu")} onScore={(score) => recordScore("memory", score)} />;
    if (game === "tictactoe") return <TicTacToe mode={gameMode} onBack={() => selectGame("tictactoe-menu")} onScore={(score) => recordScore("tictactoe", score)} />;
    if (game === "connect4") return <ConnectFour mode={gameMode} onBack={() => selectGame("connect4-menu")} onScore={(score) => recordScore("connect4", score)} />;
    if (game === "rps") return <RockPaperScissors mode={gameMode} onBack={() => selectGame("rps-menu")} onScore={(score) => recordScore("rps", score)} />;
    if (game === "dice") return <DiceRace mode={gameMode} onBack={() => selectGame("dice-menu")} onScore={(score) => recordScore("dice", score)} />;
    if (game === "meducktion") return <EmbeddedGame game="meducktion" onBack={() => selectGame("meducktion-menu")} />;
    if (game === "deducktion") return <EmbeddedGame game="deducktion" onBack={() => selectGame("deducktion-menu")} />;
    const activeTab: AppTab = game === "leaderboard" || game === "friends" || game === "profile" ? game : "games";
    return <AppHome activeTab={activeTab} theme={theme} onThemeToggle={toggleTheme} onTabChange={selectGame} onSelect={(selected) => selectGame(`${selected}-menu`)} highScores={highScores} profileName={profileName} avatarId={avatarId} onProfileNameChange={updateProfileName} onAvatarChange={updateAvatar} onProfileSave={saveProfile} firebaseUser={firebaseUser} authLoading={authLoading} authError={authError} onSignIn={signIn} onEmailSignIn={emailSignIn} onEmailCreate={emailCreate} onSignOut={signOutProfile} leaderboards={leaderboards} friends={visibleFriends} friendCode={firebaseUser && !firebaseUser.isAnonymous ? friendCodeFor(firebaseUser.uid) : ""} friendLinkCode={friendLinkCode} onAddFriend={addFriend} onRemoveFriend={removeFriend} incomingInvites={incomingInvites} outgoingInvites={outgoingInvites} onSendInvite={sendInvite} onRespondInvite={respondInvite} onCancelInvite={cancelInvite} onCloseInvite={closeInvite} onJoinLobby={(gameId, inviteRoomCode) => { if (inviteRoomCode) void joinRoom(inviteRoomCode, profileName); else selectGame(`${gameId}-lobby`); }} />;
  }, [game, gameMode, theme, highScores, profileName, avatarId, recordScore, toggleTheme, updateProfileName, updateAvatar, saveProfile, firebaseUser, authLoading, authError, signIn, emailSignIn, emailCreate, signOutProfile, leaderboards, visibleFriends, friendLinkCode, addFriend, removeFriend, incomingInvites, outgoingInvites, activeRoom, roomCode, createRoom, joinRoom, leaveRoom, startVersus, sendInvite, respondInvite, cancelInvite, closeInvite]);

  return view;
}
