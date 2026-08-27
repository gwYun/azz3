/**
 * News section league config — the sub-tabs under the top-level 뉴스 tab, shared
 * by the nav (sub-tab row) and the /news/[league] pages so they never drift.
 *
 * `live` = the club explorer is open now (KBO). The rest launch next month (KBO
 * playoffs + the major soccer leagues) and render a "coming soon" panel until
 * then. `id` is the URL segment (/news/<id>) and, for soccer, matches the Naver
 * league code so the article pipeline can key on it later.
 */
export type NewsLeague = { id: string; ko: string; en: string; live: boolean };

export const NEWS_LEAGUES: NewsLeague[] = [
  { id: "kbo",         ko: "KBO",            en: "KBO",            live: true },
  { id: "kbo-playoff", ko: "KBO 플레이오프",  en: "KBO Playoffs",   live: false },
  { id: "epl",         ko: "프리미어리그",    en: "Premier League", live: false },
  { id: "primera",     ko: "라리가",          en: "LaLiga",         live: false },
  { id: "bundesliga",  ko: "분데스리가",      en: "Bundesliga",     live: false },
  { id: "seria",       ko: "세리에 A",        en: "Serie A",        live: false },
  { id: "ligue1",      ko: "리그 1",          en: "Ligue 1",        live: false },
];

/** URL paths of every news sub-tab — the nav uses these to mark the section active. */
export const NEWS_PATHS = NEWS_LEAGUES.map((l) => `/news/${l.id}`);

/** The first (live) sub-tab — where the parent "News" tab points. */
export const NEWS_DEFAULT = NEWS_LEAGUES.find((l) => l.live)?.id ?? NEWS_LEAGUES[0].id;

export const getNewsLeague = (id: string): NewsLeague | undefined =>
  NEWS_LEAGUES.find((l) => l.id === id);
