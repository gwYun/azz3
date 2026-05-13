export type FeatureName = string;

export type FeatureStat = {
  p5: number;
  p95: number;
  sd: number;
};

export type ModelInfo = {
  features: FeatureName[];
  medians: Record<FeatureName, number>;
  feature_stats: Record<FeatureName, FeatureStat>;
  feature_groups: Record<string, FeatureName[]>;
  feature_set_hash: string;
};

export type Archetype = {
  name: string;
  position: string;
  age: number;
  features: Record<FeatureName, number>;
};

export type FeatureVector = Record<FeatureName, number>;

// API response shapes
export type Perturbation = {
  feature: FeatureName;
  current: number;
  new_value: number;
  predicted_fee_eur: number;
  delta_eur: number;
};

export type PredictResponse = {
  predicted_fee_eur: number;
  top_3_perturbations: Perturbation[];
  feature_set_hash: string;
};

export type GroupSwap = {
  group: string;
  members: FeatureName[];
  fee_a_with_b_group_eur: number;
  delta_eur: number;
  abs_delta_eur: number;
};

export type CompareResponse = {
  a: { predicted_fee_eur: number };
  b: { predicted_fee_eur: number };
  deciding_group: string | null;
  group_swaps: GroupSwap[];
  feature_set_hash: string;
};

// localStorage build
export type SavedBuild = {
  id: string;
  name: string;
  features: FeatureVector;
  predicted_fee_eur: number;
  feature_set_hash: string;
  saved_at: number; // epoch ms
};
