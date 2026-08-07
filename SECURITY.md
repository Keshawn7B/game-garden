# Game Garden security

## Security model

Game Garden is a public browser game backed by Firebase Authentication and Cloud Firestore. Treat every browser, URL parameter, room code, game move, score, profile field, and store product ID as attacker-controlled. Firestore Security Rules and a future trusted payment service are the authorization boundary; React UI checks are only usability checks.

The Firebase web API key in `app/firebase.ts` identifies this Firebase project. It is intentionally browser-visible and is not an Admin credential. Authorization comes from Firebase Auth, Firestore Rules, App Check, and Google Cloud IAM. Service-account keys, payment keys, and webhook secrets must never be added to this repository or any `NEXT_PUBLIC_*` variable.

## Controls in this repository

- Private account documents are readable only by their authenticated owner. Anonymous sessions cannot read permanent profiles, friends, entitlements, or checkout records.
- Public profiles and friend codes support direct lookup only. Collection listing is denied to reduce bulk player scraping.
- Friend relationships require a two-party request/accept flow. Chat data and messages are limited to the two participants, with bounded strings and map shapes.
- Rooms can be fetched only by an exact cryptographically random code and cannot be listed. Room, invite, and game documents have strict schemas, sizes, roles, transitions, and expiration limits.
- Browser clients cannot write `storeProducts`, `checkoutSessions`, `purchaseEvents`, or paid entitlement documents. A paid item must be granted by a trusted server using the Admin SDK.
- The legacy `GOLD` and `SOKEY` test codes create immutable audit records before enabling their legacy test flags. They are public test promotions, not purchase proof or secrets.
- Account data, scores, and locally cached data are reset when authentication changes so one account cannot inherit another account's UI state.
- New email/password accounts require at least 12 characters in the client. Existing shorter-password accounts may still sign in.
- Browser responses use a restrictive Content Security Policy, clickjacking protection, MIME sniffing protection, limited browser permissions, strict referrer handling, and no-store caching for HTML. Firebase's static export moves startup code into hash-named same-origin files so CSP does not need `unsafe-inline` for scripts.
- The Cloudflare/Sites runtime generates a fresh CSP nonce for every HTML response.
- Firebase App Check with reCAPTCHA Enterprise is wired into the app and initializes before Auth or Firestore when `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` is configured.
- Dependencies are pinned and the security test command audits production packages and exercises Firestore Rules in the emulator.

Run the security checks with:

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run test:security
```

## Firebase console hardening still required

Repository code cannot enable these project-level controls. Complete them before considering the backend fully hardened:

1. In Firebase App Check, register the web app with a score-based reCAPTCHA Enterprise key that allows these hosts:
   - `gamegardenplay.web.app`
   - `game-garden-658de.web.app`
   - `pocket-play-arcade.kfuture.chatgpt.site`
2. Put the public site key in local/deployment build configuration as `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`. Monitor App Check metrics first, then enforce App Check for Cloud Firestore and Authentication.
3. In Firebase Authentication, keep only the three production hosts above plus required local development hosts in Authorized domains. Enable email-enumeration protection, configure a server-side password policy of at least 12 characters, and set defensive Identity Toolkit sign-in/sign-up quotas.
4. In Google Cloud Credentials, verify that the Firebase browser API key is restricted to the exact production origins and only the Firebase APIs the app uses. Do not delete the browser key merely because a scanner calls it a secret.
5. Enable Firebase/Google Cloud budget alerts, usage alerts, audit logging, and billing limits appropriate for a public game. Add retention/TTL policies for expired rooms, invites, old chats, and processed purchase events.

## Secure store implementation contract

The current store is a visual preview and code-redemption test. Before enabling real purchases, build the purchase path on a trusted server such as Cloud Functions or another protected backend:

1. Require and verify both the user's Firebase ID token and an App Check token. Refuse anonymous accounts for purchases.
2. Accept only a product identifier from the browser. Load product availability, price, currency, and payment price ID from the server-owned catalog; never accept a client-supplied price or entitlement.
3. Create the hosted Checkout Session on the server. Put the Firebase UID and an internal order ID in trusted session metadata, and store a server-owned pending checkout record.
4. Grant nothing from the success page. Verify the payment provider's webhook signature against the untouched raw request body and confirm the session is paid.
5. Make fulfillment idempotent by recording the provider event ID/order ID and atomically writing the purchase record plus `users/{uid}/entitlements/{productId}`. Replayed events must return the existing result without granting twice.
6. Handle delayed payment success/failure, refunds, disputes, cancellations, entitlement expiration, and administrative revocation. Keep a non-editable audit trail.
7. Store payment API keys and webhook secrets only in a managed secret store. Never log secrets, full payment payloads, passwords, ID tokens, or unnecessary personal data.
8. Rate-limit checkout creation and promo-code attempts by account, IP/risk signal, and time window. Real promo codes must be redeemed and validated by the server; they must not be hard-coded into the browser bundle.

The Firestore paths `storeProducts`, `checkoutSessions`, `purchaseEvents`, and `users/{uid}/entitlements/{productId}` already reserve this trust boundary: clients can read only the data needed for their own account and cannot create or modify purchase proof.

## Known game-integrity boundary

Firestore Rules protect account and purchase authorization, but a browser-hosted game cannot prove that a single-player score came from unmodified game code. Some multiplayer state is also client-authoritative. Treat current leaderboards as casual. Before prizes, paid tournaments, or competitive rankings, move score calculation and hidden game state to an authoritative server or validate signed move logs/replays server-side.

## Reporting and incident response

Do not open a public issue containing a vulnerability, credential, token, or user data. Contact the repository owner privately with the affected URL, impact, and reproducible steps. If a real secret is exposed: revoke or rotate it first, review Firebase/Auth/payment logs, disable the affected path, invalidate sessions or entitlements as needed, and only then remove it from history. Removing a secret from Git alone does not revoke it.

References: [Firebase security checklist](https://firebase.google.com/support/guides/security-checklist), [Firebase App Check for web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider), [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature), and [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment).
