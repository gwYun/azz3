/**
 * Report section league config — the sub-tabs under the top-level 리포트 tab,
 * shared by the nav (sub-tab row) and the /reports/[league] pages so they never
 * drift.
 *
 * `live` = the club explorer is open. `soccer` leagues read the per-team match
 * reports (/api/soccer/articles); `id` is the URL segment (/reports/<id>) and,
 * for soccer, the Naver league code the pipeline keys on.
 */
export type NewsLeague = { id: string; ko: string; en: string; live: boolean; soccer?: boolean };

export const NEWS_LEAGUES: NewsLeague[] = [
  { id: "kbo",         ko: "KBO",            en: "KBO",            live: true },
  { id: "kbo-playoff", ko: "KBO 플레이오프",  en: "KBO Playoffs",   live: false },
  { id: "epl",         ko: "프리미어리그",    en: "Premier League", live: true, soccer: true },
  { id: "primera",     ko: "라리가",          en: "LaLiga",         live: true, soccer: true },
  { id: "bundesliga",  ko: "분데스리가",      en: "Bundesliga",     live: true, soccer: true },
  { id: "seria",       ko: "세리에 A",        en: "Serie A",        live: true, soccer: true },
  { id: "ligue1",      ko: "리그 1",          en: "Ligue 1",        live: true, soccer: true },
  { id: "kleague",     ko: "K리그1",          en: "K League 1",     live: true, soccer: true },
  { id: "kleague2",    ko: "K리그2",          en: "K League 2",     live: true, soccer: true },
];

/** URL paths of every report sub-tab — the nav uses these to mark the section active. */
export const NEWS_PATHS = NEWS_LEAGUES.map((l) => `/reports/${l.id}`);

/** The first (live) sub-tab — where the parent "News" tab points. */
export const NEWS_DEFAULT = NEWS_LEAGUES.find((l) => l.live)?.id ?? NEWS_LEAGUES[0].id;

export const getNewsLeague = (id: string): NewsLeague | undefined =>
  NEWS_LEAGUES.find((l) => l.id === id);
