# HM Calibration Log: Build Plan

Status: **plan only, nothing built yet.** Answer the open questions in section 12 before the build starts.

---

## 1. What we are building

A website used by 100+ HM stores to log calibration for three stations and to track how fresh each batch is:

| Station | Items | Batch life | Brew time |
|---|---|---|---|
| Espresso | Hot machine, Cold machine (or one machine for both) | 3 hours | none |
| Hot drip | Ethiopian, Brazilian | 30 minutes | 5 min 30 s |
| Iced drip | Ethiopian, Brazilian | 1 hour | 5 min 30 s |

Main goal: **a calibration takes 1 tap, at most 3.** Everything that can be filled automatically is: date, time, store, person and the last grinder setting.

---

## 2. How staff use it (as few taps as possible)

**Drip (hot or iced, per bean): 1 tap**
1. Tap **Start** on the tile (for example "Hot drip · Ethiopian").
2. The tile shows the **brewing** timer (5:30), then switches to a **fresh** countdown, then to **expired**.

**Only if a previous batch is still in the urn**, a small sheet asks: *"Discard from last batch?"* with chips **None · ¼ · ½ · ¾ · Full**. One more tap. The sheet defaults to "None" and closes itself after 4 seconds.

**Reset (wrong tap):** for 2 minutes after Start, the tile shows an **Undo** button that cancels the batch. Cancelled batches are kept in the log, marked "voided", so nothing can be erased silently. After 2 minutes, **Reset** stays available in the tile's menu and asks for confirmation.

**Espresso: 2 taps**
1. Tap **Calibrate** on the Hot or Cold tile.
2. A sheet opens with **Dose 1** and **Dose 2** already filled with the last values used (for example `6:30` and `8:70`). If nothing changed, tap **Save & start**. If something changed, adjust it with the ± steppers: the right-hand number moves in steps of 5 only (`7:25 → 7:30`), so a value like `7:23` can never be entered.
3. The 3-hour countdown starts.

Each store's settings say whether it has a **Hot + Cold** pair or a **single machine** (which then covers both, shown as one tile).

**Who did it:** the person is picked once, from chips with the store's staff names at the top of the screen ("On shift: Ahmed"). Every log uses that name until someone else taps their name. Nobody types their name for each log.

**Date and time:** automatic, set by the server so a wrong device clock can't change them.

---

## 3. Screen layout

The app is built for a **phone or tablet held in one hand** and also works on a desktop.

```
┌──────────────────────────────────────────┐
│ ½M  Store 014 · Olaya       Sun 23 Nov    │  ← header: store, date, sound status
│ On shift: [Ahmed] [Sara] [+]      🔔 On    │  ← staff chips (one tap to switch)
├──────────────────────────────────────────┤
│ ESPRESSO                                  │
│ ┌────────────────┐ ┌────────────────┐     │
│ │ Hot            │ │ Cold           │     │
│ │ 2:14:08 left   │ │ EXPIRED 0:03   │     │  ← red pulse + buzzer
│ │ 6:30 · 8:70    │ │ [Calibrate]    │     │
│ └────────────────┘ └────────────────┘     │
│ HOT DRIP · every 30 min                   │
│ ┌────────────────┐ ┌────────────────┐     │
│ │ Ethiopian      │ │ Brazilian      │     │
│ │ Brewing 3:12   │ │ 18:40 left     │     │  ← progress ring
│ │ ◐              │ │ [Start]        │     │
│ └────────────────┘ └────────────────┘     │
│ ICED DRIP · every 1 h                     │
│ ┌────────────────┐ ┌────────────────┐     │
│ │ Ethiopian      │ │ Brazilian      │     │
│ │ 41:05 left     │ │ Not started    │     │
│ │ [Start]        │ │ [Start]        │     │
│ └────────────────┘ └────────────────┘     │
├──────────────────────────────────────────┤
│   [ Board ]     [ Today's log ]   [ ⋯ ]   │  ← bottom tab bar (thumb reach)
└──────────────────────────────────────────┘
```

