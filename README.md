# Tendon Tracker

Daily log for Achilles rehab: pain monitoring (Silbernagel model), steps against a progressing target, isometric and seated-raise loading, and a diclofenac washout hold. The app turns each day green/amber/red and suggests when to progress, hold or drop back.

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import `ashrleahy/TendonTracker`. Defaults are fine (Next.js).
2. Optional but recommended, to sync phone and desktop:
   - **Storage → Neon** (Marketplace) and connect it to the project. That sets `DATABASE_URL` automatically. Or paste an existing Neon connection string as `DATABASE_URL`.
   - Add `APP_PASSCODE` (any string). The API refuses requests without it, so the public URL can't read or write your data.
3. Redeploy after adding env vars. Tables (`tt_entries`, `tt_settings`) are created on first request.

Without `DATABASE_URL` the app still works, storing everything in the browser (export/import JSON from History).

## Rules

- **Status:** morning first-steps pain (and evening pain) vs the median of the previous 7 days. Same or lower = green, +1 = amber, +2 = red. Pain over 3/10 during holds, calf work or walking = at least amber.
- **Steps:** reviewed over the last 7 days. Any red drops weekdays one increment (floor 6,000). 2+ ambers holds. A green week at target raises weekdays; weekends stay at baseline until weekdays catch up, then all days move to the goal.
- **One variable per week:** raising steps or seated-raise load locks the other for 7 days. Isometric load is exempt.
- **Isometrics:** +5kg after 3 consecutive green days with holds logged; red drops back.
- **Seated raise:** +5kg after two leg days in a row with pain ≤3/10 and a green next morning.
- **Diclofenac:** progressions hold until 4 days after the last dose.

## Dev

```
npm install
npm run dev
npm test   # rule logic
```
