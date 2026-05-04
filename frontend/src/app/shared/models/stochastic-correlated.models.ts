// ---------------------------------------------------------------------------
// VAR parameters (primary + advanced)
// ---------------------------------------------------------------------------

export interface VARParams {
  // Primary
  mu_pi:    number;   // long-run inflation mean
  mu_i:     number;   // long-run return mean
  mu_C0:    number;   // long-run consumption mean
  sigma_C0: number;   // consumption volatility
  nu:       number;   // Student-t degrees of freedom (tail risk)
  beta:     number;   // inflation-consumption sensitivity

  // Advanced — A matrix
  a_pp: number; a_pi: number; a_pC: number;
  a_ip: number; a_ii: number; a_iC: number;
  a_Cp: number; a_Ci: number; a_CC: number;

  // Advanced — shock volatilities
  sigma_pi: number;
  sigma_i:  number;

  // Advanced — correlations
  rho_pi_i:  number;
  rho_pi_C0: number;
  rho_i_C0:  number;
}

// ---------------------------------------------------------------------------
// Regime parameters
// ---------------------------------------------------------------------------

export interface RegimeParams {
  T_mean_liberal:       number;
  T_std_liberal:        number;
  S0_mean_liberal:      number;
  S0_std_liberal:       number;

  T_mean_conservative:  number;
  T_std_conservative:   number;
  S0_mean_conservative: number;
  S0_std_conservative:  number;

  p_stay_liberal:       number;
  p_stay_conservative:  number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_VAR: VARParams = {
  mu_pi:    3.5,      // display: %
  mu_i:     7.0,      // display: %
  mu_C0:    80_000,
  sigma_C0: 8_000,
  nu:       5,
  beta:     0.3,

  a_pp:  0.65, a_pi:  0.05, a_pC:  0.00,
  a_ip:  0.40, a_ii:  0.55, a_iC:  0.00,
  a_Cp: -0.10, a_Ci: -0.08, a_CC:  0.70,

  sigma_pi: 1.5,     // display: %
  sigma_i:  2.0,     // display: %

  rho_pi_i:   0.80,
  rho_pi_C0: -0.30,
  rho_i_C0:  -0.40,
};

export const DEFAULT_REGIME: RegimeParams = {
  T_mean_liberal:       32,     // display: %
  T_std_liberal:        3,
  S0_mean_liberal:      15_000,
  S0_std_liberal:       3_000,

  T_mean_conservative:  22,     // display: %
  T_std_conservative:   3,
  S0_mean_conservative: 8_000,
  S0_std_conservative:  2_000,

  p_stay_liberal:       75,     // display: %
  p_stay_conservative:  75,     // display: %
};

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface CorrelatedRequest {
  tier:   number;
  W0:     number;
  k:      number;
  n:      number;
  var:    VARParams;
  regime: RegimeParams;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface FanBand {
  years:      number[];
  p05:        (number | null)[];
  p25:        (number | null)[];
  p50:        (number | null)[];
  p75:        (number | null)[];
  p95:        (number | null)[];
  path_count: number;
}

export interface RegimeComparison {
  pct_net_gain:           number;
  pct_loss_solvent:       number;
  pct_ruin:               number;
  mean_final_W:           number | null;
  median_final_W:         number | null;
  p10_final_W:            number | null;
  p90_final_W:            number | null;
  mean_years_to_ruin:     number | null;
  median_years_to_ruin:   number | null;
  mean_wealth_growth_pct: number | null;
  path_count:             number;
}

export interface CorrelatedResponse {
  outcome_counts:       { net_gain: number; loss_solvent: number; ruin: number };
  outcome_pct:          { net_gain: number; loss_solvent: number; ruin: number };
  surviving_paths:      number;
  median_final_W:       number | null;
  mean_years_to_ruin:   number | null;
  fan_overall:          FanBand;
  fan_liberal:          FanBand;
  fan_conservative:     FanBand;
  regime_liberal:       RegimeComparison;
  regime_conservative:  RegimeComparison;
}