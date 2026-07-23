/**
 * Lightweight i18n. Two locales (en, ko), no library, no runtime download.
 *
 * Pattern:
 *   - Server Components import `dict` and pass `dict[locale]` to children.
 *   - Client Components use `useT()` from i18n-context.tsx.
 *   - Locale persists in localStorage; defaults to "ko".
 *
 * Add a new key by adding it to BOTH `en` and `ko`. TS will fail if either is missing.
 */

export type Locale = "en" | "ko";

export const LOCALES: readonly Locale[] = ["en", "ko"] as const;
export const DEFAULT_LOCALE: Locale = "ko";

export const STORAGE_KEY = "azz3.locale";

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "ko";
}

const en = {
  // Nav
  "nav.glossary": "Glossary",
  "nav.build": "Predict",
  "nav.forecast": "Predict",
  "nav.sub.fee": "Transfer Fee",
  "nav.saved": "Saved Builds",
  "nav.worldcup": "World Cup 2026",
  "nav.kbo": "KBO 2026",
  "nav.transfers": "2026 Transfers",
  "nav.salary": "Salary",
  "nav.contact": "Contact",
  // Reorganized top-level sections + sub-tabs
  "nav.market": "Market Forecast",
  "nav.match": "Match Simulation",
  "nav.sub.soccer": "Football",
  "nav.sub.baseball": "Baseball",
  "nav.sub.build": "Player Builder",
  "nav.sub.worldcup": "'26 World Cup",
  "nav.sub.kbo": "KBO",
  "nav.sub.matchup": "KBO Matchup",
  "nav.lang.label": "Language",
  "nav.lang.en": "English",
  "nav.lang.ko": "한국어",

  // Landing
  "landing.eyebrow": "Cross-industry competitive intelligence",
  "landing.badge.football": "Football",
  "landing.badge.baseball": "KBO Baseball",
  "landing.badge.esports": "Esports",
  "landing.badge.poker": "Pro Poker",
  "landing.title": "True value is born from data, and proven by prediction.",
  "landing.subtitle":
    "Achieving disruptive innovation in cross-industry sports intelligence, from AI-driven transfer value forecasting to match prediction.",
  "landing.cta.primary": "Forecast a transfer fee",
  "landing.cta.secondary": "Predict match results",
  "landing.stat.sims": "Simulations",
  "landing.stat.transfers": "Transfers learned",
  "landing.stat.accuracy": "Rank correlation",
  "landing.radar.title": "Player value profile",
  "landing.radar.axis1": "Potential",
  "landing.radar.axis2": "Adaptability",
  "landing.radar.axis3": "Strategic IQ",
  "landing.radar.axis4": "Market Value",
  "landing.radar.axis5": "Growth Rate",
  "landing.radar.axis6": "Precision",
  "landing.features.title": "KEY FEATURES",
  "landing.feature.forecast.title": "Fee & Team Forecast",
  "landing.feature.forecast.body":
    "Predict a player's market fee and best-fit team from real-season form.",
  "landing.feature.multidomain.title": "Neural Network",
  "landing.feature.multidomain.body":
    "One neural network across football, baseball, esports, and poker.",
  "landing.feature.sim.title": "Strategic Squad Simulation",
  "landing.feature.sim.body":
    "Simulate the 2026 World Cup a million times from team value.",
  "landing.feature.glossary.title": "Plain-English Stats",
  "landing.feature.glossary.body":
    "Every metric the model uses, explained in one line.",

  // Glossary page
  "glossary.title": "Football stats, in plain English",
  "glossary.subtitle":
    "Quick reference for the 15 numbers the model uses. Take a minute, then build a player.",
  "glossary.cta": "Build a player →",
  "glossary.col.stat": "Stat",
  "glossary.col.definition": "Definition",

  // Glossary stat definitions
  "stat.MP_Playing.full": "Matches Played",
  "stat.MP_Playing.def": "Total league matches the player appeared in last season.",
  "stat.Starts_Playing.full": "Starts",
  "stat.Starts_Playing.def": "Matches the player started (vs came on as a sub).",
  "stat.Mins_Per_90_Playing.full": "90s Played",
  "stat.Mins_Per_90_Playing.def": "Total minutes ÷ 90 — how many 'full matches' the player covered.",
  "stat.Gls.full": "Goals",
  "stat.Gls.def": "League goals scored.",
  "stat.Ast.full": "Assists",
  "stat.Ast.def": "Passes that directly led to a goal.",
  "stat.PK.full": "Penalty Goals",
  "stat.PK.def": "Goals scored from the penalty spot.",
  "stat.PKatt.full": "Penalty Attempts",
  "stat.PKatt.def": "Penalties taken (made + missed).",
  "stat.CrdY.full": "Yellow Cards",
  "stat.CrdY.def": "Bookings received.",
  "stat.CrdR.full": "Red Cards",
  "stat.CrdR.def": "Sent off in a match.",
  "stat.Gls_Per.full": "Goals per 90",
  "stat.Gls_Per.def": "Goals scored per 90 minutes played — a rate, not a total.",
  "stat.G+A_Per.full": "Goals + Assists per 90",
  "stat.G+A_Per.def": "Combined goal involvement per 90 minutes.",
  "stat.G_minus_PK_Per.full": "Non-Penalty Goals per 90",
  "stat.G_minus_PK_Per.def": "Goals from open play per 90, excluding penalties.",
  "stat.xG_Expected.full": "Expected Goals (xG)",
  "stat.xG_Expected.def":
    "Quality-weighted shot total — how many goals a typical player would have scored from these chances.",
  "stat.npxG_Expected.full": "Non-Penalty Expected Goals (npxG)",
  "stat.npxG_Expected.def": "xG from open play only, excluding penalties.",
  "stat.xAG_Expected.full": "Expected Assisted Goals (xAG)",
  "stat.xAG_Expected.def":
    "How many xG the player set up — quality-weighted creation, not just final assists.",
  "stat.Min_Playing.full": "Minutes Played",
  "stat.Min_Playing.def": "Total league minutes played last season.",
  "stat.Ast_Per.full": "Assists per 90",
  "stat.Ast_Per.def": "Assists per 90 minutes played — a rate, not a total.",
  "stat.xG_Per.full": "Expected Goals per 90 (xG/90)",
  "stat.xG_Per.def": "Quality-weighted shot total per 90 minutes — goal-scoring threat adjusted for chance quality.",
  "stat.xAG_Per.full": "Expected Assisted Goals per 90 (xAG/90)",
  "stat.xAG_Per.def": "Quality-weighted chance creation per 90 minutes — creative output adjusted for chance quality.",
  "stat.Sh_Standard_shoot.full": "Shots",
  "stat.Sh_Standard_shoot.def": "Total shots taken last season.",
  "stat.SoT_Standard_shoot.full": "Shots on Target",
  "stat.SoT_Standard_shoot.def": "Shots that would have gone in without a save.",
  "stat.SoT_percent_Standard_shoot.full": "Shot Accuracy (%)",
  "stat.SoT_percent_Standard_shoot.def": "Percentage of shots that were on target.",
  "stat.Sh_per_90_Standard_shoot.full": "Shots per 90",
  "stat.Sh_per_90_Standard_shoot.def": "Shots taken per 90 minutes — shot volume rate.",
  "stat.SoT_per_90_Standard_shoot.full": "Shots on Target per 90",
  "stat.SoT_per_90_Standard_shoot.def": "On-target shots per 90 minutes — combines accuracy and volume.",

  // Build page
  "build.title": "Build a player",
  "build.archetype.label": "Start from",
  "build.archetype.placeholder": "Pick an archetype…",
  "build.realplayer.label": "Real player",
  "build.realplayer.placeholder": "Pick a real transfer…",
  "build.realplayer.actual": "Actual fee: {fee}",
  "build.fee.label": "Predicted transfer fee",
  "build.fee.krwApprox": "≈ {amount}",
  "build.counterfactuals.krwApprox": "≈ {delta} in KRW",
  "build.fee.calibration":
    "Model error: about ±€7M. Trained on 2,123 Big-5 league transfers (2014–2022), validated on 292 held-out transfers. Spearman ρ 0.84.",
  "build.fee.calibration.aria": "Calibration info",
  "build.counterfactuals.title": "Top stat improvements",
  "build.counterfactuals.format": "If you raised {feature} by {amount}, you would be worth {delta}",
  "build.counterfactuals.empty": "Drag a slider to see how the fee changes.",
  "build.counterfactuals.ceiling":
    "You're at the ceiling — every stat is already in the top 5%.",
  "build.showAllStats.show": "Show all 15 stats",
  "build.showAllStats.hide": "Hide nuisance stats",
  "build.section.finishing": "Finishing",
  "build.section.creation": "Creation",
  "build.section.passing": "Passing",
  "build.section.nuisance": "Other (rarely matter)",
  "build.save.button": "Save this build",
  "build.save.placeholder": "Name this build…",
  "build.save.submit": "Save",
  "build.save.cancel": "Cancel",
  "build.share.button": "Copy share link",
  "build.error.predict": "Couldn't reach the model. Your slider values are still here.",
  "build.error.retry": "Retry",
  "build.error.load": "Failed to load: {error}",
  "build.error.loadGeneric": "Failed to load model info",
  "build.suggestName.goalMachine": "Goal-machine build",
  "build.suggestName.playmaker": "Playmaker build",
  "build.suggestName.allRounder": "All-rounder build",
  "build.suggestName.numbered": "Build {n}",
  "toast.saved": "Saved as '{name}'",
  "toast.saved.link": "View all builds",
  "toast.copied": "Link copied — paste it anywhere",

  // Saved page
  "saved.title": "Saved builds",
  "saved.empty.title": "No builds yet",
  "saved.empty.body": "Head to Build to create one.",
  "saved.empty.cta": "Build a player →",
  "saved.col.name": "Name",
  "saved.col.fee": "Predicted fee",
  "saved.col.date": "Saved",
  "saved.compare.button": "Compare",
  "saved.compare.helpOne": "Select one more build to compare.",
  "saved.compare.helpZero": "Select two builds to compare.",
  "saved.delete": "Delete",
  "saved.staleBadge": "Saved against an older model — view only",
  "saved.staleTooltip":
    "The model has been retrained since this build was saved. The fee shown was correct at save time but the current model would predict differently.",

  // Compare panel
  "compare.title": "Compare",
  "compare.deciding.format":
    "{group} is what separates these two builds. Swapping just that group changes the fee by {delta}.",
  "compare.group.finishing_volume": "Finishing volume",
  "compare.group.creation": "Creation",
  "compare.group.availability": "Availability",
  "compare.group.discipline": "Discipline",
  "compare.group.set_pieces": "Set pieces",
  "compare.col.stat": "Stat",
  "compare.close": "Close",

  // World Cup 2026 report
  "wc.eyebrow": "ValueTrack Research",
  "wc.title": "Who wins the 2026 World Cup",
  "wc.subtitle":
    "We valued every nation's squad with the same transfer-fee model that powers ValueTrack, then ran the real 2026 bracket {sims} times. One engine, from a single player's fee to a tournament.",
  "wc.call.label": "The call",
  "wc.call.body":
    "ValueTrack's top pick to win is {first}. England, France, Spain and Portugal form the most likely final four.",
  "wc.call.locked": "Locked before kickoff · fully reproducible",
  "wc.stat.champion": "Title favorite",
  "wc.stat.top4prob": "Exact final-four hit rate",
  "wc.stat.sims": "Simulations",
  "wc.leaderboard.title": "Title probability",
  "wc.leaderboard.note": "Probability of lifting the trophy, per nation.",
  "wc.col.rank": "#",
  "wc.col.nation": "Nation",
  "wc.col.win": "Win %",
  "wc.col.sf": "Final four %",
  "wc.leaderboard.more": "Show all 48 nations",
  "wc.leaderboard.less": "Show top 12",
  "wc.semifinal.title": "Most likely final four",
  "wc.semifinal.body":
    "Across a million simulations, this exact quartet came up more than any other. The four nations that reach the semifinals most often are the same four.",
  "wc.strength.title": "Squad strength ranking",
  "wc.strength.note":
    "Player value plus squad synergy — spine completeness, positional balance, and club chemistry.",
  "wc.col.rating": "Strength",
  "wc.col.tm": "Team value (€M)",
  "wc.col.synergy": "Synergy",
  "wc.reasoning.title": "Why these four",
  "wc.reasoning.france":
    "France — strength 123.4, the field's richest squad at €1,558M. Current 2025/26 form lifts it to the top.",
  "wc.reasoning.england":
    "England — strength 123.4, team value €1,333M. The most balanced squad in the field, even across every line.",
  "wc.reasoning.spain":
    "Spain — strength 121.4, team value €1,286M. Elite spine with deep attacking talent in current form.",
  "wc.reasoning.portugal":
    "Portugal — strength 119.8, team value €1,038M. Balanced and complete across the pitch.",
  "wc.method.title": "Method",
  "wc.method.model":
    "Engine: ValueTrack's transfer-fee model, reused to value each player.",
  "wc.method.input":
    "Player input: each nation's players are valued on their real 2025/26 season form, not a stale snapshot.",
  "wc.method.coverage":
    "Coverage: anchored with each nation's full squad market value so non-European squads aren't undervalued.",
  "wc.method.sims":
    "Large-scale simulation of the real 2026 bracket to produce title and final-four odds.",

  // Transfer market forecast
  "tf.eyebrow": "ValueTrack Research",
  "tf.title": "2026 Summer Transfer Forecast",
  "tf.subtitle":
    "Predicted fees for three of the window's most-watched moves — valued on real 2025/26 data, shaped by each buying club's spending history.",
  "tf.from": "From",
  "tf.value": "Market value",
  "tf.age": "Age",
  "tf.col.dest": "Team",
  "tf.col.fee": "Predicted fee",
  "tf.rough": "rough",
  "tf.salah.contract": "Contract left",
  "tf.salah.modelfee": "Model fee",
  "tf.salah.expired": "out of contract",
  "tf.salah.yr": "{n} yr",
  "tf.salah.reality": "If his contract runs down",
  "tf.salah.free": "Free transfer · €0",
  "tf.stats.label": "2025/26",
  "tf.stat.apps": "Apps",
  "tf.stat.g": "Goals",
  "tf.stat.a": "Assists",
  "tf.stat.min": "Minutes",
  "tf.note": "ValueTrack model estimates, in 2026 value.",
  // World Cup Stars (breakout predictor)
  "nav.sub.wcstars": "World Cup Stars",
  "wcs.eyebrow": "ValueTrack Research",
  "wcs.title": "2026 World Cup Star Predictor",
  "wcs.subtitle": "The 2026 World Cup's recognizable stars who could actually move — their tournament stats, how far their market value jumps, real transfer rumors, and destination clubs ranked by club value. Settled stars anchored at a super-club with no transfer link are excluded.",
  "wcs.result": "Result",
  "wcs.goldenBoot": "Golden Boot",
  "wcs.youngPlayer": "Young Player",
  "wcs.james.tag": "Most likely 'James' case",
  "wcs.board.title": "World Cup star board",
  "wcs.board.sub": "Ranked by star index — recognizability × tournament output. Bars show value gained.",
  "wcs.col.player": "Player",
  "wcs.col.jump": "Value jump",
  "wcs.col.dest": "Destination",
  "wcs.col.fee": "Predicted fee",
  "wcs.col.value": "Club value",
  "wcs.detail.title": "Top stars — destinations by club value",
  "wcs.dest.title": "Best-fit destination",
  "wcs.dest.byvalue": "Interested clubs — largest by club value",
  "wcs.dest.hypo": "Hypothetical — clubs that could be interested, ranked by club value",
  "wcs.dest.fee": "Fee at {club}",
  "wcs.model.pred": "Model best-fit",
  "wcs.stat.title": "WC stats",
  "wcs.stat.curated": "Curated estimate (below FotMob's top-3 cutoff)",
  "wcs.rumor.reported": "asking",
  "wcs.rumor.fee": "fee",
  "wcs.actual.label": "Confirmed move",
  "wcs.modelfit": "Model best-fit (ref.)",
  "wcs.age": "Age",
  "wcs.before": "Before WC",
  "wcs.after": "After WC",
  "wcs.mover.confirmed": "Real transfer confirmed",
  "wcs.mover.rumored": "Real transfer link",
  "wcs.valid.title": "Validation — vs real 2026 moves",
  "wcs.valid.james": "James 2014 anchor: model ×{model} vs real ×{target}. Only the scale is fit to this one case; the movers below are held out.",
  "wcs.valid.pred": "Model",
  "wcs.valid.real": "Real",
  "wcs.valid.ratio": "P/R",
  "wcs.valid.note": "Predicted value is destination-agnostic; a specific super-club's buyer premium lifts confirmed record fees above it.",
  "wcs.note": "ValueTrack star model: board ranked by a star index (recognizability × WC output), filtered to likely movers — a settled star at a super-club with no transfer link is dropped. The value jump is calibrated to James Rodríguez 2014 and disclosed. WC stat lines are FotMob top-stats where available, else curated estimates (marked *). Transfer rumors are curated summer-2026 reports. Destination clubs are ordered by club enterprise value. Big-5-league players only; fees in 2026 value.",

  // Footer
  "footer.partnership": "Interested in business partnership?",
  "footer.contact": "Contact Us",

  // Contact page
  "contact.eyebrow": "Get in touch",
  "contact.title": "Interested in business partnership?",
  "contact.subtitle":
    "Whether you're exploring a partnership, licensing the value engine, or just have a question — we'd love to hear from you. Reach us directly and we'll get back to you.",
  "contact.email.label": "Email",
  "contact.phone.label": "Phone",
  "contact.note": "We typically reply within 1–2 business days.",

  // KBO Korean Series forecast
  "kbo.eyebrow": "ValueTrack Research",
  "kbo.title": "Who wins the {season} Korean Series",
  "kbo.subtitle":
    "{sims} Monte-Carlo simulations of the 144-game KBO season and the postseason ladder, from sabermetrics computed in-house on public data.",
  "kbo.call.label": "The call",
  "kbo.call.body": "{first} is our pick to win the {season} Korean Series.",
  "kbo.call.locked": "Public data · metrics computed in-house · reproducible (seed {seed})",
  "kbo.stat.champion": "Title favorite",
  "kbo.stat.prob": "Korean Series win %",
  "kbo.stat.sims": "Simulations",
  "kbo.board.title": "Championship probability",
  "kbo.board.note": "Korean Series title odds for all 10 clubs, with the road there.",
  "kbo.col.rank": "#",
  "kbo.col.team": "Team",
  "kbo.col.champ": "Title %",
  "kbo.col.pennant": "KS %",
  "kbo.col.playoff": "Playoff %",
  "kbo.col.first": "1st %",
  "kbo.col.off": "OFF",
  "kbo.col.def": "DEF",
  "kbo.col.wins": "Wins",
  "kbo.legend": "OFF / DEF = offense / run-prevention rating (100 = league average). KS = reached the Korean Series.",
  "kbo.sens.title": "Sensitivity — no cherry-picking",
  "kbo.sens.note":
    "The champion under each defensible variant of the projection weight and season-strength uncertainty, reported as-is.",
  "kbo.sens.col.variant": "Variant",
  "kbo.sens.col.champ": "Champion",
  "kbo.sens.col.prob": "Title %",
  "kbo.sens.axis.proj": "projection weight {v}",
  "kbo.sens.axis.unc": "season uncertainty {v}",
  "kbo.method.title": "Method & limits",
  "kbo.method.data":
    "Data: KBO official record pages (robots-permitted) + the open choosunsick game log. statiz is not scraped — its robots.txt forbids bots.",
  "kbo.method.metrics":
    "Metrics: wOBA, wRC+, FIP and a WAR proxy computed in-house with KBO per-season constants, not copied from any site.",
  "kbo.method.model":
    "Model: Marcel-style team projection → Negative-Binomial run model → Monte-Carlo of the 144-game season and the Wild Card → Korean Series ladder.",
  "kbo.method.limits":
    "Limits: park factors neutral; the WAR proxy omits defense/baserunning; independent game noise understates season spread, so the favorite's title % runs a little high — see the sensitivity rows.",

  // KBO v2 — bottom-up (player-level)
  "kbo.strength.title": "Team strength & payroll",
  "kbo.col.payroll": "₩억",
  "kbo.col.player": "Player",
  "kbo.col.war": "WAR",
  "kbo.col.metric": "Rate",
  "kbo.col.salary": "Est. ₩",
  "kbo.col.real_salary": "Actual ₩",
  "kbo.players.title": "Player value leaderboard",
  "kbo.players.note": "Top players by in-house WAR, with an estimated salary (₩억) from the WAR→salary curve — level-calibrated so its median matches real top-earner salaries. The last column shows the real reported salary where the player matches the reference; because WAR doesn't predict individual pay (FA market, service time), the two can diverge widely per player.",
  "kbo.bt.rho": "Backtest ρ",
  "kbo.bt.rhosub": "standings, 2015–19",
  "kbo.bt.signal": "Champion signal",
  "kbo.bt.signalsub": "vs 10% naive",
  "kbo.bt.title": "Backtest — 2015–2019",
  "kbo.bt.note": "The engine, run on full real rosters, versus what actually happened. Reported as-is.",
  "kbo.bt.col.season": "Yr",
  "kbo.bt.col.pick": "Model pick",
  "kbo.bt.col.actual": "Actual champ",
  "kbo.bt.col.prob": "P(actual)",
  "kbo.bt.summary": "Across 2015–19: mean standings ρ {rho}, exact champion {hit}%, and the eventual champion got {sig}% of the model's title odds on average (naive = 10%).",
  "kbo.method.pipeline":
    "Pipeline: player stats → value (wOBA/wRC+/FIP/WAR) → lineup + playing-time preset + manager tactics → team run scoring/prevention → winning-environment (WAR+synergy) → 144-game + Korean Series Monte-Carlo. Estimated salary is display-only and not fed into the sim.",
  "kbo.method.backtest":
    "Validation: backtested on 2015–2019 full rosters (standings ρ ≈ 0.8, the eventual champion credited ~3× the naive rate) before forecasting 2026.",

  // Salary / valuation estimator (KBO ⚾ + football ⚽)
  "salary.eyebrow": "Player valuation",
  "salary.title": "Star player salary predictor",
  "salary.subtitle.kbo":
    "Estimate a KBO player's salary from WAR with the same WAR→₩ curve behind the KBO leaderboard — level-calibrated to real top-earner salaries. Load a star player or move the sliders.",
  "salary.preset.label": "Load a star player",
  "salary.preset.placeholder": "Pick a player…",
  "salary.war.label": "WAR (wins above replacement)",
  "salary.war.hint": "replacement → elite",
  "salary.age.toggle": "Factor in age",
  "salary.age.label": "Age",
  "salary.age.off": "Age unknown — no age tilt applied (factor ×1.00).",
  "salary.age.peak": "FA/prime ≈ 30",
  "salary.breakdown.title": "How it's built",
  "salary.breakdown.floor": "League minimum",
  "salary.breakdown.premium": "WAR premium (WAR^1.25 × ₩3.1B)",
  "salary.breakdown.age": "Age tilt",
  "salary.breakdown.cap": "Megadeal cap",
  "salary.breakdown.total": "Estimated salary",
  "salary.result.kbo.label": "Estimated annual salary",
  "salary.result.kbo.ref": "{name} — {metric}. Level-calibrated estimate, not this player's reported salary.",
  "salary.result.kbo.caveat":
    "A WAR→₩ estimate whose overall scale is calibrated so its median matches real KBO top-earner salaries (floor ₩30M). Because top-earner pay is uncorrelated with WAR (FA market, service time), the curve gets the magnitude right but not any individual figure — the real reported salary is shown alongside on /kbo. Only the level is calibrated, never the slope.",

  // KBO matchup prediction (야구 승부 예측)
  "matchup.eyebrow": "KBO Matchup Prediction",
  "matchup.title": "{season} KBO Head-to-Head",
  "matchup.subtitle":
    "Pick two teams. Each side's projected lineup is built from real full rosters, then the game is simulated {sims} times with an order-sensitive base-out model.",
  "matchup.home": "Home",
  "matchup.away": "Away",
  "matchup.swap": "Swap",
  "matchup.winprob": "Win probability",
  "matchup.expscore": "Expected score",
  "matchup.mu": "Exp. runs",
  "matchup.series": "Series game",
  "matchup.starter": "Starter",
  "matchup.bullpen": "Bullpen",
  "matchup.rested": "resting",
  "matchup.toggle.optimal": "Win-max lineup",
  "matchup.toggle.leverage": "Late bullpen leverage",
  "matchup.sims": "{sims} simulations",
  "matchup.simconfirm": "1,000,000-sim Monte Carlo confirms {pct}",
  "matchup.win": "{team} to win",
  "matchup.lineup.projected": "Projected lineup",
  "matchup.lineup.optimal": "Win-max lineup",
  "matchup.lineup.gain": "+{gain} runs vs projected",
  "matchup.lineup.note":
    "Batting order is modeled — KBO lineup cards live behind a blocked API. The win-max order is found by hill-climbing expected runs against tonight's opponent.",
  "matchup.col.order": "#",
  "matchup.col.player": "Batter",
  "matchup.col.wrc": "wRC+",
  "matchup.col.ob": "OB%",
  "matchup.rotation.title": "Projected rotation",
  "matchup.rotation.note": "Rotation is modeled and advanced by series game so a starter isn't reused back-to-back.",
  "matchup.dist.title": "Run distribution",
  "matchup.calc": "Simulating…",
  "matchup.method.title": "Method",
  "matchup.method.data":
    "Data: every player on all 10 rosters (regulars + bench) from the KBO /Record pages, current season. Rates and value computed in-house; statiz never scraped.",
  "matchup.method.model":
    "Model: log5 batter×pitcher outcomes → a base-out Markov chain over the 9-batter order (starter early, bullpen late, home +10%) → Negative-Binomial score convolution, confirmed by a 1,000,000-draw Monte Carlo in your browser.",
  "matchup.method.limits":
    "Limits: batting order and rotation are modeled (real lineups / probable starters are behind the robots-blocked /ws/ API); no positions or park factors; order effects are real but modest.",

  // Common
  "loading": "Loading…",
  "common.cancel": "Cancel",
} as const;

