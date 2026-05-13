import type { CompareResponse, FeatureVector, ModelInfo, PredictResponse } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(res.status, text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return parsed as T;
}

export async function predict(features: FeatureVector): Promise<PredictResponse> {
  const res = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ features }),
  });
  return jsonOrThrow<PredictResponse>(res);
}

export async function compare(a: FeatureVector, b: FeatureVector): Promise<CompareResponse> {
  const res = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compare: { a, b } }),
  });
  return jsonOrThrow<CompareResponse>(res);
}

/** Cold load: fetches the static model-info.json from the CDN. */
export async function loadModelInfo(): Promise<ModelInfo> {
  const res = await fetch("/model-info.json", { cache: "force-cache" });
  if (!res.ok) throw new ApiError(res.status, "model-info.json not found");
  return (await res.json()) as ModelInfo;
}
