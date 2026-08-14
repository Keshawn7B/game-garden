import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-game-garden-security";
const passwordClaims = { firebase: { sign_in_provider: "password" } };
const anonymousClaims = { firebase: { sign_in_provider: "anonymous" } };
let testEnv;

function accountProfile(uid, displayName = "Player One") {
  return {
    uid,
    displayName,
    photoURL: "",
    avatarId: "play",
    bannerId: "torii",
    highScores: {},
    scoreSeason: 2,
    premiumUnlocked: false,
    goldModeUnlocked: false,
    blossomThemeUnlocked: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function createAccount(uid, displayName = "Player One") {
  const db = testEnv.authenticatedContext(uid, passwordClaims).firestore();
  await assertSucceeds(setDoc(doc(db, "users", uid), accountProfile(uid, displayName)));
  return db;
}

async function createPublicProfile(uid, displayName = "Player One", code = "ABC12345") {
  const db = testEnv.authenticatedContext(uid, passwordClaims).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "publicProfiles", uid), {
    uid,
    name: displayName,
    avatarId: "play",
    bannerId: "torii",
    friendCode: code,
    highScores: {},
    scoreSeason: 2,
    online: true,
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "friendCodes", code), {
    code,
    uid,
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
}

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

test("accounts are private and cannot be modified by another user", async () => {
  const alice = await createAccount("alice", "Alice");
  const bob = testEnv.authenticatedContext("bob", passwordClaims).firestore();
  const anonymous = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(alice, "users", "alice")));
  await assertFails(getDoc(doc(bob, "users", "alice")));
  await assertFails(getDoc(doc(anonymous, "users", "alice")));
  await assertFails(updateDoc(doc(bob, "users", "alice"), { displayName: "Owned", updatedAt: serverTimestamp() }));
});

test("a browser cannot mint a paid entitlement", async () => {
  const alice = await createAccount("alice", "Alice");

  await assertFails(setDoc(doc(alice, "users", "alice", "entitlements", "gold-mode"), {
    uid: "alice",
    productId: "gold-mode",
    status: "active",
    source: "browser",
    grantedAt: serverTimestamp(),
  }));
});

test("a trusted entitlement unlocks its item without copying purchase authority into the profile", async () => {
  const alice = await createAccount("alice", "Alice");
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", "alice", "entitlements", "premium-avatars"), {
      uid: "alice",
      productId: "premium-avatars",
      status: "active",
      grantedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    });
  });

  await assertSucceeds(updateDoc(doc(alice, "users", "alice"), {
    avatarId: "premium-cat",
    updatedAt: serverTimestamp(),
  }));
  const profile = await getDoc(doc(alice, "users", "alice"));
  if (profile.data().premiumUnlocked !== false) throw new Error("A server entitlement must not mutate the legacy client flag.");
});

test("an old account can add a missing immutable creation timestamp exactly once", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const seeded = accountProfile("alice", "Alice");
    delete seeded.createdAt;
    seeded.updatedAt = Timestamp.now();
    await setDoc(doc(context.firestore(), "users", "alice"), seeded);
  });
  const alice = testEnv.authenticatedContext("alice", passwordClaims).firestore();
  await assertSucceeds(updateDoc(doc(alice, "users", "alice"), {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(alice, "users", "alice"), {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
});

test("an older account can safely add a missing blossom flag as locked", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const seeded = accountProfile("alice", "Alice");
    delete seeded.blossomThemeUnlocked;
    seeded.updatedAt = Timestamp.now();
    await setDoc(doc(context.firestore(), "users", "alice"), seeded);
  });
  const alice = testEnv.authenticatedContext("alice", passwordClaims).firestore();
  await assertSucceeds(updateDoc(doc(alice, "users", "alice"), {
    blossomThemeUnlocked: false,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(alice, "users", "alice"), {
    blossomThemeUnlocked: true,
    updatedAt: serverTimestamp(),
  }));
});

test("store records are public catalog data but checkout and fulfillment remain server-owned", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await setDoc(doc(admin, "storeProducts", "gold-mode"), { active: false, name: "Gold Mode" });
    await setDoc(doc(admin, "checkoutSessions", "checkout-1"), { uid: "alice", status: "pending" });
  });
  const publicDb = testEnv.unauthenticatedContext().firestore();
  const alice = testEnv.authenticatedContext("alice", passwordClaims).firestore();
  const bob = testEnv.authenticatedContext("bob", passwordClaims).firestore();

  await assertSucceeds(getDoc(doc(publicDb, "storeProducts", "gold-mode")));
  await assertSucceeds(getDoc(doc(alice, "checkoutSessions", "checkout-1")));
  await assertFails(getDoc(doc(bob, "checkoutSessions", "checkout-1")));
  await assertFails(setDoc(doc(alice, "checkoutSessions", "browser-created"), { uid: "alice", status: "paid" }));
  await assertFails(setDoc(doc(alice, "purchaseEvents", "fake-event"), { uid: "alice", paid: true }));
});