const ko: Record<keyof typeof en, string> = {
  // Nav
  "nav.glossary": "용어집",
  "nav.build": "예측",
  "nav.forecast": "예측",
  "nav.sub.fee": "이적료 예측",
  "nav.saved": "저장된 빌드",
  "nav.worldcup": "2026 월드컵",
  "nav.kbo": "2026 KBO",
  "nav.transfers": "2026 축구 이적시장",
  "nav.salary": "연봉 예측",
  "nav.contact": "문의",
  // 재구성된 상위 섹션 + 하위 탭
  "nav.market": "마켓 예측",
  "nav.match": "승부 시뮬레이션",
  "nav.sub.soccer": "축구",
  "nav.sub.baseball": "야구",
  "nav.sub.build": "가상 선수빌드",
  "nav.sub.worldcup": "26월드컵(WWW)",
  "nav.sub.kbo": "KBO",
  "nav.sub.matchup": "KBO 승부예측",
  "nav.lang.label": "언어",
  "nav.lang.en": "English",
  "nav.lang.ko": "한국어",

  // Landing
  "landing.eyebrow": "종목을 넘나드는 경쟁 가치 분석",
  "landing.badge.football": "축구",
  "landing.badge.baseball": "KBO 야구",
  "landing.badge.esports": "e스포츠",
  "landing.badge.poker": "프로 포커",
  // Brand tagline: kept in English across locales (shown as-is on the KO page too).
  "landing.title": "True value is born from data, and proven by prediction.",
  "landing.subtitle":
    "AI 기반 이적시장의 선수 가치 예측부터 경기 결과까지, 크로스 인더스트리 스포츠 인텔리전스 고도화의 와해적 혁신을 이룩합니다.",
  "landing.cta.primary": "이적료 예측하기",
  "landing.cta.secondary": "승부 결과 예측",
  "landing.stat.sims": "시뮬레이션",
  "landing.stat.transfers": "학습 이적 건수",
  "landing.stat.accuracy": "순위 상관도",
  "landing.radar.title": "선수 가치 프로파일",
  "landing.radar.axis1": "잠재력",
  "landing.radar.axis2": "적응력",
  "landing.radar.axis3": "전략 IQ",
  "landing.radar.axis4": "시장가치",
  "landing.radar.axis5": "성장세",
  "landing.radar.axis6": "정확도",
  "landing.features.title": "핵심 기능",
  "landing.feature.forecast.title": "이적료·이적팀 예측",
  "landing.feature.forecast.body":
    "실제 시즌 경기력을 바탕으로 선수의 시장 이적료와 최적의 이적팀을 예측합니다.",
  "landing.feature.multidomain.title": "신경망 네트워크",
  "landing.feature.multidomain.body":
    "축구·야구·e스포츠·포커를 하나의 신경망 네트워크로 분석합니다.",
  "landing.feature.sim.title": "전략 스쿼드 시뮬레이션",
  "landing.feature.sim.body":
    "팀 가치를 기반으로 2026 월드컵을 100만 회 시뮬레이션합니다.",
  "landing.feature.glossary.title": "쉬운 스탯 가이드",
  "landing.feature.glossary.body":
    "모델이 사용하는 모든 지표를 한 줄로 설명합니다.",

  // Glossary page
  "glossary.title": "축구 스탯, 쉬운 말로 정리했습니다",
  "glossary.subtitle":
    "모델이 사용하는 15개 지표를 한눈에 확인하실 수 있습니다. 잠깐 훑어보신 뒤 선수를 만들어 보십시오.",
  "glossary.cta": "선수 만들기 →",
  "glossary.col.stat": "지표",
  "glossary.col.definition": "설명",

  // Glossary stat definitions
  "stat.MP_Playing.full": "출전 경기 수",
  "stat.MP_Playing.def": "지난 시즌 리그에서 출전한 총 경기 수입니다.",
  "stat.Starts_Playing.full": "선발 출전",
  "stat.Starts_Playing.def": "교체 투입이 아닌 선발로 시작한 경기 수입니다.",
  "stat.Mins_Per_90_Playing.full": "90분 환산 경기 수",
  "stat.Mins_Per_90_Playing.def": "총 출전 시간 ÷ 90 — '풀타임 경기'로 환산한 값입니다.",
  "stat.Gls.full": "득점",
  "stat.Gls.def": "리그 득점 수입니다.",
  "stat.Ast.full": "도움",
  "stat.Ast.def": "득점으로 직접 연결된 패스입니다.",
  "stat.PK.full": "PK 득점",
  "stat.PK.def": "페널티킥으로 기록한 득점입니다.",
  "stat.PKatt.full": "PK 시도",
  "stat.PKatt.def": "페널티킥 시도 횟수입니다(성공 + 실패).",
  "stat.CrdY.full": "옐로카드",
  "stat.CrdY.def": "받은 경고 수입니다.",
  "stat.CrdR.full": "레드카드",
  "stat.CrdR.def": "퇴장당한 경기 수입니다.",
  "stat.Gls_Per.full": "90분당 득점",
  "stat.Gls_Per.def": "출전 90분당 득점입니다 — 비율 지표로, 총합이 아닙니다.",
  "stat.G+A_Per.full": "90분당 공격 포인트(득점+도움)",
  "stat.G+A_Per.def": "90분당 득점과 도움을 합산한 값입니다.",
  "stat.G_minus_PK_Per.full": "90분당 논PK 득점",
  "stat.G_minus_PK_Per.def": "페널티킥을 제외한 필드골을 90분 기준으로 환산한 값입니다.",
  "stat.xG_Expected.full": "기대 득점 (xG)",
  "stat.xG_Expected.def":
    "슛 위치와 상황을 가중한 득점 기대치입니다 — 평균적인 선수가 동일한 기회에서 기록했을 득점 수를 의미합니다.",
  "stat.npxG_Expected.full": "논PK 기대 득점 (npxG)",
  "stat.npxG_Expected.def": "페널티킥을 제외한 기대 득점(xG)입니다.",
  "stat.xAG_Expected.full": "기대 도움 (xAG)",
  "stat.xAG_Expected.def":
    "선수가 만들어 낸 슛의 xG 합계입니다 — 실제 도움 수가 아닌, 가중치를 반영한 기회 창출량을 뜻합니다.",
  "stat.Min_Playing.full": "출전 시간(분)",
  "stat.Min_Playing.def": "지난 시즌 리그에서 출전한 총 시간(분)입니다.",
  "stat.Ast_Per.full": "90분당 도움",
  "stat.Ast_Per.def": "출전 90분당 도움 수입니다 — 비율 지표로, 총합이 아닙니다.",
  "stat.xG_Per.full": "90분당 기대 득점 (xG/90)",
  "stat.xG_Per.def": "슛 위치와 상황을 가중한 90분당 득점 기대치입니다.",
  "stat.xAG_Per.full": "90분당 기대 도움 (xAG/90)",
  "stat.xAG_Per.def": "기회의 질을 반영한 90분당 기회 창출량입니다.",
  "stat.Sh_Standard_shoot.full": "슈팅 수",
  "stat.Sh_Standard_shoot.def": "지난 시즌 시도한 총 슈팅 수입니다.",
  "stat.SoT_Standard_shoot.full": "유효 슈팅 수",
  "stat.SoT_Standard_shoot.def": "세이브가 없었다면 들어갔을 슈팅 수입니다.",
  "stat.SoT_percent_Standard_shoot.full": "슈팅 정확도 (%)",
  "stat.SoT_percent_Standard_shoot.def": "전체 슈팅 중 유효 슈팅의 비율입니다.",
  "stat.Sh_per_90_Standard_shoot.full": "90분당 슈팅",
  "stat.Sh_per_90_Standard_shoot.def": "출전 90분당 시도한 슈팅 수입니다.",
  "stat.SoT_per_90_Standard_shoot.full": "90분당 유효 슈팅",
  "stat.SoT_per_90_Standard_shoot.def": "출전 90분당 유효 슈팅 수입니다 — 정확도와 빈도를 모두 반영합니다.",

  // Build page
  "build.title": "선수 만들기",
  "build.archetype.label": "시작 유형",
  "build.archetype.placeholder": "선수 유형을 선택하십시오…",
  "build.realplayer.label": "실제 선수",
  "build.realplayer.placeholder": "실제 이적 사례를 선택하십시오…",
  "build.realplayer.actual": "실제 이적료: {fee}",
  "build.fee.label": "예측 이적료",
  "build.fee.krwApprox": "약 {amount}",
  "build.counterfactuals.krwApprox": "원화 환산 약 {delta}",
  "build.fee.calibration":
    "모델 오차는 약 ±€7M입니다. 빅5 리그 이적 2,123건(2014–2022)으로 학습하고, 292건을 검증 데이터로 사용했습니다. Spearman ρ 0.84.",
  "build.fee.calibration.aria": "보정 정보",
  "build.counterfactuals.title": "이적료를 가장 많이 올리는 변화",
  "build.counterfactuals.format": "{feature} 지표를 {amount} 올리면 이적료가 {delta} 상승합니다",
  "build.counterfactuals.empty": "슬라이더를 움직이시면 이적료가 어떻게 바뀌는지 확인하실 수 있습니다.",
  "build.counterfactuals.ceiling":
    "이미 최고 수준입니다 — 모든 지표가 상위 5% 안에 들어 있습니다.",
  "build.showAllStats.show": "전체 15개 지표 보기",
  "build.showAllStats.hide": "비주요 지표 숨기기",
  "build.section.finishing": "마무리",
  "build.section.creation": "기회 창출",
  "build.section.passing": "패스",
  "build.section.nuisance": "기타 (영향 적음)",
  "build.save.button": "이 빌드 저장",
  "build.save.placeholder": "빌드 이름을 입력하십시오…",
  "build.save.submit": "저장",
  "build.save.cancel": "취소",
  "build.share.button": "공유 링크 복사",
  "build.error.predict": "모델에 연결하지 못했습니다. 슬라이더 값은 그대로 유지됩니다.",
  "build.error.retry": "다시 시도",
  "build.error.load": "불러오기에 실패했습니다: {error}",
  "build.error.loadGeneric": "모델 정보를 불러오지 못했습니다",
  "build.suggestName.goalMachine": "득점 기계 빌드",
  "build.suggestName.playmaker": "플레이메이커 빌드",
  "build.suggestName.allRounder": "올라운더 빌드",
  "build.suggestName.numbered": "빌드 {n}",
  "toast.saved": "'{name}'(으)로 저장되었습니다",
  "toast.saved.link": "저장된 빌드 보기",
  "toast.copied": "링크가 복사되었습니다 — 원하는 곳에 붙여 넣으십시오",

  // Saved page
  "saved.title": "저장된 빌드",
  "saved.empty.title": "아직 저장된 빌드가 없습니다",
  "saved.empty.body": "'선수 만들기' 페이지에서 새로 만들어 보십시오.",
  "saved.empty.cta": "선수 만들기 →",
  "saved.col.name": "이름",
  "saved.col.fee": "예측 이적료",
  "saved.col.date": "저장 일시",
  "saved.compare.button": "비교",
  "saved.compare.helpOne": "비교하시려면 한 개를 더 선택하십시오.",
  "saved.compare.helpZero": "두 개의 빌드를 선택하시면 비교하실 수 있습니다.",
  "saved.delete": "삭제",
  "saved.staleBadge": "이전 모델 기준 — 보기 전용",
  "saved.staleTooltip":
    "이 빌드를 저장한 이후 모델이 재학습되었습니다. 저장 시점의 이적료는 정확했으나, 현재 모델은 다른 값을 예측합니다.",

  // Compare panel
  "compare.title": "비교",
  "compare.deciding.format":
    "두 빌드를 가르는 핵심 요소는 '{group}'입니다. 해당 그룹만 변경하면 이적료가 {delta} 변동합니다.",
  "compare.group.finishing_volume": "마무리 빈도",
  "compare.group.creation": "기회 창출",
  "compare.group.availability": "출전 안정성",
  "compare.group.discipline": "징계",
  "compare.group.set_pieces": "세트피스",
  "compare.col.stat": "지표",
  "compare.close": "닫기",

  // World Cup 2026 report
  "wc.eyebrow": "밸류트랙 리서치",
  "wc.title": "2026 월드컵, 누가 우승하는가",
  "wc.subtitle":
    "밸류트랙을 움직이는 바로 그 이적료 예측 모델로 각국 스쿼드의 가치를 평가하고, 실제 2026 대진표를 {sims}회 시뮬레이션했습니다. 선수 한 명의 이적료부터 월드컵 우승까지, 하나의 엔진으로 분석합니다.",
  "wc.call.label": "예측",
  "wc.call.body":
    "밸류트랙이 꼽은 우승 1순위는 {first}입니다. 잉글랜드·프랑스·스페인·포르투갈이 가장 유력한 4강 구도를 형성합니다.",
  "wc.call.locked": "킥오프 전 확정 · 완전 재현 가능",
  "wc.stat.champion": "우승 1순위",
  "wc.stat.top4prob": "정확한 4강 적중 확률",
  "wc.stat.sims": "시뮬레이션",
  "wc.leaderboard.title": "우승 확률",
  "wc.leaderboard.note": "각국이 우승할 확률입니다.",
  "wc.col.rank": "순위",
  "wc.col.nation": "국가",
  "wc.col.win": "우승 확률",
  "wc.col.sf": "4강 진출",
  "wc.leaderboard.more": "48개국 전체 보기",
  "wc.leaderboard.less": "상위 12개국만 보기",
  "wc.semifinal.title": "가장 유력한 4강",
  "wc.semifinal.body":
    "100만 회 시뮬레이션에서 이 정확한 4개국 조합이 가장 자주 등장했습니다. 4강에 가장 많이 오른 네 나라 또한 동일합니다.",
  "wc.strength.title": "스쿼드 전력 랭킹",
  "wc.strength.note":
    "선수 가치에 스쿼드 시너지(스파인 완성도·포지션 균형·클럽 케미스트리)를 반영한 전력 점수입니다.",
  "wc.col.rating": "전력",
  "wc.col.tm": "팀 가치(€M)",
  "wc.col.synergy": "시너지",
  "wc.reasoning.title": "예측 근거",
  "wc.reasoning.france":
    "프랑스 — 전력 123.4, €1,558M으로 이번 대회 최고가 스쿼드. 2025/26 시즌 현재 폼이 정상으로 끌어올렸습니다.",
  "wc.reasoning.england":
    "잉글랜드 — 전력 123.4, 팀 가치 €1,333M. 모든 포지션에 핵심 선수가 고르게 분포된 가장 균형 잡힌 스쿼드입니다.",
  "wc.reasoning.spain":
    "스페인 — 전력 121.4, 팀 가치 €1,286M. 탄탄한 중심축과 현재 폼이 좋은 두터운 공격 자원을 보유했습니다.",
  "wc.reasoning.portugal":
    "포르투갈 — 전력 119.8, 팀 가치 €1,038M. 전 포지션에 걸쳐 빈틈 없는 완성형 스쿼드입니다.",
  "wc.method.title": "방법론",
  "wc.method.model":
    "모델: 밸류트랙의 이적료 예측 모델을 그대로 활용해 각 선수의 가치를 산출했습니다.",
  "wc.method.input":
    "선수 입력: 각국 선수를 과거 스냅샷이 아닌 2025/26 시즌 실제 폼으로 평가했습니다.",
  "wc.method.coverage":
    "커버리지: 비유럽 리그 선수가 저평가되지 않도록 각국 전체 스쿼드의 시장가치를 함께 반영했습니다.",
  "wc.method.sims":
    "실제 2026년 대진표를 기준으로 대규모 시뮬레이션을 수행해 각국의 우승·4강 진출 확률을 산출했습니다.",

  // Transfer market forecast
  "tf.eyebrow": "밸류트랙 리서치",
  "tf.title": "2026 여름 이적시장 예측",
  "tf.subtitle":
    "이번 여름 가장 주목받는 세 이적 시나리오의 예측 이적료입니다. 2025/26 시즌 실제 데이터를 기반으로 평가하고, 영입 구단의 과거 지출 성향을 반영했습니다.",
  "tf.from": "현 소속",
  "tf.value": "시장가치",
  "tf.age": "나이",
  "tf.col.dest": "이적팀",
  "tf.col.fee": "예측 이적료",
  "tf.rough": "추정",
  "tf.salah.contract": "계약 잔여",
  "tf.salah.modelfee": "모델 예측",
  "tf.salah.expired": "계약 만료",
  "tf.salah.yr": "{n}년",
  "tf.salah.reality": "계약을 소진할 경우 실제로는",
  "tf.salah.free": "자유 이적 · €0",
  "tf.stats.label": "2025/26",
  "tf.stat.apps": "경기",
  "tf.stat.g": "득점",
  "tf.stat.a": "도움",
  "tf.stat.min": "출전(분)",
  "tf.note": "밸류트랙 모델 추정치 · 2026년 가치 기준.",
  // 월드컵 스타 (브레이크아웃 예측)
  "nav.sub.wcstars": "월드컵 스타",
  "wcs.eyebrow": "밸류트랙 리서치",
  "wcs.title": "2026 월드컵 스타 예측",
  "wcs.subtitle": "2026 월드컵에서 사람들이 알 만한, 그리고 실제로 움직일 수 있는 스타들 — 대회 스탯, 시장가치가 얼마나 뛰는지, 실제 이적설, 그리고 구단가치 순 행선지. 빅클럽에 정착해 이적 가능성이 낮은 스타는 제외했다.",
  "wcs.result": "결과",
  "wcs.goldenBoot": "득점왕",
  "wcs.youngPlayer": "영플레이어",
  "wcs.james.tag": "가장 유력한 하메스 케이스",
  "wcs.board.title": "월드컵 스타 보드",
  "wcs.board.sub": "스타 지수 순 — 인지도 × 대회 활약. 막대는 상승한 가치.",
  "wcs.col.player": "선수",
  "wcs.col.jump": "가치 점프",
  "wcs.col.dest": "행선지",
  "wcs.col.fee": "예상 이적료",
  "wcs.col.value": "구단가치",
  "wcs.detail.title": "상위 스타 — 구단가치 순 행선지",
  "wcs.dest.title": "가장 적합한 행선지",
  "wcs.dest.byvalue": "관심 가능 구단 — 구단가치 큰 순",
  "wcs.dest.hypo": "가정 — 구단가치 기준 관심 가능 구단",
  "wcs.dest.fee": "{club} 예상 이적료",
  "wcs.model.pred": "모델 예상 행선지",
  "wcs.stat.title": "월드컵 스탯",
  "wcs.stat.curated": "추정치 (FotMob top-3 밖)",
  "wcs.rumor.reported": "호가",
  "wcs.rumor.fee": "이적료",
  "wcs.actual.label": "실제 이적",
  "wcs.modelfit": "모델 적합 구단 (참고)",
  "wcs.age": "나이",
  "wcs.before": "이적 전",
  "wcs.after": "이적 후",
  "wcs.mover.confirmed": "실제 이적 확정",
  "wcs.mover.rumored": "실제 이적설",
  "wcs.valid.title": "검증 — 실제 2026 이적과 대조",
  "wcs.valid.james": "하메스 2014 앵커: 모델 ×{model} vs 실제 ×{target}. 스케일은 이 한 케이스에만 맞췄고, 아래 선수들은 보정에 쓰지 않았다.",
  "wcs.valid.pred": "모델",
  "wcs.valid.real": "실제",
  "wcs.valid.ratio": "예상/실제",
  "wcs.valid.note": "예상 가치는 행선지 무관값이며, 특정 빅클럽의 영입 프리미엄이 실제 확정 이적료를 그 위로 끌어올린다.",
  "wcs.note": "밸류트랙 스타 모델: 보드는 스타 지수(인지도 × 대회 활약) 순이며, 이적 가능성이 있는 선수만 남겼다(빅클럽에 정착해 이적설 없는 스타는 제외). 가치 점프는 하메스 2014에 보정·공개했다. 월드컵 스탯은 FotMob top-stats 우선, 없으면 큐레이션 추정치(* 표시). 이적설은 큐레이션한 2026 여름 보도다. 행선지 구단은 구단가치(기업가치) 순으로 정렬한다. 빅5 리그 선수 한정 · 이적료는 2026년 가치.",

  // Footer
  "footer.partnership": "비즈니스 제휴에 관심이 있으신가요?",
  "footer.contact": "문의하기",

  // Contact page
  "contact.eyebrow": "문의하기",
  "contact.title": "비즈니스 제휴에 관심이 있으신가요?",
  "contact.subtitle":
    "제휴, 가치 엔진 라이선스, 또는 단순한 궁금증까지 — 무엇이든 편하게 문의해 주십시오. 아래 연락처로 연락 주시면 빠르게 답변드리겠습니다.",
  "contact.email.label": "이메일",
  "contact.phone.label": "전화",
  "contact.note": "보통 영업일 기준 1~2일 이내에 답변드립니다.",

  // KBO 한국시리즈 예측
  "kbo.eyebrow": "밸류트랙 리서치",
  "kbo.title": "{season} 한국시리즈, 누가 우승할까",
  "kbo.subtitle":
    "144경기 정규시즌과 포스트시즌 사다리를 {sims}회 몬테카를로로 시뮬레이션했습니다. 공개 데이터로 자체 계산한 세이버메트릭스 기반입니다.",
  "kbo.call.label": "예측",
  "kbo.call.body": "{first} — {season} 한국시리즈 우승 1순위.",
  "kbo.call.locked": "공개 데이터 · 자체 계산 지표 · 재현 가능 (시드 {seed})",
  "kbo.stat.champion": "우승 1순위",
  "kbo.stat.prob": "한국시리즈 우승 확률",
  "kbo.stat.sims": "시뮬레이션",
  "kbo.board.title": "우승 확률",
  "kbo.board.note": "10개 구단의 한국시리즈 우승 확률과 거기까지 가는 길.",
  "kbo.col.rank": "#",
  "kbo.col.team": "구단",
  "kbo.col.champ": "우승",
  "kbo.col.pennant": "한국시리즈",
  "kbo.col.playoff": "가을야구",
  "kbo.col.first": "정규1위",
  "kbo.col.off": "공격",
  "kbo.col.def": "수비",
  "kbo.col.wins": "예상승수",
  "kbo.legend": "공격 / 수비 = 득점력 · 실점 억제 전력 (100 = 리그 평균). 한국시리즈 = KS 진출.",
  "kbo.sens.title": "민감도 분석 — 체리피킹 방지",
  "kbo.sens.note":
    "투영 가중치와 시즌 불확실성의 방어 가능한 변형별 우승팀을 그대로 보고합니다.",
  "kbo.sens.col.variant": "변형",
  "kbo.sens.col.champ": "우승팀",
  "kbo.sens.col.prob": "우승 확률",
  "kbo.sens.axis.proj": "투영 가중치 {v}",
  "kbo.sens.axis.unc": "시즌 불확실성 {v}",
  "kbo.method.title": "방법론 / 한계",
  "kbo.method.data":
    "데이터: KBO 공식 기록실(robots 허용) + 공개 choosunsick 경기 로그. statiz는 크롤링하지 않습니다 — robots.txt가 봇을 차단합니다.",
  "kbo.method.metrics":
    "지표: wOBA·wRC+·FIP·WAR를 KBO 시즌별 상수로 직접 계산했습니다. 외부 사이트 수치 복사가 아닙니다.",
  "kbo.method.model":
    "모델: Marcel식 팀 투영 → 음이항분포 득점 모델 → 144경기 정규시즌과 와일드카드~한국시리즈 사다리 몬테카를로.",
  "kbo.method.limits":
    "한계: 구장 보정 중립, WAR는 수비/주루 생략, 독립 경기 노이즈가 시즌 분산을 과소평가해 1순위 확률이 다소 높습니다 — 민감도 표를 참고하세요.",

  // KBO v2 — 선수 단위 bottom-up
  "kbo.strength.title": "팀 전력 & 연봉",
  "kbo.col.payroll": "연봉(억)",
  "kbo.col.player": "선수",
  "kbo.col.war": "WAR",
  "kbo.col.metric": "지표",
  "kbo.col.salary": "추정연봉",
  "kbo.col.real_salary": "실연봉",
  "kbo.players.title": "선수 가치 리더보드",
  "kbo.players.note": "자체 계산 WAR 상위 선수와 WAR→연봉 곡선의 추정 연봉(억원) — 실연봉 중앙값에 레벨 보정. 마지막 열은 매칭되는 선수의 실제 공시 연봉으로, WAR이 개별 연봉을 예측하진 못해(FA 시장·서비스타임) 선수별로 크게 갈립니다.",
  "kbo.bt.rho": "백테스트 ρ",
  "kbo.bt.rhosub": "순위 상관, 2015–19",
  "kbo.bt.signal": "우승팀 신호",
  "kbo.bt.signalsub": "무작위 10% 대비",
  "kbo.bt.title": "백테스트 — 2015–2019",
  "kbo.bt.note": "엔진을 실제 전체 로스터로 돌려 실제 결과와 비교. 있는 그대로 보고합니다.",
  "kbo.bt.col.season": "연도",
  "kbo.bt.col.pick": "모델 예측",
  "kbo.bt.col.actual": "실제 우승",
  "kbo.bt.col.prob": "P(실제)",
  "kbo.bt.summary": "2015–19 평균: 순위 상관 ρ {rho}, 우승 정확 적중 {hit}%, 실제 우승팀에 평균 {sig}%의 우승확률 부여(무작위 10%).",
  "kbo.method.pipeline":
    "파이프라인: 선수 스탯 → 가치(wOBA/wRC+/FIP/WAR) → 라인업·출전 preset·감독 전술 → 팀 공격/수비 득점 → 승리환경(WAR+시너지) → 144경기+한국시리즈 몬테카를로. 추정연봉은 표시용이며 시뮬에는 미투입.",
  "kbo.method.backtest":
    "검증: 2015–2019 전체 로스터로 백테스트(순위 상관 ρ≈0.8, 실제 우승팀에 무작위의 약 3배 확률 부여) 후 2026 예측.",

  // 선수 가치/연봉 예측기 (KBO ⚾ + 축구 ⚽)
  "salary.eyebrow": "선수 가치 예측",
  "salary.title": "대표 선수 연봉 예측",
  "salary.subtitle.kbo":
    "KBO 리더보드에 쓰인 WAR→₩ 곡선 그대로, 선수의 WAR로 예상 연봉을 계산합니다 — 실연봉 상위 중앙값에 레벨 보정. 대표 선수를 불러오거나 슬라이더를 움직여 보십시오.",
  "salary.preset.label": "대표 선수 불러오기",
  "salary.preset.placeholder": "선수를 선택하십시오…",
  "salary.war.label": "WAR (대체 대비 승리 기여)",
  "salary.war.hint": "대체 → 리그 정상",
  "salary.age.toggle": "나이 반영",
  "salary.age.label": "나이",
  "salary.age.off": "나이 미지정 — 나이 보정 없음 (계수 ×1.00).",
  "salary.age.peak": "FA/전성기 ≈ 30세",
  "salary.breakdown.title": "산출 방식",
  "salary.breakdown.floor": "리그 최저",
  "salary.breakdown.premium": "WAR 프리미엄 (WAR^1.25 × 31억)",
  "salary.breakdown.age": "나이 보정",
  "salary.breakdown.cap": "초대형 계약 상한",
  "salary.breakdown.total": "예상 연봉",
  "salary.result.kbo.label": "예상 연봉",
  "salary.result.kbo.ref": "{name} — {metric}. 개별 실연봉이 아니라 실연봉 수준에 맞춘 WAR 기반 추정치입니다.",
  "salary.result.kbo.caveat":
    "전체 스케일을 실제 KBO 상위 연봉자 중앙값에 맞춰 보정한 WAR→₩ 추정치입니다(최저 3천만원). 상위 연봉은 WAR과 상관이 없어(FA 시장·서비스타임) 크기는 현실적이지만 개별 금액은 맞지 않습니다 — /kbo에 실제 공시 연봉을 함께 표시합니다. 레벨만 보정하고 기울기는 미적합.",

  // KBO matchup prediction (야구 승부 예측)
  "matchup.eyebrow": "KBO 승부 예측",
  "matchup.title": "{season} KBO 맞대결 예측",
  "matchup.subtitle":
    "두 팀을 고르면, 전 구단 실제 로스터로 예상 라인업을 짜고 타순까지 반영한 베이스-아웃 모델로 경기를 {sims}회 시뮬레이션합니다.",
  "matchup.home": "홈",
  "matchup.away": "원정",
  "matchup.swap": "홈/원정 교체",
  "matchup.winprob": "승리 확률",
  "matchup.expscore": "예상 스코어",
  "matchup.mu": "기대 득점",
  "matchup.series": "시리즈 경기",
  "matchup.starter": "선발",
  "matchup.bullpen": "불펜",
  "matchup.rested": "휴식",
  "matchup.toggle.optimal": "승리확률 최대 라인업",
  "matchup.toggle.leverage": "후반 불펜 레버리지",
  "matchup.sims": "{sims}회 시뮬레이션",
  "matchup.simconfirm": "100만 회 몬테카를로로 {pct} 확인",
  "matchup.win": "{team} 승리",
  "matchup.lineup.projected": "예상 라인업",
  "matchup.lineup.optimal": "승리확률 최대 라인업",
  "matchup.lineup.gain": "예상 대비 +{gain}점",
  "matchup.lineup.note":
    "타순은 모델링입니다 — 실제 라인업지는 차단된 API에만 있습니다. 최대 라인업은 오늘 상대에 대한 기대 득점을 최적화해 찾습니다.",
  "matchup.col.order": "타순",
  "matchup.col.player": "타자",
  "matchup.col.wrc": "wRC+",
  "matchup.col.ob": "출루율",
  "matchup.rotation.title": "예상 로테이션",
  "matchup.rotation.note": "로테이션은 모델링이며 시리즈 경기에 따라 선발이 연속으로 겹치지 않게 진행됩니다.",
  "matchup.dist.title": "득점 분포",
  "matchup.calc": "시뮬레이션 중…",
  "matchup.method.title": "방법론",
  "matchup.method.data":
    "데이터: KBO /Record 페이지의 전 구단 10팀 전체 선수(주전+벤치), 현재 시즌. 지표·가치는 자체 계산. statiz 미사용.",
  "matchup.method.model":
    "모델: log5 타자×투수 결과 → 9인 타순 베이스-아웃 마르코프(초반 선발·후반 불펜·홈 +10%) → 음이항 스코어 합성, 브라우저 내 100만 회 몬테카를로로 확인.",
  "matchup.method.limits":
    "한계: 타순·로테이션은 모델링(실제 라인업/예고선발은 robots 차단 /ws/ API에만 존재). 포지션·파크팩터 미반영. 타순 효과는 실재하나 크지 않음.",

  // Common
  "loading": "불러오는 중…",
  "common.cancel": "취소",
};

export const dict = { en, ko } as const;

export type TKey = keyof typeof en;

/** Translate with optional `{var}` interpolation. */
export function t(locale: Locale, key: TKey, vars?: Record<string, string>): string {
  let s: string = dict[locale][key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(v);
    }
  }
  return s;
}