**Tile states** (each one has its own colour and motion):

| State | Look |
|---|---|
| Not started | Calm beige, **Start** button |
| Brewing | Teal progress ring counting down from 5:30 |
| Fresh | Large countdown in tabular numbers so the digits don't jump |
| Expiring soon (last 5 min) | Turns tan/amber with a soft chime once |
| Expired | Red, a gentle pulse, **loud buzzer** until someone taps it or starts a new batch |

On a phone the tiles are in **1 column**, on a tablet in **2 columns**, and on a wide screen the three stations sit side by side. Expired tiles always move to the top of their station.

**Screens**
1. **Store sign-in (once per device):** store code + PIN, then a request for location permission and one tap on "Enable sound". Browsers only allow sound after a tap, so this tap is what lets the buzzer play later.
2. **Board:** the main screen shown above.
3. **Today's log:** a timeline of every entry today (time, station, bean or machine, doses, person, discarded amount, voided). It has a date picker for any of the stored days and **Download PDF** / **Share** buttons.
4. **More (⋯):** manage staff names, sound test, machine setup (Hot + Cold or single), sign out.
5. **Admin (head office only, separate login):** add or edit stores (name, code, PIN, GPS location), see which stores missed calibrations, and download any store's daily PDF.

---

## 4. Alarm: how it can work on a website

The short answer: **the loud buzzer only works while the website is open on screen.** Pop-up notifications can still arrive when it's closed, but with the phone's normal notification sound. The plan uses both layers.

### Layer 1: In-page buzzer (main alarm, loudest, most reliable)
- Works when the page is **open and on screen** on the store device.
- Countdowns are worked out from the **exact expiry time saved on the server**, not from a running counter. So even if the browser slows the page down or the device sleeps, the moment the page is visible again it shows the correct time and plays the alarm if something has expired.
- We use the **Screen Wake Lock** feature so the screen doesn't turn off while the Board is open. Chrome, Edge, Safari 16.4+ and Samsung Internet support it.
- The buzzer is generated by the browser's audio engine at full page volume and repeats until someone acknowledges it. **The device's own volume must be up**; a website cannot raise the system volume.
- **Recommendation:** one cheap Android tablet per store, mounted at the bar, always showing the Board and plugged into power. This is what makes the alarm dependable.

### Layer 2: Push notifications (backup, also when the page is closed)
- If the site is **installed to the home screen** (as a PWA, which works like an app without an app store), the server can send a notification at expiry time **even when the website is closed**.
- **Android (Chrome):** works with the browser closed.
- **iPhone/iPad:** works only if the site was **added to the Home Screen** (iOS 16.4+). It does not work from a normal Safari tab.
- **Limitation:** the notification uses the phone's normal notification sound. A website cannot play a custom loud buzzer when it's closed, and silent mode or Do Not Disturb will silence it.
- On the server side, a scheduled job runs every minute, finds batches that just expired, and sends the pushes.

### Summary
| Situation | Loud buzzer | Notification |
|---|---|---|
| Board open on screen | ✅ | ✅ |
| Other tab or app open, browser still running | ⚠️ plays once you come back | ✅ |
| Browser closed, PWA installed (Android) | ❌ | ✅ |
| Browser closed, iPhone added to Home Screen | ❌ | ✅ |
| Browser closed, not installed | ❌ | ❌ |

Only a native app from the Play Store or App Store can do a loud alarm while closed. We can add that later if it's needed; this plan doesn't require it.

---

## 5. Location limit (500 m)

- When a store signs in and **on every log**, the device sends its GPS position. The **server** checks that it is within **500 m** of the store's saved location and rejects the log if not. The check happens on the server, so it can't be skipped by changing the page.
- Limitations you should know about:
  - Indoors, GPS can be off by 20–150 m. That's why 500 m works and a much smaller radius would cause false blocks.
  - Laptops and desktops have no GPS and use Wi‑Fi positioning, which can be off by kilometres. If a store uses a desktop, we may have to add an exception for it.
  - The user must allow location access. If they deny it, the app shows a clear screen explaining how to turn it on.
  - A determined person can fake a GPS position with special apps. The check stops casual misuse, not deliberate fraud.
