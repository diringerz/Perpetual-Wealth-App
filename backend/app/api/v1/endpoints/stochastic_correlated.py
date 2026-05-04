"""
stochastic_correlated.py — POST /api/v1/stochastic/correlated/simulate

Correlated stochastic simulation with:
- VAR(1) macro dynamics for π, i, C₀
- Student-t shocks for fat tails
- Markov regime switching for T and S₀ (Liberal / Conservative)
- Inflation-consumption coupling via β
- Returns aggregated statistics + fan chart split by majority regime
"""

from __future__ import annotations

import math
from typing import Literal
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/stochastic/correlated", tags=["stochastic-correlated"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGIME_LIBERAL       = 0
REGIME_CONSERVATIVE  = 1
REGIME_LABELS        = ["Liberal", "Conservative"]

CLIP_BOUNDS = {
    "i":  (0.0,   0.50),
    "T":  (0.0,   0.99),
    "pi": (0.0,   0.20),
    "C0": (1_000, math.inf),
    "S0": (0.0,   math.inf),
    "g":  (0.0,   0.20),
}

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class VARParams(BaseModel):
    """VAR(1) parameters for [π, i, C₀]."""
    # Long-run means
    mu_pi:  float = 0.035
    mu_i:   float = 0.07
    mu_C0:  float = 80_000.0

    # A matrix rows (3×3 flattened)
    # Row 0: π equation  — [a_pp, a_pi, a_pC]
    # Row 1: i equation  — [a_ip, a_ii, a_iC]
    # Row 2: C0 equation — [a_Cp, a_Ci, a_CC]
    a_pp: float =  0.65;  a_pi: float =  0.05;  a_pC: float =  0.00
    a_ip: float =  0.40;  a_ii: float =  0.55;  a_iC: float =  0.00
    a_Cp: float = -0.10;  a_Ci: float = -0.08;  a_CC: float =  0.70

    # Shock standard deviations
    sigma_pi: float = 0.015
    sigma_i:  float = 0.020
    sigma_C0: float = 8_000.0

    # Contemporaneous correlations
    rho_pi_i:  float =  0.80
    rho_pi_C0: float = -0.30
    rho_i_C0:  float = -0.40

    # Student-t degrees of freedom (fat tails)
    nu: float = Field(default=5.0, ge=2.0, le=30.0)

    # Inflation-consumption sensitivity
    beta: float = Field(default=0.3, ge=0.0, le=1.0)


class RegimeParams(BaseModel):
    """Per-regime distributions for T and S₀."""
    T_mean_liberal:    float = 0.32
    T_std_liberal:     float = 0.03
    S0_mean_liberal:   float = 15_000.0
    S0_std_liberal:    float = 3_000.0

    T_mean_conservative:  float = 0.22
    T_std_conservative:   float = 0.03
    S0_mean_conservative: float = 8_000.0
    S0_std_conservative:  float = 2_000.0

    # Transition matrix diagonal (prob of staying in current regime)
    p_stay_liberal:       float = Field(default=0.75, ge=0.0, le=1.0)
    p_stay_conservative:  float = Field(default=0.75, ge=0.0, le=1.0)

    # Starting regime is sampled from the stationary distribution — not user-specified
    # to avoid bias in the regime comparison.


class SimulateRequest(BaseModel):
    tier:    int   = Field(ge=1, le=3)
    W0:      float = Field(gt=0)
    k:       int   = Field(ge=1,   le=10_000, default=1_000)
    n:       int   = Field(ge=1,   le=1_000,  default=50)
    var:     VARParams     = VARParams()
    regime:  RegimeParams  = RegimeParams()


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class OutcomeCounts(BaseModel):
    net_gain: int; loss_solvent: int; ruin: int

class OutcomePct(BaseModel):
    net_gain: float; loss_solvent: float; ruin: float

class FanBand(BaseModel):
    years: list[int]
    p05: list[float | None]; p25: list[float | None]
    p50: list[float | None]; p75: list[float | None]
    p95: list[float | None]
    path_count: int

class RegimeComparison(BaseModel):
    # Outcome percentages
    pct_net_gain:     float
    pct_loss_solvent: float
    pct_ruin:         float
    # Wealth metrics (surviving paths only)
    mean_final_W:     float | None
    median_final_W:   float | None
    p10_final_W:      float | None   # 10th percentile — downside
    p90_final_W:      float | None   # 90th percentile — upside
    # Ruin metrics
    mean_years_to_ruin:   float | None
    median_years_to_ruin: float | None
    # Growth
    mean_wealth_growth_pct: float | None  # (W_final - W0) / W0 * 100
    # Path count
    path_count: int

