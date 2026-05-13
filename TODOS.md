# TODOS

Items captured from /plan-eng-review on 2026-05-05 (branch: main).

## Deferred from web playground design (already documented in design doc as v2)

- Real-player templating (pick Saka, mutate his stats) — design says v2.
- Mobile sliders for <768px viewport — design ships desktop-only with a banner.
- Glossary v2: per-position typical ranges + FBref doc links per stat.
- Build export-as-JSON — drop unless a teammate asks.
- Vercel password protection / Cloudflare Access — defer until someone wants it private.

Design doc reference: `~/.gstack/projects/azz3/gwyunm1air-main-design-20260505-144914.md`

## Surfaced by /plan-eng-review 2026-05-05

### Retrain model with richer features + position dummies

**What:** Retrain xgboost on a feature set that includes xA, progressive carries, progressive passes, defensive stats (tackles, interceptions, blocks per 90), and one-hot position group dummies. Target n >= 300 by widening to more leagues / seasons.

**Why:** Current model is the structural reason the playground UX has to compromise — 15 features (most counting-stat nuisance), n=96, MAE €14M, Spearman 0.31. Two locked compromises trace directly to this:
- T1 (eng review): "+€5M from 1 SD bump" is dominated by noise; ships with a calibration tooltip instead of honest range UX.
- T3 (eng review): single-stat compare-swap was abandoned for correlated-group swap because xG/npxG/Gls collinearity makes single-stat extrapolation off-distribution.

A stronger model dissolves both compromises. Sub-€10M MAE makes point-estimate UX honest. Position dummies unlock the design's original position-selector vision.

**Pros:**
- Unlocks design's original UX (position selector, ~30 features, defender/midfielder archetypes).
- Counterfactuals become defensible to a stats-literate teammate.
- Compare-view deciding-stat could go back to single-stat swap (in-distribution).

**Cons:**
- ~1 weekend of work.
- Re-runs feature_set_hash invalidation — all teammates' saved builds go read-only on first visit after retrain (schemaVersion machinery doing its job, but a one-time UX cost).

**Context:** `src/model.py`, `src/features.py`, `data/models/selected_features.json`. After retrain, `scripts/export_for_web.py` regenerates all web artifacts.

**Depends on:** nothing — fully unblocked. Best done after the playground ships and teammates have given feedback on what features they wished the model captured.

### Strategic alternative (not a TODO, escalated for /plan-ceo-review consideration)

Outside voice flagged "Guess the Transfer Fee" game as a fundamentally different demo idea using the same model artifacts: show real test-set player lines, teammates guess fee, reveal model's prediction + actual. Reframes weak model accuracy as the demo's interesting hook (model losing to humans = "I beat the algorithm on Saka" group-chat moment). Not added here as a TODO because it's a product-direction question, not a deferrable engineering task. If you want to evaluate it as an alternative or successor product, run `/plan-ceo-review`.

## Surfaced by /plan-design-review 2026-05-05

### Run /design-consultation to produce a real DESIGN.md

**What:** Run the `/design-consultation` skill to produce a full DESIGN.md (typography hierarchy rules, color story with semantic naming, motion language, brand voice + tone guidelines, component vocabulary).

**Why:** Today the playground has a thin inline token set: accent #2C8C5F (football pitch green), Inter (body) + Inter Tight (display), 4-base spacing, neutral Tailwind ramp. Enough to ship the demo. But if any other surface gets built (separate landing page, future tournament/season comparison view, mobile experience), the inline tokens won't extend coherently — they were chosen for one screen.

**Pros:** Future surfaces inherit a real design language; tone/voice gets explicit instead of implicit; reduces "what should this color/spacing be" questions during implementation.

**Cons:** ~30-45 min run; produces a doc that may be over-engineered for a 5-teammate playground that may never grow.

**Context:** Inline tokens locked in this design review (see plan). DESIGN.md would supersede or formalize them.

**Depends on:** nothing — fully unblocked. Best done if the playground grows beyond the 5-teammate demo.
