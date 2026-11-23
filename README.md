# HM Calibration Log

Website for 100+ HM stores to log espresso and drip calibrations and track batch freshness, with a loud alarm on expiry, branded daily PDF reports, a 500 m location lock and Arabic/English. Runs entirely on Cloudflare's free tier.

| Station | Items | Batch life |
|---|---|---|
| Espresso | Hot + Cold machines, or one machine for both | 3 h |
| Hot drip | Ethiopian, Brazilian | 30 min after the 5:30 brew |
| Iced drip | Ethiopian, Brazilian | 1 h after the 5:30 brew |

## How it works

- **Store device:** sign in once with store code + PIN (location checked), tap **Tap to begin** each time the page opens (this enables sound and keeps the screen awake).
- **Shift:** tap names in the **On shift** bar to add or remove people; several people can be on shift. Each log records who did it.
- **Drip:** 1 tap on **Start** (when 2+ people are on shift, one more tap picks who is brewing). If an earlier batch existed, a sheet asks how much was thrown away (None / ¼ / ½ / ¾ L / Other in 0.25 L steps); it closes by itself after 10 s.
- **Espresso:** **Calibrate** opens dose 1 / dose 2, pre-filled with the last values, shots thrown (dose 1 = 18.8 g, dose 2 = 25.8 g) and **Calibrated by** (pre-selected with the last person who logged). The right-hand number only moves in steps of 5 (00–95).
- **Undo** for 2 minutes after Start; after that, **⋯ → Reset batch** until it expires. Reset batches stay in the log, marked "Reset".
- **Alarm:** loud repeating buzzer while the page is open, until **Stop alarm** or a new batch. Optional push notifications when the page is closed (Android; iPhone only when added to the Home Screen).
- **Log:** any of the last 92 days, **Download PDF** / **Share** (built on the device).
- **Head office:** `/admin` — add/edit stores, PINs, GPS location, radius, espresso setup; see today's activity per store, download any store's PDF, and see free-tier usage with a warning at 70%.

## Store master data (weekly sync)

Stores, cities, regions, area managers and ROMs come from **Master_Location_Mapping.xlsx** on SharePoint (sheet `Location_Mapping`). A scheduled task runs every Sunday at 04:47 Riyadh time, reads the sheet with the Microsoft 365 connector and runs:

```bash
python3 -I scripts/sync_stores.py <exported sheet file>
```

- Only `Branch` and `Kiosk` rows are imported; the login code is `SOURCE_SUBINVENTORY` (e.g. `RIY031`).
- PINs, staff, espresso setup and radius are never changed. New stores have no PIN until head office clicks **Generate missing PINs** in `/admin`.
- Stores removed from the sheet are deactivated, never deleted. The script refuses to write if fewer than 50 stores parse.
- The sheet is **not** stored in this repository (it contains staff names and emails).

## Bean batches

Each store keeps the current batch (lot) number for **Espresso**, **Ethiopian** and **Brazilian** (hot/cold espresso share one; hot/iced drip share their origin's). The board shows them in a strip; tap one to change it when a new bag is opened (recent batches are one tap). The first log of a bean without a batch asks for it once (can be skipped). Every log is stamped with the batch in use, so it costs no extra taps.

`/admin` → **Batches**: results per batch for 7 / 30 / 92 days — stores, calibrations, drip litres discarded (and per batch brewed), espresso grams thrown (and per calibration), average and range of grinder settings, first/last day used; tap a batch for the per-store breakdown; CSV export. A nightly summary (`batch_daily`, one row per day) keeps it cheap.

## Waste in coffee weight

All waste is reported as coffee weight (g / kg). Staff still choose litres for thrown drip; it is converted at **1 L = 70 g** (`DRIP_G_PER_L` in `shared/config.ts`). Espresso shots: dose 1 = 18.8 g, dose 2 = 25.8 g.

## Bean waste report

`/admin` → **Bean waste**: litres of Ethiopian and Brazilian drip discarded (hot/iced split) for today, 7, 30 or 92 days, grouped by store, area manager, ROM or city, with CSV export. Finished days come from a nightly summary (one row per day), so the report stays cheap on the free tier.

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
