/**
 * Leaguepedia (lol.fandom.com) Cargo client — per-game draft + scoreboard data
 * for the draft model. Content is CC BY-SA 3.0: reports that use it must credit
 * Leaguepedia.
 *
 * Anonymous Cargo queries are rate-limited almost immediately, so we log in with
 * a bot password (Special:BotPasswords; LEAGUEPEDIA_USER = 'User@botname',
 * LEAGUEPEDIA_BOT_PASSWORD) and keep the session cookie. Queries are sequential
 * with a delay; a `ratelimited` error backs off and retries.
 */
const API = "https://lol.fandom.com/api.php";
const UA = "valuetrack-research/0.1";
const DELAY_MS = 1500;
const PAGE = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Leaguepedia {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private keepCookies(res: Response) {
    const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const c of raw) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  private async call(params: Record<string, string>, post = false): Promise<any> {
    const body = new URLSearchParams({ format: "json", ...params });
    const res = await fetch(post ? API : `${API}?${body}`, {
      method: post ? "POST" : "GET",
      headers: {
        "User-Agent": UA,
        Cookie: this.cookieHeader(),
        ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: post ? body : undefined,
    });
    this.keepCookies(res);
    if (!res.ok) throw new Error(`leaguepedia ${res.status}`);
    return res.json();
  }

  async login(user = process.env.LEAGUEPEDIA_USER, password = process.env.LEAGUEPEDIA_BOT_PASSWORD) {
    if (!user || !password) throw new Error("LEAGUEPEDIA_USER / LEAGUEPEDIA_BOT_PASSWORD not set");
    const tok = await this.call({ action: "query", meta: "tokens", type: "login" });
    const r = await this.call(
      { action: "login", lgname: user, lgpassword: password, lgtoken: tok.query.tokens.logintoken },
      true,
    );
    if (r.login?.result !== "Success") throw new Error(`leaguepedia login: ${r.login?.result} ${r.login?.reason ?? ""}`);
  }

  /** One Cargo query, all pages. Rows are the flat `title` objects. */
  async cargo(q: {
    tables: string;
    fields: string;
    where?: string;
    joinOn?: string;
    orderBy?: string;
    groupBy?: string;
  }): Promise<Record<string, string>[]> {
    const out: Record<string, string>[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const params: Record<string, string> = {
        action: "cargoquery", tables: q.tables, fields: q.fields, limit: String(PAGE), offset: String(offset),
      };
      if (q.where) params.where = q.where;
      if (q.joinOn) params.join_on = q.joinOn;
      if (q.orderBy) params.order_by = q.orderBy;
      if (q.groupBy) params.group_by = q.groupBy;
      let res: any;
      for (let attempt = 0; ; attempt++) {
        res = await this.call(params);
        if (res.error?.code === "ratelimited" && attempt < 5) {
          await sleep(10_000 * (attempt + 1));
          continue;
        }
        break;
      }
      if (res.error) throw new Error(`cargo: ${res.error.code} ${res.error.info}`);
      const rows = (res.cargoquery ?? []).map((r: { title: Record<string, string> }) => r.title);
      out.push(...rows);
      await sleep(DELAY_MS);
      if (rows.length < PAGE) return out;
    }
  }

  async fields(table: string): Promise<Record<string, unknown>> {
    const r = await this.call({ action: "cargofields", table });
    return r.cargofields ?? r;
  }
}
