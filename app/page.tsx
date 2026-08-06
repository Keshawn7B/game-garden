"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUserWithEmailAndPassword, getRedirectResult, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type User } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, limitToLast, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";
import { ChatChromeProvider, HeaderChatButton } from "./chat-chrome";
import { makeOnlineGameState, OnlineVersusGame, type OnlineGameId } from "./online-games";
import { BarricadeDragPiece, type BarricadeDragKind } from "./barricade-drag";

type PlayableGameId = "codebreaker" | "order" | "number" | "memory" | "tictactoe" | "connect4" | "rps" | "dice" | "barricade";
type LibraryGameId = PlayableGameId;
type AppTab = "games" | "leaderboard" | "friends" | "store" | "profile";
type ThemeMode = "classic" | "sakura";
type GameMode = "solo" | "multi";
type GameId = AppTab | LibraryGameId | `${LibraryGameId}-menu` | `${PlayableGameId}-lobby`;
type ColorId = "coral" | "gold" | "mint" | "blue" | "violet" | "pink";
type AvatarId = "play" | "sakura" | "fox" | "koi" | "moon" | "crane" | "dragon" | "cat" | "ninja" | "sun" | "pink-blossom" | "pink-heart" | "pink-bunny" | "pink-fan" | "pink-peach" | "premium-shogun" | "premium-kitsune" | "premium-empress" | "premium-dragon" | "premium-koi" | "premium-ronin" | "premium-cat" | "premium-blossom" | "premium-dual-swords";
type HighScores = Partial<Record<PlayableGameId, number>>;
type LeaderboardEntry = { uid: string; name: string; photoURL: string; avatarId?: AvatarId; score: number };
type Leaderboards = Partial<Record<PlayableGameId, LeaderboardEntry[]>>;
type FriendEntry = { uid: string; name: string; avatarId: AvatarId; highScores?: HighScores; online?: boolean; lastActiveAt?: Timestamp; isOnline?: boolean };
type FriendRequestStatus = "pending" | "accepted" | "declined" | "cancelled";
type FriendRequest = {
  id: string;
  fromUid: string;
  fromName: string;
  fromAvatar: AvatarId;
  toUid: string;
  toName: string;
  toAvatar: AvatarId;
  status: FriendRequestStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};
type DirectChatSummary = {
  id: string;
  userA: string;
  userB: string;
  participants: string[];
  userAName: string;
  userAAvatar: AvatarId;
  userBName: string;
  userBAvatar: AvatarId;
  lastMessage: string;
  lastSenderUid: string;
  lastMessageAt?: Timestamp;
  unreadBy?: Record<string, boolean>;
};
type DirectMessage = {
  id: string;
  senderUid: string;
  senderName: string;
  senderAvatar: AvatarId;
  text: string;
  sentAt?: Timestamp;
};
const EMPTY_DIRECT_MESSAGES: DirectMessage[] = [];
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
const PRESENCE_WINDOW_MS = 2 * 60 * 1000;
const PREMIUM_ACCESS_CODE = "SOKEY";
const SCORE_SEASON = 2;
const HEADER_META: Record<AppTab, { label: string; japanese: string; glyph: string }> = {
  games: { label: "ARCADE", japanese: "ゲーム", glyph: "遊" },
  leaderboard: { label: "RANKS", japanese: "ランキング", glyph: "冠" },
  friends: { label: "SOCIAL", japanese: "フレンド", glyph: "友" },
  store: { label: "STORE", japanese: "売店", glyph: "店" },
  profile: { label: "PLAYER", japanese: "プロフィール", glyph: "人" },
};

const AVATARS: { id: AvatarId; glyph?: string; label: string; premium?: boolean }[] = [
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
  { id: "premium-shogun", label: "Crimson Shogun", premium: true },
  { id: "premium-kitsune", label: "Celestial Kitsune", premium: true },
  { id: "premium-empress", label: "Sakura Empress", premium: true },
  { id: "premium-dragon", label: "Onyx Dragon", premium: true },
  { id: "premium-koi", label: "Legendary Koi", premium: true },
  { id: "premium-ronin", label: "Moon Ronin", premium: true },
  { id: "premium-cat", label: "Emerald Guardian Cat", premium: true },
  { id: "premium-blossom", label: "Sacred Sakura", premium: true },
  { id: "premium-dual-swords", label: "Crimson Dual Swords", premium: true },
];

function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATARS.some((avatar) => avatar.id === value);
}

function isPremiumAvatar(value: AvatarId) {
  return AVATARS.some((avatar) => avatar.id === value && avatar.premium);
}

function friendCodeFor(uid: string) {
  return uid.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
}

type PlayerStorageField = "scores" | "name" | "avatar";

function playerStorageKey(user: User | null, field: PlayerStorageField) {
  return user && !user.isAnonymous
    ? `game-garden-account-${user.uid}-${field}`
    : `game-garden-guest-${field}`;
}

function storedScores(user: User | null): HighScores {
  try {
    const saved = window.localStorage.getItem(playerStorageKey(user, "scores"));
    if (!saved) return {};
    const parsed = JSON.parse(saved) as Record<string, unknown>;
    return Object.fromEntries(SCORE_GAME_IDS.flatMap((gameId) => {
      const score = parsed[gameId];
      return Number.isInteger(score) && Number(score) >= 1 && Number(score) <= 10_000 ? [[gameId, Number(score)]] : [];
    })) as HighScores;
  } catch {
    return {};
  }
}

function directChatId(leftUid: string, rightUid: string) {
  return [leftUid, rightUid].sort((left, right) => left.localeCompare(right)).join("--");
}

function friendRequestId(fromUid: string, toUid: string) {
  return `${fromUid}--${toUid}`;
}

function friendIsOnline(friend: FriendEntry, now?: number) {
  return friend.online === true && friend.lastActiveAt instanceof Timestamp && (now == null || now - friend.lastActiveAt.toMillis() < PRESENCE_WINDOW_MS);
}

