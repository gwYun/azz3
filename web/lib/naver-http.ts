/**
 * HTTPS GET for api-gw.sports.naver.com. Since 2026-10-26 the gateway stalls
 * (accepts TLS, never answers) on Node's default ClientHello — both global
 * fetch and https.get — while a TLS-1.3-only handshake answers in ~50 ms. So
 * the KBO and soccer clients go through node:https with a TLS 1.3 agent
 * instead of fetch. esports-api.game.naver.com (LoL) is unaffected.
 */
import https from "node:https";

const agent = new https.Agent({ keepAlive: true, minVersion: "TLSv1.3" });

/** GET `url` and parse JSON; rejects on non-2xx or after `timeoutMs`. */
export function naverGetJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, agent, timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => (body += d));
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) return reject(new Error(`naver ${status} for ${url}`));
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`naver timeout after ${timeoutMs}ms for ${url}`)));
    req.on("error", reject);
  });
}
