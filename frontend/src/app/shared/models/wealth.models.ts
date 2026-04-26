// ---------------------------------------------------------------------------
// Parameter models
// ---------------------------------------------------------------------------

export type SweepVariable = 'i' | 'T' | 'pi' | 'C0' | 'S0' | 'g';

export type EdgeCase =
  | 'r_equals_pi'
  | 'r_equals_g'
  | 'infeasible'
  | 'welfare_covers_all'
  | 'full_taxation';

export type Tier = 1 | 2 | 3 | 4;

export interface WealthParams {
  C0:  number;   // annual consumption
  i:   number;   // nominal annual return rate
  T:   number;   // marginal tax rate on investment income
  pi:  number;   // annual inflation rate
  S0:  number;   // initial annual welfare (pre-tax)
  g:   number;   // annual welfare growth rate
}

// ---------------------------------------------------------------------------
// /solve
// ---------------------------------------------------------------------------

export interface SolveRequest {
  params:     WealthParams;
  t_horizon:  number;
  tier:       number;    // add this
}

export interface TrajectoryPoint {
  t: number;
  W: number;
}

export interface SensitivityResult {
  variable:   SweepVariable;
  dW0_dx:     number;
  elasticity: number;
  d2W0_dx2:   number;
}

export interface SolveResponse {
  tier:             Tier;
  W0:               number | null;
  r_real:           number;
  r_real_formula:   string;
  W0_formula:       string;
  edge_case:        EdgeCase | null;
  trajectory:       TrajectoryPoint[];
  sensitivity:      SensitivityResult[];
}

// ---------------------------------------------------------------------------
// /sweep
// ---------------------------------------------------------------------------

export interface SweepRange {
  min:      number;
  max:      number;
  n_points: number;
}

export interface SweepRequest {
  base_params:  WealthParams;
  sweep_var:    SweepVariable;
  sweep_range:  SweepRange;
  tier:         number;    // add this
}

export interface SweepPoint {
  x:          number;
  W0:         number | null;
  edge_case:  EdgeCase | null;
}

export interface InfeasibleRegion {
  from_x: number;
  to_x:   number;
}

export interface SensitivityAtBase {
  variable:   SweepVariable;
  dW0_dx:     number;
  elasticity: number;
  d2W0_dx2:   number;
}

export interface SweepResponse {
  sweep_var:           SweepVariable;
  points:              SweepPoint[];
  asymptotes:          number[];
  infeasible_regions:  InfeasibleRegion[];
  base_point:          SweepPoint;
  sensitivity_at_base: SensitivityAtBase;
}

// ---------------------------------------------------------------------------
// UI config models
// ---------------------------------------------------------------------------

export interface VariableMeta {
  key:         SweepVariable;
  label:       string;
  description: string;
  min:         number;
  max:         number;
  step:        number;
  unit:        string;
  formatFn:    (v: number) => string;
}

export interface TierConfig {
  tier:        Tier;
  label:       string;
  description: string;
  variables:   SweepVariable[];
}

// Snapshot stored per graph at time of last fetch
export interface GraphSnapshot {
  params:     WealthParams;
  sweepVar:   SweepVariable;
  sweepRange: SweepRange;
  fetchedAt:  Date;
}
