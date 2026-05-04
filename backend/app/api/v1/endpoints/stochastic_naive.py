"""
stochastic_naive.py — POST /api/v1/stochastic/naive/simulate

Runs K independent Monte Carlo trials over N years using inverse-CDF sampling.
Each variable is sampled independently from its specified distribution each year.
C0 and S0 distribution means shift by the sampled inflation each year.
Paths stop at first ruin (W < 0).
Returns only aggregated statistics — no raw paths.
"""

from __future__ import annotations

import math
from typing import Literal, Union
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/stochastic/naive", tags=["stochastic-naive"])


# ---------------------------------------------------------------------------
# Distribution models
# ---------------------------------------------------------------------------

class NormalDist(BaseModel):
    type: Literal["normal"]
    mean: float
    std:  float = Field(gt=0)


class UniformDist(BaseModel):
    type: Literal["uniform"]
    low:  float
    high: float


class ExponentialDist(BaseModel):
    type:  Literal["exponential"]
    scale: float = Field(gt=0)   # mean of the exponential = 1/lambda


AnyDist = Union[NormalDist, UniformDist, ExponentialDist]


# ---------------------------------------------------------------------------
# Clip bounds per variable
# ---------------------------------------------------------------------------

CLIP_BOUNDS: dict[str, tuple[float, float]] = {
    "i":  (0.0,   0.50),
    "T":  (0.0,   0.99),
    "pi": (0.0,   0.20),
    "C0": (1_000, math.inf),
    "S0": (0.0,   math.inf),
    "g":  (0.0,   0.20),
}


def sample_clipped(dist: AnyDist, var: str, size: int, rng: np.random.Generator) -> np.ndarray:
    """Sample `size` values from dist, clip to variable bounds."""
    lo, hi = CLIP_BOUNDS[var]

    # Draw uniform [0,1] and apply inverse CDF (probability integral transform)
    u = rng.uniform(0.0, 1.0, size=size)

    if isinstance(dist, NormalDist):
        from scipy.stats import norm
        vals = norm.ppf(u, loc=dist.mean, scale=dist.std)

    elif isinstance(dist, UniformDist):
        # Inverse CDF of Uniform(low, high): low + u * (high - low)
        vals = dist.low + u * (dist.high - dist.low)

    elif isinstance(dist, ExponentialDist):
        from scipy.stats import expon
        vals = expon.ppf(u, scale=dist.scale)

    else:
        raise ValueError(f"Unknown distribution type: {dist.type}")

    return np.clip(vals, lo, hi if hi != math.inf else np.finfo(float).max)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class Distributions(BaseModel):
    i:  AnyDist
    T:  AnyDist
    pi: AnyDist
    C0: AnyDist
    S0: AnyDist
    g:  AnyDist


class SimulateRequest(BaseModel):
    tier:          int   = Field(ge=1, le=3)
    W0:            float = Field(gt=0)
    k:             int   = Field(ge=1,   le=10_000, default=1_000)
    n:             int   = Field(ge=1,   le=1_000,  default=50)
    distributions: Distributions


class OutcomeCounts(BaseModel):
    net_gain:     int
    loss_solvent: int
    ruin:         int


class OutcomePct(BaseModel):
    net_gain:     float
    loss_solvent: float
    ruin:         float


class FanChart(BaseModel):
    years: list[int]
    p05:   list[float | None]
    p25:   list[float | None]
    p50:   list[float | None]
    p75:   list[float | None]
    p95:   list[float | None]


class SimulateResponse(BaseModel):
    outcome_counts:      OutcomeCounts
    outcome_pct:         OutcomePct
    surviving_paths:     int
    median_final_W:      float | None
    mean_years_to_ruin:  float | None
    fan_chart:           FanChart


# ---------------------------------------------------------------------------
# Simulation core
# ---------------------------------------------------------------------------

def _step_W(W: float, i: float, T: float, pi: float,
            C0: float, S0: float, g: float,
            year: int, tier: int) -> float:
    growth      = W * (1.0 + i * (1.0 - T))
    consumption = C0 * math.pow(1.0 + pi, year) if tier >= 2 else C0
    welfare     = S0 * math.pow(1.0 + g, year) * (1.0 - T) if tier >= 3 else 0.0
    return growth - consumption + welfare


