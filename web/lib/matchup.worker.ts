// 1,000,000-draw Monte-Carlo of a single matchup, off the main thread.
//
// The heavy order-sensitive part (the base-out Markov μ) is computed once on the main
// thread; this worker just samples two NegBinom score distributions a million times to
// produce the run-distribution histogram and a Monte-Carlo win% that confirms the exact
// PMF headline. That split is why 1M sims stay responsive (~50-150ms) — the naive
// per-game plate-appearance simulation (~10^9 PAs) is deliberately avoided.

export type SimRequest = { muHome: number; muAway: number; k: number; n: number; cap?: number };
export type SimResult = {
  homeWin: number; n: number; cap: number;
  histHome: number[]; histAway: number[];
};

function cumulative(mu: number, k: number, cap: number): Float64Array {
  const cdf = new Float64Array(cap + 1);
  const p = k / (k + mu);
  let cur = Math.pow(p, k);
  let sum = 0;
  for (let r = 0; r <= cap; r++) {
    sum += cur;
    cdf[r] = sum;
    cur = (cur * (1 - p) * (k + r)) / (r + 1);
  }
  cdf[cap] = 1; // clamp so the tail always resolves
  return cdf;
}

function sample(cdf: Float64Array, u: number, cap: number): number {
  for (let r = 0; r < cap; r++) if (u <= cdf[r]) return r;
  return cap;
}

export function runSim(req: SimRequest): SimResult {
  const cap = req.cap ?? 25;
  const n = req.n;
  const cdfH = cumulative(req.muHome, req.k, cap);
  const cdfA = cumulative(req.muAway, req.k, cap);
  const histHome = new Array(cap + 1).fill(0);
  const histAway = new Array(cap + 1).fill(0);
  const tieHomeP = req.muHome / (req.muHome + req.muAway);
  let homeWins = 0;
  for (let i = 0; i < n; i++) {
    const rh = sample(cdfH, Math.random(), cap);
    const ra = sample(cdfA, Math.random(), cap);
    histHome[rh]++;
    histAway[ra]++;
    if (rh > ra) homeWins++;
    else if (rh === ra && Math.random() < tieHomeP) homeWins++;
  }
  return { homeWin: homeWins / n, n, cap, histHome, histAway };
}

// Worker entry (guarded so the module is also importable in tests / SSR typecheck).
if (typeof self !== "undefined" && typeof (self as unknown as { postMessage?: unknown }).postMessage === "function") {
  self.onmessage = (e: MessageEvent<SimRequest>) => {
    (self as unknown as { postMessage: (m: SimResult) => void }).postMessage(runSim(e.data));
  };
}
