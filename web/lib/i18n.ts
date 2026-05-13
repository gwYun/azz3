/**
 * Lightweight i18n. Two locales (en, ko), no library, no runtime download.
 *
 * Pattern:
 *   - Server Components import `dict` and pass `dict[locale]` to children.
 *   - Client Components use `useT()` from i18n-context.tsx.
 *   - Locale persists in localStorage; defaults to "en".
 *
 * Add a new key by adding it to BOTH `en` and `ko`. TS will fail if either is missing.
 */

export type Locale = "en" | "ko";

export const LOCALES: readonly Locale[] = ["en", "ko"] as const;
export const DEFAULT_LOCALE: Locale = "en";

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
  "build.fee.label": "Predicted transfer fee",
  "build.fee.calibration":
    "Model error: about ±€14M. Treat this number as directional, not exact. Trained on 96 players, so take big jumps with a grain of salt.",
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
  "nav.build": "빌드",
  "nav.saved": "저장됨",
  "nav.lang.label": "언어",
  "nav.lang.en": "English",
  "nav.lang.ko": "한국어",

  // Glossary page
  "glossary.title": "축구 스탯, 쉬운 말로",
  "glossary.subtitle":
    "모델이 사용하는 15개 지표의 빠른 사전. 잠깐 훑어본 뒤 선수를 만들어 보세요.",
  "glossary.cta": "선수 빌드하기 →",
  "glossary.col.stat": "지표",
  "glossary.col.definition": "설명",

  // Glossary stat definitions
  "stat.MP_Playing.full": "경기 출전 수",
  "stat.MP_Playing.def": "지난 시즌 리그에서 출전한 총 경기 수.",
  "stat.Starts_Playing.full": "선발 출전",
  "stat.Starts_Playing.def": "교체 출전이 아닌 선발로 시작한 경기 수.",
  "stat.Mins_Per_90_Playing.full": "90분 환산 경기 수",
  "stat.Mins_Per_90_Playing.def": "총 출전 분 ÷ 90 — '풀타임 경기'로 환산한 값.",
  "stat.Gls.full": "득점",
  "stat.Gls.def": "리그 득점 수.",
  "stat.Ast.full": "도움",
  "stat.Ast.def": "골로 직접 연결된 패스.",
  "stat.PK.full": "PK 득점",
  "stat.PK.def": "페널티킥으로 넣은 골.",
  "stat.PKatt.full": "PK 시도",
  "stat.PKatt.def": "PK 시도 횟수 (성공 + 실패).",
  "stat.CrdY.full": "옐로카드",
  "stat.CrdY.def": "받은 경고 수.",
  "stat.CrdR.full": "레드카드",
  "stat.CrdR.def": "퇴장당한 경기 수.",
  "stat.Gls_Per.full": "90분당 득점",
  "stat.Gls_Per.def": "출전 90분당 득점 — 비율 지표 (총합 아님).",
  "stat.G+A_Per.full": "90분당 (득점 + 도움)",
  "stat.G+A_Per.def": "90분당 공격 포인트 합산.",
  "stat.G_minus_PK_Per.full": "90분당 논PK 득점",
  "stat.G_minus_PK_Per.def": "PK 제외, 90분당 필드 골.",
  "stat.xG_Expected.full": "기대 득점 (xG)",
  "stat.xG_Expected.def":
    "슛 위치·상황으로 가중한 골 기대치 — 평균적인 선수가 같은 기회에서 넣었을 골 수.",
  "stat.npxG_Expected.full": "논PK 기대 득점 (npxG)",
  "stat.npxG_Expected.def": "PK를 제외한 xG.",
  "stat.xAG_Expected.full": "기대 어시스트 골 (xAG)",
  "stat.xAG_Expected.def":
    "선수가 만든 슛의 xG 합계 — 결과 어시스트가 아닌, 가중 창출량.",

  // Build page
  "build.title": "선수 빌드",
  "build.archetype.label": "시작점",
  "build.archetype.placeholder": "원형 선택…",
  "build.fee.label": "예측 이적료",
  "build.fee.calibration":
    "모델 오차: 약 ±€14M. 정확한 값이 아닌 방향성으로 받아들여 주세요. 학습 데이터 96명 기준이라 큰 변화는 한 번 더 의심해 보세요.",
  "build.counterfactuals.title": "이적료를 가장 많이 올릴 변경",
  "build.counterfactuals.format": "{feature}을(를) 1 SD 올리면 {delta} 더 받을 수 있어요",
  "build.counterfactuals.empty": "슬라이더를 움직이면 이적료가 어떻게 변하는지 보여줄게요.",
  "build.counterfactuals.ceiling":
    "이미 천장이에요 — 모든 지표가 상위 5% 안에 들어가 있어요.",
  "build.showAllStats.show": "전체 15개 지표 보기",
  "build.showAllStats.hide": "잡음 지표 숨기기",
  "build.section.scoring": "득점",
  "build.section.creation": "창출",
  "build.section.efficiency": "90분당 효율",
  "build.section.nuisance": "기타 (큰 영향 없음)",
  "build.save.button": "이 빌드 저장",
  "build.save.placeholder": "빌드 이름…",
  "build.save.submit": "저장",
  "build.save.cancel": "취소",
  "build.share.button": "공유 링크 복사",
  "build.error.predict": "모델에 연결하지 못했어요. 슬라이더 값은 그대로 남아 있어요.",
  "build.error.retry": "다시 시도",
  "toast.saved": "'{name}' 으로 저장됨",
  "toast.saved.link": "저장된 빌드 보기",
  "toast.copied": "링크 복사됨 — 어디든 붙여 넣으세요",

  // Saved page
  "saved.title": "저장된 빌드",
  "saved.empty.title": "아직 저장된 빌드가 없어요",
  "saved.empty.body": "빌드 페이지에서 만들어 보세요.",
  "saved.empty.cta": "선수 빌드하기 →",
  "saved.col.name": "이름",
  "saved.col.fee": "예측 이적료",
  "saved.col.date": "저장 시각",
  "saved.compare.button": "비교",
  "saved.compare.helpOne": "비교하려면 한 개 더 선택해 주세요.",
  "saved.compare.helpZero": "두 개를 선택해 비교해 보세요.",
  "saved.delete": "삭제",
  "saved.staleBadge": "이전 모델로 저장됨 — 보기 전용",
  "saved.staleTooltip":
    "이 빌드 저장 후 모델이 다시 학습되었어요. 저장 시점의 이적료는 정확했지만, 지금 모델은 다른 값을 예측해요.",

  // Compare panel
  "compare.title": "비교",
  "compare.deciding.format":
    "두 빌드를 가르는 핵심은 {group} 입니다. 그 그룹만 바꿨을 때 이적료가 {delta} 변해요.",
  "compare.group.finishing_volume": "결정력",
  "compare.group.creation": "창출",
  "compare.group.availability": "출전 안정성",
  "compare.group.discipline": "징계",
  "compare.group.set_pieces": "세트피스",
  "compare.col.stat": "지표",
  "compare.close": "닫기",

  // Common
  "loading": "불러오는 중…",
  "common.cancel": "취소",

  // Mobile banner
  "mobile.banner": "데스크탑에서 가장 잘 작동해요. 모바일은 곧 지원 예정.",
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
