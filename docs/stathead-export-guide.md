# Stathead CSV Export Guide

> **⚠️ As of January 2026, Sports Reference deleted all advanced soccer data**
> (xG, xA, progressive passes, etc.) from FBref and Stathead after their data
> provider terminated the agreement. The Stathead FBref subscription no longer
> provides the advanced stats this model depends on. Request a refund.
>
> **What this means for the pipeline:**
> - The existing cached RDS files (2010–2023 stats, 2010–2022 transfers) are
>   unaffected and remain usable.
> - New seasons (2024–2025) only have basic stats (goals, assists, minutes) —
>   no xG/xA. Any extension of the training data to 2024–2025 requires either
>   a new advanced data provider or retraining without xG features.
> - The model as trained on 2014–2022 data continues to work unchanged.

Files go in `data/raw/stathead/`. The ingestion code (`src/stathead.py`) picks
them up automatically on the next training run.

---

## 1. Transfer data (3 files)

**URL:** https://www.sports-reference.com/stathead/fbref/ → look for "Transfers" finder

For each of the three missing summer windows, apply these filters and export CSV:

| Filename to save as | Season filter | Notes |
|---|---|---|
| `transfers_2023.csv` | 2023-24 | Summer 2023 window |
| `transfers_2024.csv` | 2024-25 | Summer 2024 window |
| `transfers_2025.csv` | 2025-26 | Summer 2025 window (partial) |

**Filters to set in the UI:**
- Transfer type: Arrivals
- Fee: disclosed only (exclude "undisclosed" / free transfers)
- Loans: exclude
- League (destination): Premier League, La Liga, Serie A, Bundesliga, Ligue 1
  — add Championship and Eredivisie if you want to expand coverage

**Expected columns in the CSV:**
`Rk, Player, Age, Nationality, Position, From, To, League.From, League.To, Fee, Season, Loan`

---

## 2. Player stats — standard table (3 files)

**URL:** https://www.sports-reference.com/stathead/fbref/ → look for "Player Season Finder"

For each season, set **Stat Type = Standard**, filter by year, export CSV:

| Filename | Season filter | Covers |
|---|---|---|
| `fbref_standard_2023.csv` | 2022-23 | Prior season stats for 2023 transfers |
| `fbref_standard_2024.csv` | 2023-24 | Prior season stats for 2024 transfers |
| `fbref_standard_2025.csv` | 2024-25 | Prior season stats for 2025 transfers + live predictions |

**Minimum columns needed:**
`Season, Player, Squad, Age, Pos, MP, Starts, Min, 90s, Gls, Ast, G+A, G-PK, PK, PKatt, CrdY, CrdR, xG, npxG, xAG, npxG+xAG, PrgC, PrgP, PrgR`

---

## 3. Player stats — auxiliary tables (up to 15 files, optional but recommended)

Same Player Season Finder, same season filters. Export once per table type per season.

| Table type | Filename pattern |
|---|---|
| Shooting | `fbref_shooting_<year>.csv` |
| Passing | `fbref_passing_<year>.csv` |
| Possession | `fbref_possession_<year>.csv` |
| Defense | `fbref_defense_<year>.csv` |
| Miscellaneous | `fbref_misc_<year>.csv` |

For 3 seasons × 5 table types = 15 files. These are optional — the model falls
back to standard-only stats if aux files are absent (just with fewer features).

---

## 4. Quick smoke test after downloading

```bash
python - <<'EOF'
import sys; sys.path.insert(0, '.')
from src.stathead import load_stathead_transfers, load_stathead_stats
t = load_stathead_transfers(seasons=[2023, 2024, 2025])
print(f"Transfers loaded: {len(t)} rows")
s = load_stathead_stats(table='standard', seasons=[2023, 2024, 2025])
print(f"Standard stats loaded: {len(s)} rows")
EOF
```

Expected: ~180+ transfer rows, ~10 000+ stat rows (all Big-5 players for 3 seasons).

---

## 5. Retrain after loading

```bash
python scripts/sanity_check.py   # should show >800 training rows
python scripts/train.py           # retrains model; saves to data/models/
python scripts/predict.py         # generates predictions/latest/
```

---

## 6. Live player lookup (after cookie setup)

```bash
# First: run /setup-browser-cookies in Claude Code to import your session
python scripts/fetch_stathead_live.py "Erling Haaland" --season 2025
# → writes data/raw/stathead/fbref_standard_erling_haaland_2025.csv
# → auto-included in next training run or /api/predict call
```
