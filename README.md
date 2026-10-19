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
- **Weeks** alternate from the first Monday after the diclofenac hold: steps week, calf week, steps week, hold week (every 4th). One thing changes per week; diclofenac days never count as evidence.
- **Steps:** +500 weekdays on a steps-week Monday after 2 weeks with no red, last week ≤1 amber, at target, Monday no worse than Friday. Weekdays climb to the weekend baseline, then all days move to the goal. Any red drops weekdays back; a red morning drops that day to baseline.
- **Isometrics:** +5kg below 50kg, then +2.5kg, after 5 green days with holds done, ceiling 100kg; red morning returns to the previous load.
- **Calves:** in a calf week, after 3 tolerated sessions (pain ≤3/10, green next morning), seated raise +5kg below 50kg then +2.5kg, or standing raise up a level, taking turns. Red morning after a leg day steps both back.
- **Diclofenac:** taper is editable in Plan. Nothing progresses until 4 days after the last dose. Pain at/above the threshold (default 5/10) or two red days running → offload advice; a 3-day 50mg × 3 rescue course is offered only after 7 clear days; escalation after two rescue courses in 4 weeks, three days over threshold on an NSAID, or still mostly amber/red 1–3 weeks after stopping.

## Dev

```
npm install
npm run dev
npm test   # rule logic
```