function friendPresenceLabel(friend: FriendEntry) {
  if (friend.isOnline) return "Online now";
  const lastActive = friend.lastActiveAt?.toMillis();
  if (!lastActive) return "Offline";
  const minutes = Math.max(1, Math.floor((Date.now() - lastActive) / 60000));
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  return "Offline";
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
    scoreSeason: SCORE_SEASON,
    online: true,
    lastActiveAt: serverTimestamp(),
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
        <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Start a new code">↻</button></div>
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
        <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Start a new order">↻</button></div>
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
        <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Start a new number game">↻</button></div>
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
      <header className="game-topbar"><button className="back-button" onClick={() => void onLeave()}>← Leave room</button><HeaderLogo compact /><div className="game-header-actions"><HeaderChatButton inGame /><span className="online-room-pill">● {room.code}</span></div></header>
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
        <div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Shuffle and restart">↻</button></div>
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
type CpuDifficulty = "easy" | "normal" | "hard";
const TIC_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const CPU_DIFFICULTIES: { id: CpuDifficulty; label: string; japanese: string; hint: string }[] = [
  { id: "easy", label: "Easy", japanese: "初級", hint: "Relaxed" },
  { id: "normal", label: "Normal", japanese: "中級", hint: "Balanced" },
  { id: "hard", label: "Hard", japanese: "上級", hint: "Sharp" },
];

function ticWinner(board: TicMark[]) {
  for (const [a, b, c] of TIC_LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return "";
}

function CpuDifficultyPicker({ difficulty, onChange, gameName }: { difficulty: CpuDifficulty; onChange: (difficulty: CpuDifficulty) => void; gameName: string }) {
  return (
    <div className="cpu-difficulty" aria-label={`${gameName} CPU difficulty`}>
      <div><span>CPU LEVEL</span><small>難易度</small></div>
      <div className="difficulty-options">
        {CPU_DIFFICULTIES.map((level) => <button key={level.id} className={difficulty === level.id ? "active" : ""} onClick={() => onChange(level.id)} aria-pressed={difficulty === level.id}><span>{level.label}</span><small>{level.japanese} · {level.hint}</small></button>)}
      </div>
    </div>
  );
}

function ticMinimax(board: TicMark[], maximizing: boolean, depth = 0): number {
  const winner = ticWinner(board);
  if (winner === "O") return 10 - depth;
  if (winner === "X") return depth - 10;
  const open = board.map((mark, index) => mark ? -1 : index).filter((index) => index >= 0);
  if (!open.length) return 0;
  if (maximizing) return Math.max(...open.map((index) => ticMinimax(board.map((mark, cell) => cell === index ? "O" : mark), false, depth + 1)));
  return Math.min(...open.map((index) => ticMinimax(board.map((mark, cell) => cell === index ? "X" : mark), true, depth + 1)));
}

function cpuTicMove(board: TicMark[], difficulty: CpuDifficulty) {
  const open = board.map((mark, index) => mark ? -1 : index).filter((index) => index >= 0);
  const randomMove = () => open[Math.floor(Math.random() * open.length)];
  const winning = open.find((index) => ticWinner(board.map((cell, cellIndex) => cellIndex === index ? "O" : cell)) === "O");
  const blocking = open.find((index) => ticWinner(board.map((cell, cellIndex) => cellIndex === index ? "X" : cell)) === "X");
  if (difficulty === "easy") {
    if (winning != null && Math.random() < 0.55) return winning;
    if (blocking != null && Math.random() < 0.25) return blocking;
    return randomMove();
  }
  if (difficulty === "normal") {
    if (winning != null) return winning;
    if (blocking != null && Math.random() < 0.78) return blocking;
    if (Math.random() < 0.28) return randomMove();
    if (!board[4]) return 4;
    const openCorner = [0, 2, 6, 8].filter((index) => !board[index]);
    return openCorner.length ? openCorner[Math.floor(Math.random() * openCorner.length)] : randomMove();
  }
  let bestMove = open[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const index of open) {
    const score = ticMinimax(board.map((mark, cell) => cell === index ? "O" : mark), false);
    if (score > bestScore) { bestScore = score; bestMove = index; }
  }
  return bestMove;
}

function TicTacToe({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [board, setBoard] = useState<TicMark[]>(Array(9).fill(""));
  const [turn, setTurn] = useState<TicMark>("X");
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const winner = ticWinner(board);
  const draw = !winner && board.every(Boolean);

  const reset = () => { setBoard(Array(9).fill("")); setTurn("X"); };
  const changeDifficulty = (nextDifficulty: CpuDifficulty) => { setDifficulty(nextDifficulty); reset(); };
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
    const cpuIndex = cpuTicMove(next, difficulty);
    setBoard(cpuIndex == null ? next : next.map((cell, cellIndex) => cellIndex === cpuIndex ? "O" : cell));
  };

  return (
    <main className="game-shell simple-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart tic tac toe">↻</button></div></header>
      <section className="simple-game tic-game">
        <p className="eyebrow">STRATEGY · {mode === "multi" ? "2 PLAYERS" : `VS CPU · ${difficulty.toUpperCase()}`}</p>
        <h1>Tic Tac Toe</h1>
        <p>Make three in a row before your opponent.</p>
        {mode === "solo" && <CpuDifficultyPicker difficulty={difficulty} onChange={changeDifficulty} gameName="Tic Tac Toe" />}
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
const CONNECT_CPU_LEVELS: Record<CpuDifficulty, { winChance: number; blockChance: number; randomChance: number; depth: number; noise: number }> = {
  easy: { winChance: 0.65, blockChance: 0.28, randomChance: 0.78, depth: 1, noise: 110 },
  normal: { winChance: 1, blockChance: 0.72, randomChance: 0.38, depth: 2, noise: 22 },
  hard: { winChance: 1, blockChance: 1, randomChance: 0, depth: 4, noise: 0 },
};
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

function connectCpuMove(board: ConnectPiece[], difficulty: CpuDifficulty) {
  const settings = CONNECT_CPU_LEVELS[difficulty];
  const openColumns = CONNECT_COLUMN_ORDER.filter((column) => !board[column]);
  if (!openColumns.length) return 0;
  const winning = openColumns.find((column) => connectWinner(dropConnectPiece(board, column, 2)!.board)?.player === 2);
  if (winning != null && Math.random() < settings.winChance) return winning;
  const blocking = openColumns.find((column) => connectWinner(dropConnectPiece(board, column, 1)!.board)?.player === 1);
  if (blocking != null && Math.random() < settings.blockChance) return blocking;
  if (Math.random() < settings.randomChance) return openColumns[Math.floor(Math.random() * openColumns.length)];

  let bestColumn = openColumns[0] ?? 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const column of openColumns) {
    const move = dropConnectPiece(board, column, 2)!;
    const score = connectMinimax(move.board, settings.depth, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, false) + (Math.random() - 0.5) * settings.noise;
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
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
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

  const changeDifficulty = (nextDifficulty: CpuDifficulty) => {
    setDifficulty(nextDifficulty);
    resetMatch();
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
      const move = dropConnectPiece(board, connectCpuMove(board, difficulty), 2);
      if (!move) return;
      const nextWinner = connectWinner(move.board);
      setBoard(move.board);
      setLastDrop(move.index);
      setMoves((value) => value + 1);
      if (nextWinner) setMatchScore((scores) => [scores[0], scores[1] + 1]);
      else setTurn(1);
    }, 460);
    return () => window.clearTimeout(timer);
  }, [board, cpuThinking, difficulty]);

  const turnName = mode === "solo" ? turn === 1 ? "YOUR TURN" : "CPU THINKING" : `PLAYER ${turn}'S TURN`;
  const resultTitle = winner ? mode === "solo" ? winner.player === 1 ? "You connected four!" : "CPU connected four." : `Player ${winner.player} wins!` : draw ? "Board locked. Draw game." : turnName;

  return (
    <main className="game-shell simple-game-shell connect-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={resetMatch} aria-label="Restart Connect Four match">↻</button></div></header>
      <section className="connect-game">
        <div className="connect-heading"><div><p className="eyebrow">STRATEGY · {mode === "multi" ? "2 PLAYERS" : `VS CPU · ${difficulty.toUpperCase()}`}</p><h1>Connect Four</h1><p>Build a line across, down, or diagonally before your opponent.</p></div><span><b>四</b><small>四目並べ</small></span></div>
        {mode === "solo" && <CpuDifficultyPicker difficulty={difficulty} onChange={changeDifficulty} gameName="Connect Four" />}
        {mode === "multi" && !winner && !draw && <TurnBanner mode={mode} currentPlayer={turn === 1 ? 0 : 1} scores={matchScore} />}
        <div className="connect-scoreboard" aria-label="Match score">
          <div className={`connect-player player-one ${turn === 1 && !winner ? "is-active" : ""} ${winner?.player === 1 ? "is-winner" : ""}`}><i /><span><small>{mode === "solo" ? "YOU" : "PLAYER 1"}</small><strong>{matchScore[0]}</strong></span></div>
          <div className="connect-round"><small>ROUND</small><strong>{String(round).padStart(2, "0")}</strong><span>{moves} MOVES</span></div>
          <div className={`connect-player player-two ${turn === 2 && !winner ? "is-active" : ""} ${winner?.player === 2 ? "is-winner" : ""}`}><span><small>{mode === "solo" ? `CPU · ${difficulty.toUpperCase()}` : "PLAYER 2"}</small><strong>{matchScore[1]}</strong></span><i /></div>
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

/* Legacy track-based prototype retained in source history only.
const BARRICADE_FINISH = 28;
const BARRICADE_STARTS = [6, 12, 18, 23];

function barricadeDestination(position: number, roll: number, barricades: number[]) {
  const destination = position + roll;
  if (destination > BARRICADE_FINISH) return null;
  if (barricades.some((space) => space > position && space < destination)) return null;
  return destination;
}

function BarricadeClassic({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const [positions, setPositions] = useState<[number, number]>([0, 0]);
  const [barricades, setBarricades] = useState(BARRICADE_STARTS);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [lastRoll, setLastRoll] = useState(0);
  const [moves, setMoves] = useState(0);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [relocating, setRelocating] = useState<number | null>(null);
  const [message, setMessage] = useState("Roll the die and race to the gate.");

  const reset = useCallback(() => {
    setPositions([0, 0]);
    setBarricades(BARRICADE_STARTS);
    setTurn(0);
    setLastRoll(0);
    setMoves(0);
    setWinner(null);
    setRelocating(null);
    setMessage("Roll the die and race to the gate.");
  }, []);

  const finishTurn = useCallback((nextTurn: 0 | 1) => {
    setTurn(nextTurn);
    setRelocating(null);
  }, []);

  const movePawn = useCallback((player: 0 | 1, roll: number) => {
    const destination = barricadeDestination(positions[player], roll, barricades);
    setLastRoll(roll);
    if (player === 0) setMoves((value) => value + 1);
    if (destination == null) {
      setMessage("Blocked. The full roll cannot be used.");
      finishTurn(player === 0 ? 1 : 0);
      return;
    }
    const nextPositions: [number, number] = [...positions];
    nextPositions[player] = destination;
    if (destination === positions[player === 0 ? 1 : 0]) nextPositions[player === 0 ? 1 : 0] = 0;
    setPositions(nextPositions);
    if (destination === BARRICADE_FINISH) {
      setWinner(player);
      setMessage(player === 0 ? "You reached the garden gate!" : "CPU reached the garden gate.");
      if (player === 0) onScore(moves + 1);
      return;
    }
    const captured = barricades.indexOf(destination);
    if (captured >= 0) {
      setBarricades((current) => current.filter((_, index) => index !== captured));
      setRelocating(destination);
      setMessage(player === 0 ? "Barricade captured. Tap an open space to relocate it." : "CPU is relocating the barricade.");
      return;
    }
    setMessage(player === 0 ? "CPU turn." : "Your turn.");
    finishTurn(player === 0 ? 1 : 0);
  }, [barricades, finishTurn, moves, onScore, positions]);

  const validRelocation = useCallback((space: number) => space > 1 && space < BARRICADE_FINISH && !barricades.includes(space) && !positions.includes(space), [barricades, positions]);
  const relocate = useCallback((space: number, player: 0 | 1) => {
    if (!validRelocation(space)) return;
    setBarricades((current) => [...current, space].sort((left, right) => left - right));
    setMessage(player === 0 ? "Barricade placed. CPU turn." : "CPU placed a barricade. Your turn.");
    finishTurn(player === 0 ? 1 : 0);
  }, [finishTurn, validRelocation]);

  useEffect(() => {
    if (mode !== "solo" || turn !== 1 || winner != null) return;
    const timer = window.setTimeout(() => {
      if (relocating != null) {
        const available = Array.from({ length: BARRICADE_FINISH - 2 }, (_, index) => index + 2).filter(validRelocation);
        const playerPosition = positions[0];
        const candidates = available.filter((space) => space > playerPosition && space <= playerPosition + (difficulty === "hard" ? 4 : 7));
        const pool = difficulty === "easy" || !candidates.length ? available : candidates;
        relocate(pool[Math.floor(Math.random() * pool.length)], 1);
        return;
      }
      movePawn(1, Math.floor(Math.random() * 6) + 1);
    }, relocating != null ? 520 : 650);
    return () => window.clearTimeout(timer);
  }, [difficulty, mode, movePawn, positions, relocate, relocating, turn, validRelocation, winner]);

  return (
    <main className="game-shell simple-game-shell barricade-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Barricade">↻</button></div></header>
      <section className="barricade-game">
        <div className="barricade-heading"><div><p className="eyebrow">STRATEGY · {mode === "solo" ? `VS CPU · ${difficulty.toUpperCase()}` : "2 PLAYERS"}</p><h1>Barricade</h1><p>Land exactly on barriers, move them to new spaces, and reach the gate first.</p></div><span>塞</span></div>
        {mode === "solo" && <CpuDifficultyPicker difficulty={difficulty} onChange={(next) => { setDifficulty(next); reset(); }} gameName="Barricade" />}
        <div className="barricade-score-strip"><div className={turn === 0 && winner == null ? "active" : ""}><i className="pawn-one" /><span>YOU</span><strong>{positions[0]}</strong></div><b className={lastRoll ? "rolled" : ""}>{lastRoll || "—"}<small>DIE</small></b><div className={turn === 1 && winner == null ? "active" : ""}><strong>{positions[1]}</strong><span>{mode === "solo" ? "CPU" : "PLAYER 2"}</span><i className="pawn-two" /></div></div>
        <div className="barricade-board" aria-label="Barricade race board">
          {Array.from({ length: BARRICADE_FINISH + 1 }, (_, space) => {
            const canPlace = relocating != null && turn === 0 && validRelocation(space);
            return <button key={space} className={`${space === BARRICADE_FINISH ? "finish" : ""} ${barricades.includes(space) ? "has-barricade" : ""} ${canPlace ? "can-place" : ""}`} onClick={() => canPlace && relocate(space, 0)} disabled={!canPlace}><small>{space === 0 ? "START" : space === BARRICADE_FINISH ? "GOAL" : space}</small>{barricades.includes(space) && <span className="barricade-block">止</span>}<span className="pawn-stack">{positions[0] === space && <i className="pawn-one" />}{positions[1] === space && <i className="pawn-two" />}</span></button>;
          })}
        </div>
        <div className="barricade-controls" role="status"><div><small>{winner != null ? "MATCH COMPLETE" : relocating != null ? "MOVE THE BARRICADE" : turn === 0 ? "YOUR MOVE" : "OPPONENT MOVE"}</small><strong>{message}</strong></div>{winner != null ? <button className="primary-button" onClick={reset}>Rematch</button> : relocating == null && turn === 0 ? <button className="primary-button barricade-roll" onClick={() => movePawn(0, Math.floor(Math.random() * 6) + 1)}>Roll die</button> : <span className="barricade-wait">{turn === 1 ? "CPU THINKING…" : "CHOOSE A SPACE"}</span>}</div>
      </section>
    </main>
  );
}
*/

type GridWall = { row: number; column: number; orientation: "h" | "v"; owner: 0 | 1 };
const BARRICADE_SIZE = 9;
const BARRICADE_START: [number, number] = [76, 4];

function barricadeEdgeBlocked(from: number, to: number, walls: GridWall[]) {
  const fromRow = Math.floor(from / BARRICADE_SIZE);
  const fromColumn = from % BARRICADE_SIZE;
  const toRow = Math.floor(to / BARRICADE_SIZE);
  const toColumn = to % BARRICADE_SIZE;
  if (fromRow !== toRow) {
    const boundary = Math.min(fromRow, toRow);
    return walls.some((wall) => wall.orientation === "h" && wall.row === boundary && (wall.column === fromColumn || wall.column + 1 === fromColumn));
  }
  const boundary = Math.min(fromColumn, toColumn);
  return walls.some((wall) => wall.orientation === "v" && wall.column === boundary && (wall.row === fromRow || wall.row + 1 === fromRow));
}

function barricadeNeighbors(position: number, walls: GridWall[]) {
  const row = Math.floor(position / BARRICADE_SIZE);
  const column = position % BARRICADE_SIZE;
  return [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]
    .filter(([nextRow, nextColumn]) => nextRow >= 0 && nextRow < BARRICADE_SIZE && nextColumn >= 0 && nextColumn < BARRICADE_SIZE)
    .map(([nextRow, nextColumn]) => nextRow * BARRICADE_SIZE + nextColumn)
    .filter((next) => !barricadeEdgeBlocked(position, next, walls));
}

function barricadeMoves(position: number, opponent: number, walls: GridWall[]) {
  const moves = new Set<number>();
  for (const next of barricadeNeighbors(position, walls)) {
    if (next !== opponent) {
      moves.add(next);
      continue;
    }
    const rowDelta = Math.floor(opponent / BARRICADE_SIZE) - Math.floor(position / BARRICADE_SIZE);
    const columnDelta = opponent % BARRICADE_SIZE - position % BARRICADE_SIZE;
    const behindRow = Math.floor(opponent / BARRICADE_SIZE) + rowDelta;
    const behindColumn = opponent % BARRICADE_SIZE + columnDelta;
    if (behindRow >= 0 && behindRow < BARRICADE_SIZE && behindColumn >= 0 && behindColumn < BARRICADE_SIZE) {
      const behind = behindRow * BARRICADE_SIZE + behindColumn;
      if (!barricadeEdgeBlocked(opponent, behind, walls)) {
        moves.add(behind);
        continue;
      }
    }
    for (const side of barricadeNeighbors(opponent, walls)) {
      const sideRow = Math.floor(side / BARRICADE_SIZE);
      const sideColumn = side % BARRICADE_SIZE;
      if ((rowDelta !== 0 && sideRow === Math.floor(opponent / BARRICADE_SIZE)) || (columnDelta !== 0 && sideColumn === opponent % BARRICADE_SIZE)) moves.add(side);
    }
  }
  return [...moves];
}

function barricadePathLength(start: number, goalRow: number, walls: GridWall[]) {
  const queue: Array<[number, number]> = [[start, 0]];
  const seen = new Set([start]);
  while (queue.length) {
    const [position, distance] = queue.shift()!;
    if (Math.floor(position / BARRICADE_SIZE) === goalRow) return distance;
    for (const next of barricadeNeighbors(position, walls)) if (!seen.has(next)) {
      seen.add(next);
      queue.push([next, distance + 1]);
    }
  }
  return Number.POSITIVE_INFINITY;
}

function legalBarricadeWall(candidate: GridWall, walls: GridWall[], positions: [number, number]) {
  const overlaps = walls.some((wall) => wall.orientation === candidate.orientation
    ? candidate.orientation === "h" ? wall.row === candidate.row && Math.abs(wall.column - candidate.column) < 2 : wall.column === candidate.column && Math.abs(wall.row - candidate.row) < 2
    : wall.row === candidate.row && wall.column === candidate.column);
  if (overlaps) return false;
  const nextWalls = [...walls, candidate];
  return Number.isFinite(barricadePathLength(positions[0], 0, nextWalls)) && Number.isFinite(barricadePathLength(positions[1], 8, nextWalls));
}

function shortestBarricadeMove(position: number, opponent: number, goalRow: number, walls: GridWall[]) {
  const moves = barricadeMoves(position, opponent, walls);
  return moves.sort((left, right) => barricadePathLength(left, goalRow, walls) - barricadePathLength(right, goalRow, walls))[0];
}

function Barricade({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const [positions, setPositions] = useState<[number, number]>(BARRICADE_START);
  const [walls, setWalls] = useState<GridWall[]>([]);
  const [wallsLeft, setWallsLeft] = useState<[number, number]>([10, 10]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [draggingPiece, setDraggingPiece] = useState<BarricadeDragKind | null>(null);
  const [moves, setMoves] = useState(0);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [message, setMessage] = useState("Move your pawn or place a barricade.");
  const boardRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setPositions(BARRICADE_START);
    setWalls([]);
    setWallsLeft([10, 10]);
    setTurn(0);
    setDraggingPiece(null);
    setMoves(0);
    setWinner(null);
    setMessage("Move your pawn or place a barricade.");
  }, []);

  const finishAction = useCallback((player: 0 | 1, nextPositions: [number, number]) => {
    const won = Math.floor(nextPositions[player] / BARRICADE_SIZE) === (player === 0 ? 0 : 8);
    if (player === 0) setMoves((value) => value + 1);
    if (won) {
      setWinner(player);
      setMessage(player === 0 ? "You reached the far side!" : "CPU reached the far side.");
      if (player === 0) onScore(moves + 1);
    } else {
      setTurn(player === 0 ? 1 : 0);
      setMessage(player === 0 ? "Opponent turn." : "Your turn.");
    }
  }, [moves, onScore]);

  const movePawn = useCallback((player: 0 | 1, destination: number) => {
    if (!barricadeMoves(positions[player], positions[player === 0 ? 1 : 0], walls).includes(destination)) return;
    const nextPositions: [number, number] = [...positions];
    nextPositions[player] = destination;
    setPositions(nextPositions);
    finishAction(player, nextPositions);
  }, [finishAction, positions, walls]);

  const placeWall = useCallback((player: 0 | 1, row: number, column: number, wallOrientation: "h" | "v") => {
    if (wallsLeft[player] <= 0) return;
    const candidate: GridWall = { row, column, orientation: wallOrientation, owner: player };
    if (!legalBarricadeWall(candidate, walls, positions)) {
      if (player === 0) setMessage("That wall would overlap or remove every route.");
      return;
    }
    setWalls((current) => [...current, candidate]);
    setWallsLeft((current) => current.map((count, index) => index === player ? count - 1 : count) as [number, number]);
    finishAction(player, positions);
  }, [finishAction, positions, walls, wallsLeft]);

  const dropBarricadePiece = useCallback((clientX: number, clientY: number, kind: BarricadeDragKind) => {
    const cells = boardRef.current?.querySelector<HTMLElement>(".quoridor-cells");
    if (!cells || turn !== 0 || winner != null) return;
    const rect = cells.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      setMessage("Drop the piece on the board.");
      return;
    }
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const row = Math.round(y * 9 - 1);
    const column = Math.round(x * 9 - 1);
    if (row < 0 || row > 7 || column < 0 || column > 7 || !legalBarricadeWall({ row, column, orientation: kind, owner: 0 }, walls, positions)) {
      setMessage("That wall cannot be placed there.");
      return;
    }
    placeWall(0, row, column, kind);
  }, [placeWall, positions, turn, walls, winner]);

  useEffect(() => {
    if (mode !== "solo" || turn !== 1 || winner != null) return;
    const timer = window.setTimeout(() => {
      const cpuPath = barricadePathLength(positions[1], 8, walls);
      const playerPath = barricadePathLength(positions[0], 0, walls);
      const candidates: GridWall[] = [];
      if (wallsLeft[1] > 0) for (let row = 0; row < 8; row += 1) for (let column = 0; column < 8; column += 1) for (const nextOrientation of ["h", "v"] as const) {
        const candidate: GridWall = { row, column, orientation: nextOrientation, owner: 1 };
        if (legalBarricadeWall(candidate, walls, positions)) candidates.push(candidate);
      }
      const shouldWall = candidates.length > 0 && (difficulty === "hard" ? playerPath <= cpuPath + 2 : difficulty === "normal" ? playerPath < cpuPath : Math.random() < .18);
      if (shouldWall) {
        const ranked = candidates.map((candidate) => {
          const nextWalls = [...walls, candidate];
          return { candidate, value: barricadePathLength(positions[0], 0, nextWalls) - playerPath - Math.max(0, barricadePathLength(positions[1], 8, nextWalls) - cpuPath) };
        }).sort((left, right) => right.value - left.value);
        const choice = difficulty === "easy" ? ranked[Math.floor(Math.random() * ranked.length)] : ranked[0];
        placeWall(1, choice.candidate.row, choice.candidate.column, choice.candidate.orientation);
      } else {
        const legalMoves = barricadeMoves(positions[1], positions[0], walls);
        const destination = difficulty === "easy" && Math.random() < .45 ? legalMoves[Math.floor(Math.random() * legalMoves.length)] : shortestBarricadeMove(positions[1], positions[0], 8, walls);
        movePawn(1, destination);
      }
    }, 520);
    return () => window.clearTimeout(timer);
  }, [difficulty, mode, movePawn, placeWall, positions, turn, walls, wallsLeft, winner]);

  const legalMoves = turn === 0 && winner == null ? barricadeMoves(positions[0], positions[1], walls) : [];
  return (
    <main className="game-shell simple-game-shell barricade-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Barricade">↻</button></div></header>
      <section className="barricade-game grid-barricade">
        <div className="barricade-heading"><div><p className="eyebrow">STRATEGY · {mode === "solo" ? `VS CPU · ${difficulty.toUpperCase()}` : "2 PLAYERS"}</p><h1>Barricade</h1><p>Reach the opposite edge while reshaping both routes with tactical walls.</p></div><span>壁</span></div>
        {mode === "solo" && <CpuDifficultyPicker difficulty={difficulty} onChange={(next) => { setDifficulty(next); reset(); }} gameName="Barricade" />}
        <div className="barricade-score-strip"><div className={turn === 0 && winner == null ? "active" : ""}><i className="pawn-one" /><span>YOU</span><strong>{wallsLeft[0]}<small>WALLS</small></strong></div><b>対<small>RACE</small></b><div className={turn === 1 && winner == null ? "active" : ""}><strong>{wallsLeft[1]}<small>WALLS</small></strong><span>{mode === "solo" ? "CPU" : "PLAYER 2"}</span><i className="pawn-two" /></div></div>
        <div className="quoridor-board" ref={boardRef}>
          <div className="quoridor-cells" role="grid">{Array.from({ length: 81 }, (_, index) => <button key={index} role="gridcell" className={`${legalMoves.includes(index) ? "legal-move" : ""} ${Math.floor(index / 9) === 0 ? "top-goal" : ""} ${Math.floor(index / 9) === 8 ? "bottom-goal" : ""}`} onClick={() => movePawn(0, index)} disabled={!legalMoves.includes(index)} aria-label={legalMoves.includes(index) ? `Move to row ${Math.floor(index / 9) + 1}, column ${index % 9 + 1}` : `Board row ${Math.floor(index / 9) + 1}, column ${index % 9 + 1}`}>{positions[0] === index && <i className="pawn-one" />}{positions[1] === index && <i className="pawn-two" />}</button>)}</div>
          <div className={`quoridor-wall-layer dragging-${draggingPiece ?? "none"}`}>{Array.from({ length: 64 }, (_, index) => { const row = Math.floor(index / 8); const column = index % 8; const wallOrientation = draggingPiece === "h" || draggingPiece === "v" ? draggingPiece : null; const canPlace = wallOrientation != null && turn === 0 && legalBarricadeWall({ row, column, orientation: wallOrientation, owner: 0 }, walls, positions); return <span key={index} className={canPlace ? `wall-target legal wall-${wallOrientation}` : "wall-target"} style={{ "--wall-row": row, "--wall-column": column } as React.CSSProperties} />; })}{walls.map((wall, index) => <i key={index} className={`placed-wall wall-${wall.orientation} owner-${wall.owner + 1}`} style={{ "--wall-row": wall.row, "--wall-column": wall.column } as React.CSSProperties} />)}</div>
        </div>
        <div className="barricade-piece-tray" aria-label="Drag a wall onto the board">
          <BarricadeDragPiece kind="h" label="Drag a horizontal wall" disabled={turn !== 0 || winner != null || wallsLeft[0] === 0} onDragStart={setDraggingPiece} onDragEnd={() => setDraggingPiece(null)} onDrop={dropBarricadePiece} />
          <span><strong>{wallsLeft[0]}</strong><small>WALLS</small></span>
          <BarricadeDragPiece kind="v" label="Drag a vertical wall" disabled={turn !== 0 || winner != null || wallsLeft[0] === 0} onDragStart={setDraggingPiece} onDragEnd={() => setDraggingPiece(null)} onDrop={dropBarricadePiece} />
        </div>
        <div className="barricade-controls" role="status"><div><small>{winner != null ? "MATCH COMPLETE" : turn === 0 ? "TAP A SPACE OR DRAG A WALL" : "OPPONENT MOVE"}</small><strong>{message}</strong></div>{winner != null && <button className="primary-button" onClick={reset}>Rematch</button>}</div>
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
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart rock paper scissors">↻</button></div></header>
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
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart dice race">↻</button></div></header>
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
      "Play against the CPU or open a live Versus room for a friend.",
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
  barricade: {
    title: "Barricade",
    japanese: "バリケード",
    category: "Strategy",
    glyph: "止",
    color: "barricade",
    players: "1–2 Players",
    rules: [
      "Move one square toward the opposite edge, or place one wall.",
      "Walls span two gaps and may never remove every route to a goal.",
      "Jump an adjacent opponent when the square behind them is open.",
    ],
  },
};

function GameMenu({ game, onPlay, onBack }: { game: LibraryGameId; onPlay: (mode: GameMode) => void; onBack: () => void }) {
  const details = GAME_MENUS[game];
  const [selectedMode, setSelectedMode] = useState<GameMode>("solo");

  return (
    <main className="game-menu-shell">
      <header className="game-topbar menu-topbar">
        <button className="back-button" onClick={onBack}>← Games</button>
        <HeaderLogo compact />
        <div className="game-header-actions"><HeaderChatButton inGame /><span className="menu-header-spacer" aria-hidden="true" /></div>
      </header>
      <section className="game-menu">
        <div className="menu-card">
          <button className="menu-close" onClick={onBack} aria-label="Close game menu">×</button>
          <span className={`game-cover menu-game-cover art-${game}`}><i>{details.glyph}</i></span>
          <p className="menu-japanese">{details.japanese}</p>
          <h1>{details.title}</h1>
          <div className="menu-meta"><span>{details.players}</span><span>{details.category}</span></div>
          <div className="mode-picker" aria-label="Choose game mode">
            <button className={selectedMode === "solo" ? "active" : ""} onClick={() => setSelectedMode("solo")}><b>一</b><span>SOLO<small>1 PLAYER</small></span></button>
            <button className={selectedMode === "multi" ? "active" : ""} onClick={() => setSelectedMode("multi")}><b>対</b><span>VERSUS<small>2 PLAYERS</small></span></button>
          </div>
          <div className="menu-rules">
            <h2>How to play <span>遊び方</span></h2>
            <ol>{details.rules.map((rule, index) => <li key={rule}><b>{index + 1}</b><span>{rule}</span></li>)}</ol>
          </div>
          <button className="primary-button menu-start" onClick={() => onPlay(selectedMode)}>{selectedMode === "multi" ? "Open Lobby" : "Start Game"} <span>→</span></button>
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
        <div className="game-header-actions"><HeaderChatButton inGame /><span className="menu-header-spacer" aria-hidden="true" /></div>
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

const GAMES: { id: LibraryGameId; number: string; name: string; japanese: string; meta: string; scoreGame?: PlayableGameId }[] = [
  { id: "codebreaker", number: "01", name: "Codebreaker", japanese: "コードブレイカー", meta: "LOGIC", scoreGame: "codebreaker" },
  { id: "order", number: "02", name: "Order Match", japanese: "並べ替え", meta: "LOGIC", scoreGame: "order" },
  { id: "number", number: "03", name: "Number Hunt", japanese: "数字探し", meta: "QUICK", scoreGame: "number" },
  { id: "memory", number: "04", name: "Memory Flip", japanese: "記憶", meta: "MEMORY", scoreGame: "memory" },
  { id: "tictactoe", number: "05", name: "Tic Tac Toe", japanese: "三目並べ", meta: "STRATEGY", scoreGame: "tictactoe" },
  { id: "connect4", number: "06", name: "Connect Four", japanese: "四目並べ", meta: "STRATEGY", scoreGame: "connect4" },
  { id: "rps", number: "07", name: "Rock Paper Scissors", japanese: "じゃんけん", meta: "QUICK", scoreGame: "rps" },
  { id: "dice", number: "08", name: "Dice Race", japanese: "サイコロ競走", meta: "LUCK", scoreGame: "dice" },
  { id: "barricade", number: "09", name: "Barricade", japanese: "バリケード", meta: "STRATEGY", scoreGame: "barricade" },
];

const SCORE_GAME_IDS: PlayableGameId[] = ["codebreaker", "order", "number", "memory", "tictactoe", "connect4", "rps", "dice", "barricade"];

function formatScore(game: PlayableGameId, score?: number) {
  if (score == null) return "—";
  const unit = game === "memory" || game === "tictactoe" || game === "connect4" || game === "barricade" ? "moves" : game === "order" ? "checks" : game === "rps" ? "rounds" : game === "dice" ? "rolls" : "guesses";
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
      scoreSeason: SCORE_SEASON,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.set(profileRef, { highScores: { [gameId]: bestScore }, scoreSeason: SCORE_SEASON, avatarId, updatedAt: serverTimestamp() }, { merge: true });
    transaction.set(publicProfileRef, {
      uid: user.uid,
      name: profileName.trim() || user.displayName || "Player One",
      avatarId,
      friendCode: friendCodeFor(user.uid),
      highScores: { [gameId]: bestScore },
      scoreSeason: SCORE_SEASON,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

function AvatarGlyph({ avatarId, className = "" }: { avatarId: AvatarId; className?: string }) {
  const avatar = AVATARS.find((option) => option.id === avatarId) ?? AVATARS[0];
  return <span className={`${className} avatar-style-${avatar.id} ${avatar.premium ? "avatar-premium" : ""}`} aria-hidden="true">{avatar.glyph && <b className="avatar-mark">{avatar.glyph}</b>}</span>;
}

function PlayerAvatar({ small = false, avatarId }: { small?: boolean; avatarId: AvatarId }) {
  return <AvatarGlyph avatarId={avatarId} className={`player-avatar ${small ? "avatar-small" : ""}`} />;
}

function HeaderLogo({ compact = false }: { compact?: boolean }) {
  return <span className={`header-title-logo ${compact ? "game-header-logo" : ""}`} role="img" aria-label="Game Garden" />;
}

function FriendsChat({
  user,
  profileName,
  avatarId,
  friends,
  open,
  selectedUid,
  onClose,
  onSelectFriend,
  onUnreadCountChange,
}: {
  user: User | null;
  profileName: string;
  avatarId: AvatarId;
  friends: FriendEntry[];
  open: boolean;
  selectedUid: string | null;
  onClose: () => void;
  onSelectFriend: (uid: string | null) => void;
  onUnreadCountChange: (count: number) => void;
}) {
  const [chats, setChats] = useState<DirectChatSummary[]>([]);
  const [messageThread, setMessageThread] = useState<{ id: string; messages: DirectMessage[] }>({ id: "", messages: EMPTY_DIRECT_MESSAGES });
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || user.isAnonymous) return;
    return onSnapshot(
      query(collection(db, "directChats"), where("participants", "array-contains", user.uid)),
      (snapshot) => setChats(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as DirectChatSummary))),
      () => setChatError("Chat is temporarily unavailable."),
    );
  }, [user]);

  useEffect(() => {
    const unreadCount = user && !user.isAnonymous
      ? chats.filter((chat) => chat.unreadBy?.[user.uid] === true).length
      : 0;
    onUnreadCountChange(unreadCount);
  }, [chats, onUnreadCountChange, user]);

  const peers = useMemo(() => {
    const entries = new Map<string, FriendEntry>();
    friends.forEach((friend) => entries.set(friend.uid, friend));
    if (user) {
      chats.forEach((chat) => {
        const peerUid = chat.userA === user.uid ? chat.userB : chat.userA;
        if (entries.has(peerUid)) return;
        const peerIsA = chat.userA === peerUid;
        entries.set(peerUid, {
          uid: peerUid,
          name: peerIsA ? chat.userAName : chat.userBName,
          avatarId: isAvatarId(peerIsA ? chat.userAAvatar : chat.userBAvatar) ? (peerIsA ? chat.userAAvatar : chat.userBAvatar) : "play",
          isOnline: false,
        });
      });
    }
    return [...entries.values()].sort((left, right) => {
      if (Boolean(left.isOnline) !== Boolean(right.isOnline)) return left.isOnline ? -1 : 1;
      const leftChat = user ? chats.find((chat) => chat.id === directChatId(user.uid, left.uid)) : undefined;
      const rightChat = user ? chats.find((chat) => chat.id === directChatId(user.uid, right.uid)) : undefined;
      const recentDifference = (rightChat?.lastMessageAt?.toMillis() ?? 0) - (leftChat?.lastMessageAt?.toMillis() ?? 0);
      return recentDifference || left.name.localeCompare(right.name);
    });
  }, [chats, friends, user]);

  const selectedPeer = peers.find((peer) => peer.uid === selectedUid) ?? null;
  const activeChatId = user && selectedPeer ? directChatId(user.uid, selectedPeer.uid) : "";
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const visiblePeers = peers.filter((peer) => peer.name.toLowerCase().includes(search.trim().toLowerCase()));
  const threadMessages = messageThread.id === activeChatId ? messageThread.messages : EMPTY_DIRECT_MESSAGES;

  useEffect(() => {
    if (!user || user.isAnonymous || !open || !activeChatId || !activeChat) return;
    return onSnapshot(
      query(collection(db, "directChats", activeChatId, "messages"), orderBy("sentAt", "asc"), limitToLast(100)),
      (snapshot) => {
        setMessageThread({ id: activeChatId, messages: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as DirectMessage)) });
      },
      () => setChatError("Could not load this conversation."),
    );
  }, [activeChat, activeChatId, open, user]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [threadMessages]);

  useEffect(() => {
    if (!user || !open || !activeChatId || activeChat?.unreadBy?.[user.uid] !== true) return;
    void updateDoc(doc(db, "directChats", activeChatId), {
      [`unreadBy.${user.uid}`]: false,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }, [activeChat?.unreadBy, activeChatId, open, user]);

  const sendMessage = async () => {
    if (!user || user.isAnonymous || !selectedPeer || sending) return;
    const text = draft.trim().slice(0, 500);
    if (!text) return;
    setSending(true);
    setChatError("");
    try {
      const [userA, userB] = [user.uid, selectedPeer.uid].sort((left, right) => left.localeCompare(right));
      const currentName = (profileName.trim() || user.displayName || "Player One").slice(0, 18);
      const currentIsA = userA === user.uid;
      const chatRef = doc(db, "directChats", directChatId(user.uid, selectedPeer.uid));
      const messageRef = doc(collection(chatRef, "messages"));
      const batch = writeBatch(db);
      batch.set(chatRef, {
        userA,
        userB,
        participants: [userA, userB],
        userAName: currentIsA ? currentName : selectedPeer.name.slice(0, 18),
        userAAvatar: currentIsA ? avatarId : selectedPeer.avatarId,
        userBName: currentIsA ? selectedPeer.name.slice(0, 18) : currentName,
        userBAvatar: currentIsA ? selectedPeer.avatarId : avatarId,
        lastMessage: text,
        lastSenderUid: user.uid,
        lastMessageAt: serverTimestamp(),
        unreadBy: { [user.uid]: false, [selectedPeer.uid]: true },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.set(messageRef, {
        senderUid: user.uid,
        senderName: currentName,
        senderAvatar: avatarId,
        text,
        sentAt: serverTimestamp(),
      });
      await batch.commit();
      setDraft("");
    } catch {
      setChatError("That message did not send. Try again.");
    } finally {
      setSending(false);
    }
  };

  if (!user || user.isAnonymous || !open) return null;

  return (
    <aside className="friends-chat" aria-label="Friends chat">
      <div className="chat-window" role="dialog" aria-label="Direct friends chat">
        <header className="chat-window-header">
          {selectedPeer ? (
            <>
              <button className="chat-back" onClick={() => onSelectFriend(null)} aria-label="Back to conversations">←</button>
              <span className="chat-peer-avatar"><AvatarGlyph avatarId={selectedPeer.avatarId} className="chat-avatar" /><i className={selectedPeer.isOnline ? "online" : ""} /></span>
              <div><strong>{selectedPeer.name}</strong><small>{friendPresenceLabel(selectedPeer)}</small></div>
            </>
          ) : <div className="chat-title"><span>話</span><div><strong>Friends chat</strong><small>フレンドチャット</small></div></div>}
          <button className="chat-close" onClick={onClose} aria-label="Close friends chat">×</button>
        </header>

        {!selectedPeer ? (
          <div className="chat-inbox">
            <div className="chat-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search friends" aria-label="Search friends to chat" /></div>
            <div className="chat-inbox-label"><span>DIRECT MESSAGES</span><b>{peers.filter((peer) => peer.isOnline).length} ONLINE</b></div>
            <div className="chat-peer-list">
              {visiblePeers.map((peer) => {
                const summary = chats.find((chat) => chat.id === directChatId(user.uid, peer.uid));
                const unread = summary?.unreadBy?.[user.uid] === true;
                return (
                  <button className={`chat-peer-row ${unread ? "unread" : ""}`} key={peer.uid} onClick={() => onSelectFriend(peer.uid)}>
                    <span className="chat-peer-avatar"><AvatarGlyph avatarId={peer.avatarId} className="chat-avatar" /><i className={peer.isOnline ? "online" : ""} /></span>
                    <span><strong>{peer.name}</strong><small>{summary?.lastMessage || friendPresenceLabel(peer)}</small></span>
                    {unread ? <b>NEW</b> : <time>{summary?.lastMessageAt?.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || ""}</time>}
                  </button>
                );
              })}
              {!visiblePeers.length && <p className="chat-empty">No friends found. Add someone from the Friends screen.</p>}
            </div>
          </div>
        ) : (
          <>
            <div className="chat-messages" aria-live="polite">
              {!threadMessages.length && <div className="chat-start"><span>話</span><strong>Start a conversation</strong><p>Messages are only visible to you and {selectedPeer.name}.</p></div>}
              {threadMessages.map((message) => {
                const mine = message.senderUid === user.uid;
                return <div className={`chat-message ${mine ? "mine" : "theirs"}`} key={message.id}><p>{message.text}</p><small>{message.sentAt?.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>;
              })}
              <div ref={messageEndRef} />
            </div>
            {chatError && <p className="chat-error" role="alert">{chatError}</p>}
            <div className="chat-compose">
              <textarea value={draft} maxLength={500} rows={1} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={`Message ${selectedPeer.name}`} aria-label={`Message ${selectedPeer.name}`} />
              <button onClick={() => void sendMessage()} disabled={!draft.trim() || sending} aria-label="Send message">送</button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
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
  onResetScores,
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
  incomingFriendRequests,
  outgoingFriendRequests,
  onRespondFriendRequest,
  onCancelFriendRequest,
  incomingInvites,
  outgoingInvites,
  onSendInvite,
  onRespondInvite,
  onCancelInvite,
  onCloseInvite,
  onJoinLobby,
  onOpenChat,
  premiumUnlocked,
  onUnlockPremium,
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
  onResetScores: () => Promise<string>;
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
  incomingFriendRequests: FriendRequest[];
  outgoingFriendRequests: FriendRequest[];
  onRespondFriendRequest: (request: FriendRequest, response: "accepted" | "declined") => Promise<void>;
  onCancelFriendRequest: (request: FriendRequest) => Promise<void>;
  incomingInvites: GameInvite[];
  outgoingInvites: GameInvite[];
  onSendInvite: (friend: FriendEntry, gameId: PlayableGameId) => Promise<string>;
  onRespondInvite: (invite: GameInvite, response: "accepted" | "declined") => Promise<void>;
  onCancelInvite: (invite: GameInvite) => Promise<void>;
  onCloseInvite: (invite: GameInvite) => Promise<void>;
  onJoinLobby: (gameId: PlayableGameId, roomCode?: string) => void;
  onOpenChat: (friend: FriendEntry) => void;
  premiumUnlocked: boolean;
  onUnlockPremium: (code: string) => Promise<string>;
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
  const [friendSearch, setFriendSearch] = useState("");
  const [selectedFriend, setSelectedFriend] = useState<FriendEntry | null>(null);
  const [premiumCode, setPremiumCode] = useState("");
  const [premiumMessage, setPremiumMessage] = useState("");
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const activeRanks = leaderboards[rankGame] ?? [];
  const liveIncoming = incomingInvites.filter(inviteIsLive);
  const socialNoticeCount = liveIncoming.length + incomingFriendRequests.length;
  const liveOutgoing = outgoingInvites.filter(inviteIsLive);
  const readyInvites = [...incomingInvites, ...outgoingInvites].filter((invite, index, all) => invite.status === "accepted" && all.findIndex((item) => item.id === invite.id) === index);
  const currentHeader = HEADER_META[activeTab];
  const onlineFriends = friends.filter((friend) => friend.isOnline);
  const displayedFriends = [...friends]
    .filter((friend) => friend.name.toLowerCase().includes(friendSearch.trim().toLowerCase()))
    .sort((left, right) => Number(Boolean(right.isOnline)) - Number(Boolean(left.isOnline)) || left.name.localeCompare(right.name));

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [profileMenuOpen]);

  const chooseProfileMenu = (tab: AppTab, showInvites = false) => {
    setProfileMenuOpen(false);
    onTabChange(tab);
    if (showInvites) window.setTimeout(() => document.getElementById("game-invites")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const submitPremiumCode = async () => {
    setPremiumBusy(true);
    setPremiumMessage("");
    try {
      const message = await onUnlockPremium(premiumCode);
      setPremiumMessage(message);
      if (message.startsWith("Premium unlocked")) setPremiumCode("");
    } finally {
      setPremiumBusy(false);
    }
  };

  const submitFriend = async () => {
    setFriendBusy(true);
    setFriendMessage("");
    try {
      const message = await onAddFriend(friendInput);
      setFriendMessage(message);
      if (message.includes("request sent")) {
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
          {socialNoticeCount > 0 && <button className="header-invites" onClick={() => onTabChange("friends")} aria-label={`${socialNoticeCount} pending social alerts`}><b>招</b><span>{socialNoticeCount}</span></button>}
          <button className="theme-toggle" onClick={onThemeToggle} aria-label="Change color mode" aria-pressed={theme === "sakura"}><span>MODE</span></button>
          <HeaderChatButton />
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button className="header-profile" onClick={() => setProfileMenuOpen((open) => !open)} aria-label="Open account menu" aria-haspopup="menu" aria-expanded={profileMenuOpen}>
              <PlayerAvatar small avatarId={avatarId} />
            </button>
            {profileMenuOpen && <div className="profile-dropdown" role="menu" aria-label="Account menu">
              <button role="menuitem" onClick={() => chooseProfileMenu("profile")}><b>人</b><span>Profile</span></button>
              <button role="menuitem" onClick={() => chooseProfileMenu("leaderboard")}><b>冠</b><span>Leaderboard</span></button>
              <button role="menuitem" onClick={() => chooseProfileMenu("friends")}><b>友</b><span>Friends</span></button>
              <button role="menuitem" onClick={() => chooseProfileMenu("friends", true)}><b>招</b><span>Invites</span>{socialNoticeCount > 0 && <em>{socialNoticeCount}</em>}</button>
            </div>}
          </div>
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
                  <span className={`game-cover art-${game.id}`}><i>{game.number}</i></span>
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
              <button className="profile-avatar-button" onClick={() => setAvatarPickerOpen(true)} aria-label="Change profile picture">
                <PlayerAvatar avatarId={avatarId} />
                <span className="profile-avatar-label">CHANGE PICTURE</span>
                <small>画像を変更</small>
              </button>
              <p>PLAYER PROFILE <span>プロフィール</span></p>
              {avatarPickerOpen && (
                <div className="avatar-picker-backdrop" onMouseDown={() => setAvatarPickerOpen(false)}>
                  <section className="avatar-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-picker-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setAvatarPickerOpen(false); }}>
                    <div className="avatar-picker-heading"><div><small>PLAYER ICON · アイコン</small><h2 id="avatar-picker-title">Choose your picture</h2></div><button autoFocus onClick={() => setAvatarPickerOpen(false)} aria-label="Close profile picture chooser">×</button></div>
                    <div className="avatar-collection-label"><span>CLASSIC COLLECTION</span><small>スタンダード</small></div>
                    <div className="avatar-picker classic-avatar-picker" role="group" aria-label="Choose a profile picture">
                      {AVATARS.filter((avatar) => !avatar.premium).map((avatar) => (
                        <button key={avatar.id} className={avatarId === avatar.id ? "selected" : ""} onClick={() => { onAvatarChange(avatar.id); setAvatarPickerOpen(false); }} aria-label={`${avatar.label} profile picture`} aria-pressed={avatarId === avatar.id}>
                          <AvatarGlyph avatarId={avatar.id} className="avatar-option" />
                        </button>
                      ))}
                    </div>
                    <div className="avatar-collection-label premium-collection-label"><span>✦ PREMIUM COLLECTION</span><small>{premiumUnlocked ? "伝説のアバター" : "ACCOUNT ACCESS REQUIRED"}</small></div>
                    <div className={`avatar-picker premium-avatar-picker ${premiumUnlocked ? "" : "locked"}`} role="group" aria-label="Choose a premium profile picture">
                      {AVATARS.filter((avatar) => avatar.premium).map((avatar) => (
                        <button key={avatar.id} className={`${avatarId === avatar.id ? "selected" : ""} ${premiumUnlocked ? "" : "locked"}`} onClick={() => { onAvatarChange(avatar.id); setAvatarPickerOpen(false); }} aria-label={`${avatar.label} premium profile picture${premiumUnlocked ? "" : ", locked"}`} aria-pressed={avatarId === avatar.id} disabled={!premiumUnlocked}>
                          <AvatarGlyph avatarId={avatar.id} className="avatar-option" />
                        </button>
                      ))}
                    </div>
                    {!premiumUnlocked && <p className="avatar-picker-lock-note">Enter your access code in the Store to unlock the legendary collection.</p>}
                  </section>
                </div>
              )}
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
            <details className="profile-stats-menu">
              <summary><span><small>PLAYER DATA · プレイヤーデータ</small><strong>Stats &amp; high scores</strong></span><span className="stats-summary-counts"><b>{completedGames}</b> BESTS <b>{GAMES.length}</b> GAMES</span><i>⌄</i></summary>
              <div className="profile-stats-dropdown">
                <div className="profile-stats-compact"><div><strong>{completedGames}</strong><span>HIGH SCORES</span></div><div><strong>{GAMES.length}</strong><span>GAMES</span></div></div>
                <div className="profile-score-dropdown"><h2>Your best <span>自己ベスト</span></h2>{scoredGames.map((game) => <p key={game.id}><span>{game.name}</span><strong>{formatScore(game.scoreGame, highScores[game.scoreGame])}</strong></p>)}</div>
                <button className="reset-scores-button" disabled={resetBusy || completedGames === 0} onClick={() => { if (!window.confirm("Reset every high score for this profile? This cannot be undone.")) return; setResetBusy(true); setResetMessage(""); void onResetScores().then(setResetMessage).finally(() => setResetBusy(false)); }}>{resetBusy ? "Resetting…" : "Reset this profile's scores"}</button>
                {resetMessage && <p className="reset-scores-message" role="status">{resetMessage}</p>}
              </div>
            </details>
          </section>
        )}

        {activeTab === "store" && (
          <section className="app-panel store-panel">
            <div className="app-title"><div><p>DISCOVER</p><h1>Store <span>売店</span></h1></div><strong>店<small>SHOP</small></strong></div>
            <div className="store-hero">
              <div><small>GAME GARDEN COLLECTION</small><h2>Codes, drops &amp; rewards.</h2><p>Redeem account codes here. New avatar sets, events, and featured releases can appear in this space.</p></div>
              <span>庭</span>
            </div>
            <div className="store-grid">
              <div className={`store-code-card ${premiumUnlocked ? "unlocked" : ""}`}>
                <div className="store-card-heading"><span>鍵</span><div><small>REDEEM A CODE</small><strong>{premiumUnlocked ? "Legendary collection active" : "Unlock account rewards"}</strong></div><b>{premiumUnlocked ? "OWNED" : "CODE"}</b></div>
                {firebaseUser && !firebaseUser.isAnonymous ? <div className="store-code-form"><input value={premiumCode} maxLength={12} onChange={(event) => setPremiumCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && premiumCode) void submitPremiumCode(); }} placeholder="ENTER CODE" aria-label="Store access code" autoComplete="off" /><button onClick={() => void submitPremiumCode()} disabled={!premiumCode || premiumBusy}>{premiumBusy ? "Checking…" : "Redeem"}</button></div> : <button className="primary-button store-signin" onClick={() => onTabChange("profile")}>Sign in to redeem</button>}
                {premiumMessage && <p className="store-code-message" role="status">{premiumMessage}</p>}
              </div>
              <div className="store-feature-card">
                <div className="store-avatar-stack">{AVATARS.filter((item) => item.premium).slice(-3).map((item) => <AvatarGlyph key={item.id} avatarId={item.id} className="store-avatar" />)}</div>
                <small>FEATURED COLLECTION</small><strong>Legendary Icons</strong><p>Premium profile pictures stay attached to the account that redeems access.</p>
              </div>
              <div className="store-promo-card"><span>COMING NEXT</span><strong>Seasonal drops</strong><p>Reserved for future Game Garden events and announcements.</p><b>予告</b></div>
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
              <div className="friends-social-hero">
                <div className="social-hero-copy"><span>YOUR SOCIAL GARDEN</span><h2>Play together.<br />Stay connected.</h2><p>See who is around, jump into a match, or message a friend without leaving the hub.</p></div>
                <div className="social-live-count"><span><i /> LIVE NOW</span><strong>{onlineFriends.length}</strong><small>of {friends.length} friends online</small></div>
              </div>
              {(incomingFriendRequests.length > 0 || outgoingFriendRequests.length > 0) && <div className="friend-request-center">
                <div className="friend-request-heading"><span>Friend requests</span><b>{incomingFriendRequests.length} TO REVIEW</b></div>
                {incomingFriendRequests.map((request) => <div className="friend-request-row" key={request.id}><AvatarGlyph avatarId={request.fromAvatar} className="friend-request-avatar" /><div><small>WANTS TO CONNECT</small><strong>{request.fromName}</strong></div><span><button className="primary-button" onClick={() => void onRespondFriendRequest(request, "accepted")}>Accept</button><button className="secondary-button" onClick={() => void onRespondFriendRequest(request, "declined")}>Decline</button></span></div>)}
                {outgoingFriendRequests.map((request) => <div className="friend-request-row outgoing" key={request.id}><AvatarGlyph avatarId={request.toAvatar} className="friend-request-avatar" /><div><small>REQUEST SENT</small><strong>{request.toName}</strong></div><span><em>WAITING</em><button className="secondary-button" onClick={() => void onCancelFriendRequest(request)}>Cancel</button></span></div>)}
              </div>}
              <div className="invite-center" id="game-invites">
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
              <div className="friend-connect-card">
                <div className="friend-connect-code">
                  <span>YOUR FRIEND CODE · 友達コード</span>
                  <strong>{friendCode}</strong>
                  <small>Share your code or send your personal friend link.</small>
                  <div className="friend-link-actions">
                    <button className="friend-share-button" onClick={() => void shareFriendLink()}>Share friend link</button>
                    <button className="friend-copy-button" onClick={() => void copyFriendLink()}>Copy link</button>
                  </div>
                  {shareMessage && <p className="friend-share-message" role="status">{shareMessage}</p>}
                </div>
                <div className="friend-connect-add">
                  <span className="friend-add-glyph">友</span>
                  <label htmlFor="friend-code">ADD A FRIEND <span>友達を追加</span></label>
                  <p>Enter their eight-character code. They must accept before either profile becomes a friend.</p>
                  <div><input id="friend-code" value={friendInput} maxLength={8} onChange={(event) => setFriendInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="FRIEND CODE" /><button className="primary-button" onClick={submitFriend} disabled={friendBusy || friendInput.length !== 8}>{friendBusy ? "Sending…" : "Request"}</button></div>
                  {friendMessage && <p className="friend-add-message" role="status">{friendMessage}</p>}
                </div>
              </div>
              <div className="friend-list">
                <div className="friend-list-heading"><span>Friend list <b>{friends.length}</b></span><span>フレンド</span></div>
                <div className="friend-list-search"><span>⌕</span><input value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder="Search your friends" aria-label="Search your friends" /><b>{onlineFriends.length} ONLINE</b></div>
                {inviteMessage && <p className="invite-message" role="status">{inviteMessage}</p>}
                {displayedFriends.length ? displayedFriends.map((friend) => (
                  <div className={`friend-row ${friend.isOnline ? "is-online" : ""}`} key={friend.uid}>
                    <div className="friend-row-head">
                      <button className="friend-avatar-button" onClick={() => setSelectedFriend(friend)} aria-label={`Open ${friend.name}'s profile`}><span className="friend-avatar-wrap"><AvatarGlyph avatarId={isAvatarId(friend.avatarId) ? friend.avatarId : "play"} className="friend-avatar" /><i className={friend.isOnline ? "online" : ""} /></span></button>
                      <span className="friend-identity"><strong>{friend.name}</strong><small className={friend.isOnline ? "online" : ""}>{friendPresenceLabel(friend)}</small></span>
                      <div className="friend-row-actions"><button className="friend-chat-button" onClick={() => onOpenChat(friend)}><span>話</span> CHAT</button><button className="friend-invite-button" onClick={() => { setInviteTarget((current) => current === friend.uid ? null : friend.uid); setInviteMessage(""); }}>PLAY</button><button className="friend-remove-button" onClick={() => onRemoveFriend(friend.uid)} aria-label={`Remove ${friend.name}`}>×</button></div>
                    </div>
                    {inviteTarget === friend.uid && (
                      <div className="friend-invite-picker">
                        <span>CHOOSE A GAME</span>
                        <div>{scoredGames.map((game) => <button key={game.id} className={inviteGame === game.scoreGame ? "active" : ""} onClick={() => setInviteGame(game.scoreGame)}>{game.name}</button>)}</div>
                        <button className="primary-button" disabled={inviteBusy} onClick={() => void submitInvite(friend)}>{inviteBusy ? "Sending…" : `Invite ${friend.name}`}</button>
                      </div>
                    )}
                  </div>
                )) : <p className="empty-friends">{friends.length ? "No friends match that search." : "No friends added yet."}</p>}
              </div>
              {selectedFriend && <div className="friend-profile-backdrop" onMouseDown={() => setSelectedFriend(null)}><section className="friend-profile-dialog" role="dialog" aria-modal="true" aria-label={`${selectedFriend.name}'s profile`} onMouseDown={(event) => event.stopPropagation()}><button className="friend-profile-close" onClick={() => setSelectedFriend(null)} aria-label="Close friend profile">×</button><AvatarGlyph avatarId={selectedFriend.avatarId} className="friend-profile-avatar" /><small>FRIEND PROFILE</small><h2>{selectedFriend.name}</h2><p className={selectedFriend.isOnline ? "online" : ""}>{friendPresenceLabel(selectedFriend)}</p><div className="friend-profile-actions"><button className="primary-button" onClick={() => { onOpenChat(selectedFriend); setSelectedFriend(null); }}>Message</button><button className="secondary-button" onClick={() => { setInviteTarget(selectedFriend.uid); setSelectedFriend(null); }}>Invite to play</button></div><div className="friend-profile-scores">{scoredGames.map((game) => <div key={game.id}><span>{game.name}</span><b>{formatScore(game.scoreGame, selectedFriend.highScores?.[game.scoreGame])}</b></div>)}</div></section></div>}
            </>}
          </section>
        )}
      </div>

      <nav className="bottom-nav" aria-label="App navigation">
        <button className={activeTab === "games" ? "active" : ""} onClick={() => onTabChange("games")}><b>遊</b><span>Games</span></button>
        <button className={activeTab === "leaderboard" ? "active" : ""} onClick={() => onTabChange("leaderboard")}><b>冠</b><span>Ranks</span></button>
        <button className={activeTab === "friends" ? "active" : ""} onClick={() => onTabChange("friends")}><b>友{socialNoticeCount > 0 && <i className="nav-invite-badge">{socialNoticeCount}</i>}</b><span>Friends</span></button>
        <button className={activeTab === "store" ? "active" : ""} onClick={() => onTabChange("store")}><b>店</b><span>Store</span></button>
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
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequest[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<FriendRequest[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<GameInvite[]>([]);
  const [presenceNow, setPresenceNow] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTargetUid, setChatTargetUid] = useState<string | null>(null);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [premiumUnlocked, setPremiumUnlocked] = useState(false);
  const authLoadId = useRef(0);

  useEffect(() => {
    const onPopState = () => setGame((window.location.hash.slice(1) as GameId) || "games");
    onPopState();
    const restoreTimer = window.setTimeout(() => {
      try {
        const savedTheme = window.localStorage.getItem("game-garden-theme");
        const legacyScores = window.localStorage.getItem("pocket-play-scores");
        const legacyName = window.localStorage.getItem("pocket-play-name");
        const legacyAvatar = window.localStorage.getItem("game-garden-avatar");
        if (legacyScores && !window.localStorage.getItem(playerStorageKey(null, "scores"))) window.localStorage.setItem(playerStorageKey(null, "scores"), legacyScores);
        if (legacyName && !window.localStorage.getItem(playerStorageKey(null, "name"))) window.localStorage.setItem(playerStorageKey(null, "name"), legacyName);
        if (legacyAvatar && !window.localStorage.getItem(playerStorageKey(null, "avatar"))) window.localStorage.setItem(playerStorageKey(null, "avatar"), legacyAvatar);
        window.localStorage.removeItem("pocket-play-scores");
        window.localStorage.removeItem("pocket-play-name");
        window.localStorage.removeItem("game-garden-avatar");
        if (!auth.currentUser) {
          const guestName = window.localStorage.getItem(playerStorageKey(null, "name"));
          const guestAvatar = window.localStorage.getItem(playerStorageKey(null, "avatar"));
          setProfileName(guestName || "Player One");
          setHighScores(storedScores(null));
          if (isAvatarId(guestAvatar) && !isPremiumAvatar(guestAvatar)) setAvatarId(guestAvatar);
        }
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
      const loadId = ++authLoadId.current;
      setFirebaseUser(user);
      setAuthLoading(false);
      setAuthError("");
      setHighScores({});
      setProfileName("Player One");
      setAvatarId("play");
      setPremiumUnlocked(false);
      setFriends([]);
      setFriendProfiles({});
      setIncomingFriendRequests([]);
      setOutgoingFriendRequests([]);
      setIncomingInvites([]);
      setOutgoingInvites([]);
      setActiveRoom(null);
      setChatOpen(false);
      setChatTargetUid(null);
      setChatUnreadCount(0);
      if (!user) {
        const guestName = window.localStorage.getItem(playerStorageKey(null, "name")) || "Player One";
        const guestAvatar = window.localStorage.getItem(playerStorageKey(null, "avatar"));
        setProfileName(guestName);
        setHighScores(storedScores(null));
        if (isAvatarId(guestAvatar) && !isPremiumAvatar(guestAvatar)) setAvatarId(guestAvatar);
        return;
      }

      if (user.isAnonymous) {
        const savedGuestName = window.localStorage.getItem("game-garden-guest-name") || window.localStorage.getItem(playerStorageKey(null, "name")) || `Guest ${user.uid.slice(0, 4).toUpperCase()}`;
        const savedAvatar = window.localStorage.getItem(playerStorageKey(null, "avatar"));
        setProfileName(savedGuestName);
        setHighScores(storedScores(null));
        if (isAvatarId(savedAvatar) && !isPremiumAvatar(savedAvatar)) setAvatarId(savedAvatar);
        return;
      }

      try {
        const profileRef = doc(db, "users", user.uid);
        const profile = await getDoc(profileRef);
        if (authLoadId.current !== loadId || auth.currentUser?.uid !== user.uid) return;
        const data = profile.data();
        const hasPremiumAccess = data?.premiumUnlocked === true;
        const accountName = window.localStorage.getItem(playerStorageKey(user, "name"));
        const cloudName = typeof data?.displayName === "string" ? data.displayName : user.displayName || accountName || "Player One";
        const savedAvatar = window.localStorage.getItem(playerStorageKey(user, "avatar"));
        const avatarCandidate: AvatarId = isAvatarId(data?.avatarId) ? data.avatarId : isAvatarId(savedAvatar) ? savedAvatar : "play";
        const cloudAvatar: AvatarId = isPremiumAvatar(avatarCandidate) && !hasPremiumAccess ? "play" : avatarCandidate;
        const cloudScores = data?.scoreSeason === SCORE_SEASON && data?.highScores && typeof data.highScores === "object" ? data.highScores as HighScores : {};
        if (authLoadId.current !== loadId || auth.currentUser?.uid !== user.uid) return;
        setProfileName(cloudName);
        setAvatarId(cloudAvatar);
        setPremiumUnlocked(hasPremiumAccess);
        setHighScores(cloudScores);
        window.localStorage.setItem(playerStorageKey(user, "name"), cloudName);
        window.localStorage.removeItem(playerStorageKey(user, "scores"));
        window.localStorage.setItem(playerStorageKey(user, "avatar"), cloudAvatar);
        await setDoc(profileRef, {
          uid: user.uid,
          displayName: cloudName,
          photoURL: user.photoURL || "",
          avatarId: cloudAvatar,
          highScores: cloudScores,
          scoreSeason: SCORE_SEASON,
          premiumUnlocked: hasPremiumAccess,
          updatedAt: serverTimestamp(),
          ...(profile.exists() ? {} : { createdAt: serverTimestamp() }),
        }, { merge: true });
        await syncPublicProfile(user, cloudName, cloudAvatar, cloudScores);
      } catch (error) {
        if (authLoadId.current !== loadId || auth.currentUser?.uid !== user.uid) return;
        setAuthError(error instanceof Error ? error.message : "Could not load the cloud profile.");
      }
    });
  }, []);

  useEffect(() => {
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    const profileRef = doc(db, "publicProfiles", firebaseUser.uid);
    const updatePresence = (online: boolean) => updateDoc(profileRef, {
      online,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
    const onVisibilityChange = () => void updatePresence(document.visibilityState === "visible");
    void updatePresence(document.visibilityState === "visible");
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") void updatePresence(true);
    }, 45_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void updatePresence(false);
    };
  }, [firebaseUser]);

  useEffect(() => {
    const clock = window.setInterval(() => setPresenceNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    return onSnapshot(collection(db, "users", firebaseUser.uid, "friends"), (snapshot) => {
      setFriends(snapshot.docs.map((friend) => friend.data() as FriendEntry).sort((a, b) => a.name.localeCompare(b.name)));
    }, () => setAuthError("Could not load the friend list."));
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    const newestFirst = (left: FriendRequest, right: FriendRequest) => (right.updatedAt?.toMillis() ?? 0) - (left.updatedAt?.toMillis() ?? 0);
    const incoming = onSnapshot(query(collection(db, "friendRequests"), where("toUid", "==", firebaseUser.uid)), (snapshot) => {
      setIncomingFriendRequests(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as FriendRequest)).filter((item) => item.status === "pending").sort(newestFirst));
    }, () => setAuthError("Could not load friend requests."));
    const outgoing = onSnapshot(query(collection(db, "friendRequests"), where("fromUid", "==", firebaseUser.uid)), (snapshot) => {
      setOutgoingFriendRequests(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as FriendRequest)).filter((item) => item.status === "pending").sort(newestFirst));
    }, () => setAuthError("Could not load sent friend requests."));
    return () => {
      incoming();
      outgoing();
    };
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
      if (isParticipant && nextRoom.status === "playing") {
        setGameMode("multi");
        setGame(nextRoom.gameId);
        window.location.hash = nextRoom.gameId;
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
          highScores: data.scoreSeason === SCORE_SEASON && data.highScores && typeof data.highScores === "object" ? data.highScores as HighScores : {},
          online: data.online === true,
          lastActiveAt: data.lastActiveAt instanceof Timestamp ? data.lastActiveAt : undefined,
        },
      }));
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [friends]);

  useEffect(() => {
    const unsubscribers = SCORE_GAME_IDS.map((gameId) => onSnapshot(
      query(collection(db, "leaderboards", gameId, "entries"), orderBy("score", "asc"), limit(10)),
      (snapshot) => setLeaderboards((previous) => ({ ...previous, [gameId]: snapshot.docs.map((entry) => entry.data()).filter((entry) => entry.scoreSeason === SCORE_SEASON) as LeaderboardEntry[] })),
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
      if (!firebaseUser || firebaseUser.isAnonymous) {
        try { window.localStorage.setItem(playerStorageKey(null, "scores"), JSON.stringify(next)); } catch { /* Device storage may be unavailable. */ }
      }
      return next;
    });
    if (firebaseUser && !firebaseUser.isAnonymous) void saveCloudScore(firebaseUser, gameId, score, profileName, avatarId).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not save the score online."));
  }, [firebaseUser, profileName, avatarId]);

  const updateProfileName = useCallback((name: string) => {
    setProfileName(name);
    try { window.localStorage.setItem(playerStorageKey(firebaseUser, "name"), name); } catch { /* Device storage may be unavailable. */ }
  }, [firebaseUser]);

  const updateAvatar = useCallback((nextAvatar: AvatarId) => {
    if (isPremiumAvatar(nextAvatar) && !premiumUnlocked) {
      setAuthError("Enter a premium access code before choosing a legendary avatar.");
      return;
    }
    setAvatarId(nextAvatar);
    try { window.localStorage.setItem(playerStorageKey(firebaseUser, "avatar"), nextAvatar); } catch { /* Device storage may be unavailable. */ }
  }, [firebaseUser, premiumUnlocked]);

  const unlockPremium = useCallback(async (rawCode: string) => {
    if (!firebaseUser || firebaseUser.isAnonymous) return "Sign in before unlocking premium access.";
    if (rawCode.trim().toUpperCase() !== PREMIUM_ACCESS_CODE) return "That premium code is not valid.";
    try {
      await setDoc(doc(db, "users", firebaseUser.uid), {
        premiumUnlocked: true,
        premiumUnlockedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setPremiumUnlocked(true);
      setAuthError("");
      return "Premium unlocked for this account.";
    } catch {
      return "Could not unlock premium access. Try again.";
    }
  }, [firebaseUser]);

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
    const savedAvatar = isPremiumAvatar(avatarId) && !premiumUnlocked ? "play" : avatarId;
    setProfileName(displayName);
    setAuthError("");
    try {
      await setDoc(doc(db, "users", firebaseUser.uid), {
        uid: firebaseUser.uid,
        displayName,
        photoURL: firebaseUser.photoURL || "",
        avatarId: savedAvatar,
        premiumUnlocked,
        highScores,
        scoreSeason: SCORE_SEASON,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await syncPublicProfile(firebaseUser, displayName, savedAvatar, highScores);
      await updateProfile(firebaseUser, { displayName });
      const batch = writeBatch(db);
      for (const [gameId, score] of Object.entries(highScores) as [PlayableGameId, number][]) {
        batch.set(doc(db, "leaderboards", gameId, "entries", firebaseUser.uid), {
          uid: firebaseUser.uid,
          name: displayName,
          photoURL: "",
          avatarId: savedAvatar,
          score,
          scoreSeason: SCORE_SEASON,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      window.localStorage.setItem(playerStorageKey(firebaseUser, "name"), displayName);
      setAvatarId(savedAvatar);
      window.localStorage.setItem(playerStorageKey(firebaseUser, "avatar"), savedAvatar);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not save the profile.");
    }
  }, [firebaseUser, highScores, profileName, avatarId, premiumUnlocked]);

  const resetScores = useCallback(async () => {
    const user = firebaseUser;
    setAuthError("");
    try {
      if (user && !user.isAnonymous) {
        const batch = writeBatch(db);
        for (const gameId of SCORE_GAME_IDS) batch.delete(doc(db, "leaderboards", gameId, "entries", user.uid));
        batch.set(doc(db, "users", user.uid), { highScores: {}, scoreSeason: SCORE_SEASON, updatedAt: serverTimestamp() }, { merge: true });
        batch.set(doc(db, "publicProfiles", user.uid), { highScores: {}, scoreSeason: SCORE_SEASON, updatedAt: serverTimestamp() }, { merge: true });
        await batch.commit();
      }
      window.localStorage.removeItem(playerStorageKey(user, "scores"));
      setHighScores({});
      return user && !user.isAnonymous ? "This account's scores were reset." : "Guest scores were reset.";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reset these scores.";
      setAuthError(message);
      return message;
    }
  }, [firebaseUser]);

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
        highScores: {},
        scoreSeason: SCORE_SEASON,
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
    const user = auth.currentUser;
    const finish = () => signOut(auth).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not sign out."));
    if (!user || user.isAnonymous) {
      void finish();
      return;
    }
    void updateDoc(doc(db, "publicProfiles", user.uid), { online: false, lastActiveAt: serverTimestamp(), updatedAt: serverTimestamp() })
      .catch(() => undefined)
      .finally(() => void finish());
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
      if ((await getDoc(doc(db, "users", firebaseUser.uid, "friends", friendUid))).exists()) return `${friendName} is already your friend.`;
      const reverse = await getDoc(doc(db, "friendRequests", friendRequestId(friendUid, firebaseUser.uid)));
      if (reverse.exists() && reverse.data().status === "pending") return `${friendName} already sent you a request. Accept it above.`;
      const requestId = friendRequestId(firebaseUser.uid, friendUid);
      await setDoc(doc(db, "friendRequests", requestId), {
        fromUid: firebaseUser.uid,
        fromName: (profileName.trim() || firebaseUser.displayName || "Player One").slice(0, 18),
        fromAvatar: avatarId,
        toUid: friendUid,
        toName: friendName,
        toAvatar: friendAvatar,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return `Friend request sent to ${friendName}.`;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not add that friend.");
      return "Could not add that friend.";
    }
  }, [avatarId, firebaseUser, profileName]);

  const removeFriend = useCallback((friendUid: string) => {
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    void (async () => {
      try {
        const [forward, reverse] = await Promise.all([
          getDoc(doc(db, "friendRequests", friendRequestId(firebaseUser.uid, friendUid))),
          getDoc(doc(db, "friendRequests", friendRequestId(friendUid, firebaseUser.uid))),
        ]);
        const accepted = (forward.exists() && forward.data().status === "accepted") || (reverse.exists() && reverse.data().status === "accepted");
        if (!accepted) {
          await deleteDoc(doc(db, "users", firebaseUser.uid, "friends", friendUid));
          return;
        }
        const batch = writeBatch(db);
        batch.delete(doc(db, "users", firebaseUser.uid, "friends", friendUid));
        batch.delete(doc(db, "users", friendUid, "friends", firebaseUser.uid));
        await batch.commit();
      } catch {
        setAuthError("Could not remove that friend.");
      }
    })();
  }, [firebaseUser]);

  const respondFriendRequest = useCallback(async (request: FriendRequest, response: "accepted" | "declined") => {
    if (!firebaseUser || firebaseUser.isAnonymous || request.toUid !== firebaseUser.uid) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "friendRequests", request.id), { status: response, updatedAt: serverTimestamp(), respondedAt: serverTimestamp() });
      if (response === "accepted") {
        batch.set(doc(db, "users", firebaseUser.uid, "friends", request.fromUid), { uid: request.fromUid, name: request.fromName, avatarId: request.fromAvatar, addedAt: serverTimestamp() });
        batch.set(doc(db, "users", request.fromUid, "friends", firebaseUser.uid), { uid: firebaseUser.uid, name: profileName.trim() || firebaseUser.displayName || "Player One", avatarId, addedAt: serverTimestamp() });
      }
      await batch.commit();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not update that friend request.");
    }
  }, [avatarId, firebaseUser, profileName]);

  const cancelFriendRequest = useCallback(async (request: FriendRequest) => {
    if (!firebaseUser || firebaseUser.isAnonymous || request.fromUid !== firebaseUser.uid) return;
    try {
      await updateDoc(doc(db, "friendRequests", request.id), { status: "cancelled", updatedAt: serverTimestamp(), respondedAt: serverTimestamp() });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not cancel that friend request.");
    }
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
    if (!user || !activeRoom || activeRoom.hostUid !== user.uid || !activeRoom.guestUid || !activeRoom.guestName) {
      setAuthError("The host can start after both online players are ready.");
      return;
    }
    const batch = writeBatch(db);
    if (gameId === "number") {
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
    } else {
      batch.set(doc(db, "rooms", activeRoom.code, "game", "state"), {
        ...makeOnlineGameState(gameId as OnlineGameId, activeRoom),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
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
            {
              const batch = writeBatch(db);
              batch.delete(doc(db, "rooms", code, "numberHunt", "state"));
              batch.delete(doc(db, "rooms", code, "numberHunt", "secret-1"));
              batch.delete(doc(db, "rooms", code, "numberHunt", "secret-2"));
              batch.delete(doc(db, "rooms", code, "game", "state"));
              batch.delete(roomRef);
              await batch.commit();
            }
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

  const visibleFriends = useMemo(() => friends.map((friend) => {
    const merged = { ...friend, ...friendProfiles[friend.uid], uid: friend.uid };
    return { ...merged, isOnline: friendIsOnline(merged, presenceNow ?? undefined) };
  }), [friends, friendProfiles, presenceNow]);

  const openFriendChat = useCallback((friend: FriendEntry) => {
    setChatTargetUid(friend.uid);
    setChatOpen(true);
  }, []);

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
    if (game === "barricade-menu") return <GameMenu game="barricade" onPlay={(mode) => playFromMenu("barricade", mode)} onBack={() => selectGame("games")} />;
    if (gameMode === "multi" && firebaseUser && activeRoom?.status === "playing" && activeRoom.gameId === game && game !== "number" && SCORE_GAME_IDS.includes(game as PlayableGameId)) return <OnlineVersusGame room={activeRoom as GameRoom & { gameId: OnlineGameId }} user={firebaseUser} onLeave={leaveRoom} />;
    if (game === "codebreaker") return <Codebreaker mode="solo" onBack={() => selectGame("codebreaker-menu")} onScore={(score) => recordScore("codebreaker", score)} />;
    if (game === "order") return <OrderMatch mode="solo" onBack={() => selectGame("order-menu")} onScore={(score) => recordScore("order", score)} />;
    if (game === "number") return gameMode === "multi" && activeRoom?.gameId === "number" && firebaseUser ? <OnlineNumberHunt room={activeRoom} user={firebaseUser} onLeave={leaveRoom} /> : <NumberHunt mode="solo" onBack={() => selectGame("number-menu")} onScore={(score) => recordScore("number", score)} />;
    if (game === "memory") return <MemoryGame mode="solo" onBack={() => selectGame("memory-menu")} onScore={(score) => recordScore("memory", score)} />;
    if (game === "tictactoe") return <TicTacToe mode="solo" onBack={() => selectGame("tictactoe-menu")} onScore={(score) => recordScore("tictactoe", score)} />;
    if (game === "connect4") return <ConnectFour mode="solo" onBack={() => selectGame("connect4-menu")} onScore={(score) => recordScore("connect4", score)} />;
    if (game === "rps") return <RockPaperScissors mode="solo" onBack={() => selectGame("rps-menu")} onScore={(score) => recordScore("rps", score)} />;
    if (game === "dice") return <DiceRace mode="solo" onBack={() => selectGame("dice-menu")} onScore={(score) => recordScore("dice", score)} />;
    if (game === "barricade") return <Barricade mode="solo" onBack={() => selectGame("barricade-menu")} onScore={(score) => recordScore("barricade", score)} />;
    const activeTab: AppTab = game === "leaderboard" || game === "friends" || game === "store" || game === "profile" ? game : "games";
    return <AppHome activeTab={activeTab} theme={theme} onThemeToggle={toggleTheme} onTabChange={selectGame} onSelect={(selected) => selectGame(`${selected}-menu`)} highScores={highScores} profileName={profileName} avatarId={avatarId} onProfileNameChange={updateProfileName} onAvatarChange={updateAvatar} onProfileSave={saveProfile} onResetScores={resetScores} firebaseUser={firebaseUser} authLoading={authLoading} authError={authError} onSignIn={signIn} onEmailSignIn={emailSignIn} onEmailCreate={emailCreate} onSignOut={signOutProfile} leaderboards={leaderboards} friends={visibleFriends} friendCode={firebaseUser && !firebaseUser.isAnonymous ? friendCodeFor(firebaseUser.uid) : ""} friendLinkCode={friendLinkCode} onAddFriend={addFriend} onRemoveFriend={removeFriend} incomingFriendRequests={incomingFriendRequests} outgoingFriendRequests={outgoingFriendRequests} onRespondFriendRequest={respondFriendRequest} onCancelFriendRequest={cancelFriendRequest} incomingInvites={incomingInvites} outgoingInvites={outgoingInvites} onSendInvite={sendInvite} onRespondInvite={respondInvite} onCancelInvite={cancelInvite} onCloseInvite={closeInvite} onJoinLobby={(gameId, inviteRoomCode) => { if (inviteRoomCode) void joinRoom(inviteRoomCode, profileName); else selectGame(`${gameId}-lobby`); }} onOpenChat={openFriendChat} premiumUnlocked={premiumUnlocked} onUnlockPremium={unlockPremium} />;
  }, [game, gameMode, theme, highScores, profileName, avatarId, recordScore, toggleTheme, updateProfileName, updateAvatar, saveProfile, resetScores, firebaseUser, authLoading, authError, signIn, emailSignIn, emailCreate, signOutProfile, leaderboards, visibleFriends, friendLinkCode, addFriend, removeFriend, incomingFriendRequests, outgoingFriendRequests, respondFriendRequest, cancelFriendRequest, incomingInvites, outgoingInvites, activeRoom, roomCode, createRoom, joinRoom, leaveRoom, startVersus, sendInvite, respondInvite, cancelInvite, closeInvite, openFriendChat, premiumUnlocked, unlockPremium]);

  return <ChatChromeProvider enabled={Boolean(firebaseUser && !firebaseUser.isAnonymous)} open={chatOpen} unreadCount={chatUnreadCount} onToggle={() => setChatOpen((current) => !current)}>{view}<FriendsChat key={firebaseUser?.uid ?? "signed-out"} user={firebaseUser} profileName={profileName} avatarId={avatarId} friends={visibleFriends} open={chatOpen} selectedUid={chatTargetUid} onClose={() => setChatOpen(false)} onSelectFriend={setChatTargetUid} onUnreadCountChange={setChatUnreadCount} /></ChatChromeProvider>;
}