test("gold cannot be self-granted without its auditable test redemption", async () => {
  const alice = await createAccount("alice", "Alice");
  const userRef = doc(alice, "users", "alice");

  await assertFails(updateDoc(userRef, {
    goldModeUnlocked: true,
    goldModeUnlockedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const batch = writeBatch(alice);
  batch.set(doc(alice, "users", "alice", "redemptions", "gold-mode-test"), {
    uid: "alice",
    redemptionId: "gold-mode-test",
    productId: "gold-mode",
    source: "test-code",
    redeemedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(userRef, {
    goldModeUnlocked: true,
    goldModeUnlockedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
});

test("blossom theme cannot be self-granted without its auditable test redemption", async () => {
  const alice = await createAccount("alice", "Alice");
  const userRef = doc(alice, "users", "alice");

  await assertFails(updateDoc(userRef, {
    blossomThemeUnlocked: true,
    blossomThemeUnlockedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const batch = writeBatch(alice);
  batch.set(doc(alice, "users", "alice", "redemptions", "blossom-theme-test"), {
    uid: "alice",
    redemptionId: "blossom-theme-test",
    productId: "blossom-theme",
    source: "test-code",
    redeemedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(userRef, {
    blossomThemeUnlocked: true,
    blossomThemeUnlockedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
});

test("blossom redemption works for an account that already owns premium and gold", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const seeded = accountProfile("alice", "Alice");
    seeded.premiumUnlocked = true;
    seeded.premiumUnlockedAt = Timestamp.now();
    seeded.goldModeUnlocked = true;
    seeded.goldModeUnlockedAt = Timestamp.now();
    seeded.legacyRank = "garden-veteran";
    seeded.highScores = { legacyGame: 0 };
    seeded.updatedAt = Timestamp.now();
    await setDoc(doc(context.firestore(), "users", "alice"), seeded);
  });
  const alice = testEnv.authenticatedContext("alice", passwordClaims).firestore();
  const batch = writeBatch(alice);
  batch.set(doc(alice, "users", "alice", "redemptions", "blossom-theme-test"), {
    uid: "alice",
    redemptionId: "blossom-theme-test",
    productId: "blossom-theme",
    source: "test-code",
    redeemedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(alice, "users", "alice"), {
    blossomThemeUnlocked: true,
    blossomThemeUnlockedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
});

test("profile discovery uses direct friend-code lookups and blocks directory scraping", async () => {
  await createAccount("alice", "Alice");
  await createPublicProfile("alice", "Alice", "ABC12345");
  const bob = testEnv.authenticatedContext("bob", passwordClaims).firestore();
  const anonymous = testEnv.authenticatedContext("guest", anonymousClaims).firestore();

  await assertSucceeds(getDoc(doc(bob, "friendCodes", "ABC12345")));
  await assertSucceeds(getDoc(doc(bob, "publicProfiles", "alice")));
  await assertFails(getDocs(collection(bob, "publicProfiles")));
  await assertFails(getDoc(doc(anonymous, "publicProfiles", "alice")));
});

test("friend acceptance creates both sides and only friends can start a direct chat", async () => {
  const alice = await createAccount("alice", "Alice");
  const bob = await createAccount("bob", "Bob");
  await createPublicProfile("alice", "Alice", "ABC12345");
  await createPublicProfile("bob", "Bob", "BOB12345");
  const requestRef = doc(alice, "friendRequests", "alice--bob");
  await assertSucceeds(setDoc(requestRef, {
    fromUid: "alice",
    fromName: "Alice",
    fromAvatar: "play",
    toUid: "bob",
    toName: "Bob",
    toAvatar: "play",
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const acceptance = writeBatch(bob);
  acceptance.update(doc(bob, "friendRequests", "alice--bob"), {
    status: "accepted",
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  acceptance.set(doc(bob, "users", "bob", "friends", "alice"), {
    uid: "alice", name: "Alice", avatarId: "play", addedAt: serverTimestamp(),
  });
  acceptance.set(doc(bob, "users", "alice", "friends", "bob"), {
    uid: "bob", name: "Bob", avatarId: "play", addedAt: serverTimestamp(),
  });
  await assertSucceeds(acceptance.commit());

  const chat = writeBatch(alice);
  chat.set(doc(alice, "directChats", "alice--bob"), {
    userA: "alice",
    userB: "bob",
    participants: ["alice", "bob"],
    userAName: "Alice",
    userAAvatar: "play",
    userBName: "Bob",
    userBAvatar: "play",
    lastMessage: "Hello",
    lastSenderUid: "alice",
    lastMessageAt: serverTimestamp(),
    unreadBy: { alice: false, bob: true },
    updatedAt: serverTimestamp(),
  });
  chat.set(doc(alice, "directChats", "alice--bob", "messages", "message-1"), {
    senderUid: "alice",
    senderName: "Alice",
    senderAvatar: "play",
    text: "Hello",
    sentAt: serverTimestamp(),
  });
  await assertSucceeds(chat.commit());
  await assertSucceeds(getDoc(doc(bob, "directChats", "alice--bob", "messages", "message-1")));
});

test("leaderboard writes succeed only when the same atomic write updates the account score", async () => {
  const alice = await createAccount("alice", "Alice");
  await createPublicProfile("alice", "Alice", "ABC12345");
  const entryRef = doc(alice, "leaderboards", "tictactoe", "entries", "alice");
  const entry = {
    uid: "alice", name: "Alice", photoURL: "", avatarId: "play", bannerId: "torii", score: 3, scoreSeason: 2, updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(entryRef, entry));

  const scoreBatch = writeBatch(alice);
  scoreBatch.update(doc(alice, "users", "alice"), {
    highScores: { tictactoe: 3 }, scoreSeason: 2, avatarId: "play", bannerId: "torii", updatedAt: serverTimestamp(),
  });
  scoreBatch.set(doc(alice, "publicProfiles", "alice"), {
    uid: "alice",
    name: "Alice",
    avatarId: "play",
    bannerId: "torii",
    friendCode: "ABC12345",
    highScores: { tictactoe: 3 },
    scoreSeason: 2,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  scoreBatch.set(entryRef, entry);
  await assertSucceeds(scoreBatch.commit());

  await assertFails(updateDoc(entryRef, { score: 2, updatedAt: serverTimestamp() }));
});

test("2048 accepts an account-specific high score and rejects impossible values", async () => {
  const alice = await createAccount("alice", "Alice");
  await createPublicProfile("alice", "Alice", "ABC12345");
  const score = 32768;
  const batch = writeBatch(alice);
  batch.update(doc(alice, "users", "alice"), {
    highScores: { "2048": score }, scoreSeason: 2, avatarId: "play", bannerId: "torii", updatedAt: serverTimestamp(),
  });
  batch.set(doc(alice, "publicProfiles", "alice"), {
    uid: "alice", name: "Alice", avatarId: "play", bannerId: "torii", friendCode: "ABC12345", highScores: { "2048": score }, scoreSeason: 2, updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(alice, "leaderboards", "2048", "entries", "alice"), {
    uid: "alice", name: "Alice", photoURL: "", avatarId: "play", bannerId: "torii", score, scoreSeason: 2, updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(alice, "users", "alice"), {
    highScores: { "2048": 1000001 }, updatedAt: serverTimestamp(),
  }));
});

test("Word Garden accepts an account-specific guess score", async () => {
  const alice = await createAccount("alice", "Alice");
  await createPublicProfile("alice", "Alice", "ABC12345");
  const score = 4;
  const batch = writeBatch(alice);
  batch.update(doc(alice, "users", "alice"), {
    highScores: { wordgarden: score }, scoreSeason: 2, avatarId: "play", bannerId: "torii", updatedAt: serverTimestamp(),
  });
  batch.set(doc(alice, "publicProfiles", "alice"), {
    uid: "alice", name: "Alice", avatarId: "play", bannerId: "torii", friendCode: "ABC12345", highScores: { wordgarden: score }, scoreSeason: 2, updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(alice, "leaderboards", "wordgarden", "entries", "alice"), {
    uid: "alice", name: "Alice", photoURL: "", avatarId: "play", bannerId: "torii", score, scoreSeason: 2, updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
});

test("Blackjack accepts an account-specific chip bankroll and rejects impossible values", async () => {
  const alice = await createAccount("alice", "Alice");
  await createPublicProfile("alice", "Alice", "ABC12345");
  const score = 2475;
  const batch = writeBatch(alice);
  batch.update(doc(alice, "users", "alice"), {
    highScores: { blackjack: score }, scoreSeason: 2, avatarId: "play", bannerId: "torii", updatedAt: serverTimestamp(),
  });
  batch.set(doc(alice, "publicProfiles", "alice"), {
    uid: "alice", name: "Alice", avatarId: "play", bannerId: "torii", friendCode: "ABC12345", highScores: { blackjack: score }, scoreSeason: 2, updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(alice, "leaderboards", "blackjack", "entries", "alice"), {
    uid: "alice", name: "Alice", photoURL: "", avatarId: "play", bannerId: "torii", score, scoreSeason: 2, updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(alice, "users", "alice"), {
    highScores: { blackjack: 1000001 }, updatedAt: serverTimestamp(),
  }));
});

test("Queens accepts an account-specific best time and rejects impossible values", async () => {
  const alice = await createAccount("alice", "Alice");
  await createPublicProfile("alice", "Alice", "ABC12345");
  const score = 94;
  const batch = writeBatch(alice);
  batch.update(doc(alice, "users", "alice"), {
    highScores: { queens: score }, scoreSeason: 2, avatarId: "play", bannerId: "torii", updatedAt: serverTimestamp(),
  });
  batch.set(doc(alice, "publicProfiles", "alice"), {
    uid: "alice", name: "Alice", avatarId: "play", bannerId: "torii", friendCode: "ABC12345", highScores: { queens: score }, scoreSeason: 2, updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(alice, "leaderboards", "queens", "entries", "alice"), {
    uid: "alice", name: "Alice", photoURL: "", avatarId: "play", bannerId: "torii", score, scoreSeason: 2, updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(alice, "users", "alice"), {
    highScores: { queens: 10001 }, updatedAt: serverTimestamp(),
  }));
});

test("room codes allow a direct join lookup but cannot be listed", async () => {
  const host = testEnv.authenticatedContext("host", anonymousClaims).firestore();
  const guest = testEnv.authenticatedContext("guest", anonymousClaims).firestore();
  const roomRef = doc(host, "rooms", "ABC234");
  await assertSucceeds(setDoc(roomRef, {
    code: "ABC234",
    gameId: "tictactoe",
    gameName: "Tic Tac Toe",
    hostUid: "host",
    hostName: "Host Player",
    hostAvatar: "play",
    hostBanner: "torii",
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  }));

  await assertSucceeds(getDoc(doc(guest, "rooms", "ABC234")));
  await assertFails(getDocs(collection(guest, "rooms")));
  await assertSucceeds(updateDoc(doc(guest, "rooms", "ABC234"), {
    guestUid: "guest",
    guestName: "Guest Player",
    guestAvatar: "play",
    guestBanner: "sakura-moon",
    status: "ready",
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(guest, "rooms", "ABC234")));
  await assertSucceeds(updateDoc(doc(guest, "rooms", "ABC234"), {
    guestUid: deleteField(),
    guestName: deleteField(),
    guestAvatar: deleteField(),
    guestBanner: deleteField(),
    status: "open",
    updatedAt: serverTimestamp(),
  }));
});

test("a joined room can start and play an online game without exposing it to outsiders", async () => {
  const host = testEnv.authenticatedContext("host", anonymousClaims).firestore();
  const guest = testEnv.authenticatedContext("guest", anonymousClaims).firestore();
  const outsider = testEnv.authenticatedContext("outsider", anonymousClaims).firestore();
  const roomRef = doc(host, "rooms", "DEF567");
  await assertSucceeds(setDoc(roomRef, {
    code: "DEF567",
    gameId: "tictactoe",
    gameName: "Tic Tac Toe",
    hostUid: "host",
    hostName: "Host Player",
    hostAvatar: "play",
    hostBanner: "torii",
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  }));
  await assertSucceeds(updateDoc(doc(guest, "rooms", "DEF567"), {
    guestUid: "guest",
    guestName: "Guest Player",
    guestAvatar: "play",
    guestBanner: "koi-current",
    status: "ready",
    updatedAt: serverTimestamp(),
  }));

  const stateRef = doc(host, "rooms", "DEF567", "game", "state");
  const start = writeBatch(host);
  start.set(stateRef, {
    gameId: "tictactoe",
    roomCode: "DEF567",
    players: ["host", "guest"],
    names: ["Host Player", "Guest Player"],
    turnUid: "host",
    phase: "playing",
    round: 1,
    moves: 0,
    scores: [0, 0],
    winnerUid: "",
    board: Array(9).fill(""),
    secret: [],
    guesses: [],
    target: [],
    objects: [],
    checks: [],
    deck: [],
    open: [],
    matched: [],
    choices: [],
    positions: [0, 0],
    faces: [0, 0],
    barricades: [],
    wallsLeft: [10, 10],
    fleets: { p0: [], p1: [] },
    shots: { p0: [], p1: [] },
    ready: [false, false],
    lastShots: [-1, -1],
    airEndsAt: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  start.update(roomRef, { status: "playing", updatedAt: serverTimestamp() });
  await assertSucceeds(start.commit());

  const board = Array(9).fill("");
  board[0] = "X";
  await assertSucceeds(updateDoc(stateRef, {
    board,
    moves: 1,
    turnUid: "guest",
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(doc(guest, "rooms", "DEF567", "game", "state")));
  await assertFails(getDoc(doc(outsider, "rooms", "DEF567", "game", "state")));
});

test("Graph War supports private online placement and alternating function shots", async () => {
  const host = testEnv.authenticatedContext("graph-host", anonymousClaims).firestore();
  const guest = testEnv.authenticatedContext("graph-guest", anonymousClaims).firestore();
  const outsider = testEnv.authenticatedContext("graph-outsider", anonymousClaims).firestore();
  const roomRef = doc(host, "rooms", "GRF234");
  await assertSucceeds(setDoc(roomRef, {
    code: "GRF234", gameId: "graphwar", gameName: "Graph War",
    hostUid: "graph-host", hostName: "Graph Host", hostAvatar: "play", hostBanner: "torii",
    status: "open", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  }));
  await assertSucceeds(updateDoc(doc(guest, "rooms", "GRF234"), {
    guestUid: "graph-guest", guestName: "Graph Guest", guestAvatar: "play", guestBanner: "koi-current",
    status: "ready", updatedAt: serverTimestamp(),
  }));

  const stateRef = doc(host, "rooms", "GRF234", "game", "state");
  const start = writeBatch(host);
  start.set(stateRef, {
    gameId: "graphwar", roomCode: "GRF234", players: ["graph-host", "graph-guest"], names: ["Graph Host", "Graph Guest"],
    turnUid: "graph-host", phase: "placing", round: 1, moves: 0, scores: [0, 0], winnerUid: "", board: [],
    secret: [], guesses: [], target: [], objects: [], checks: [], deck: [], open: [], matched: [], choices: [],
    positions: [-1, -1], faces: [0, 0], barricades: [], wallsLeft: [10, 10], fleets: { p0: [], p1: [] },
    shots: { p0: [], p1: [] }, ready: [false, false], lastShots: [-1, -1], airEndsAt: 0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  start.update(roomRef, { status: "playing", updatedAt: serverTimestamp() });
  await assertSucceeds(start.commit());
  await assertSucceeds(updateDoc(stateRef, { positions: [58, -1], ready: [true, false], turnUid: "graph-guest", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(guest, "rooms", "GRF234", "game", "state"), { positions: [58, 230], ready: [true, true], phase: "playing", turnUid: "graph-host", updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(stateRef, { open: [0, 100, 0], moves: 1, turnUid: "graph-guest", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(outsider, "rooms", "GRF234", "game", "state"), { open: [0, 100, 0, 1, 0, 0], moves: 2, updatedAt: serverTimestamp() }));
});

test("nonparticipants cannot read a direct chat", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "directChats", "alice--bob"), {
      userA: "alice",
      userB: "bob",
      participants: ["alice", "bob"],
      userAName: "Alice",
      userAAvatar: "play",
      userBName: "Bob",
      userBAvatar: "play",
      lastMessage: "Hello",
      lastSenderUid: "alice",
      lastMessageAt: Timestamp.now(),
      unreadBy: { bob: true },
      updatedAt: Timestamp.now(),
    });
  });

  const alice = testEnv.authenticatedContext("alice", passwordClaims).firestore();
  const mallory = testEnv.authenticatedContext("mallory", passwordClaims).firestore();
  await assertSucceeds(getDoc(doc(alice, "directChats", "alice--bob")));
  await assertFails(getDoc(doc(mallory, "directChats", "alice--bob")));
});
