// ---------------------------------------------------------------------------
// Distribution types
// ---------------------------------------------------------------------------

export type DistributionType = 'normal' | 'uniform' | 'exponential';

export interface NormalParams  { mean: number; std:   number; }
export interface UniformParams { low:  number; high:  number; }
export interface ExponentialParams { scale: number; }

export interface NormalDist     { type: 'normal';      params: NormalParams;      }
export interface UniformDist    { type: 'uniform';     params: UniformParams;     }
export interface ExponentialDist { type: 'exponential'; params: ExponentialParams; }

export type AnyDist = NormalDist | UniformDist | ExponentialDist;

// Which distributions are valid per variable
export const VARIABLE_DISTS: Record<string, DistributionType[]> = {
  i:  ['normal', 'uniform'],
  T:  ['normal', 'uniform'],
  pi: ['normal', 'uniform'],
  C0: ['normal', 'uniform', 'exponential'],
  S0: ['normal', 'uniform', 'exponential'],
  g:  ['normal', 'uniform'],
};

// Default distributions
export const DEFAULT_DISTS: Record<string, AnyDist> = {
  i:  { type: 'normal',  params: { mean: 0.08,   std: 0.02  } },
  T:  { type: 'uniform', params: { low:  0.20,   high: 0.30 } },
  pi: { type: 'normal',  params: { mean: 0.03,   std: 0.005 } },
  C0: { type: 'normal',  params: { mean: 80_000, std: 5_000 } },
  S0: { type: 'uniform', params: { low:  0,      high: 0    } },
  g:  { type: 'uniform', params: { low:  0,      high: 0    } },
};

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

export interface StochasticRequest {
  tier:          number;
  W0:            number;
  k:             number;
  n:             number;
  distributions: Record<string, AnyDist>;
}

export interface OutcomeCounts {
  net_gain:     number;
  loss_solvent: number;
  ruin:         number;
}

export interface OutcomePct {
  net_gain:     number;
  loss_solvent: number;
  ruin:         number;
}

export interface FanChart {
  years: number[];
  p05:   (number | null)[];
  p25:   (number | null)[];
  p50:   (number | null)[];
  p75:   (number | null)[];
  p95:   (number | null)[];
}

export interface StochasticResponse {
  outcome_counts:      OutcomeCounts;
  outcome_pct:         OutcomePct;
  surviving_paths:     number;
  median_final_W:      number | null;
  mean_years_to_ruin:  number | null;
  fan_chart:           FanChart;
}