class SimulateResponse(BaseModel):
    outcome_counts:     OutcomeCounts
    outcome_pct:        OutcomePct
    surviving_paths:    int
    median_final_W:     float | None
    mean_years_to_ruin: float | None
    fan_overall:        FanBand
    fan_liberal:        FanBand
    fan_conservative:   FanBand
    regime_liberal:     RegimeComparison
    regime_conservative: RegimeComparison


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_chol(v: VARParams) -> np.ndarray:
    """Build Cholesky factor of shock covariance matrix."""
    # Normalise sigma_C0 by mu_C0 to match the normalised VAR state
    sigma_C0_norm = v.sigma_C0 / v.mu_C0 if v.mu_C0 > 0 else v.sigma_C0
    s = np.array([v.sigma_pi, v.sigma_i, sigma_C0_norm])
    R = np.array([
        [1.0,          v.rho_pi_i,  v.rho_pi_C0],
        [v.rho_pi_i,   1.0,         v.rho_i_C0 ],
        [v.rho_pi_C0,  v.rho_i_C0,  1.0        ],
    ])
    # Ensure positive semi-definite by clipping eigenvalues
    eigvals, eigvecs = np.linalg.eigh(R)
    eigvals = np.maximum(eigvals, 1e-8)
    R = eigvecs @ np.diag(eigvals) @ eigvecs.T
    Sigma = np.diag(s) @ R @ np.diag(s)
    return np.linalg.cholesky(Sigma)


def _percentiles(W_col: np.ndarray, mask: np.ndarray) -> tuple:
    vals = W_col[mask]
    if len(vals) == 0:
        return None, None, None, None, None
    p = np.percentile(vals, [5, 25, 50, 75, 95])
    return float(p[0]), float(p[1]), float(p[2]), float(p[3]), float(p[4])


def _make_fan(W: np.ndarray, alive_by_year: np.ndarray, mask_paths: np.ndarray) -> FanBand:
    """Build FanBand for a subset of paths defined by mask_paths."""
    N   = W.shape[0] - 1
    p05_l, p25_l, p50_l, p75_l, p95_l = [], [], [], [], []
    years = list(range(N + 1))

    for yr in range(N + 1):
        alive = alive_by_year[yr] & mask_paths
        p05, p25, p50, p75, p95 = _percentiles(W[yr], alive)
        p05_l.append(p05); p25_l.append(p25); p50_l.append(p50)
        p75_l.append(p75); p95_l.append(p95)

    return FanBand(
        years=years,
        p05=p05_l, p25=p25_l, p50=p50_l, p75=p75_l, p95=p95_l,
        path_count=int(mask_paths.sum()),
    )


def _regime_comparison(
    final_W: np.ndarray,
    ruin_year: np.ndarray,
    ruined: np.ndarray,
    mask: np.ndarray,
    W0: float,
    K: int,
) -> RegimeComparison:
    n_paths     = int(mask.sum())
    if n_paths == 0:
        return RegimeComparison(
            pct_net_gain=0, pct_loss_solvent=0, pct_ruin=0,
            mean_final_W=None, median_final_W=None,
            p10_final_W=None, p90_final_W=None,
            mean_years_to_ruin=None, median_years_to_ruin=None,
            mean_wealth_growth_pct=None, path_count=0,
        )

    survived   = mask & ~ruined
    ruined_m   = mask & ruined
    n_survived = int(survived.sum())
    n_ruined   = int(ruined_m.sum())

    W_surv     = final_W[survived]
    pct_gain   = round(float(((W_surv > W0).sum()) / n_paths * 100), 2)
    pct_loss   = round(float(((W_surv <= W0).sum()) / n_paths * 100), 2)
    pct_ruin   = round(float(n_ruined / n_paths * 100), 2)

    mean_W     = float(np.mean(W_surv))      if n_survived > 0 else None
    med_W      = float(np.median(W_surv))    if n_survived > 0 else None
    p10_W      = float(np.percentile(W_surv, 10)) if n_survived > 0 else None
    p90_W      = float(np.percentile(W_surv, 90)) if n_survived > 0 else None
    growth_pct = float(np.mean((W_surv - W0) / W0 * 100)) if n_survived > 0 else None

    ry         = ruin_year[ruined_m].astype(float)
    mean_ruin  = float(np.mean(ry))   if n_ruined > 0 else None
    med_ruin   = float(np.median(ry)) if n_ruined > 0 else None

    return RegimeComparison(
        pct_net_gain=pct_gain,
        pct_loss_solvent=pct_loss,
        pct_ruin=pct_ruin,
        mean_final_W=mean_W,
        median_final_W=med_W,
        p10_final_W=p10_W,
        p90_final_W=p90_W,
        mean_years_to_ruin=mean_ruin,
        median_years_to_ruin=med_ruin,
        mean_wealth_growth_pct=growth_pct,
        path_count=n_paths,
    )


