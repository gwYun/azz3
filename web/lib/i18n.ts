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
  "nav.build": "Build",
  "nav.saved": "Saved",
  "nav.lang.label": "Language",
  "nav.lang.en": "English",
  "nav.lang.ko": "한국어",

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
    "Model error: about ±€14M. Treat this number as directional, not exact. Trained on 96 players, so take big jumps with a grain of salt.",
  "build.fee.calibration.aria": "Calibration info",
  "build.counterfactuals.title": "Top stat improvements",
  "build.counterfactuals.format": "If you bumped {feature} by 1 SD, you would be worth {delta}",
  "build.counterfactuals.empty": "Drag a slider to see how the fee changes.",
  "build.counterfactuals.ceiling":
    "You're at the ceiling — every stat is already in the top 5%.",
  "build.showAllStats.show": "Show all 15 stats",
  "build.showAllStats.hide": "Hide nuisance stats",
  "build.section.scoring": "Scoring",
  "build.section.creation": "Creation",
  "build.section.efficiency": "Per-90 efficiency",
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

  // Common
  "loading": "Loading…",
  "common.cancel": "Cancel",

  // Mobile banner
  "mobile.banner": "Best on desktop. Mobile coming soon.",
} as const;

const ko: Record<keyof typeof en, string> = {
  // Nav
  "nav.glossary": "용어집",
  "nav.build": "선수 만들기",
  "nav.saved": "저장 목록",
  "nav.lang.label": "언어",
  "nav.lang.en": "English",
  "nav.lang.ko": "한국어",

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
    "모델 오차는 약 ±€14M입니다. 정확한 값이 아닌 방향성으로 받아들여 주십시오. 학습 데이터가 96명 기준이므로, 큰 폭의 변화는 한 번 더 확인하시기 바랍니다.",
  "build.fee.calibration.aria": "보정 정보",
  "build.counterfactuals.title": "이적료를 가장 많이 올리는 변화",
  "build.counterfactuals.format": "{feature} 지표를 1 SD 올리면 이적료가 {delta} 상승합니다",
  "build.counterfactuals.empty": "슬라이더를 움직이시면 이적료가 어떻게 바뀌는지 확인하실 수 있습니다.",
  "build.counterfactuals.ceiling":
    "이미 최고 수준입니다 — 모든 지표가 상위 5% 안에 들어 있습니다.",
  "build.showAllStats.show": "전체 15개 지표 보기",
  "build.showAllStats.hide": "비주요 지표 숨기기",
  "build.section.scoring": "득점",
  "build.section.creation": "기회 창출",
  "build.section.efficiency": "90분당 효율",
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
