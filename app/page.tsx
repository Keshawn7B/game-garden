"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUserWithEmailAndPassword, getRedirectResult, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type User } from "firebase/auth";
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, limitToLast, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type DocumentSnapshot } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";
import { ChatChromeProvider, HeaderChatButton } from "./chat-chrome";
import { makeOnlineGameState, OnlineVersusGame, type OnlineGameId } from "./online-games";
import { BarricadeDragPiece, type BarricadeDragKind } from "./barricade-drag";
import { CHECKERS_START, applyCheckersMove, checkersLegalMoves, checkersPieceCount, checkersPieceOwner, checkersWinner, chooseCheckersCpuTurn, type CheckersMove, type CheckersPlayer } from "./checkers";
import { Battleship } from "./battleship-game";
import { DotsAndBoxes } from "./dots-boxes-game";
import { GameResult } from "./game-result";
import { AirHockey } from "./air-hockey-game";
import { Game2048 } from "./game-2048";
import { WordGarden } from "./word-garden-game";
import { Blackjack } from "./blackjack-game";
import { Queens } from "./queens-game";
import { GraphWar } from "./graph-war-game";

type PlayableGameId = "codebreaker" | "order" | "number" | "memory" | "tictactoe" | "connect4" | "rps" | "dice" | "barricade" | "checkers" | "battleship" | "dotsboxes" | "airhockey" | "2048" | "wordgarden" | "blackjack" | "queens";
type LibraryGameId = PlayableGameId | "graphwar";
type AppTab = "games" | "leaderboard" | "friends" | "store" | "profile" | "addons";
type ThemeMode = "classic" | "sakura" | "gold";
type GameMode = "solo" | "multi";
type BannerId = "torii" | "sakura-moon" | "koi-current" | "golden-crane";
type GameId = AppTab | LibraryGameId | `${LibraryGameId}-menu` | `${PlayableGameId}-lobby`;
type ColorId = "coral" | "gold" | "mint" | "blue" | "violet" | "pink";
type AvatarId = "play" | "sakura" | "fox" | "koi" | "moon" | "crane" | "dragon" | "cat" | "ninja" | "sun" | "pink-blossom" | "pink-heart" | "pink-bunny" | "pink-fan" | "pink-peach" | "premium-shogun" | "premium-kitsune" | "premium-empress" | "premium-dragon" | "premium-koi" | "premium-ronin" | "premium-cat" | "premium-blossom" | "premium-dual-swords";
type HighScores = Partial<Record<PlayableGameId, number>>;
type LeaderboardEntry = { uid: string; name: string; photoURL: string; avatarId?: AvatarId; bannerId?: BannerId; score: number };
type Leaderboards = Partial<Record<PlayableGameId, LeaderboardEntry[]>>;
type FriendEntry = { uid: string; name: string; avatarId: AvatarId; bannerId?: BannerId; highScores?: HighScores; online?: boolean; lastActiveAt?: Timestamp; isOnline?: boolean };
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
  userAClearedAt?: Timestamp;
  userBClearedAt?: Timestamp;
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
  hostBanner: BannerId;
  guestUid?: string;
  guestName?: string;
  guestAvatar?: AvatarId;
  guestBanner?: BannerId;
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
const GOLD_MODE_ACCESS_CODE = "GOLD";
const BLOSSOM_THEME_ACCESS_CODE = "BLOSSOM";
const BLOSSOM_ADDON_STORAGE_KEY = "game-garden-blossom-addon";
const SCORE_SEASON = 2;
const HEADER_META: Record<AppTab, { label: string; japanese: string; glyph: string }> = {
  games: { label: "ARCADE", japanese: "ゲーム", glyph: "遊" },
  leaderboard: { label: "RANKS", japanese: "ランキング", glyph: "冠" },
  friends: { label: "SOCIAL", japanese: "フレンド", glyph: "友" },
  store: { label: "STORE", japanese: "売店", glyph: "店" },
  profile: { label: "PLAYER", japanese: "プロフィール", glyph: "人" },
  addons: { label: "ADD-ONS", japanese: "追加", glyph: "花" },
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

const BANNERS: { id: BannerId; label: string; japanese: string }[] = [
  { id: "torii", label: "Crimson Torii", japanese: "赤鳥居" },
  { id: "sakura-moon", label: "Moonlit Sakura", japanese: "月桜" },
  { id: "koi-current", label: "Koi Current", japanese: "錦鯉" },
  { id: "golden-crane", label: "Golden Crane", japanese: "金鶴" },
];
const DEFAULT_BANNER_ID: BannerId = "torii";

function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && AVATARS.some((avatar) => avatar.id === value);
}

function isPremiumAvatar(value: AvatarId) {
  return AVATARS.some((avatar) => avatar.id === value && avatar.premium);
}

function isBannerId(value: unknown): value is BannerId {
  return typeof value === "string" && BANNERS.some((banner) => banner.id === value);
}

function friendCodeFor(uid: string) {
  return uid.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
}

type PlayerStorageField = "scores" | "name" | "avatar" | "banner";

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
      const maximum = gameId === "2048" ? 1_000_000 : 10_000;
      return Number.isInteger(score) && Number(score) >= 1 && Number(score) <= maximum ? [[gameId, Number(score)]] : [];
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
  const random = new Uint32Array(6);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
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