# ---------------------------------------------------------------------------
# Simulation core
# ---------------------------------------------------------------------------

@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    rng  = np.random.default_rng()
    v    = req.var
    r    = req.regime
    K, N = req.k, req.n
    W0   = req.W0
    tier = req.tier

    # ── Build VAR structures ──────────────────────────────────────────────
    mu = np.array([v.mu_pi, v.mu_i, v.mu_C0])
    A  = np.array([
        [v.a_pp, v.a_pi, v.a_pC],
        [v.a_ip, v.a_ii, v.a_iC],
        [v.a_Cp, v.a_Ci, v.a_CC],
    ])
    L = _build_chol(v)   # Cholesky factor of Σ

    # ── Regime transition matrix ──────────────────────────────────────────
    P = np.array([
        [r.p_stay_liberal,      1 - r.p_stay_liberal     ],
        [1 - r.p_stay_conservative, r.p_stay_conservative],
    ])

    # ── Allocate arrays ───────────────────────────────────────────────────
    W         = np.full((N + 1, K), W0, dtype=np.float64)
    ruined    = np.zeros(K, dtype=bool)
    ruin_year = np.full(K, -1, dtype=np.int32)

    # Regime counts per year per path: shape (N, K)  0=Liberal 1=Conservative
    regimes = np.zeros((N, K), dtype=np.int8)

    # VAR state: shape (3, K)  rows = [π, i, C0/mu_C0 (normalised)]
    # We normalise C0 by mu_C0 so all three variables are O(0.01-0.1) scale.
    # This prevents the A matrix cross terms from producing nonsensical values
    # when mixing decimal rates with dollar amounts.
    mu_normalised    = np.array([v.mu_pi, v.mu_i, 1.0])   # C0 normalised = 1
    X = np.tile(mu_normalised[:, None], (1, K)).astype(np.float64)

    # Initial regime sampled from stationary distribution of the Markov chain.
    # Stationary dist: π_L = (1 - p_stay_C) / (2 - p_stay_L - p_stay_C)
    # This avoids bias in the regime comparison — no path gets a head start.
    p_stay_L   = r.p_stay_liberal
    p_stay_C   = r.p_stay_conservative
    denom      = 2.0 - p_stay_L - p_stay_C
    pi_liberal = (1.0 - p_stay_C) / denom if denom > 0 else 0.5
    regime_state = (rng.uniform(size=K) > pi_liberal).astype(np.int8)

    # Cumulative inflation for C0/S0 scaling
    cum_inf = np.ones(K, dtype=np.float64)

    # Student-t shocks: draw standard normal then scale by chi2
    # t_ν = Z / sqrt(V/ν),  V ~ chi2(ν)
    nu = v.nu

    for yr in range(N):
        alive = ~ruined

        # ── Regime transition ────────────────────────────────────────────
        u_reg = rng.uniform(size=K)
        stay_prob = np.where(
            regime_state == REGIME_LIBERAL,
            P[REGIME_LIBERAL, REGIME_LIBERAL],
            P[REGIME_CONSERVATIVE, REGIME_CONSERVATIVE],
        )
        switch = u_reg > stay_prob
        regime_state = np.where(switch,
            1 - regime_state,   # flip regime
            regime_state,
        ).astype(np.int8)
        regimes[yr] = regime_state

        # ── Sample T and S0 from regime ──────────────────────────────────
        is_lib = regime_state == REGIME_LIBERAL

        T_mu  = np.where(is_lib, r.T_mean_liberal,  r.T_mean_conservative)
        T_sig = np.where(is_lib, r.T_std_liberal,   r.T_std_conservative)
        S_mu  = np.where(is_lib, r.S0_mean_liberal, r.S0_mean_conservative)
        S_sig = np.where(is_lib, r.S0_std_liberal,  r.S0_std_conservative)

        T_yr  = np.clip(rng.normal(T_mu,  T_sig,  size=K), *CLIP_BOUNDS["T"])
        S0_yr = np.clip(rng.normal(S_mu,  S_sig,  size=K), 0, np.finfo(float).max)

        # ── VAR(1) step with Student-t shocks ────────────────────────────
        Z   = rng.standard_normal((3, K))                    # standard normals
        chi = rng.chisquare(nu, size=K) / nu                 # chi2(ν)/ν
        eps = (L @ Z) / np.sqrt(chi)                         # t-distributed shocks

        mu_norm  = np.array([v.mu_pi, v.mu_i, 1.0])
        X_new = mu_norm[:, None] + A @ (X - mu_norm[:, None]) + eps
        X     = X_new

        pi_yr = np.clip(X[0], *CLIP_BOUNDS["pi"])
        i_yr  = np.clip(X[1], *CLIP_BOUNDS["i"])
        # De-normalise C0: multiply normalised value by mu_C0
        C0_yr = np.clip(X[2] * v.mu_C0, *CLIP_BOUNDS["C0"])

        # ── Inflation-consumption coupling ───────────────────────────────
        pi_surprise = pi_yr - v.mu_pi
        C0_yr       = np.maximum(C0_yr + v.beta * pi_surprise * C0_yr,
                                  CLIP_BOUNDS["C0"][0])

        # ── Cumulative inflation for C0/S0 compounding ───────────────────
        cum_inf *= (1.0 + pi_yr)

        # ── Wealth step ──────────────────────────────────────────────────
        growth      = W[yr] * (1.0 + i_yr * (1.0 - T_yr))
        consumption = C0_yr * np.power(1.0 + pi_yr, yr) if tier >= 2 else C0_yr
        welfare     = S0_yr * (1.0 - T_yr) if tier >= 3 else 0.0
        W_next      = growth - consumption + welfare

        W[yr + 1] = np.where(alive, W_next, W[yr])

        newly_ruined              = alive & (W[yr + 1] < 0)
        ruined[newly_ruined]      = True
        ruin_year[newly_ruined]   = yr + 1
        W[yr + 1, newly_ruined]   = 0.0

    # ── Outcomes ─────────────────────────────────────────────────────────
    final_W       = W[N]
    survived_mask = ~ruined
    n_ruin        = int(ruined.sum())
    n_net_gain    = int(((final_W > W0) & survived_mask).sum())
    n_loss_solvent= int(survived_mask.sum()) - n_net_gain
    n_surviving   = int(survived_mask.sum())
    pct           = lambda x: round(x / K * 100, 2)

    # ── Majority-regime mask ─────────────────────────────────────────────
    liberal_years_per_path = (regimes == REGIME_LIBERAL).sum(axis=0)
    majority_liberal       = liberal_years_per_path >= (N / 2)
    majority_conservative  = ~majority_liberal

    # ── alive_by_year mask ───────────────────────────────────────────────
    alive_by_year = np.zeros((N + 1, K), dtype=bool)
    for yr in range(N + 1):
        alive_by_year[yr] = (ruin_year < 0) | (ruin_year >= yr)
        alive_by_year[yr] &= ~ruined | (ruin_year >= yr)

    # ── Fan charts ───────────────────────────────────────────────────────
    all_mask  = np.ones(K, dtype=bool)
    fan_overall      = _make_fan(W, alive_by_year, all_mask)
    fan_liberal      = _make_fan(W, alive_by_year, majority_liberal)
    fan_conservative = _make_fan(W, alive_by_year, majority_conservative)

    return SimulateResponse(
        outcome_counts=OutcomeCounts(
            net_gain=n_net_gain, loss_solvent=n_loss_solvent, ruin=n_ruin),
        outcome_pct=OutcomePct(
            net_gain=pct(n_net_gain),
            loss_solvent=pct(n_loss_solvent),
            ruin=pct(n_ruin)),
        surviving_paths=n_surviving,
        median_final_W=float(np.median(final_W[survived_mask])) if n_surviving > 0 else None,
        mean_years_to_ruin=float(np.mean(ruin_year[ruined])) if n_ruin > 0 else None,
        fan_overall=fan_overall,
        fan_liberal=fan_liberal,
        fan_conservative=fan_conservative,
        regime_liberal=_regime_comparison(
            final_W, ruin_year, ruined, majority_liberal, W0, K),
        regime_conservative=_regime_comparison(
            final_W, ruin_year, ruined, majority_conservative, W0, K),
    )