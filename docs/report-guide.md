# Report Guide — How to read `predictions/latest/report.md`

A reader-friendly walk-through of every section, every number, and every stat
in a prediction report. Pair this with any `report.md` produced by
`scripts/predict.py`.

The pitch in one paragraph: a model trained on 437 historical Big-5 transfers
predicts what a player would have sold for, given their FBref stats from the
season before the move. For each player it also reports SHAP-style
counterfactuals — "if this stat had been ~1 SD higher, the predicted fee
would have moved by €X." That's the *which stat to improve* feature.

---

## 1. The header

```
# Prediction Report — `2026-05-01T08:27:22Z`

| Field | Value |
| --- | --- |
| Run ID (UTC) | `2026-05-01T08:27:22Z` |
| Model commit | `8f56342` |
```

**Run ID (UTC)** — the exact moment the prediction script ran. Stamped on every
row in every CSV in this run, so you can trace any prediction back to the
exact bytes that produced it. Reports for previous runs live under
`predictions/runs/<run_id>/`.

**Model commit** — the short git SHA of the project HEAD at run time. Same
prediction with the same data on different commits = different model. The
commit lets you check `git log <sha>` to see exactly what code produced the
prediction.

**Train rows / Test rows** — how many transfers were in each split.
- Train: transfers from 2014-2020 windows (older → learn from).
- Test: 2021-2022 windows (held out → judge on).
- Player-disjoint: any player who appears in both train and test gets dropped
  from test, so the model can't cheat by remembering specific players.

**Test MAE** — Mean Absolute Error in €. The average gap between the model's
prediction and the actual disclosed fee, across all test transfers. Lower
is better. Today's number is around €14M, which is roughly the median actual
fee — meaning the model is calibrated near the typical mid-tier transfer
but loses accuracy at the extremes.