- Head office can see from the admin screen which logs were made at what distance.

---

## 6. Daily PDF in the HM brand

- **Download PDF** on Today's log, or for any stored day.
- The PDF is generated **on the device**, not on the server. This keeps the server inside its free-tier processing limit.
- **Share** opens the phone's share sheet (WhatsApp, email, Teams) with the PDF attached. On desktop it downloads the file.
- **Layout (A4):**
  - Header with the ½M logo, store name and code, date, and a tan rule.
  - A summary strip: number of calibrations per station, number of expired batches, total discarded.
  - Three tables (Espresso, Hot drip, Iced drip) with these columns: time, item, doses (espresso), person, ended (fresh or expired), discarded, notes. Voided rows are shown greyed out.
  - Footer with the generated time and page x/y.
- **Brand colours:** beige `#F5EDE3`, near-black `#1D1B17`, tan `#D4B38B`, teal `#84C6B2`. Red `#C2564A` is used only for expired, deep teal `#2B8A74` only for on-time.
- **Font:** HM uses Frutiger LT Arabic. We need the font files and a licence to embed them in a website or PDF. Otherwise we use a close free substitute (Inter / IBM Plex Sans Arabic).

---

## 7. Data storage and the 3-month rule

**Rule:** keep a rolling window of **at least 3 months**. A scheduled job runs every night and deletes everything **older than 92 days**, so the database never grows past three months.

