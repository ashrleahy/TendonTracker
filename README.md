# Tendon Tracker

Daily log for Achilles rehab. Four entries a day (pain at start of day, total steps, training, pain at end of day) plus an exacerbation section. The app turns each day green/amber/red and progresses or scales back isometric and calf loads from pain scores and the pain trend.

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import `ashrleahy/TendonTracker`. Defaults are fine (Next.js).
2. Optional but recommended, to sync phone and desktop:
   - **Storage → Neon** (Marketplace) and connect it to the project. That sets `DATABASE_URL` automatically. Or paste an existing Neon connection string as `DATABASE_URL`.
   - Add `APP_PASSCODE` (any string). The API refuses requests without it, so the public URL can't read or write your data.
3. Redeploy after adding env vars. Tables (`tt_entries`, `tt_settings`) are created on first request.

Without `DATABASE_URL` the app still works, storing everything in the browser (export/import JSON from History).

## How the plan works

Loads are replayed from the log each day, so they're earned rather than set.

- **Status:** red = flare logged, morning at/over threshold (default 5/10), morning 2+ above the 7-day median, or training pain over 5. Amber = morning +1, training pain 4-5, or evening 2+ above the morning.
- **Trend:** mean morning pain this week vs last. Up 1+ = rising: no progressions, and loads drop a step at most once a week until it turns.
- **Isometrics:** assumed done daily (no logging). +5kg below 50kg, then +2.5kg, after 5 green days in a row with a green morning and a non-rising trend; ceiling 100kg. Red morning: previous load.
- **Calves (leg days Mon/Sat):** assumed done as prescribed unless marked lighter/skipped. Tolerated = training pain 3 or less and green next morning. After 3, one exercise steps up (seated +kg or standing up a level, alternating), max one a week, not within 2 days of an isometric step. Red morning after a session, or training pain over 5: both step back.
- **Steps:** context only, no target. A day 25%+ over the 14-day median (and over 8k) is flagged heavy; a bad morning after a heavy day with no leg session doesn't hit calf loads.
- **Flare:** isometrics down 20% (still daily, lighter), calves down a step and no loaded calf work until 2 mornings back at the pre-flare usual; no progressions for a week after. Review if a flare runs 10+ days, 2 flares in 4 weeks, or 5 of 7 days amber/red.
- **Anti-inflammatories:** days up to 4 after the last dose (Plan setting, or any logged dose) don't count as evidence.

## Dev

```
npm install
npm run dev
npm test   # rule logic
```