**Test Spearman ρ (rho)** — a *ranking* metric, not an absolute one. Asks:
"if the model says player A is more expensive than player B, is it right?"
- ρ = 1.0 → perfect ranking.
- ρ = 0.0 → random.
- ρ ≈ 0.33 (today's number) → right about ⅔ of the time.

Spearman is the more honest read for this MVP. The model under-predicts
elite transfers in absolute € (so MAE looks bad on Grealish/Lukaku) but
still puts them above mid-tier players in the rank order (so ρ is still
positive). For the "improve this stat to raise predicted fee" UX, ranking
signal is what matters.

---

## 2. The three result tables

### Top 10 highest-fee held-out transfers

Sorted by *actual* fee, descending. Lets you eye-test "where does the model
do well on the marquee transfers?" Today's run shows Haaland at 7% error
(model nailed him) and Grealish at 55% (model under-predicts elite).

### 5 best predictions

Sorted by *absolute % error*, ascending. The closest to perfect, regardless
of fee size. These are the cases where the model's calibration matched
reality. Often dominated by mid-tier mid-attacker transfers — exactly where
the training distribution is densest.

### 5 worst predictions

Same sort, descending. The model's biggest misses. Two common patterns
appear here:
- **Bargain veterans** (e.g., Craig Dawson €2.3M actual, model predicts
  €26M). The model has a "minutes + age" baseline that says "this guy
  played 33 starts, that's worth €15M+". The market disagreed because the
  veteran was on a free or near-free deal — context the stats can't see.
- **Defenders priced like attackers** (e.g., Wesley Fofana, Marc
  Cucurella). The model has no defensive features (LASSO/RFE/MI dropped
  them), so it tries to price defenders using attacking stats and gets
  them very wrong.

### What every column means

| Column | What it is |
| --- | --- |
| **Season** | Transfer window year. `2022` = summer 2022. |
| **Player** | Player name. |
| **To** | Destination club. |
| **Actual** | The real disclosed transfer fee in €, from Transfermarkt. |
| **Predicted** | The model's predicted fee in €. |
| **Err %** | `\|actual - predicted\| / actual`. Lower is better. >100% means the model was off by more than the actual fee. |
| **Top-3 stat improvements** | The three stats whose ±1 SD perturbation would have moved the predicted fee most. Format: `±FeatureName:+€XM`. The sign before the feature name is the *direction of improvement* (the sign that raised the predicted fee). The € number is *how much higher* the prediction would have been. |

---

## 3. The synthetic fake-players section

Six made-up player profiles covering different archetypes (forward, veteran
striker, playmaker, defensive mid, centre-back, wonderkid). Each profile is
a complete FBref-standard stats dict.

Why these exist:
1. **Sanity check on out-of-sample shapes.** Real test-set players come from
   transfer history. Fake players let us probe arbitrary points in stat
   space and see if the model behaves sensibly.
2. **Calibration map.** Reading the predictions across archetypes shows
   *where* the model is well-calibrated and where it isn't. Today's run
   shows the playmaking-mid and breakout-winger getting the highest
   predictions (€55-60M range), the centre-back getting €20M (low for a
   real-world top-tier CB), and the lottery-ticket wonderkid getting €15M
   (low because actual wonderkids like Mbappé/Pedri got €40M+).
3. **SHAP sanity.** The top-3 improvements per archetype should make
   intuitive football sense. Forward → improve goals/xG. Playmaker →
   improve assists/xAG. If the SHAP output instead points at "reduce
   minutes played" for an attacker, the model has learned something weird.

---

## 4. The features — what each stat means and how it affects fee

Every prediction is a function of these 15 features (selected by the
LASSO + RFE + Mutual-Information ensemble in `src/features.py`). They split
into **playing-time stats**, **counting stats**, **per-90 rates**, and
**expected-goal advanced stats**.

### Playing-time stats

| Stat | Meaning | Typical Big-5 starter range | How it affects predicted fee |
| --- | --- | --- | --- |
| **`MP_Playing`** | Matches Played | 25-38 | Higher → mostly higher predicted fee. The model treats "is this player a regular starter" as a major positive signal. Failing here is one of the model's defects on rotation forwards. |
| **`Starts_Playing`** | Starts (not subs) | 18-34 | Same direction as MP, but more discriminating. A super-sub with 30 MP / 8 starts gets priced lower than a 30 MP / 28 starts profile. |
| **`Min_Playing`** | Total minutes | 1500-3200 | Same direction. Useful for catching rotation/sub patterns MP misses. |
| **`Mins_Per_90_Playing`** | Total minutes ÷ 90, basically full-90s played | 16-34 | Smoothest minutes proxy. The model often picks this up as the cleanest "did this guy play a lot" signal. |

These four are highly correlated. The model uses them together as an
"availability + trust" cluster. Players who don't play don't get bought
expensively (with rare exceptions for wonderkids — which the model misses).

### Counting stats

| Stat | Meaning | Typical Big-5 forward range | How it affects predicted fee |
| --- | --- | --- | --- |
| **`Gls`** | Goals scored | 4-25 | Strong positive driver, especially for forwards. The single biggest non-playing-time feature for attackers. |
| **`Ast`** | Assists | 2-12 | Strong positive driver, especially for playmakers. The model often picks Ast as the top SHAP improvement for midfielders. |
| **`G_minus_PK`** | Non-penalty goals | 3-20 | Same direction as Gls but more honest about "real" goalscoring (penalties are easier and depend on team penalty-taker designation). |
| **`PK`** / **`PKatt`** | Penalties scored / attempted | 0-5 | Weak signal alone, but identifies penalty-takers. Non-penalty-takers get 0 here regardless of skill. |
| **`CrdY`** | Yellow cards | 2-9 | Mild *negative* signal. The model sometimes surfaces "reduce yellow cards" as a top SHAP improvement, especially for defensive mids. |
| **`CrdR`** | Red cards | 0-1 | Almost always 0. When 1+, the model penalizes mildly. |

### Per-90 rate stats

These normalize counting stats by minutes played, so a sub who scores once
per game looks better than a starter who scores once every 5 games.

| Stat | Meaning | "Good" (Big-5 starter) | How it affects predicted fee |
| --- | --- | --- | --- |
| **`Gls_Per`** | Goals per 90 | Forwards: 0.5+, midfielders: 0.2+ | Strong positive for attackers. |
| **`Ast_Per`** | Assists per 90 | Playmakers: 0.3+ | Strong positive for playmakers. |
| **`G+A_Per`** | (Goals + Assists) per 90 | 0.5+ for any starter attacker | The cleanest "attacking output" signal. The model picks this as a top SHAP improvement for both wingers and playmakers. |
| **`G_minus_PK_Per`** | Non-pen goals per 90 | 0.5+ for elite forwards | More penalty-independent version of Gls_Per. |
| **`G+A_minus_PK_Per`** | (Goals + Assists - PK goals) per 90 | 0.5+ | The "honest" attacking output. |

### Expected-goal (xG / xAG) stats — the analytics core

xG and xAG are the modern football analytics consensus for "shot/chance
quality independent of finishing luck." They take a player's SHOTS (or
key passes) and assign each one a probability of becoming a goal, then sum
those probabilities. A player with 0.30 xG/90 is *expected* to score about
one goal every 3 games, regardless of whether they actually did.

The model leans on these heavily because they correlate with future goals
better than past goals do — and the transfer market knows this.