async function syncPublicProfile(user: User, name: string, avatarId: AvatarId, bannerId: BannerId, highScores: HighScores) {
  const friendCode = friendCodeFor(user.uid);
  const batch = writeBatch(db);
  batch.set(doc(db, "publicProfiles", user.uid), {
    uid: user.uid,
    name: name.trim() || user.displayName || "Player One",
    avatarId,
    bannerId,
    friendCode,
    highScores,
    scoreSeason: SCORE_SEASON,
    online: true,
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(db, "friendCodes", friendCode), {
    code: friendCode,
    uid: user.uid,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
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
          <GameResult outcome={won ? mode === "multi" ? `Player ${(winner ?? 0) + 1} Wins!` : "You Win!" : mode === "multi" ? "Draw Game" : "Code Not Cracked"} detail={won ? `Code cracked in ${guesses.length} ${guesses.length === 1 ? "guess" : "guesses"}.` : "The secret slipped away this round."} onPlayAgain={reset} draw={!won && mode === "multi"} neutral={!won && mode === "solo"} />
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
              {!won && !lost && <button className="primary-button" onClick={checkOrder}>Check order</button>}
            </div>
          </div>
        </div>
        {(won || lost) && <GameResult outcome={won ? mode === "multi" ? `Player ${currentPlayer + 1} Wins!` : "You Win!" : "Order Not Matched"} detail={won ? `Matched the hidden order in ${checks.length} ${checks.length === 1 ? "check" : "checks"}.` : "The hidden order was revealed after eight checks."} onPlayAgain={reset} neutral={lost} />}
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
  const matchTitle = playerOneScore === playerTwoScore ? "Draw Match" : `Player ${playerOneScore < playerTwoScore ? 1 : 2} Wins!`;
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
            <div className="number-match-scores"><div className={playerOneScore < playerTwoScore ? "winner" : ""}><small>PLAYER 1</small><strong>{scoreLabel(roundScores[0])}</strong><span>Secret was {roundSecrets[1]}</span></div><b>VS</b><div className={playerTwoScore < playerOneScore ? "winner" : ""}><small>PLAYER 2</small><strong>{scoreLabel(roundScores[1])}</strong><span>Secret was {roundSecrets[0]}</span></div></div>
            <GameResult outcome={matchTitle} detail="Fewest guesses wins. Both secret rounds are shown above." onPlayAgain={reset} draw={playerOneScore === playerTwoScore} />
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
            {mode === "solo" && (won || lost) ? <GameResult outcome={won ? "You Win!" : "Number Not Found"} detail={won ? `Found ${target} in ${history.length} ${history.length === 1 ? "guess" : "guesses"}.` : `The secret number was ${target}.`} onPlayAgain={reset} neutral={!won} /> : <button className="primary-button wide-button" onClick={submit}>Lock in guess</button>}
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
              <div className="number-role-card number-match-card"><div className="number-match-scores"><div className={playerOneScore < playerTwoScore ? "winner" : ""}><small>{room.hostName}</small><strong>{scoreLabel(match.scores[0])}</strong><span>Secret was {match.revealedSecrets[1]}</span></div><b>VS</b><div className={playerTwoScore < playerOneScore ? "winner" : ""}><small>{room.guestName}</small><strong>{scoreLabel(match.scores[1])}</strong><span>Secret was {match.revealedSecrets[0]}</span></div></div><GameResult outcome={playerOneScore === playerTwoScore ? "Draw Match" : `${playerOneScore < playerTwoScore ? room.hostName : room.guestName} Wins!`} detail="Fewest guesses wins. Both secret rounds synchronized live." onPlayAgain={user.uid === room.hostUid ? () => void restartMatch() : undefined} waitingText={`Waiting for ${room.hostName} to play again…`} draw={playerOneScore === playerTwoScore} /></div>
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
        {complete && <GameResult outcome={mode === "multi" ? pairScores[0] === pairScores[1] ? "Draw Game" : `Player ${pairScores[0] > pairScores[1] ? 1 : 2} Wins!` : "You Win!"} detail={mode === "multi" ? `Final score ${pairScores[0]}–${pairScores[1]}.` : `Every pair found in ${moves} moves.`} onPlayAgain={reset} draw={mode === "multi" && pairScores[0] === pairScores[1]} />}
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
        {winner || draw ? <GameResult outcome={winner ? mode === "multi" ? `Player ${winner === "X" ? 1 : 2} Wins!` : winner === "X" ? "You Win!" : "CPU Wins!" : "Draw Game"} detail={winner ? `${winner} completed three in a row.` : "Every square is filled with no winner."} onPlayAgain={reset} draw={draw} /> : <div className="simple-status" role="status"><strong>{mode === "multi" ? `Player ${turn === "X" ? 1 : 2}'s turn` : "You are X"}</strong><span>Tap an open square.</span></div>}
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
        {winner || draw ? <GameResult outcome={winner ? mode === "solo" ? winner.player === 1 ? "You Win!" : "CPU Wins!" : `Player ${winner.player} Wins!` : "Draw Game"} detail={winner ? "Four connected chips decide the round." : "The board filled without a winning line."} onPlayAgain={resetRound} draw={draw} /> : <div className="connect-status" role="status"><span>{cpuThinking ? "思考中" : "あなたの番"}</span><div><strong>{resultTitle}</strong><small>{board.filter((piece) => !piece).length} open spaces</small></div></div>}
      </section>
    </main>
  );
}

function Checkers({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const [board, setBoard] = useState([...CHECKERS_START]);
  const [turn, setTurn] = useState<CheckersPlayer>(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [forcedFrom, setForcedFrom] = useState<number | null>(null);
  const [winner, setWinner] = useState<CheckersPlayer | null>(null);
  const [moves, setMoves] = useState(0);
  const [message, setMessage] = useState("Select a red piece to begin.");
  const [lastMove, setLastMove] = useState<CheckersMove | null>(null);
  const cpuThinking = turn === 1 && winner == null;

  const reset = useCallback(() => {
    setBoard([...CHECKERS_START]);
    setTurn(0);
    setSelected(null);
    setForcedFrom(null);
    setWinner(null);
    setMoves(0);
    setMessage("Select a red piece to begin.");
    setLastMove(null);
  }, []);

  const legalMoves = useMemo(() => winner == null ? checkersLegalMoves(board, turn, forcedFrom) : [], [board, forcedFrom, turn, winner]);
  const selectable = useMemo(() => new Set(legalMoves.map((move) => move.from)), [legalMoves]);
  const destinations = useMemo(() => new Map(legalMoves.filter((move) => move.from === selected).map((move) => [move.to, move])), [legalMoves, selected]);
  const captureRequired = legalMoves.some((move) => move.captured != null);

  const finishPlayerTurn = useCallback((nextBoard: typeof board, nextMoves: number) => {
    const nextWinner = checkersWinner(nextBoard, 1);
    setBoard(nextBoard);
    setSelected(null);
    setForcedFrom(null);
    setMoves(nextMoves);
    if (nextWinner != null) {
      setWinner(nextWinner);
      setMessage("You cleared the board. Victory!");
      onScore(nextMoves);
      return;
    }
    setTurn(1);
    setMessage("CPU is planning its move.");
  }, [onScore]);

  const playPlayerMove = (move: CheckersMove) => {
    if (turn !== 0 || winner != null || cpuThinking) return;
    const applied = applyCheckersMove(board, move);
    setLastMove(move);
    const followUps = move.captured != null && !applied.promoted ? checkersLegalMoves(applied.board, 0, move.to) : [];
    setBoard(applied.board);
    if (followUps.length) {
      setSelected(move.to);
      setForcedFrom(move.to);
      setMessage("Great jump—keep capturing with the same piece.");
      return;
    }
    finishPlayerTurn(applied.board, moves + 1);
  };

  const handleSquare = (index: number) => {
    const destination = destinations.get(index);
    if (destination) return playPlayerMove(destination);
    if (selectable.has(index)) {
      setSelected(index);
      setMessage(captureRequired ? "Capture required. Choose the highlighted landing square." : "Choose a highlighted diagonal square.");
    }
  };

  useEffect(() => {
    if (turn !== 1 || winner != null) return;
    const timer = window.setTimeout(() => {
      const choice = chooseCheckersCpuTurn(board, difficulty);
      if (!choice) {
        setWinner(0);
        setMessage("CPU has no legal move. You win!");
        onScore(moves);
        return;
      }
      const nextMoves = moves + 1;
      const nextWinner = checkersWinner(choice.board, 0);
      setLastMove(choice.moves.at(-1) ?? null);
      setBoard(choice.board);
      setMoves(nextMoves);
      setWinner(nextWinner);
      setTurn(0);
      setMessage(nextWinner === 1 ? "CPU wins this match." : choice.captures > 1 ? `CPU made a ${choice.captures}-piece combo. Your move.` : choice.captures ? "CPU captured a piece. Your move." : "Your move.");
    }, 480);
    return () => window.clearTimeout(timer);
  }, [board, difficulty, moves, onScore, turn, winner]);

  const redPieces = checkersPieceCount(board, 0);
  const blackPieces = checkersPieceCount(board, 1);

  return (
    <main className="game-shell simple-game-shell checkers-game-shell">
      <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><HeaderLogo compact /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={reset} aria-label="Restart Checkers">↻</button></div></header>
      <section className="checkers-game">
        <div className="checkers-heading"><div><p className="eyebrow">STRATEGY · VS CPU · {difficulty.toUpperCase()}</p><h1>Checkers</h1><p>Capture every rival piece or leave the CPU without a legal move.</p></div><span>棋</span></div>
        <CpuDifficultyPicker difficulty={difficulty} onChange={(next) => { setDifficulty(next); reset(); }} gameName="Checkers" />
        <div className="checkers-score-strip" aria-label="Pieces remaining"><div className={turn === 0 && winner == null ? "active" : ""}><i className="red-piece" /><span>YOU</span><strong>{redPieces}<small>PIECES</small></strong></div><b>対<small>{moves} MOVES</small></b><div className={turn === 1 && winner == null ? "active" : ""}><strong>{blackPieces}<small>PIECES</small></strong><span>CPU</span><i className="black-piece" /></div></div>
        <div className="checkers-board" role="grid" aria-label="Checkers board">
          {board.map((piece, index) => {
            const row = Math.floor(index / 8);
            const column = index % 8;
            const playable = (row + column) % 2 === 1;
            const owner = checkersPieceOwner(piece);
            const isKing = piece === "R" || piece === "B";
            const isDestination = destinations.has(index);
            const canSelect = turn === 0 && winner == null && selectable.has(index);
            const isArrival = lastMove?.to === index;
            const moveStyle = isArrival ? { "--move-x": `${(lastMove.from % 8 - column) * 137}%`, "--move-y": `${(Math.floor(lastMove.from / 8) - row) * 137}%` } as React.CSSProperties : undefined;
            return <button type="button" role="gridcell" key={index} className={`${playable ? "dark-square" : "light-square"} ${selected === index ? "selected" : ""} ${isDestination ? "legal-target" : ""} ${canSelect ? "selectable" : ""}`} disabled={turn !== 0 || winner != null || cpuThinking || (!canSelect && !isDestination)} onClick={() => handleSquare(index)} aria-label={`Row ${row + 1}, column ${column + 1}${piece ? `, ${owner === 0 ? "red" : "black"}${isKing ? " king" : " piece"}` : isDestination ? ", legal move" : ", empty"}`}>
              {piece && <span style={moveStyle} className={`checkers-piece ${owner === 0 ? "red" : "black"} ${isKing ? "king" : ""} ${isArrival ? "move-arrival" : ""}`}>{isKing && <b>王</b>}</span>}
              {isDestination && <i className={destinations.get(index)?.captured != null ? "capture-dot" : "move-dot"} />}
              {lastMove?.captured === index && <i className="capture-burst" aria-hidden="true" />}
            </button>;
          })}
        </div>
        {winner != null ? <GameResult outcome={winner === 0 ? "You Win!" : "CPU Wins!"} detail={`${moves} turns played.`} onPlayAgain={reset} /> : <div className="checkers-status" role="status"><span>{captureRequired && turn === 0 ? "取" : cpuThinking ? "考" : "手"}</span><div><strong>{message}</strong><small>{captureRequired && turn === 0 ? "A capture is available and must be taken." : "Red moves upward. Kings move both directions."}</small></div></div>}
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
        {winner != null ? <GameResult outcome={mode === "solo" ? winner === 0 ? "You Win!" : "CPU Wins!" : `Player ${winner + 1} Wins!`} detail="The winning piece reached the end of the track." onPlayAgain={reset} /> : <div className="barricade-controls" role="status"><div><small>{relocating != null ? "MOVE THE BARRICADE" : turn === 0 ? "YOUR MOVE" : "OPPONENT MOVE"}</small><strong>{message}</strong></div>{relocating == null && turn === 0 ? <button className="primary-button barricade-roll" onClick={() => movePawn(0, Math.floor(Math.random() * 6) + 1)}>Roll die</button> : <span className="barricade-wait">{turn === 1 ? "CPU THINKING…" : "CHOOSE A SPACE"}</span>}</div>}
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

type BarricadeCpuAction = { kind: "move"; destination: number } | { kind: "wall"; wall: GridWall };

function barricadeBestReplyPath(position: number, opponent: number, goalRow: number, walls: GridWall[]) {
  const replies = barricadeMoves(position, opponent, walls);
  if (!replies.length) return barricadePathLength(position, goalRow, walls);
  return Math.min(...replies.map((reply) => barricadePathLength(reply, goalRow, walls)));
}

function chooseBarricadeCpuAction(positions: [number, number], walls: GridWall[], cpuWallsLeft: number, difficulty: CpuDifficulty): BarricadeCpuAction {
  const playerPosition = positions[0];
  const cpuPosition = positions[1];
  const cpuMoves = barricadeMoves(cpuPosition, playerPosition, walls);
  const winningMove = cpuMoves.find((move) => Math.floor(move / BARRICADE_SIZE) === 8);
  if (winningMove != null) return { kind: "move", destination: winningMove };

  const bestMove = shortestBarricadeMove(cpuPosition, playerPosition, 8, walls) ?? cpuMoves[0];
  if (bestMove == null || cpuWallsLeft <= 0) return { kind: "move", destination: bestMove ?? cpuPosition };

  const playerPath = barricadePathLength(playerPosition, 0, walls);
  const cpuPath = barricadePathLength(cpuPosition, 8, walls);
  const playerCanWinNext = barricadeMoves(playerPosition, cpuPosition, walls).some((move) => Math.floor(move / BARRICADE_SIZE) === 0);
  const moveReplyPath = barricadeBestReplyPath(playerPosition, bestMove, 0, walls);
  const moveScore = (moveReplyPath - barricadePathLength(bestMove, 8, walls)) * 4;

  const rankedWalls: Array<{ wall: GridWall; score: number; delay: number; blocksWin: boolean }> = [];
  for (let row = 0; row < 8; row += 1) for (let column = 0; column < 8; column += 1) for (const orientation of ["h", "v"] as const) {
    const wall: GridWall = { row, column, orientation, owner: 1 };
    if (!legalBarricadeWall(wall, walls, positions)) continue;
    const nextWalls = [...walls, wall];
    const nextPlayerPath = barricadePathLength(playerPosition, 0, nextWalls);
    const nextCpuPath = barricadePathLength(cpuPosition, 8, nextWalls);
    const delay = nextPlayerPath - playerPath;
    const selfDelay = nextCpuPath - cpuPath;
    const playerWinsAfterWall = barricadeMoves(playerPosition, cpuPosition, nextWalls).some((move) => Math.floor(move / BARRICADE_SIZE) === 0);
    const blocksWin = playerCanWinNext && !playerWinsAfterWall;
    const replyPath = barricadeBestReplyPath(playerPosition, cpuPosition, 0, nextWalls);
    const replyAdvantage = replyPath - nextCpuPath;
    const conservationPenalty = cpuWallsLeft <= 2 ? 2 : cpuWallsLeft <= 4 ? .75 : 0;
    const threatScore = blocksWin ? 120 : playerWinsAfterWall ? -120 : 0;
    rankedWalls.push({ wall, delay, blocksWin, score: threatScore + replyAdvantage * 4 + delay * 6 - selfDelay * 8 - conservationPenalty });
  }
  rankedWalls.sort((left, right) => right.score - left.score);
  const bestWall = rankedWalls[0];
  if (!bestWall) return { kind: "move", destination: bestMove };

  const blockingWall = rankedWalls.find((choice) => choice.blocksWin);
  if (playerCanWinNext && blockingWall && difficulty !== "easy") return { kind: "wall", wall: blockingWall.wall };
  if (difficulty === "easy") {
    const usefulWalls = rankedWalls.filter((choice) => choice.delay > 0 && choice.score > -10).slice(0, 10);
    if (usefulWalls.length && Math.random() < .16) return { kind: "wall", wall: usefulWalls[Math.floor(Math.random() * usefulWalls.length)].wall };
    const destination = Math.random() < .48 ? cpuMoves[Math.floor(Math.random() * cpuMoves.length)] : bestMove;
    return { kind: "move", destination };
  }

  const wallThreshold = difficulty === "hard" ? moveScore + 1 : moveScore + 5;
  const raceIsClose = playerPath <= cpuPath + (difficulty === "hard" ? 3 : 1);
  if (bestWall.delay > 0 && raceIsClose && bestWall.score >= wallThreshold) return { kind: "wall", wall: bestWall.wall };
  return { kind: "move", destination: bestMove };
}

function Barricade({ mode, onBack, onScore }: { mode: GameMode; onBack: () => void; onScore: (score: number) => void }) {
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  const [positions, setPositions] = useState<[number, number]>(BARRICADE_START);
  const [walls, setWalls] = useState<GridWall[]>([]);
  const [wallsLeft, setWallsLeft] = useState<[number, number]>([10, 10]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [draggingPiece, setDraggingPiece] = useState<BarricadeDragKind | null>(null);
  const [wallSnapPreview, setWallSnapPreview] = useState<{ row: number; column: number; orientation: BarricadeDragKind } | null>(null);
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
    setWallSnapPreview(null);
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

  const previewBarricadeWall = useCallback((clientX: number, clientY: number, orientation: BarricadeDragKind) => {
    const cells = boardRef.current?.querySelector<HTMLElement>(".quoridor-cells");
    if (!cells) return setWallSnapPreview(null);
    const rect = cells.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return setWallSnapPreview(null);
    const row = Math.round(((clientY - rect.top) / rect.height) * 9 - 1);
    const column = Math.round(((clientX - rect.left) / rect.width) * 9 - 1);
    setWallSnapPreview(row >= 0 && row <= 7 && column >= 0 && column <= 7 ? { row, column, orientation } : null);
  }, []);

  useEffect(() => {
    if (mode !== "solo" || turn !== 1 || winner != null) return;
    const timer = window.setTimeout(() => {
      const action = chooseBarricadeCpuAction(positions, walls, wallsLeft[1], difficulty);
      if (action.kind === "wall") placeWall(1, action.wall.row, action.wall.column, action.wall.orientation);
      else movePawn(1, action.destination);
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
          <div className={`quoridor-wall-layer dragging-${draggingPiece ?? "none"}`}>
            {Array.from({ length: 64 }, (_, index) => {
              const row = Math.floor(index / 8);
              const column = index % 8;
              const orientation = draggingPiece;
              const canPlace = orientation != null && turn === 0 && legalBarricadeWall({ row, column, orientation, owner: 0 }, walls, positions);
              const isSnap = wallSnapPreview?.row === row && wallSnapPreview.column === column && wallSnapPreview.orientation === orientation;
              const classes = ["wall-target", "owner-1", orientation ? `wall-${orientation}` : "", canPlace ? "legal" : isSnap ? "blocked" : "", isSnap ? "snap-preview" : ""].filter(Boolean).join(" ");
              return <span key={index} className={classes} style={{ "--wall-row": row, "--wall-column": column } as React.CSSProperties} />;
            })}
            {walls.map((wall, index) => <i key={index} className={`placed-wall wall-${wall.orientation} owner-${wall.owner + 1}`} style={{ "--wall-row": wall.row, "--wall-column": wall.column } as React.CSSProperties} />)}
          </div>
        </div>
        <div className="barricade-piece-tray" aria-label="Drag a wall onto the board">
          <BarricadeDragPiece kind="h" label="Drag a horizontal wall" disabled={turn !== 0 || winner != null || wallsLeft[0] === 0} onDragStart={setDraggingPiece} onDragMove={previewBarricadeWall} onDragEnd={() => { setDraggingPiece(null); setWallSnapPreview(null); }} onDrop={dropBarricadePiece} />
          <span><strong>{wallsLeft[0]}</strong><small>WALLS</small></span>
          <BarricadeDragPiece kind="v" label="Drag a vertical wall" disabled={turn !== 0 || winner != null || wallsLeft[0] === 0} onDragStart={setDraggingPiece} onDragMove={previewBarricadeWall} onDragEnd={() => { setDraggingPiece(null); setWallSnapPreview(null); }} onDrop={dropBarricadePiece} />
        </div>
        {winner != null ? <GameResult outcome={mode === "solo" ? winner === 0 ? "You Win!" : "CPU Wins!" : `Player ${winner + 1} Wins!`} detail="The winning pawn reached the opposite edge." onPlayAgain={reset} /> : <div className="barricade-controls" role="status"><div><small>{turn === 0 ? "TAP A SPACE OR DRAG A WALL" : "OPPONENT MOVE"}</small><strong>{message}</strong></div></div>}
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
    if (result === 0 || result === 1) nextScores[result] += 1;
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
        {gameOver ? <GameResult outcome={scores[0] > scores[1] ? mode === "multi" ? "Player 1 Wins!" : "You Win!" : mode === "multi" ? "Player 2 Wins!" : "CPU Wins!"} detail={`Final score ${scores[0]}–${scores[1]}.`} onPlayAgain={reset} /> : <div className="simple-status" role="status"><strong>{message}</strong><span>Round {rounds + 1}</span></div>}
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
        {winner == null ? <><button className="primary-button dice-roll" onClick={roll}>{`Roll ${mode === "multi" ? `for Player ${currentPlayer + 1}` : "the dice"}`}</button><div className="simple-status" role="status"><strong>{mode === "multi" ? `Player ${currentPlayer + 1}'s roll` : "Your roll also rolls for the CPU."}</strong><span>{rolls} {rolls === 1 ? "roll" : "rolls"} played</span></div></> : <GameResult outcome={mode === "solo" ? winner === 0 ? "You Win!" : "CPU Wins!" : `Player ${winner + 1} Wins!`} detail={`${rolls} ${rolls === 1 ? "roll" : "rolls"} played.`} onPlayAgain={reset} />}
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
  checkers: {
    title: "Checkers",
    japanese: "チェッカー",
    category: "Strategy",
    glyph: "王",
    color: "checkers",
    players: "1–2 Players",
    rules: [
      "Move diagonally on dark squares; red moves first toward the top.",
      "Captures are mandatory, and a piece must continue a multi-jump.",
      "Reach the far edge to become a king, or capture every rival piece.",
    ],
  },
  battleship: {
    title: "Battleship",
    japanese: "海戦ゲーム",
    category: "Strategy",
    glyph: "艦",
    color: "battleship",
    players: "1–2 Players",
    rules: [
      "Hide five ships across your ten-by-ten ocean grid.",
      "Take turns firing at coordinates to find the enemy fleet.",
      "Sink all seventeen enemy ship sections before your fleet is lost.",
    ],
  },
  dotsboxes: {
    title: "Dots & Boxes",
    japanese: "点と箱",
    category: "Strategy",
    glyph: "点",
    color: "dotsboxes",
    players: "1–2 Players",
    rules: [
      "Draw one line between two neighboring dots.",
      "Complete a box to claim it and immediately play another line.",
      "The player with the most boxes after every line is drawn wins.",
    ],
  },
  airhockey: {
    title: "Air Hockey",
    japanese: "エアホッケー",
    category: "Arcade",
    glyph: "氷",
    color: "airhockey",
    players: "1–2 Players",
    rules: [
      "Tap Lock Rink, then drag your mallet freely around your half.",
      "In Versus, both players move simultaneously while the puck stays live.",
      "Play for two minutes; the first player to three goals wins immediately.",
    ],
  },
  "2048": {
    title: "2048",
    japanese: "二〇四八",
    category: "Number puzzle",
    glyph: "2048",
    color: "2048",
    players: "1 Player",
    rules: [
      "Swipe the board or use the arrows to slide every tile.",
      "Matching numbers merge once per move and add to your score.",
      "Build the 2048 tile before the board runs out of moves.",
    ],
  },
  wordgarden: {
    title: "Word Garden",
    japanese: "言葉庭園",
    category: "Word puzzle",
    glyph: "言",
    color: "wordgarden",
    players: "1 Player",
    rules: [
      "Enter a real five-letter word. You have six guesses.",
      "Green means the right letter and spot; gold means the letter belongs somewhere else.",
      "Gray letters are not in the hidden word. Repeated letters are scored precisely.",
    ],
  },
  blackjack: {
    title: "Blackjack",
    japanese: "ブラックジャック",
    category: "Casino cards",
    glyph: "21",
    color: "blackjack",
    players: "1 Player",
    rules: [
      "Choose a chip bet, then receive two cards against the dealer.",
      "Hit, stand, or double down. Aces count as one or eleven.",
      "Beat the dealer without passing 21. A natural blackjack pays 3 to 2.",
    ],
  },
  queens: {
    title: "Queens",
    japanese: "女王",
    category: "Logic puzzle",
    glyph: "♛",
    color: "queens",
    players: "1 Player",
    rules: [
      "Place exactly one crown in every row, column, and colored region.",
      "Crowns cannot touch each other, including along a diagonal.",
      "Tap a cell to cycle between empty, a × mark, and a crown.",
    ],
  },
  graphwar: {
    title: "Graph War",
    japanese: "関数戦",
    category: "Math strategy",
    glyph: "ƒ",
    color: "graphwar",
    players: "2 Players · Local",
    rules: [
      "Player 1 places a dot in the red zone, then Player 2 places one in the gold zone.",
      "Take turns entering a linear function in the form y = mx + b.",
      "Fire the graphed line. The first function to intersect the rival dot wins.",
    ],
  },
};

function GameMenu({ game, onPlay, onBack }: { game: LibraryGameId; onPlay: (mode: GameMode) => void; onBack: () => void }) {
  const details = GAME_MENUS[game];
  const [selectedMode, setSelectedMode] = useState<GameMode>("solo");
  const soloOnly = game === "2048" || game === "wordgarden" || game === "blackjack" || game === "queens" || game === "graphwar";

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
          {!soloOnly && <div className="mode-picker" aria-label="Choose game mode">
            <button className={selectedMode === "solo" ? "active" : ""} onClick={() => setSelectedMode("solo")}><b>一</b><span>SOLO<small>1 PLAYER</small></span></button>
            <button className={selectedMode === "multi" ? "active" : ""} onClick={() => setSelectedMode("multi")}><b>対</b><span>VERSUS<small>2 PLAYERS</small></span></button>
          </div>}
          <div className="menu-rules">
            <h2>How to play <span>遊び方</span></h2>
            <ol>{details.rules.map((rule, index) => <li key={rule}><b>{index + 1}</b><span>{rule}</span></li>)}</ol>
          </div>
          <button className="primary-button menu-start" onClick={() => onPlay(soloOnly ? "solo" : selectedMode)}>{!soloOnly && selectedMode === "multi" ? "Open Lobby" : "Start Game"} <span>→</span></button>
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
                <div className={`lobby-player ready banner-surface banner-style-${isBannerId(room.hostBanner) ? room.hostBanner : DEFAULT_BANNER_ID}`}><AvatarGlyph avatarId={room.hostAvatar} className="lobby-avatar" /><span><small>HOST</small><strong>{room.hostName}</strong><em>READY</em></span></div>
                <b>VS</b>
                <div className={`lobby-player ${roomReady ? "ready" : "waiting"} ${room.guestUid ? `banner-surface banner-style-${isBannerId(room.guestBanner) ? room.guestBanner : DEFAULT_BANNER_ID}` : ""}`}>{room.guestUid && room.guestAvatar ? <AvatarGlyph avatarId={room.guestAvatar} className="lobby-avatar" /> : <span className="lobby-empty-avatar">?</span>}<span><small>GUEST</small><strong>{room.guestName || "Waiting for guest"}</strong><em>{roomReady ? "READY" : "OPEN"}</em></span></div>
              </div>
              {isHost && !roomReady && friends.length > 0 && !firebaseUser?.isAnonymous && <div className="lobby-friends"><div className="lobby-section-title"><span>Invite friends</span><span>友達を招待</span></div>{friends.map((friend) => <div className={`lobby-friend banner-surface banner-style-${isBannerId(friend.bannerId) ? friend.bannerId : DEFAULT_BANNER_ID}`} key={friend.uid}><AvatarGlyph avatarId={isAvatarId(friend.avatarId) ? friend.avatarId : "play"} className="lobby-friend-avatar" /><strong>{friend.name}</strong><button onClick={() => void inviteFriend(friend)} disabled={busyFriend !== null || Boolean(activeInvite)}>{busyFriend === friend.uid ? "SENDING…" : activeInvite?.toUid === friend.uid ? "SENT" : "INVITE"}</button></div>)}</div>}
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
  { id: "checkers", number: "10", name: "Checkers", japanese: "チェッカー", meta: "STRATEGY", scoreGame: "checkers" },
  { id: "battleship", number: "11", name: "Battleship", japanese: "海戦ゲーム", meta: "STRATEGY", scoreGame: "battleship" },
  { id: "dotsboxes", number: "12", name: "Dots & Boxes", japanese: "点と箱", meta: "STRATEGY", scoreGame: "dotsboxes" },
  { id: "airhockey", number: "13", name: "Air Hockey", japanese: "エアホッケー", meta: "ARCADE", scoreGame: "airhockey" },
  { id: "2048", number: "14", name: "2048", japanese: "二〇四八", meta: "PUZZLE", scoreGame: "2048" },
  { id: "wordgarden", number: "15", name: "Word Garden", japanese: "言葉庭園", meta: "WORD", scoreGame: "wordgarden" },
  { id: "blackjack", number: "16", name: "Blackjack", japanese: "ブラックジャック", meta: "CASINO", scoreGame: "blackjack" },
  { id: "queens", number: "17", name: "Queens", japanese: "女王", meta: "LOGIC", scoreGame: "queens" },
  { id: "graphwar", number: "18", name: "Graph War", japanese: "関数戦", meta: "MATH · 2P" },
];

const SCORE_GAME_IDS: PlayableGameId[] = ["codebreaker", "order", "number", "memory", "tictactoe", "connect4", "rps", "dice", "barricade", "checkers", "battleship", "dotsboxes", "airhockey", "2048", "wordgarden", "blackjack", "queens"];
const MULTIPLAYER_GAME_IDS = SCORE_GAME_IDS.filter((gameId) => gameId !== "2048" && gameId !== "wordgarden" && gameId !== "blackjack" && gameId !== "queens");

function formatScore(game: PlayableGameId, score?: number) {
  if (score == null) return "—";
  if (game === "2048") return `${score.toLocaleString()} pts`;
  if (game === "blackjack") return `${score.toLocaleString()} chips`;
  const unit = game === "airhockey" || game === "queens" ? "seconds" : game === "battleship" ? "shots" : game === "memory" || game === "tictactoe" || game === "connect4" || game === "barricade" || game === "checkers" || game === "dotsboxes" ? "moves" : game === "order" ? "checks" : game === "rps" ? "rounds" : game === "dice" ? "rolls" : "guesses";
  return `${score} ${score === 1 ? unit.slice(0, -1) : unit}`;
}

function friendlyAuthError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "auth/email-already-in-use") return "That email already has an account. Sign in instead.";
  if (code === "auth/invalid-credential") return "The email or password is incorrect.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") return "Use a password with at least 12 characters.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a moment and try again.";
  if (code === "auth/unauthorized-domain") return "This Game Garden address must be added to Firebase authorized domains.";
  if (code === "auth/operation-not-allowed") return "This sign-in method still needs to be enabled in Firebase.";
  return "Could not sign in. Please try again.";
}

function activeEntitlement(snapshot: DocumentSnapshot) {
  if (!snapshot.exists()) return false;
  const data = snapshot.data();
  const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : null;
  return data.status === "active" && (expiresAt == null || expiresAt > Date.now());
}

async function saveCloudScore(user: User, gameId: PlayableGameId, score: number, profileName: string, avatarId: AvatarId, bannerId: BannerId) {
  const entryRef = doc(db, "leaderboards", gameId, "entries", user.uid);
  const profileRef = doc(db, "users", user.uid);
  const publicProfileRef = doc(db, "publicProfiles", user.uid);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(entryRef);
    const higherIsBetter = gameId === "2048" || gameId === "blackjack";
    const previousScore = current.exists() ? Number(current.data().score) : higherIsBetter ? 0 : Number.POSITIVE_INFINITY;
    const bestScore = higherIsBetter ? Math.max(previousScore, score) : Math.min(previousScore, score);
    transaction.set(entryRef, {
      uid: user.uid,
      name: profileName.trim() || user.displayName || "Player One",
      photoURL: "",
      avatarId,
      bannerId,
      score: bestScore,
      scoreSeason: SCORE_SEASON,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.set(profileRef, { highScores: { [gameId]: bestScore }, scoreSeason: SCORE_SEASON, avatarId, bannerId, updatedAt: serverTimestamp() }, { merge: true });
    transaction.set(publicProfileRef, {
      uid: user.uid,
      name: profileName.trim() || user.displayName || "Player One",
      avatarId,
      bannerId,
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

function ProfileBanner({ bannerId, className = "" }: { bannerId: BannerId; className?: string }) {
  return <span className={`${className} profile-banner-art banner-style-${bannerId}`} aria-hidden="true" />;
}

function HeaderLogo({ compact = false }: { compact?: boolean }) {
  return <span className={`header-title-logo ${compact ? "game-header-logo" : ""}`} role="img" aria-label="Game Garden" />;
}

function chatClearedAtFor(chat: DirectChatSummary | undefined, uid: string) {
  if (!chat) return undefined;
  return chat.userA === uid ? chat.userAClearedAt : chat.userBClearedAt;
}

function chatIsVisibleFor(chat: DirectChatSummary | undefined, uid: string) {
  if (!chat) return false;
  const clearedAt = chatClearedAtFor(chat, uid)?.toMillis() ?? 0;
  return (chat.lastMessageAt?.toMillis() ?? 0) > clearedAt;
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
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
      ? chats.filter((chat) => chatIsVisibleFor(chat, user.uid) && chat.unreadBy?.[user.uid] === true).length
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
      const leftCandidate = user ? chats.find((chat) => chat.id === directChatId(user.uid, left.uid)) : undefined;
      const rightCandidate = user ? chats.find((chat) => chat.id === directChatId(user.uid, right.uid)) : undefined;
      const leftChat = user && chatIsVisibleFor(leftCandidate, user.uid) ? leftCandidate : undefined;
      const rightChat = user && chatIsVisibleFor(rightCandidate, user.uid) ? rightCandidate : undefined;
      const recentDifference = (rightChat?.lastMessageAt?.toMillis() ?? 0) - (leftChat?.lastMessageAt?.toMillis() ?? 0);
      return recentDifference || left.name.localeCompare(right.name);
    });
  }, [chats, friends, user]);

  const selectedPeer = peers.find((peer) => peer.uid === selectedUid) ?? null;
  const activeChatId = user && selectedPeer ? directChatId(user.uid, selectedPeer.uid) : "";
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const visiblePeers = peers.filter((peer) => peer.name.toLowerCase().includes(search.trim().toLowerCase()));
  const clearedAt = user ? chatClearedAtFor(activeChat, user.uid)?.toMillis() ?? 0 : 0;
  const threadMessages = messageThread.id === activeChatId
    ? messageThread.messages.filter((message) => (message.sentAt?.toMillis() ?? 0) > clearedAt)
    : EMPTY_DIRECT_MESSAGES;

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

  const deleteChat = async () => {
    if (!user || !selectedPeer || !activeChat || deleteBusy) return;
    setDeleteBusy(true);
    setChatError("");
    try {
      const clearedField = activeChat.userA === user.uid ? "userAClearedAt" : "userBClearedAt";
      await updateDoc(doc(db, "directChats", activeChat.id), {
        [clearedField]: serverTimestamp(),
        [`unreadBy.${user.uid}`]: false,
        updatedAt: serverTimestamp(),
      });
      setMessageThread({ id: activeChat.id, messages: EMPTY_DIRECT_MESSAGES });
      setDeleteConfirmOpen(false);
      onSelectFriend(null);
    } catch {
      setChatError("Could not delete this chat. Try again.");
      setDeleteConfirmOpen(false);
    } finally {
      setDeleteBusy(false);
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
              {activeChat && <button className="chat-delete" onClick={() => setDeleteConfirmOpen(true)} aria-label={`Delete chat with ${selectedPeer.name}`} title="Delete chat">消</button>}
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
                const candidate = chats.find((chat) => chat.id === directChatId(user.uid, peer.uid));
                const summary = chatIsVisibleFor(candidate, user.uid) ? candidate : undefined;
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
      {deleteConfirmOpen && selectedPeer && <div className="chat-delete-confirm-backdrop" onMouseDown={() => { if (!deleteBusy) setDeleteConfirmOpen(false); }}><section className="chat-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-chat-title" onMouseDown={(event) => event.stopPropagation()}><span aria-hidden="true">消</span><small>DIRECT MESSAGE · チャット</small><h2 id="delete-chat-title">Delete chat with {selectedPeer.name}?</h2><p>This clears the conversation from your account only. It will not remove your friend or erase their copy. New messages will start a fresh chat.</p><div><button autoFocus onClick={() => setDeleteConfirmOpen(false)} disabled={deleteBusy}>Cancel</button><button className="confirm-delete-chat" onClick={() => void deleteChat()} disabled={deleteBusy}>{deleteBusy ? "Deleting…" : "Delete chat"}</button></div></section></div>}
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
  bannerId,
  onProfileNameChange,
  onAvatarChange,
  onBannerChange,
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
  goldModeUnlocked,
  blossomThemeUnlocked,
  blossomThemeEnabled,
  onBlossomThemeToggle,
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
  bannerId: BannerId;
  onProfileNameChange: (name: string) => void;
  onAvatarChange: (avatarId: AvatarId) => void;
  onBannerChange: (bannerId: BannerId) => void;
  onProfileSave: () => Promise<boolean>;
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
  onRemoveFriend: (uid: string) => Promise<boolean>;
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
  goldModeUnlocked: boolean;
  blossomThemeUnlocked: boolean;
  blossomThemeEnabled: boolean;
  onBlossomThemeToggle: () => void;
  onUnlockPremium: (code: string) => Promise<string>;
}) {
  const completedGames = Object.keys(highScores).length;
  const scoredGames = GAMES.filter((game) => game.scoreGame) as Array<(typeof GAMES)[number] & { scoreGame: PlayableGameId }>;
  const [rankGame, setRankGame] = useState<PlayableGameId>("codebreaker");
  const [gameSearch, setGameSearch] = useState("");
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
  const [friendRemoveConfirmOpen, setFriendRemoveConfirmOpen] = useState(false);
  const [friendRemoveBusy, setFriendRemoveBusy] = useState(false);
  const [premiumCode, setPremiumCode] = useState("");
  const [premiumMessage, setPremiumMessage] = useState("");
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [bannerPickerOpen, setBannerPickerOpen] = useState(false);
  const [profileSaveBusy, setProfileSaveBusy] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const appShellRef = useRef<HTMLElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const activeRanks = leaderboards[rankGame] ?? [];
  const liveIncoming = incomingInvites.filter(inviteIsLive);
  const socialNoticeCount = liveIncoming.length + incomingFriendRequests.length;
  const liveOutgoing = outgoingInvites.filter(inviteIsLive);
  const readyInvites = [...incomingInvites, ...outgoingInvites].filter((invite, index, all) => invite.status === "accepted" && all.findIndex((item) => item.id === invite.id) === index);
  const currentHeader = HEADER_META[activeTab];
  const signedIn = Boolean(firebaseUser && !firebaseUser.isAnonymous);
  const onlineFriends = friends.filter((friend) => friend.isOnline);
  const displayedFriends = [...friends]
    .filter((friend) => friend.name.toLowerCase().includes(friendSearch.trim().toLowerCase()))
    .sort((left, right) => Number(Boolean(right.isOnline)) - Number(Boolean(left.isOnline)) || left.name.localeCompare(right.name));
  const normalizedGameSearch = gameSearch.trim().toLocaleLowerCase();
  const displayedGames = normalizedGameSearch
    ? GAMES.filter((game) => `${game.name} ${game.japanese} ${game.meta}`.toLocaleLowerCase().includes(normalizedGameSearch))
    : GAMES;

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

  useEffect(() => {
    appShellRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeTab]);

  useEffect(() => {
    if (!avatarPickerOpen && !bannerPickerOpen && !selectedFriend && !signOutConfirmOpen && !resetConfirmOpen) return;
    const appShell = appShellRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousAppOverflow = appShell?.style.overflowY ?? "";
    document.body.style.overflow = "hidden";
    if (appShell) appShell.style.overflowY = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appShell) appShell.style.overflowY = previousAppOverflow;
    };
  }, [avatarPickerOpen, bannerPickerOpen, selectedFriend, signOutConfirmOpen, resetConfirmOpen]);

  useEffect(() => {
    if (!profileSaved) return;
    const timer = window.setTimeout(() => setProfileSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [profileSaved]);

  const saveProfileAndConfirm = async () => {
    setProfileSaveBusy(true);
    setProfileSaved(false);
    try {
      if (await onProfileSave()) setProfileSaved(true);
    } finally {
      setProfileSaveBusy(false);
    }
  };

  const confirmFriendRemoval = async () => {
    if (!selectedFriend) return;
    setFriendRemoveBusy(true);
    try {
      if (await onRemoveFriend(selectedFriend.uid)) {
        setFriendRemoveConfirmOpen(false);
        setSelectedFriend(null);
      }
    } finally {
      setFriendRemoveBusy(false);
    }
  };

  const confirmScoreReset = async () => {
    setResetBusy(true);
    setResetMessage("");
    try {
      setResetMessage(await onResetScores());
      setResetConfirmOpen(false);
    } finally {
      setResetBusy(false);
    }
  };

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
      if (message.toLowerCase().includes("unlocked")) setPremiumCode("");
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
    <main className="app-shell" ref={appShellRef}>
      <header className="app-header">
        <button className="header-brand" onClick={() => onTabChange("games")} aria-label="Open Game Garden games">
          <HeaderLogo />
        </button>
        <div className="header-context" aria-label={`${currentHeader.label} section`}><span>{currentHeader.glyph}</span><div><small>{currentHeader.japanese}</small><strong>{currentHeader.label}</strong></div></div>
        <div className="header-actions">
          {signedIn && <span className="header-online"><i />ONLINE</span>}
          {socialNoticeCount > 0 && <button className="header-invites" onClick={() => onTabChange("friends")} aria-label={`${socialNoticeCount} pending social alerts`}><b>招</b><span>{socialNoticeCount}</span></button>}
          <button className="theme-toggle" data-mode={theme} onClick={onThemeToggle} aria-label={`Change color mode. Current mode: ${theme === "classic" ? "red" : theme === "sakura" ? "pink" : "gold"}`}><span>MODE</span></button>
          <HeaderChatButton />
          {signedIn ? <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button className="header-profile" onClick={() => setProfileMenuOpen((open) => !open)} aria-label="Open account menu" aria-haspopup="menu" aria-expanded={profileMenuOpen}>
              <PlayerAvatar small avatarId={avatarId} />
            </button>
            {profileMenuOpen && <div className="profile-dropdown" role="menu" aria-label="Account menu">
              <button role="menuitem" onClick={() => chooseProfileMenu("profile")}><b>人</b><span>Profile</span></button>
              <button role="menuitem" onClick={() => chooseProfileMenu("leaderboard")}><b>冠</b><span>Leaderboard</span></button>
              <button role="menuitem" onClick={() => chooseProfileMenu("friends")}><b>友</b><span>Friends</span></button>
              <button role="menuitem" onClick={() => chooseProfileMenu("friends", true)}><b>招</b><span>Invites</span>{socialNoticeCount > 0 && <em>{socialNoticeCount}</em>}</button>
              <button role="menuitem" onClick={() => chooseProfileMenu("addons")}><b>花</b><span>Add-ons</span></button>
            </div>}
          </div> : <button className="header-signin-button" onClick={() => onTabChange("profile")}><b>人</b><span>SIGN IN</span></button>}
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
            <div className="app-title"><div><p>PLAY</p><h1>Games <span>ゲーム</span></h1></div></div>
            <div className="game-search-bar">
              <span className="game-search-icon" aria-hidden="true" />
              <input type="search" value={gameSearch} onChange={(event) => setGameSearch(event.target.value)} placeholder="Search games" aria-label="Search games by name or type" />
              {gameSearch && <button onClick={() => setGameSearch("")} aria-label="Clear game search">×</button>}
              <b>{displayedGames.length}<small>FOUND</small></b>
            </div>
            <div className="game-app-grid">
              {displayedGames.map((game) => (
                <button className="game-app-card" key={game.id} onClick={() => onSelect(game.id)}>
                  <span className={`game-cover art-${game.id}`} />
                  <span className="game-card-copy">
                    <strong>{game.name}</strong>
                    <small>{game.japanese}</small>
                    <em>{game.scoreGame && highScores[game.scoreGame] != null ? `BEST · ${formatScore(game.scoreGame, highScores[game.scoreGame])}` : game.meta}</em>
                  </span>
                </button>
              ))}
            </div>
            {!displayedGames.length && <div className="game-search-empty"><strong>No games found</strong><span>Try another name or game type.</span><button onClick={() => setGameSearch("")}>Clear search</button></div>}
          </section>
        )}

        {activeTab === "leaderboard" && (
          <section className="app-panel rank-panel">
            <div className="app-title"><div><p>GLOBAL</p><h1>Leaderboard <span>ランキング</span></h1></div></div>
            {signedIn ? <div className={`player-rank-card banner-surface banner-style-${bannerId}`}>
              <span className="rank-number">YOU</span><PlayerAvatar avatarId={avatarId} />
              <div><strong>{profileName || "Player One"}</strong></div>
              <b>{completedGames}<small>BESTS</small></b>
            </div> : <button className="rank-signin-card" onClick={() => onTabChange("profile")}><b>人</b><span><small>YOUR RANK IS PRIVATE</small><strong>Sign in to view your scores</strong></span><em>→</em></button>}
            <div className="rank-game-tabs" aria-label="Choose leaderboard game">
              {scoredGames.map((game) => <button key={game.id} className={rankGame === game.scoreGame ? "active" : ""} onClick={() => setRankGame(game.scoreGame)}>{game.name}</button>)}
            </div>
            <div className="global-rank-list">
              {activeRanks.length ? activeRanks.map((entry, index) => (
                <div className={`global-rank-row rank-banner-row banner-style-${isBannerId(entry.bannerId) ? entry.bannerId : DEFAULT_BANNER_ID}`} key={entry.uid}>
                  <strong>{String(index + 1).padStart(2, "0")}</strong>
                  <AvatarGlyph avatarId={isAvatarId(entry.avatarId) ? entry.avatarId : "play"} className="rank-avatar" />
                  <span>{entry.name}</span>
                  <b>{formatScore(rankGame, entry.score)}</b>
                </div>
              )) : <p className="empty-ranks">No scores yet. Set the first one.</p>}
            </div>
            {signedIn && <div className="score-list">
              <div className="score-list-heading"><span>Your high scores</span><span>ハイスコア</span></div>
              {scoredGames.map((game) => (
                <div className="score-row" key={game.id}>
                  <span className={`score-art art-${game.id}`} />
                  <div><strong>{game.name}</strong><small>{game.meta}</small></div>
                  <b className={highScores[game.scoreGame] == null ? "no-score" : ""}>{formatScore(game.scoreGame, highScores[game.scoreGame])}</b>
                </div>
              ))}
            </div>}
          </section>
        )}

        {activeTab === "profile" && (
          <section className="app-panel profile-panel">
            {signedIn ? <>
            <div className="profile-card">
              <div className={`profile-banner-hero banner-style-${bannerId}`}>
                <button className="profile-avatar-button" onClick={() => setAvatarPickerOpen(true)} aria-label="Change profile picture">
                  <PlayerAvatar avatarId={avatarId} />
                  <span className="profile-avatar-label">CHANGE PICTURE</span>
                </button>
                <button className="profile-banner-change" onClick={() => setBannerPickerOpen(true)}><span>景</span> CHANGE BANNER</button>
              </div>
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
              {bannerPickerOpen && (
                <div className="avatar-picker-backdrop" onMouseDown={() => setBannerPickerOpen(false)}>
                  <section className="avatar-picker-dialog banner-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="banner-picker-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setBannerPickerOpen(false); }}>
                    <div className="avatar-picker-heading"><div><small>PROFILE BANNER · 背景</small><h2 id="banner-picker-title">Choose your banner</h2></div><button autoFocus onClick={() => setBannerPickerOpen(false)} aria-label="Close profile banner chooser">×</button></div>
                    <div className="banner-picker" role="group" aria-label="Choose a profile banner">
                      {BANNERS.map((banner) => <button key={banner.id} className={bannerId === banner.id ? "selected" : ""} onClick={() => { onBannerChange(banner.id); setBannerPickerOpen(false); }} aria-pressed={bannerId === banner.id}><ProfileBanner bannerId={banner.id} /><span><strong>{banner.label}</strong><small>{banner.japanese}</small></span><b>{bannerId === banner.id ? "✓" : "選"}</b></button>)}
                    </div>
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
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <div className="profile-actions">
                <button className="primary-button" onClick={() => void saveProfileAndConfirm()} disabled={profileSaveBusy}>{profileSaveBusy ? "Saving…" : "Save profile"}</button><button className="text-button" onClick={() => setSignOutConfirmOpen(true)}>Sign out</button>
              </div>
            </div>
            {profileSaved && <div className="profile-saved-backdrop" onMouseDown={() => setProfileSaved(false)}><section className="profile-saved-popup" role="dialog" aria-modal="true" aria-labelledby="profile-saved-title" onMouseDown={(event) => event.stopPropagation()}><span aria-hidden="true">✓</span><small>PROFILE UPDATED</small><h2 id="profile-saved-title">Saved</h2><button autoFocus onClick={() => setProfileSaved(false)}>Done</button></section></div>}
            {signOutConfirmOpen && <div className="signout-confirm-backdrop" onMouseDown={() => setSignOutConfirmOpen(false)}><section className="signout-confirm" role="alertdialog" aria-modal="true" aria-labelledby="signout-confirm-title" onMouseDown={(event) => event.stopPropagation()}><span aria-hidden="true">出</span><small>GAME GARDEN ACCOUNT</small><h2 id="signout-confirm-title">Sign out?</h2><p>You will need to sign in again to see this account’s friends, scores, and profile.</p><div><button autoFocus onClick={() => setSignOutConfirmOpen(false)}>Cancel</button><button className="confirm-signout" onClick={() => { setSignOutConfirmOpen(false); onSignOut(); }}>Sign out</button></div></section></div>}
            {resetConfirmOpen && <div className="reset-confirm-backdrop" onMouseDown={() => { if (!resetBusy) setResetConfirmOpen(false); }}><section className="reset-confirm" role="alertdialog" aria-modal="true" aria-labelledby="reset-confirm-title" onMouseDown={(event) => event.stopPropagation()}><span aria-hidden="true">零</span><small>HIGH SCORES · ハイスコア</small><h2 id="reset-confirm-title">Reset all scores?</h2><p>This permanently clears all {completedGames} of this account’s saved high scores. This cannot be undone.</p><div><button autoFocus onClick={() => setResetConfirmOpen(false)} disabled={resetBusy}>Cancel</button><button className="confirm-reset-scores" onClick={() => void confirmScoreReset()} disabled={resetBusy}>{resetBusy ? "Resetting…" : "Reset scores"}</button></div></section></div>}
            <details className="profile-stats-menu">
              <summary><span><small>PLAYER DATA · プレイヤーデータ</small><strong>Stats &amp; high scores</strong></span><span className="stats-summary-counts"><b>{completedGames}</b> BESTS <b>{GAMES.length}</b> GAMES</span><i>⌄</i></summary>
              <div className="profile-stats-dropdown">
                <div className="profile-stats-compact"><div><strong>{completedGames}</strong><span>HIGH SCORES</span></div><div><strong>{GAMES.length}</strong><span>GAMES</span></div></div>
                <div className="profile-score-dropdown"><h2>Your best <span>自己ベスト</span></h2>{scoredGames.map((game) => <p key={game.id}><span>{game.name}</span><strong>{formatScore(game.scoreGame, highScores[game.scoreGame])}</strong></p>)}</div>
                <button className="reset-scores-button" disabled={resetBusy || completedGames === 0} onClick={() => setResetConfirmOpen(true)}>{resetBusy ? "Resetting…" : "Reset this profile's scores"}</button>
                {resetMessage && <p className="reset-scores-message" role="status">{resetMessage}</p>}
              </div>
            </details>
            </> : <div className="profile-signin-only">
              <span className="friends-signin-emblem profile-signin-emblem" aria-hidden="true"><i>人</i><b>→</b><small>LOGIN</small></span>
              <small>GAME GARDEN ACCOUNT · アカウント</small>
              <h1>Sign in to your profile.</h1>
              <p>Your avatar, name, rank, and scores stay hidden until you sign in.</p>
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <div className="profile-signin-form">
                <div className="email-auth-fields">
                  <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email address" aria-label="Email address" autoComplete="email" />
                  <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" minLength={6} maxLength={128} />
                </div>
                <div className="email-auth-actions">
                  <button className="primary-button" onClick={() => onEmailSignIn(authEmail, authPassword)} disabled={authLoading || !authEmail || authPassword.length < 6}>Sign in</button>
                  <button className="secondary-button" onClick={() => onEmailCreate(authEmail, authPassword)} disabled={authLoading || !authEmail || authPassword.length < 12}>Create account</button>
                  <small className="auth-password-note">New passwords require at least 12 characters.</small>
                </div>
                <span className="auth-divider">OR</span>
                <button className="primary-button google-button" onClick={onSignIn} disabled={authLoading}>{authLoading ? "Connecting…" : "Continue with Google"}</button>
              </div>
            </div>}
          </section>
        )}

        {activeTab === "store" && (
          <section className="app-panel store-panel">
            <div className="app-title"><div><p>DISCOVER</p><h1>Store <span>売店</span></h1></div><strong>店<small>SHOP</small></strong></div>
            <div className={`store-product-card gold-mode-product ${goldModeUnlocked ? "owned" : ""}`}>
              <div className="gold-mode-art" aria-hidden="true"><span className="gold-mode-logo" /><b>金</b><i>01</i></div>
              <div className="store-product-copy">
                <small>FIRST STORE DROP · 限定モード</small>
                <h2>Gold Mode</h2>
                <p>A premium gold-and-black colorway for the entire Game Garden app, including every game and screen.</p>
                <div className="store-product-status"><span><small>{goldModeUnlocked ? "ACCOUNT ITEM" : "PRICE"}</small><strong>{goldModeUnlocked ? "UNLOCKED" : "TBD"}</strong></span><button disabled>{goldModeUnlocked ? "OWNED" : "COMING SOON"}</button></div>
              </div>
            </div>
            <div className={`store-product-card blossom-theme-product ${blossomThemeUnlocked ? "owned" : ""}`}>
              <div className="blossom-theme-art" aria-hidden="true">
                <span className="blossom-preview blossom-preview-red" />
                <span className="blossom-preview blossom-preview-pink" />
                <span className="blossom-preview blossom-preview-gold" />
                <b>花</b><i>02</i>
              </div>
              <div className="store-product-copy">
                <small>SCENERY ADD-ON · 花景色</small>
                <h2>Blossom Theme</h2>
                <p>Flower-petal controls and illustrated blossom gardens made for the Red, Pink, and Gold color modes.</p>
                <div className="store-product-status"><span><small>{blossomThemeUnlocked ? "ACCOUNT ITEM" : "PRICE"}</small><strong>{blossomThemeUnlocked ? "UNLOCKED" : "TBD"}</strong></span><button disabled>{blossomThemeUnlocked ? "OWNED" : "COMING SOON"}</button></div>
              </div>
            </div>
            <section className={`store-code-card store-code-minimal store-redeem-card ${premiumUnlocked ? "unlocked" : ""}`} aria-label="Redeem a code">
              <div className="store-code-label"><small>REDEEM CODE</small><span>コード入力</span></div>
              <div className="store-code-form"><input value={premiumCode} maxLength={12} onChange={(event) => setPremiumCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && premiumCode) void submitPremiumCode(); }} placeholder="ENTER CODE" aria-label="Enter a store code" autoComplete="off" /><button onClick={() => void submitPremiumCode()} disabled={!premiumCode || premiumBusy} aria-label="Submit code">{premiumBusy ? "…" : "→"}</button></div>
              {premiumMessage && <p className="store-code-message" role="status">{premiumMessage}</p>}
            </section>
          </section>
        )}

        {activeTab === "addons" && (
          <section className="app-panel addons-panel">
            <div className="app-title"><div><p>PERSONALIZE</p><h1>Add-ons <span>追加</span></h1></div><strong>花<small>EXTRAS</small></strong></div>
            {!signedIn ? <div className="addons-signin-card">
              <span aria-hidden="true">花</span><small>ACCOUNT ADD-ONS</small><h2>Sign in to use add-ons.</h2><p>Your owned extras follow your account on every device.</p>
              <button className="primary-button" onClick={() => onTabChange("profile")}>Open profile</button>
            </div> : <>
              <article className={`addon-card ${blossomThemeUnlocked ? "owned" : "locked"} ${blossomThemeEnabled ? "enabled" : ""}`}>
                <div className="addon-preview-triptych" aria-hidden="true"><span /><span /><span /><b>花</b></div>
                <div className="addon-card-copy"><small>{blossomThemeUnlocked ? "OWNED ADD-ON" : "LOCKED ADD-ON"} · 花景色</small><h2>Blossom Theme</h2><p>Colored blossom trees frame the app while petal patterns decorate its main controls. The scenery changes with Red, Pink, and Gold modes.</p>
                  <div className="addon-card-footer"><span><i className={blossomThemeEnabled ? "on" : ""} />{blossomThemeEnabled ? "ACTIVE" : blossomThemeUnlocked ? "READY" : "STORE ITEM"}</span>{blossomThemeUnlocked ? <button className="primary-button" onClick={onBlossomThemeToggle}>{blossomThemeEnabled ? "Disable" : "Enable"}</button> : <button className="primary-button" onClick={() => onTabChange("store")}>View in store</button>}</div>
                </div>
              </article>
              <div className="addons-coming"><span>＋</span><div><small>MORE TO GROW</small><strong>More add-ons coming soon</strong></div></div>
            </>}
          </section>
        )}

        {activeTab === "friends" && (
          <section className="app-panel friends-panel">
            <div className="app-title"><div><p>SOCIAL</p><h1>Friends <span>友達</span></h1></div><strong>{friends.length}<small>FRIENDS</small></strong></div>
            {!firebaseUser || firebaseUser.isAnonymous ? (
              <div className="friends-signin-card">
                <span className="friends-signin-emblem" aria-hidden="true"><i>友</i><b>+</b><small>CONNECT</small></span>
                <h2>Sign in to add friends.</h2>
                <button className="primary-button" onClick={() => onTabChange("profile")}>Open profile</button>
              </div>
            ) : <>
              <div className={`friends-account-banner banner-surface banner-style-${bannerId}`}>
                <span className="friends-account-avatar"><PlayerAvatar avatarId={avatarId} /></span>
                <div><small>YOUR NAME · あなた</small><strong>{profileName || "Player One"}</strong><span><i /> ONLINE</span></div>
                <b>{onlineFriends.length}<small>FRIENDS ONLINE</small></b>
              </div>
              <div className="friend-list friend-list-primary">
                <div className="friend-list-heading"><span>Your friends <b>{friends.length}</b></span><span>フレンド</span></div>
                <label className="friend-list-search"><span>⌕</span><input value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder="Search friends by name" aria-label="Search your friends" /><b>{onlineFriends.length} ONLINE</b></label>
                {inviteMessage && <p className="invite-message" role="status">{inviteMessage}</p>}
                {displayedFriends.length ? displayedFriends.map((friend) => (
                  <article className={`friend-banner ${friend.isOnline ? "is-online" : ""}`} key={friend.uid}>
                    <button className={`friend-banner-profile banner-surface banner-style-${isBannerId(friend.bannerId) ? friend.bannerId : DEFAULT_BANNER_ID}`} onClick={() => { setFriendRemoveConfirmOpen(false); setSelectedFriend(friend); }} aria-label={`Open ${friend.name}'s profile details`}>
                      <span className="friend-avatar-wrap"><AvatarGlyph avatarId={isAvatarId(friend.avatarId) ? friend.avatarId : "play"} className="friend-avatar" /><i className={friend.isOnline ? "online" : ""} /></span>
                      <span className="friend-identity"><strong>{friend.name}</strong><small className={friend.isOnline ? "online" : ""}>{friendPresenceLabel(friend)}</small></span>
                      <span className="friend-banner-view"><small>VIEW PROFILE</small><b>›</b></span>
                    </button>
                    <div className="friend-banner-actions"><button className="friend-chat-button" onClick={() => onOpenChat(friend)}><span>話</span> MESSAGE</button><button className="friend-invite-button" onClick={() => { setInviteTarget((current) => current === friend.uid ? null : friend.uid); setInviteMessage(""); }}>PLAY</button></div>
                    {inviteTarget === friend.uid && (
                      <div className="friend-invite-picker">
                        <span>CHOOSE A GAME</span>
                        <div>{scoredGames.map((game) => <button key={game.id} className={inviteGame === game.scoreGame ? "active" : ""} onClick={() => setInviteGame(game.scoreGame)}>{game.name}</button>)}</div>
                        <button className="primary-button" disabled={inviteBusy} onClick={() => void submitInvite(friend)}>{inviteBusy ? "Sending…" : `Invite ${friend.name}`}</button>
                      </div>
                    )}
                  </article>
                )) : <p className="empty-friends">{friends.length ? "No friends match that search." : "No friends yet. Add someone below."}</p>}
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
              {selectedFriend && <div className="friend-profile-backdrop" onMouseDown={() => { setFriendRemoveConfirmOpen(false); setSelectedFriend(null); }}><section className="friend-profile-dialog" role="dialog" aria-modal="true" aria-label={`${selectedFriend.name}'s profile`} onMouseDown={(event) => event.stopPropagation()}><button className="friend-profile-close" onClick={() => { setFriendRemoveConfirmOpen(false); setSelectedFriend(null); }} aria-label="Close friend profile">×</button><div className={`friend-profile-hero banner-style-${isBannerId(selectedFriend.bannerId) ? selectedFriend.bannerId : DEFAULT_BANNER_ID}`}><AvatarGlyph avatarId={selectedFriend.avatarId} className="friend-profile-avatar" /></div><small>FRIEND PROFILE</small><h2>{selectedFriend.name}</h2><p className={selectedFriend.isOnline ? "online" : ""}>{friendPresenceLabel(selectedFriend)}</p><div className="friend-profile-actions"><button className="primary-button" onClick={() => { onOpenChat(selectedFriend); setSelectedFriend(null); }}>Message</button><button className="secondary-button" onClick={() => { setInviteTarget(selectedFriend.uid); setSelectedFriend(null); }}>Invite to play</button><button className="friend-profile-remove" onClick={() => setFriendRemoveConfirmOpen(true)}>Remove friend</button></div><div className="friend-profile-scores">{scoredGames.map((game) => <div key={game.id}><span>{game.name}</span><b>{formatScore(game.scoreGame, selectedFriend.highScores?.[game.scoreGame])}</b></div>)}</div></section></div>}
              {selectedFriend && friendRemoveConfirmOpen && <div className="friend-remove-confirm-backdrop" onMouseDown={() => setFriendRemoveConfirmOpen(false)}><section className="friend-remove-confirm" role="alertdialog" aria-modal="true" aria-labelledby="remove-friend-title" onMouseDown={(event) => event.stopPropagation()}><span aria-hidden="true">友</span><small>FRIENDSHIP</small><h2 id="remove-friend-title">Remove {selectedFriend.name}?</h2><p>They will disappear from your friends list. You can send a new request later.</p><div><button onClick={() => setFriendRemoveConfirmOpen(false)} disabled={friendRemoveBusy}>Cancel</button><button className="confirm-remove-friend" onClick={() => void confirmFriendRemoval()} disabled={friendRemoveBusy}>{friendRemoveBusy ? "Removing…" : "Remove friend"}</button></div></section></div>}
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
  const [bannerId, setBannerId] = useState<BannerId>(DEFAULT_BANNER_ID);
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
  const [goldModeUnlocked, setGoldModeUnlocked] = useState(false);
  const [blossomThemeUnlocked, setBlossomThemeUnlocked] = useState(false);
  const [blossomThemeEnabled, setBlossomThemeEnabled] = useState(false);
  const authLoadId = useRef(0);

  useEffect(() => {
    document.dispatchEvent(new Event("game-garden:ready"));
  }, []);

  useEffect(() => {
    const themeColors: Record<ThemeMode, string> = { classic: "#e60012", sakura: "#e4316b", gold: "#c89216" };
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", themeColors[theme]);
  }, [theme]);

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
          const guestBanner = window.localStorage.getItem(playerStorageKey(null, "banner"));
          setProfileName(guestName || "Player One");
          setHighScores(storedScores(null));
          if (isAvatarId(guestAvatar) && !isPremiumAvatar(guestAvatar)) setAvatarId(guestAvatar);
          if (isBannerId(guestBanner)) setBannerId(guestBanner);
        }
        if (savedTheme === "sakura" || savedTheme === "gold") {
          setTheme(savedTheme);
          document.documentElement.dataset.theme = savedTheme;
        } else {
          setTheme("classic");
          delete document.documentElement.dataset.theme;
        }
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
      setBannerId(DEFAULT_BANNER_ID);
      setPremiumUnlocked(false);
      setGoldModeUnlocked(false);
      setBlossomThemeUnlocked(false);
      setBlossomThemeEnabled(false);
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
        window.localStorage.removeItem(BLOSSOM_ADDON_STORAGE_KEY);
        delete document.documentElement.dataset.addon;
        if (window.localStorage.getItem("game-garden-theme") === "gold") {
          window.localStorage.setItem("game-garden-theme", "classic");
          setTheme("classic");
          delete document.documentElement.dataset.theme;
        }
        const guestName = window.localStorage.getItem(playerStorageKey(null, "name")) || "Player One";
        const guestAvatar = window.localStorage.getItem(playerStorageKey(null, "avatar"));
        const guestBanner = window.localStorage.getItem(playerStorageKey(null, "banner"));
        setProfileName(guestName);
        setHighScores(storedScores(null));
        if (isAvatarId(guestAvatar) && !isPremiumAvatar(guestAvatar)) setAvatarId(guestAvatar);
        if (isBannerId(guestBanner)) setBannerId(guestBanner);
        return;
      }

      if (user.isAnonymous) {
        window.localStorage.removeItem(BLOSSOM_ADDON_STORAGE_KEY);
        delete document.documentElement.dataset.addon;
        if (window.localStorage.getItem("game-garden-theme") === "gold") {
          window.localStorage.setItem("game-garden-theme", "classic");
          setTheme("classic");
          delete document.documentElement.dataset.theme;
        }
        const savedGuestName = window.localStorage.getItem("game-garden-guest-name") || window.localStorage.getItem(playerStorageKey(null, "name")) || `Guest ${user.uid.slice(0, 4).toUpperCase()}`;
        const savedAvatar = window.localStorage.getItem(playerStorageKey(null, "avatar"));
        const savedBanner = window.localStorage.getItem(playerStorageKey(null, "banner"));
        setProfileName(savedGuestName);
        setHighScores(storedScores(null));
        if (isAvatarId(savedAvatar) && !isPremiumAvatar(savedAvatar)) setAvatarId(savedAvatar);
        if (isBannerId(savedBanner)) setBannerId(savedBanner);
        return;
      }

      try {
        const profileRef = doc(db, "users", user.uid);
        const [profile, premiumEntitlement, goldEntitlement, blossomEntitlement] = await Promise.all([
          getDoc(profileRef),
          getDoc(doc(db, "users", user.uid, "entitlements", "premium-avatars")),
          getDoc(doc(db, "users", user.uid, "entitlements", "gold-mode")),
          getDoc(doc(db, "users", user.uid, "entitlements", "blossom-theme")),
        ]);
        if (authLoadId.current !== loadId || auth.currentUser?.uid !== user.uid) return;
        const data = profile.data();
        const legacyPremiumAccess = data?.premiumUnlocked === true;
        const legacyGoldMode = data?.goldModeUnlocked === true;
        const legacyBlossomTheme = data?.blossomThemeUnlocked === true;
        const hasPremiumAccess = legacyPremiumAccess || activeEntitlement(premiumEntitlement);
        const hasGoldMode = legacyGoldMode || activeEntitlement(goldEntitlement);
        const hasBlossomTheme = legacyBlossomTheme || activeEntitlement(blossomEntitlement);
        const accountName = window.localStorage.getItem(playerStorageKey(user, "name"));
        const cloudName = typeof data?.displayName === "string" ? data.displayName : user.displayName || accountName || "Player One";
        const savedAvatar = window.localStorage.getItem(playerStorageKey(user, "avatar"));
        const avatarCandidate: AvatarId = isAvatarId(data?.avatarId) ? data.avatarId : isAvatarId(savedAvatar) ? savedAvatar : "play";
        const cloudAvatar: AvatarId = isPremiumAvatar(avatarCandidate) && !hasPremiumAccess ? "play" : avatarCandidate;
        const accountBanner = window.localStorage.getItem(playerStorageKey(user, "banner"));
        const cloudBanner: BannerId = isBannerId(data?.bannerId) ? data.bannerId : isBannerId(accountBanner) ? accountBanner : DEFAULT_BANNER_ID;
        const cloudScores = data?.scoreSeason === SCORE_SEASON && data?.highScores && typeof data.highScores === "object" ? data.highScores as HighScores : {};
        if (authLoadId.current !== loadId || auth.currentUser?.uid !== user.uid) return;
        setProfileName(cloudName);
        setAvatarId(cloudAvatar);
        setBannerId(cloudBanner);
        setPremiumUnlocked(hasPremiumAccess);
        setGoldModeUnlocked(hasGoldMode);
        setBlossomThemeUnlocked(hasBlossomTheme);
        const enableBlossomTheme = hasBlossomTheme && window.localStorage.getItem(BLOSSOM_ADDON_STORAGE_KEY) === "enabled";
        setBlossomThemeEnabled(enableBlossomTheme);
        if (enableBlossomTheme) document.documentElement.dataset.addon = "blossom";
        else {
          window.localStorage.removeItem(BLOSSOM_ADDON_STORAGE_KEY);
          delete document.documentElement.dataset.addon;
        }
        setHighScores(cloudScores);
        if (hasGoldMode && window.localStorage.getItem("game-garden-theme") === "gold") {
          setTheme("gold");
          document.documentElement.dataset.theme = "gold";
        } else if (!hasGoldMode && window.localStorage.getItem("game-garden-theme") === "gold") {
          window.localStorage.setItem("game-garden-theme", "classic");
          setTheme("classic");
          delete document.documentElement.dataset.theme;
        }
        window.localStorage.setItem(playerStorageKey(user, "name"), cloudName);
        window.localStorage.removeItem(playerStorageKey(user, "scores"));
        window.localStorage.setItem(playerStorageKey(user, "avatar"), cloudAvatar);
        window.localStorage.setItem(playerStorageKey(user, "banner"), cloudBanner);
        await setDoc(profileRef, {
          uid: user.uid,
          displayName: cloudName,
          photoURL: user.photoURL || "",
          avatarId: cloudAvatar,
          bannerId: cloudBanner,
          highScores: cloudScores,
          scoreSeason: SCORE_SEASON,
          // Paid entitlements stay server-owned. These fields only preserve
          // the existing test-code grants and are never derived from a purchase.
          premiumUnlocked: legacyPremiumAccess,
          goldModeUnlocked: legacyGoldMode,
          blossomThemeUnlocked: legacyBlossomTheme,
          updatedAt: serverTimestamp(),
          ...(data?.createdAt instanceof Timestamp ? {} : { createdAt: serverTimestamp() }),
        }, { merge: true });
        await syncPublicProfile(user, cloudName, cloudAvatar, cloudBanner, cloudScores);
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
          bannerId: isBannerId(data.bannerId) ? data.bannerId : DEFAULT_BANNER_ID,
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
      query(collection(db, "leaderboards", gameId, "entries"), orderBy("score", gameId === "2048" || gameId === "blackjack" ? "desc" : "asc"), limit(10)),
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
      const previousScore = previous[gameId];
      const improved = gameId === "2048" || gameId === "blackjack" ? previousScore == null || score > previousScore : previousScore == null || score < previousScore;
      if (!improved) return previous;
      const next = { ...previous, [gameId]: score };
      if (!firebaseUser || firebaseUser.isAnonymous) {
        try { window.localStorage.setItem(playerStorageKey(null, "scores"), JSON.stringify(next)); } catch { /* Device storage may be unavailable. */ }
      }
      return next;
    });
    if (firebaseUser && !firebaseUser.isAnonymous) void saveCloudScore(firebaseUser, gameId, score, profileName, avatarId, bannerId).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not save the score online."));
  }, [firebaseUser, profileName, avatarId, bannerId]);

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

  const updateBanner = useCallback((nextBanner: BannerId) => {
    setBannerId(nextBanner);
    try { window.localStorage.setItem(playerStorageKey(firebaseUser, "banner"), nextBanner); } catch { /* Device storage may be unavailable. */ }
  }, [firebaseUser]);

  const unlockPremium = useCallback(async (rawCode: string) => {
    if (!firebaseUser || firebaseUser.isAnonymous) return "Sign in before redeeming store codes.";
    const normalizedCode = rawCode.trim().toUpperCase();
    if (normalizedCode === BLOSSOM_THEME_ACCESS_CODE) {
      if (blossomThemeUnlocked) return "Blossom Theme is already unlocked for this account.";
      try {
        const redemptionRef = doc(db, "users", firebaseUser.uid, "redemptions", "blossom-theme-test");
        const batch = writeBatch(db);
        if (!(await getDoc(redemptionRef)).exists()) batch.set(redemptionRef, {
          uid: firebaseUser.uid,
          redemptionId: "blossom-theme-test",
          productId: "blossom-theme",
          source: "test-code",
          redeemedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, "users", firebaseUser.uid), {
          blossomThemeUnlocked: true,
          blossomThemeUnlockedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        await batch.commit();
        setBlossomThemeUnlocked(true);
        setBlossomThemeEnabled(true);
        document.documentElement.dataset.addon = "blossom";
        window.localStorage.setItem(BLOSSOM_ADDON_STORAGE_KEY, "enabled");
        setAuthError("");
        return "Blossom Theme unlocked and enabled for this account.";
      } catch {
        return "Could not unlock Blossom Theme. Try again.";
      }
    }
    if (normalizedCode === GOLD_MODE_ACCESS_CODE) {
      if (goldModeUnlocked) return "Gold Mode is already unlocked for this account.";
      try {
        const redemptionRef = doc(db, "users", firebaseUser.uid, "redemptions", "gold-mode-test");
        const batch = writeBatch(db);
        if (!(await getDoc(redemptionRef)).exists()) batch.set(redemptionRef, {
          uid: firebaseUser.uid,
          redemptionId: "gold-mode-test",
          productId: "gold-mode",
          source: "test-code",
          redeemedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, "users", firebaseUser.uid), {
          goldModeUnlocked: true,
          goldModeUnlockedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        await batch.commit();
        setGoldModeUnlocked(true);
        setTheme("gold");
        document.documentElement.dataset.theme = "gold";
        window.localStorage.setItem("game-garden-theme", "gold");
        setAuthError("");
        return "Gold Mode unlocked for this account.";
      } catch {
        return "Could not unlock Gold Mode. Try again.";
      }
    }
    if (normalizedCode !== PREMIUM_ACCESS_CODE) return "That store code is not valid.";
    if (premiumUnlocked) return "Premium is already unlocked for this account.";
    try {
      const redemptionRef = doc(db, "users", firebaseUser.uid, "redemptions", "legacy-premium-test");
      const batch = writeBatch(db);
      if (!(await getDoc(redemptionRef)).exists()) batch.set(redemptionRef, {
        uid: firebaseUser.uid,
        redemptionId: "legacy-premium-test",
        productId: "premium-avatars",
        source: "test-code",
        redeemedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "users", firebaseUser.uid), {
        premiumUnlocked: true,
        premiumUnlockedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      setPremiumUnlocked(true);
      setAuthError("");
      return "Premium unlocked for this account.";
    } catch {
      return "Could not unlock premium access. Try again.";
    }
  }, [blossomThemeUnlocked, firebaseUser, goldModeUnlocked, premiumUnlocked]);

  const toggleBlossomTheme = useCallback(() => {
    if (!blossomThemeUnlocked) return;
    setBlossomThemeEnabled((current) => {
      const next = !current;
      if (next) {
        document.documentElement.dataset.addon = "blossom";
        window.localStorage.setItem(BLOSSOM_ADDON_STORAGE_KEY, "enabled");
      } else {
        delete document.documentElement.dataset.addon;
        window.localStorage.removeItem(BLOSSOM_ADDON_STORAGE_KEY);
      }
      return next;
    });
  }, [blossomThemeUnlocked]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: ThemeMode = current === "classic" ? "sakura" : current === "sakura" && goldModeUnlocked ? "gold" : "classic";
      if (next !== "classic") document.documentElement.dataset.theme = next;
      else delete document.documentElement.dataset.theme;
      try { window.localStorage.setItem("game-garden-theme", next); } catch { /* Device storage may be unavailable. */ }
      return next;
    });
  }, [goldModeUnlocked]);

  const saveProfile = useCallback(async () => {
    if (!firebaseUser || firebaseUser.isAnonymous) return false;
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
        bannerId,
        highScores,
        scoreSeason: SCORE_SEASON,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await syncPublicProfile(firebaseUser, displayName, savedAvatar, bannerId, highScores);
      await updateProfile(firebaseUser, { displayName });
      const batch = writeBatch(db);
      for (const [gameId, score] of Object.entries(highScores) as [PlayableGameId, number][]) {
        batch.set(doc(db, "leaderboards", gameId, "entries", firebaseUser.uid), {
          uid: firebaseUser.uid,
          name: displayName,
          photoURL: "",
          avatarId: savedAvatar,
          bannerId,
          score,
          scoreSeason: SCORE_SEASON,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      window.localStorage.setItem(playerStorageKey(firebaseUser, "name"), displayName);
      setAvatarId(savedAvatar);
      window.localStorage.setItem(playerStorageKey(firebaseUser, "avatar"), savedAvatar);
      window.localStorage.setItem(playerStorageKey(firebaseUser, "banner"), bannerId);
      return true;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not save the profile.");
      return false;
    }
  }, [firebaseUser, highScores, profileName, avatarId, bannerId, premiumUnlocked]);

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
      if (password.length < 12) {
        setAuthError("Use a password with at least 12 characters.");
        return;
      }
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const displayName = profileName.trim() || email.split("@")[0] || "Player One";
      await updateProfile(credential.user, { displayName });
      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid,
        displayName,
        photoURL: "",
        avatarId,
        bannerId,
        highScores: {},
        scoreSeason: SCORE_SEASON,
        premiumUnlocked: false,
        goldModeUnlocked: false,
        blossomThemeUnlocked: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await syncPublicProfile(credential.user, displayName, avatarId, bannerId, {});
      setProfileName(displayName);
    } catch (error) {
      setAuthError(friendlyAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  }, [profileName, avatarId, bannerId]);

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
    if (!/^[A-Z0-9]{8}$/.test(code)) return "Enter a valid eight-character friend code.";
    if (code === friendCodeFor(firebaseUser.uid)) return "That is your own friend code.";
    try {
      const codeSnapshot = await getDoc(doc(db, "friendCodes", code));
      if (!codeSnapshot.exists()) return "No player was found with that code.";
      const friendUid = String(codeSnapshot.data().uid || "");
      if (!friendUid || friendUid === firebaseUser.uid) return friendUid === firebaseUser.uid ? "That is your own friend code." : "No player was found with that code.";
      const profileSnapshot = await getDoc(doc(db, "publicProfiles", friendUid));
      if (!profileSnapshot.exists()) return "No player was found with that code.";
      const profile = profileSnapshot.data();
      const friendName = typeof profile.name === "string" ? profile.name : "Player";
      const friendAvatar: AvatarId = isAvatarId(profile.avatarId) ? profile.avatarId : "play";
      const forwardRef = doc(db, "friendRequests", friendRequestId(firebaseUser.uid, friendUid));
      const [currentFriend, sentRequests, receivedRequests] = await Promise.all([
        getDoc(doc(db, "users", firebaseUser.uid, "friends", friendUid)),
        getDocs(query(collection(db, "friendRequests"), where("fromUid", "==", firebaseUser.uid))),
        getDocs(query(collection(db, "friendRequests"), where("toUid", "==", firebaseUser.uid))),
      ]);
      const forward = sentRequests.docs.find((request) => request.data().toUid === friendUid);
      const reverse = receivedRequests.docs.find((request) => request.data().fromUid === friendUid);
      if (currentFriend.exists()) return `${friendName} is already your friend.`;
      if (forward?.data().status === "pending") return `Your request to ${friendName} is already waiting for approval.`;
      if (reverse?.data().status === "pending") return `${friendName} already sent you a request. Accept it above.`;

      const acceptedRequests = [forward, reverse].filter((request) => request?.data().status === "accepted");
      if (acceptedRequests.length) {
        const cleanup = writeBatch(db);
        cleanup.delete(doc(db, "users", firebaseUser.uid, "friends", friendUid));
        cleanup.delete(doc(db, "users", friendUid, "friends", firebaseUser.uid));
        await cleanup.commit();
        await Promise.all(acceptedRequests.map((request) => deleteDoc(request!.ref)));
      }

      await setDoc(forwardRef, {
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
      return `Friend request sent to ${friendName}. They need to accept it.`;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      const message = code === "permission-denied"
        ? "The friend request was blocked by account permissions. Refresh and try once more."
        : code === "unavailable"
          ? "Game Garden could not reach the friend service. Check your connection and try again."
          : "Could not send that friend request. Try again.";
      setAuthError(message);
      return message;
    }
  }, [avatarId, firebaseUser, profileName]);

  const removeFriend = useCallback(async (friendUid: string) => {
    if (!firebaseUser || firebaseUser.isAnonymous) return false;
    try {
        const [sentRequests, receivedRequests] = await Promise.all([
          getDocs(query(collection(db, "friendRequests"), where("fromUid", "==", firebaseUser.uid))),
          getDocs(query(collection(db, "friendRequests"), where("toUid", "==", firebaseUser.uid))),
        ]);
        const forward = sentRequests.docs.find((request) => request.data().toUid === friendUid);
        const reverse = receivedRequests.docs.find((request) => request.data().fromUid === friendUid);
        const acceptedRequests = [forward, reverse].filter((request) => request?.data().status === "accepted");
        const accepted = acceptedRequests.length > 0;
        if (!accepted) {
          await deleteDoc(doc(db, "users", firebaseUser.uid, "friends", friendUid));
          return true;
        }
        const batch = writeBatch(db);
        batch.delete(doc(db, "users", firebaseUser.uid, "friends", friendUid));
        batch.delete(doc(db, "users", friendUid, "friends", firebaseUser.uid));
        await batch.commit();
        await Promise.all(acceptedRequests.map((request) => deleteDoc(request!.ref)));
        return true;
    } catch {
      setAuthError("Could not remove that friend.");
      return false;
    }
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
        const nextRoom: Omit<GameRoom, "createdAt" | "updatedAt" | "expiresAt"> = { code, gameId, gameName: gameDetails.name, hostUid: user.uid, hostName: name, hostAvatar: avatarId, hostBanner: bannerId, status: "open" };
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
  }, [avatarId, bannerId, rememberRoom, roomIdentity]);

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
        await updateDoc(roomRef, { guestUid: user.uid, guestName: name, guestAvatar: avatarId, guestBanner: bannerId, status: "ready", updatedAt: serverTimestamp() });
      }
      const joinedRoom: GameRoom = foundRoom.hostUid === user.uid ? foundRoom : { ...foundRoom, guestUid: user.uid, guestName: name, guestAvatar: avatarId, guestBanner: bannerId, status: "ready" };
      setActiveRoom(joinedRoom);
      rememberRoom(code, foundRoom.gameId);
      return `Joined room ${code}.`;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not join the room.");
      return "Could not join the room.";
    }
  }, [avatarId, bannerId, rememberRoom, roomIdentity]);

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
          if (data.hostUid === user.uid) {
            {
              const batch = writeBatch(db);
              batch.delete(doc(db, "rooms", code, "numberHunt", "state"));
              batch.delete(doc(db, "rooms", code, "numberHunt", "secret-1"));
              batch.delete(doc(db, "rooms", code, "numberHunt", "secret-2"));
              batch.delete(doc(db, "rooms", code, "game", "state"));
              batch.delete(roomRef);
              await batch.commit();
            }
          } else if (data.guestUid === user.uid) {
            await updateDoc(roomRef, {
              guestUid: deleteField(),
              guestName: deleteField(),
              guestAvatar: deleteField(),
              guestBanner: deleteField(),
              status: "open",
              updatedAt: serverTimestamp(),
            });
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
    const lobbyGame = MULTIPLAYER_GAME_IDS.find((gameId) => game === `${gameId}-lobby`);
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
    if (game === "checkers-menu") return <GameMenu game="checkers" onPlay={(mode) => playFromMenu("checkers", mode)} onBack={() => selectGame("games")} />;
    if (game === "battleship-menu") return <GameMenu game="battleship" onPlay={(mode) => playFromMenu("battleship", mode)} onBack={() => selectGame("games")} />;
    if (game === "dotsboxes-menu") return <GameMenu game="dotsboxes" onPlay={(mode) => playFromMenu("dotsboxes", mode)} onBack={() => selectGame("games")} />;
    if (game === "airhockey-menu") return <GameMenu game="airhockey" onPlay={(mode) => playFromMenu("airhockey", mode)} onBack={() => selectGame("games")} />;
    if (game === "2048-menu") return <GameMenu game="2048" onPlay={(mode) => playFromMenu("2048", mode)} onBack={() => selectGame("games")} />;
    if (game === "wordgarden-menu") return <GameMenu game="wordgarden" onPlay={(mode) => playFromMenu("wordgarden", mode)} onBack={() => selectGame("games")} />;
    if (game === "blackjack-menu") return <GameMenu game="blackjack" onPlay={(mode) => playFromMenu("blackjack", mode)} onBack={() => selectGame("games")} />;
    if (game === "queens-menu") return <GameMenu game="queens" onPlay={(mode) => playFromMenu("queens", mode)} onBack={() => selectGame("games")} />;
    if (game === "graphwar-menu") return <GameMenu game="graphwar" onPlay={() => selectGame("graphwar")} onBack={() => selectGame("games")} />;
    if (gameMode === "multi" && firebaseUser && activeRoom?.status === "playing" && activeRoom.gameId === game && game !== "number" && MULTIPLAYER_GAME_IDS.includes(game as PlayableGameId)) return <OnlineVersusGame room={activeRoom as GameRoom & { gameId: OnlineGameId }} user={firebaseUser} onLeave={leaveRoom} />;
    if (game === "codebreaker") return <Codebreaker mode="solo" onBack={() => selectGame("codebreaker-menu")} onScore={(score) => recordScore("codebreaker", score)} />;
    if (game === "order") return <OrderMatch mode="solo" onBack={() => selectGame("order-menu")} onScore={(score) => recordScore("order", score)} />;
    if (game === "number") return gameMode === "multi" && activeRoom?.gameId === "number" && firebaseUser ? <OnlineNumberHunt room={activeRoom} user={firebaseUser} onLeave={leaveRoom} /> : <NumberHunt mode="solo" onBack={() => selectGame("number-menu")} onScore={(score) => recordScore("number", score)} />;
    if (game === "memory") return <MemoryGame mode="solo" onBack={() => selectGame("memory-menu")} onScore={(score) => recordScore("memory", score)} />;
    if (game === "tictactoe") return <TicTacToe mode="solo" onBack={() => selectGame("tictactoe-menu")} onScore={(score) => recordScore("tictactoe", score)} />;
    if (game === "connect4") return <ConnectFour mode="solo" onBack={() => selectGame("connect4-menu")} onScore={(score) => recordScore("connect4", score)} />;
    if (game === "rps") return <RockPaperScissors mode="solo" onBack={() => selectGame("rps-menu")} onScore={(score) => recordScore("rps", score)} />;
    if (game === "dice") return <DiceRace mode="solo" onBack={() => selectGame("dice-menu")} onScore={(score) => recordScore("dice", score)} />;
    if (game === "barricade") return <Barricade mode="solo" onBack={() => selectGame("barricade-menu")} onScore={(score) => recordScore("barricade", score)} />;
    if (game === "checkers") return <Checkers onBack={() => selectGame("checkers-menu")} onScore={(score) => recordScore("checkers", score)} />;
    if (game === "battleship") return <Battleship onBack={() => selectGame("battleship-menu")} onScore={(score) => recordScore("battleship", score)} />;
    if (game === "dotsboxes") return <DotsAndBoxes onBack={() => selectGame("dotsboxes-menu")} onScore={(score) => recordScore("dotsboxes", score)} />;
    if (game === "airhockey") return <AirHockey onBack={() => selectGame("airhockey-menu")} onScore={(score) => recordScore("airhockey", score)} />;
    if (game === "2048") return <Game2048 onBack={() => selectGame("2048-menu")} onScore={(score) => recordScore("2048", score)} />;
    if (game === "wordgarden") return <WordGarden onBack={() => selectGame("wordgarden-menu")} onScore={(score) => recordScore("wordgarden", score)} />;
    if (game === "blackjack") return <Blackjack onBack={() => selectGame("blackjack-menu")} onScore={(score) => recordScore("blackjack", score)} />;
    if (game === "queens") return <Queens onBack={() => selectGame("queens-menu")} onScore={(score) => recordScore("queens", score)} />;
    if (game === "graphwar") return <GraphWar onBack={() => selectGame("graphwar-menu")} />;
    const activeTab: AppTab = game === "leaderboard" || game === "friends" || game === "store" || game === "profile" || game === "addons" ? game : "games";
    return <AppHome activeTab={activeTab} theme={theme} onThemeToggle={toggleTheme} onTabChange={selectGame} onSelect={(selected) => selectGame(`${selected}-menu`)} highScores={highScores} profileName={profileName} avatarId={avatarId} bannerId={bannerId} onProfileNameChange={updateProfileName} onAvatarChange={updateAvatar} onBannerChange={updateBanner} onProfileSave={saveProfile} onResetScores={resetScores} firebaseUser={firebaseUser} authLoading={authLoading} authError={authError} onSignIn={signIn} onEmailSignIn={emailSignIn} onEmailCreate={emailCreate} onSignOut={signOutProfile} leaderboards={leaderboards} friends={visibleFriends} friendCode={firebaseUser && !firebaseUser.isAnonymous ? friendCodeFor(firebaseUser.uid) : ""} friendLinkCode={friendLinkCode} onAddFriend={addFriend} onRemoveFriend={removeFriend} incomingFriendRequests={incomingFriendRequests} outgoingFriendRequests={outgoingFriendRequests} onRespondFriendRequest={respondFriendRequest} onCancelFriendRequest={cancelFriendRequest} incomingInvites={incomingInvites} outgoingInvites={outgoingInvites} onSendInvite={sendInvite} onRespondInvite={respondInvite} onCancelInvite={cancelInvite} onCloseInvite={closeInvite} onJoinLobby={(gameId, inviteRoomCode) => { if (inviteRoomCode) void joinRoom(inviteRoomCode, profileName); else selectGame(`${gameId}-lobby`); }} onOpenChat={openFriendChat} premiumUnlocked={premiumUnlocked} goldModeUnlocked={goldModeUnlocked} blossomThemeUnlocked={blossomThemeUnlocked} blossomThemeEnabled={blossomThemeEnabled} onBlossomThemeToggle={toggleBlossomTheme} onUnlockPremium={unlockPremium} />;
  }, [game, gameMode, theme, highScores, profileName, avatarId, bannerId, recordScore, toggleTheme, updateProfileName, updateAvatar, updateBanner, saveProfile, resetScores, firebaseUser, authLoading, authError, signIn, emailSignIn, emailCreate, signOutProfile, leaderboards, visibleFriends, friendLinkCode, addFriend, removeFriend, incomingFriendRequests, outgoingFriendRequests, respondFriendRequest, cancelFriendRequest, incomingInvites, outgoingInvites, activeRoom, roomCode, createRoom, joinRoom, leaveRoom, startVersus, sendInvite, respondInvite, cancelInvite, closeInvite, openFriendChat, premiumUnlocked, goldModeUnlocked, blossomThemeUnlocked, blossomThemeEnabled, toggleBlossomTheme, unlockPremium]);

  return <ChatChromeProvider enabled={Boolean(firebaseUser && !firebaseUser.isAnonymous)} open={chatOpen} unreadCount={chatUnreadCount} onToggle={() => setChatOpen((current) => !current)}>{view}<FriendsChat key={firebaseUser?.uid ?? "signed-out"} user={firebaseUser} profileName={profileName} avatarId={avatarId} friends={visibleFriends} open={chatOpen} selectedUid={chatTargetUid} onClose={() => setChatOpen(false)} onSelectFriend={setChatTargetUid} onUnreadCountChange={setChatUnreadCount} /></ChatChromeProvider>;
}
