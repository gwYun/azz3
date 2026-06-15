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
  "nav.saved": "Saved",
  "nav.worldcup": "World Cup 2026",
  "nav.transfers": "Transfer Market",
  "nav.lang.label": "Language",
  "nav.lang.en": "English",
  "nav.lang.ko": "한국어",

  // Landing
  "landing.eyebrow": "Cross-industry competitive intelligence",
  "landing.badge.football": "Football",
  "landing.badge.baseball": "KBO Baseball",
  "landing.badge.esports": "Esports",
  "landing.badge.poker": "Pro Poker",
  "landing.title": "THE ACCURATE PULSE OF CROSS-INDUSTRY COMPETITIVE VALUE",
  "landing.subtitle":
    "AI-powered transfer and performance analytics. One value engine, from a single player's fee to a World Cup winner.",
  "landing.cta.primary": "Forecast a transfer fee",
  "landing.cta.secondary": "Explore the market",
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
  "landing.feature.forecast.title": "Transfer & Fee Forecast",
  "landing.feature.forecast.body":
    "Predict a player's market fee and best-fit destination from real-season form.",
  "landing.feature.multidomain.title": "Multi-Domain Tracking",
  "landing.feature.multidomain.body":
    "One value engine across football, baseball, esports, and poker.",
  "landing.feature.sim.title": "Strategic Squad Simulation",
  "landing.feature.sim.body":
    "Simulate the 2026 World Cup a million times from squad value.",
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
  "wc.col.tm": "Squad value (€M)",
  "wc.col.synergy": "Synergy",
  "wc.reasoning.title": "Why these four",
  "wc.reasoning.france":
    "France — strength 123.4, the field's richest squad at €1,558M. Current 2025/26 form lifts it to the top.",
  "wc.reasoning.england":
    "England — strength 123.4, squad value €1,333M. The most balanced squad in the field, even across every line.",
  "wc.reasoning.spain":
    "Spain — strength 121.4, squad value €1,286M. Elite spine with deep attacking talent in current form.",
  "wc.reasoning.portugal":
    "Portugal — strength 119.8, squad value €1,038M. Balanced and complete across the pitch.",
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
    "Predicted fees for three of the window's most-watched moves — valued on real 2025/26 form, shaped by each buying club's spending history.",
  "tf.from": "From",
  "tf.value": "Market value",
  "tf.age": "Age",
  "tf.col.dest": "Destination",
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

  // Common
  "loading": "Loading…",
  "common.cancel": "Cancel",

  // Mobile banner
  "mobile.banner": "Best on desktop. Mobile coming soon.",
} as const;

const ko: Record<keyof typeof en, string> = {
  // Nav
  "nav.glossary": "용어집",
  "nav.build": "예측",
  "nav.saved": "저장 목록",
  "nav.worldcup": "2026 월드컵",
  "nav.transfers": "이적시장 예측",
  "nav.lang.label": "언어",
  "nav.lang.en": "English",
  "nav.lang.ko": "한국어",

  // Landing
  "landing.eyebrow": "산업을 가로지르는 경쟁 가치 분석",
  "landing.badge.football": "축구",
  "landing.badge.baseball": "KBO 야구",
  "landing.badge.esports": "e스포츠",
  "landing.badge.poker": "프로 포커",
  "landing.title": "산업을 가로지르는 경쟁 가치의 가장 정확한 맥박",
  "landing.subtitle":
    "AI 기반 이적·퍼포먼스 분석 플랫폼입니다. 선수 한 명의 이적료부터 월드컵 우승까지, 하나의 가치 엔진으로 분석합니다.",
  "landing.cta.primary": "이적료 예측 시작",
  "landing.cta.secondary": "마켓 살펴보기",
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
  "landing.feature.forecast.title": "이적료·행선지 예측",
  "landing.feature.forecast.body":
    "실제 시즌 폼으로 선수의 시장 이적료와 가장 적합한 행선지를 예측합니다.",
  "landing.feature.multidomain.title": "멀티 도메인 트래킹",
  "landing.feature.multidomain.body":
    "축구·야구·e스포츠·포커를 하나의 가치 엔진으로 분석합니다.",
  "landing.feature.sim.title": "전략 스쿼드 시뮬레이션",
  "landing.feature.sim.body":
    "스쿼드 가치 기반으로 2026 월드컵을 100만 회 시뮬레이션합니다.",
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
  "wc.col.tm": "스쿼드 가치(€M)",
  "wc.col.synergy": "시너지",
  "wc.reasoning.title": "예측 근거",
  "wc.reasoning.france":
    "프랑스 — 전력 123.4, €1,558M으로 이번 대회 최고가 스쿼드. 2025/26 시즌 현재 폼이 정상으로 끌어올렸습니다.",
  "wc.reasoning.england":
    "잉글랜드 — 전력 123.4, 스쿼드 가치 €1,333M. 모든 포지션에 핵심 선수가 고르게 분포된 가장 균형 잡힌 스쿼드입니다.",
  "wc.reasoning.spain":
    "스페인 — 전력 121.4, 스쿼드 가치 €1,286M. 탄탄한 중심축과 현재 폼이 좋은 두터운 공격 자원을 보유했습니다.",
  "wc.reasoning.portugal":
    "포르투갈 — 전력 119.8, 스쿼드 가치 €1,038M. 전 포지션에 걸쳐 빈틈 없는 완성형 스쿼드입니다.",
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
    "이번 여름 가장 주목받는 세 이적 시나리오의 예측 이적료입니다. 2025/26 시즌 실제 폼으로 평가하고, 영입 구단의 과거 지출 성향을 반영했습니다.",
  "tf.from": "현 소속",
  "tf.value": "시장가치",
  "tf.age": "나이",
  "tf.col.dest": "행선지",
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

  // Common
  "loading": "불러오는 중…",
  "common.cancel": "취소",

  // Mobile banner
  "mobile.banner": "데스크톱 환경에 최적화되어 있습니다. 모바일 지원은 준비 중입니다.",
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