*(If you meant "keep 2 full months plus the current month and delete the third month on the 1st of each month", that works too. It's one line to change; see question 3.)*

**Free-tier check (100 stores):**

| | Estimate per day | Free limit | Room |
|---|---|---|---|
| Logs written | ~110 per store × 100 = ~11,000 rows, plus indexes ≈ 25,000 writes | 100,000 writes/day | ~4× |
| Database size | ~11,000 rows/day × 92 days ≈ 1M rows ≈ 0.3 GB | 5 GB | ~15× |
| Website requests | page loads + logs ≈ 30,000–50,000 | 100,000/day | **tight** |

**Important:**
- The countdown runs **on the device**. The app does **not** keep polling the server every few seconds. If it did, 100 stores would use up the free request limit within hours.
- The free request limit (100,000/day) is **shared by the whole Cloudflare account**, including the `hm-mixes-order` and `mugs-sop` apps that are already on it.
- If more stores join, or several devices per store need to update live, **Workers Paid ($5/month)** raises the limit to 10 million requests/month and removes this concern. I recommend budgeting for it.

---

## 8. Technology (all on Cloudflare)

| Part | Choice | Why |
|---|---|---|
| Hosting + API | **One Cloudflare Worker** (static files + API with Hono) | Same setup as your existing apps; one deployment |
| Database | **New D1 database** `hm-calibration-db` | Free, SQL, good fit for logs |
| Scheduled jobs | **Cron Triggers**: nightly clean-up, and every minute for pushes | Built in |
| Front end | **React + Vite + TypeScript**, installable as a **PWA** | Fast, works offline-tolerant, can be added to the home screen |
| Animation | **Motion** (formerly Framer Motion) + CSS transitions | Smooth spring animations |
| Toasts / sheets | **Sonner** (toasts), **Vaul** (bottom sheets) | By Emil Kowalski, made to match his design skills |
| PDF | **pdf-lib** in the browser | No server processing cost |
| Push | Web Push (VAPID) from the Worker | No third-party service |

**Data model (simplified)**
- `stores`: id, code, name, PIN hash, latitude, longitude, radius (500), espresso mode (pair or single)
- `staff`: id, store id, name, active
- `batches`: id, store id, station (`espresso_hot`, `espresso_cold`, `espresso_single`, `hot_drip`, `iced_drip`), bean (`ethiopian`, `brazilian`, or empty), dose1, dose2, staff id, started at, ready at, expires at, discarded from previous (0, 0.25, 0.5, 0.75, 1), voided at, device latitude/longitude/distance
- `push_subscriptions`: store id, endpoint, keys

---

## 9. Design and polish (Emil Kowalski skills)

I reviewed the `emilkowalski/skills` repository. These rules guide the build:
- **Animate only where it helps.** The Start button is tapped dozens of times a day, so it gets an instant press response (`scale(0.97)`) and **no** slow animation. The less common moments get more motion: a batch becoming ready, the expired alert, opening the PDF sheet.
- **Timing:** `ease-out` curves under 300 ms for things that appear, never `ease-in`. Bottom sheets follow the finger and can be swiped down.
- **Numbers:** countdowns use `tabular-nums` so the digits don't shake.
- **Mobile feel** (from the `mobile-native` skill): no tap-highlight flash, no 100vh bug, 16 px inputs so iOS doesn't zoom, safe areas for notched phones, no sticky hover states.
- **Scroll animations:** used lightly. Station sections fade in on first load, and the Today's log timeline reveals as you scroll. The Board itself stays still so it's easy to read at a glance.
- **Accessibility:** colour is never the only signal (states also show text and icons), large tap targets (min 48 px), and full respect for the device's "reduce motion" setting.
- Before release, the `review-animations` and `break-ui` checks are run (long names, 0 staff, 6 expired tiles at once, very small phone).

**Look:** premium and calm. Warm HM beige background, soft layered shadows instead of hard borders, large bold countdown numbers, teal for fresh, tan for "soon", red only for expired. A dark mode is included for night shifts.

---

## 10. Build phases

| Phase | Content | Result |
|---|---|---|
| 1. Foundation | Worker + D1 + store sign-in + location check + Board with 1-tap logging and countdowns | Usable in 1 pilot store |
| 2. Alarm | In-page buzzer, wake lock, PWA install, push notifications | Dependable alerts |
| 3. Log + PDF | Today's log, history, branded PDF, share | Daily reporting |
| 4. Admin | Stores, PINs, locations, missed-calibration overview | Rollout to 100+ stores |
| 5. Polish | Animation pass, break-ui test, all screen sizes, performance | Release |

Each phase is deployed to `hm-calibration.shelfy-help.workers.dev` (or your own domain) so you can test it on real devices.

---

## 11. Before the build: access checklist

- [x] Cloudflare token valid, account reachable
- [ ] Confirm the token has **Workers Scripts: Edit** and **D1: Edit** (it can't be checked from here without creating something)
- [ ] Optional: add `*.workers.dev` to the environment's allowed domains so I can test the live site myself
- [ ] Decide whether the GitHub repo should be **private** (it is public now)
- [ ] HM logo file (SVG preferred) and the Frutiger font licence, or approval to use a substitute font

---

## 12. Open questions

1. **Drip expiry:** do the 30 min (hot) / 1 h (iced) start **after** the 5:30 brew (start + 5:30 + 30:00), or from the Start tap (start + 30:00)? *The plan assumes after the brew.*
2. **Discarded amount:** are the chips None / ¼ / ½ / ¾ / Full enough, or do you want litres or cups?
3. **Retention:** rolling 92 days, or "delete the oldest month on the 1st of each month"?
4. **Sign-in:** one store code + PIN shared by staff on the store device. Is that fine, or does each person need their own login?
5. **Espresso dose format:** is `8:70` correct, meaning the right-hand number goes 00–95 in steps of 5? Is there a minimum or maximum for each side?
6. **Language:** English only, or English + Arabic (with right-to-left layout)?
7. **Opening hours:** should the alarm stay quiet outside opening hours, and do you want a reminder when a station hasn't been started at all?
8. **Budget:** OK to move to Workers Paid ($5/month) if usage grows past the free tier?
