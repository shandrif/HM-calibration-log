# HM Calibration Log

Website for 100+ HM stores to log espresso and drip calibrations and track batch freshness, with a loud alarm on expiry, branded daily PDF reports, a 500 m location lock and Arabic/English. Runs entirely on Cloudflare's free tier.

| Station | Items | Batch life |
|---|---|---|
| Espresso | Hot + Cold machines, or one machine for both | 3 h |
| Hot drip | Ethiopian, Brazilian | 30 min after the 5:30 brew |
| Iced drip | Ethiopian, Brazilian | 1 h after the 5:30 brew |

## How it works

- **Store device:** sign in once with store code + PIN (location checked), tap **Tap to begin** each time the page opens (this enables sound and keeps the screen awake).
- **Drip:** 1 tap on **Start**. If an earlier batch existed, a sheet asks how much was thrown away (None / ¼ / ½ / ¾ L / Other in 0.25 L steps); it closes by itself after 10 s.
- **Espresso:** **Calibrate** opens dose 1 / dose 2, pre-filled with the last values. The right-hand number only moves in steps of 5 (00–95).
- **Undo** for 2 minutes after Start; after that, **⋯ → Reset batch** until it expires. Reset batches stay in the log, marked "Reset".
- **Alarm:** loud repeating buzzer while the page is open, until **Stop alarm** or a new batch. Optional push notifications when the page is closed (Android; iPhone only when added to the Home Screen).
- **Log:** any of the last 92 days, **Download PDF** / **Share** (built on the device).
- **Head office:** `/admin` — add/edit stores, PINs, GPS location, radius, espresso setup; see today's activity per store, download any store's PDF, and see free-tier usage with a warning at 70%.

## Free-tier design

- One database row per store per day holds all its batches, so a log is **1 row written** and the nightly clean-up deletes **1 row per store per day**.
- Countdowns run on the device. The app syncs only on open, when the page becomes visible again, and every 10 minutes, and does not poll.
- Static files are served by Cloudflare without running the Worker (they don't count as requests).
- PDFs are generated on the device (no server CPU).
- Scheduled jobs: every minute (expiry push), hourly (usage check), daily 00:30 Riyadh (delete data older than 92 days).

## Project layout

```
shared/config.ts      stations, timings, dose format (used by both sides)
worker/               Cloudflare Worker API (Hono) + scheduled jobs
migrations/           D1 schema
src/                  React web app (store board, log, PDF, admin)
public/sw.js          service worker (offline shell + push)
```

## Local development

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run preview
```

Open http://localhost:8787/admin (password from `.dev.vars`), add a store, then sign in at http://localhost:8787.

## Deploy

```bash
npm run deploy
```

Secrets (set once with `npx wrangler secret put <NAME>`):

| Secret | Purpose |
|---|---|
| `SESSION_SECRET` | signs sign-in cookies and peppers PIN hashes (changing it signs everyone out and invalidates all PINs) |
| `ADMIN_PASSWORD` | head-office password for `/admin` |
| `VAPID_PRIVATE_JWK` | push notification signing key (public key is `VAPID_PUBLIC_KEY` in `wrangler.jsonc`) |
| `ANALYTICS_TOKEN` | optional: Cloudflare token with **Account Analytics: Read** for the 70% usage warning |

## Branding

The ½M mark in `src/components/Logo.tsx` and `public/icons/` is a placeholder. Replace with the official SVG. The UI and PDF use IBM Plex Sans Arabic (free, Latin + Arabic) instead of Frutiger LT Arabic, which needs a web licence.
