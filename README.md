# Tendon Tracker

Daily log for Achilles rehab: pain monitoring (Silbernagel model), steps against a progressing target, isometric and seated-raise loading, and a diclofenac washout hold. The app turns each day green/amber/red and suggests when to progress, hold or drop back.

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import `ashrleahy/TendonTracker`. Defaults are fine (Next.js).
2. Optional but recommended, to sync phone and desktop:
   - **Storage → Neon** (Marketplace) and connect it to the project. That sets `DATABASE_URL` automatically. Or paste an existing Neon connection string as `DATABASE_URL`.
   - Add `APP_PASSCODE` (any string). The API refuses requests without it, so the public URL can't read or write your data.
3. Redeploy after adding env vars. Tables (`tt_entries`, `tt_settings`) are created on first request.

Without `DATABASE_URL` the app still works, storing everything in the browser (export/import JSON from History).

## How the plan works

The Today screen is a prescription, recomputed from your log each day (history is replayed from the plan start, so targets are earned rather than set):

- **Status:** first-steps (and evening) pain vs the median of the previous 7 days. Same or lower = green, +1 = amber, +2 = red. Pain over 3/10 during loading or walking = at least amber.
- **Steps:** reviewed each Monday. A green week at target (≤1 amber, no red, Monday no worse than Friday) adds one increment to weekdays until they reach the weekend baseline, then all days move to the goal. Any red in the week drops weekdays back. A red morning drops that day to baseline.
- **Isometrics:** +5kg after 3 green days with holds done; red morning returns to the previous load.
- **Calves (leg days):** after two tolerated sessions (pain ≤3/10, green next morning) the seated raise adds 5kg, otherwise the standing raise moves up a level. Red morning after a leg day steps both back.
- **One variable per week:** step increases and calf progressions lock each other for 7 days.
- **Diclofenac:** taper is editable in Plan. Nothing progresses until 4 days after the last dose. Pain at/above the threshold (default 6/10) or two red days running → offload advice; a 3-day 50mg × 3 rescue course is offered only after 7 clear days; escalation after two rescue courses in 4 weeks, three days over threshold on an NSAID, or still mostly amber/red 1–3 weeks after stopping.

## Dev

```
npm install
npm run dev
npm test   # rule logic
```