@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    rng = np.random.default_rng()
    d   = req.distributions
    K, N, W0, tier = req.k, req.n, req.W0, req.tier

    # Pre-sample all variables: shape (N, K)
    # Each column is one trial, each row is one year.
    i_samples  = sample_clipped(d.i,  "i",  K * N, rng).reshape(N, K)
    T_samples  = sample_clipped(d.T,  "T",  K * N, rng).reshape(N, K)
    pi_samples = sample_clipped(d.pi, "pi", K * N, rng).reshape(N, K)
    g_samples  = sample_clipped(d.g,  "g",  K * N, rng).reshape(N, K)

    # C0 and S0: base samples, then shift mean by cumulative inflation each year
    C0_base = sample_clipped(d.C0, "C0", K * N, rng).reshape(N, K)
    S0_base = sample_clipped(d.S0, "S0", K * N, rng).reshape(N, K)

    # Wealth matrix: shape (N+1, K) — row 0 = W0 for all trials
    W = np.full((N + 1, K), W0, dtype=np.float64)

    # Track ruin: which trials have ruined and at what year
    ruined      = np.zeros(K, dtype=bool)
    ruin_year   = np.full(K, -1, dtype=np.int32)

    # Cumulative inflation factor per trial — shifts C0/S0 mean each year
    cum_inflation = np.ones(K, dtype=np.float64)

    for yr in range(N):
        alive = ~ruined  # only step non-ruined paths

        pi_yr = pi_samples[yr]
        i_yr  = i_samples[yr]
        T_yr  = T_samples[yr]
        g_yr  = g_samples[yr]

        # Shift C0/S0 by cumulative inflation (apply to the base sample mean offset)
        # We scale the sampled value by the cumulative inflation factor so that
        # the distribution's centre grows with inflation year over year.
        cum_inflation *= (1.0 + pi_yr)
        C0_yr = C0_base[yr] * cum_inflation
        S0_yr = S0_base[yr] * cum_inflation

        # Clip again after inflation scaling
        lo_C0, _ = CLIP_BOUNDS["C0"]
        lo_S0, _ = CLIP_BOUNDS["S0"]
        C0_yr = np.maximum(C0_yr, lo_C0)
        S0_yr = np.maximum(S0_yr, lo_S0)

        # Step formula (vectorised)
        growth      = W[yr] * (1.0 + i_yr * (1.0 - T_yr))
        consumption = C0_yr * np.power(1.0 + pi_yr, yr) if tier >= 2 else C0_yr
        welfare     = S0_yr * np.power(1.0 + g_yr, yr) * (1.0 - T_yr) if tier >= 3 else 0.0
        W_next      = growth - consumption + welfare

        # Apply only to alive paths; dead paths stay at their last W
        W[yr + 1] = np.where(alive, W_next, W[yr])

        # Detect new ruins this year
        newly_ruined          = alive & (W[yr + 1] < 0)
        ruined[newly_ruined]  = True
        ruin_year[newly_ruined] = yr + 1
        # Freeze ruined paths at 0 for fan chart (excluded from percentiles)
        W[yr + 1, newly_ruined] = 0.0

    # ---------------------------------------------------------------------------
    # Aggregate outcomes
    # ---------------------------------------------------------------------------

    final_W       = W[N]
    survived_mask = ~ruined

    n_ruin         = int(ruined.sum())
    n_net_gain     = int(((final_W > W0) & survived_mask).sum())
    n_loss_solvent = int(survived_mask.sum()) - n_net_gain
    n_surviving    = int(survived_mask.sum())

    pct = lambda x: round(x / K * 100, 2)

    outcome_counts = OutcomeCounts(
        net_gain=n_net_gain,
        loss_solvent=n_loss_solvent,
        ruin=n_ruin,
    )
    outcome_pct = OutcomePct(
        net_gain=pct(n_net_gain),
        loss_solvent=pct(n_loss_solvent),
        ruin=pct(n_ruin),
    )

    median_final_W     = float(np.median(final_W[survived_mask])) if n_surviving > 0 else None
    mean_years_to_ruin = float(np.mean(ruin_year[ruined])) if n_ruin > 0 else None

    # ---------------------------------------------------------------------------
    # Fan chart — percentiles of surviving paths at each year
    # ---------------------------------------------------------------------------

    years  = list(range(N + 1))
    p05:   list[float | None] = []
    p25:   list[float | None] = []
    p50:   list[float | None] = []
    p75:   list[float | None] = []
    p95:   list[float | None] = []

    # At year 0 all paths survive
    alive_at_year = np.ones(K, dtype=bool)

    for yr in range(N + 1):
        # Update alive mask: exclude paths that ruined at or before this year
        if yr > 0:
            alive_at_year = (ruin_year < 0) | (ruin_year >= yr)
            alive_at_year = ~ruined | (ruin_year >= yr)

        surviving_W = W[yr, alive_at_year]

        if len(surviving_W) == 0:
            p05.append(None); p25.append(None); p50.append(None)
            p75.append(None); p95.append(None)
        else:
            pcts = np.percentile(surviving_W, [5, 25, 50, 75, 95])
            p05.append(float(pcts[0]))
            p25.append(float(pcts[1]))
            p50.append(float(pcts[2]))
            p75.append(float(pcts[3]))
            p95.append(float(pcts[4]))

    fan_chart = FanChart(years=years, p05=p05, p25=p25, p50=p50, p75=p75, p95=p95)

    return SimulateResponse(
        outcome_counts=outcome_counts,
        outcome_pct=outcome_pct,
        surviving_paths=n_surviving,
        median_final_W=median_final_W,
        mean_years_to_ruin=mean_years_to_ruin,
        fan_chart=fan_chart,
    )