| Stat | Meaning | "Good" (Big-5 starter) | How it affects predicted fee |
| --- | --- | --- | --- |
| **`xG_Expected`** | Total xG from non-penalty + penalty shots, season total | 8-20 for elite forwards | Strong positive driver. |
| **`npxG_Expected`** | Non-penalty xG | 7-15 | "Real" xG without the PK boost. The cleanest "underlying goal threat" measure. |
| **`xAG_Expected`** | Expected Assists (Goals from key passes), season total | 5-12 for playmakers | Strong positive for creators. |
| **`npxG+xAG_Expected`** | npxG + xAG, the headline "creation + finishing" combined number | 12-25 | Often called the "everything attacking" stat. Single best summary of an attacker's output. |
| **`xG_Per`** | xG per 90 | 0.4-0.7 for top forwards | Per-90 version. |
| **`xAG_Per`** | xAG per 90 | 0.2-0.4 for playmakers | Per-90 version. |
| **`xG+xAG_Per`** | xG + xAG per 90 | 0.5-1.0 for elite attackers | The single most predictive per-90 number for attacking output. |
| **`npxG_Per`** | Non-pen xG per 90 | 0.3-0.6 | Per-90 npxG. |
| **`npxG+xAG_Per`** | (npxG + xAG) per 90 | 0.5-0.9 | Per-90 of the combined creation/finishing metric. |

---

## 5. Reading the SHAP top-3

For every prediction, the model also reports the three stat changes that
would have moved the predicted fee most. Format:

```
+G+A_Per:+€10.95M | -CrdY:+€2.85M | +Ast:+€2.67M
```

- **The leading sign** (`+` or `-`) is the *direction of improvement*: the
  sign that, when applied to a ±1 SD perturbation of that stat, raised the
  predicted fee. So `-CrdY` means *fewer* yellow cards is the improvement.
- **The € figure** is the predicted fee change — *how much higher* the
  prediction would have been if that stat moved by 1 standard deviation in
  the indicated direction.
- **±1 SD** is calibrated to the training-set spread for that feature. So
  "improve xG by 1 SD" is roughly "go from a typical attacker's xG to a
  noticeably better attacker's xG."

What you can read from a top-3:
- **Position fit.** Forward → top-3 should include xG/Gls/G+A. Playmaker →
  Ast/xAG. If a forward's top-3 says "improve xAG", the model's signal is
  telling you the player would price up if they passed more.
- **Improvement direction.** `+xG` is intuitive (score more is better).
  `-CrdY` is also intuitive (fewer cards looks more reliable). But
  occasionally `-Min_Playing` or `-MP_Playing` shows up — the model is
  saying "fewer minutes" raises the prediction. That's usually a sign of
  a non-monotonic xgboost partition; treat it as a model artifact, not
  career advice.

---

## 6. Known model defects to watch for

Three patterns repeat across runs. They're documented here so the report's
weird-looking lines aren't surprising:

1. **Elite-tier underprediction.** Grealish €117M actual → €53M predicted.
   The training distribution is centered around €13M with very few €80M+
   examples. Tree-based regression with squared loss + sparse upper-tail =
   predictions get pulled toward the bulk. Fix: log-transform the target,
   or quantile regression, or more training data.
2. **Defender misvaluation.** Cucurella, Fofana, centre-back archetype.
   Feature selection dropped defensive stats. The model has no anchor for
   defender value and tries to price defenders using attacking stats —
   gets them very wrong in both directions. Fix: per-position-group models.
3. **Bargain veterans priced high.** Craig Dawson £2M actual → €26M
   predicted. Model sees "33 starts, 27 years old" and treats it as a
   premium-tier signal. Fix: include age × playing-time interaction
   features, or train on a wider fee distribution including bargain deals.

---

## 7. How to reproduce a run

```bash
source .venv/bin/activate
python scripts/sanity_check.py    # confirms data layer still works
python scripts/train.py           # retrain (writes data/models/*.pkl)
python scripts/predict.py         # generate this report
```

After `predict.py`, look at:
- `predictions/latest/report.md` — this document's target.
- `predictions/latest/test_set.csv` — full per-row predictions.
- `predictions/runs/<this-run>/...` — frozen copy of everything.
- `predictions/runs/runs.jsonl` — append-only audit log of every run ever.

Each row in every CSV carries a `run_id` (UTC ISO timestamp) and
`model_commit` (git short SHA) prefix, so you can answer "which model
produced this prediction on what date" without leaving the file.

---

## 8. What this report is *not*

- **Not career advice.** SHAP outputs are *historical associations* —
  "players who looked like this got paid like this." A real player who
  improves their xG by 1 SD might or might not get the predicted bump,
  depending on age, club prestige, agent network, and dozens of other
  things the model can't see.
- **Not a transfer-market signal.** This is a side project trained on 437
  rows of public Transfermarkt fees. Any sports-agent or club analytics
  team has way more data and way more signal than this. The point of the
  project is the SHAP "which stat to improve" UX, not the absolute
  predictions.
- **Not currently calibrated to 2024+ markets.** Training data ends at
  2022 transfers via the upstream `worldfootballR_data` snapshot. Use the
  predictions as a within-era *ranking* tool, not as a live market call.
