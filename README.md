# Game Garden

Game Garden is a mobile-first Japanese-styled game hub with single-player games, live Firebase multiplayer rooms, account profiles, friends, chat, leaderboards, and a preview store.

The arcade includes logic, memory, strategy, word, arcade, and card games, including Queens: a color-region crown puzzle with four rotating courts and account-specific best times.

Public builds:

- <https://gamegardenplay.web.app>
- <https://game-garden-658de.web.app>
- <https://pocket-play-arcade.kfuture.chatgpt.site>

## Local development

Requirements: Node.js 22.13 or newer.

```powershell
npm.cmd install
npm.cmd run dev
```

Copy `.env.example` to an ignored `.env.local` when configuring Firebase App Check. Never put Admin credentials, service-account keys, payment keys, or webhook secrets in `NEXT_PUBLIC_*` variables.

## Checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run test:security
npm.cmd run build:firebase
```

`test:security` audits production dependencies and runs the Firestore Rules emulator suite. `build:firebase` creates the ignored `firebase-public/` bundle and externalizes framework startup scripts so Firebase Hosting can enforce a strict script policy.

## Data and hosting

- Firebase Authentication identifies permanent accounts and anonymous multiplayer guests.
- Cloud Firestore stores profiles, friends, chats, invites, rooms, game state, and account-specific scores.
- Firebase Hosting serves the two `web.app` addresses from the static export.
- Sites serves the mirrored Cloudflare/vinext build.
- Real store purchases are not enabled. The Firestore schema reserves server-owned catalog, checkout, purchase-event, and entitlement paths for a future trusted payment backend.

Read [SECURITY.md](./SECURITY.md) before changing authentication, Firestore data, multiplayer state, promo codes, or store behavior.
