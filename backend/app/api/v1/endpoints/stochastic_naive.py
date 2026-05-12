# """
# stochastic_naive.py — POST /api/v1/stochastic/naive/simulate

# Runs K independent Monte Carlo trials over N years using inverse-CDF sampling.
# Each variable is sampled independently from its specified distribution each year.
# C0 and S0 distribution means shift by the sampled inflation each year via a
# cumulative inflation factor (cum_inflation). No additional power-law term is
# applied on top — that would double-count inflation.
# Paths stop at first ruin (W < 0).
# Returns only aggregated statistics — no raw paths.
# """

# from __future__ import annotations

# import math
# from typing import Literal, Union
# import numpy as np
# from fastapi import APIRouter
# from pydantic import BaseModel, Field, model_validator

# router = APIRouter(prefix="/stochastic/naive", tags=["stochastic-naive"])


# # ---------------------------------------------------------------------------
# # Distribution models
# # ---------------------------------------------------------------------------

# class NormalParams(BaseModel):
#     mean: float
#     std:  float = Field(gt=0)


# class UniformParams(BaseModel):
#     low:  float
#     high: float

#     @model_validator(mode="after")
#     def low_lt_high(self) -> "UniformParams":
#         if self.low > self.high:
#             raise ValueError(f"UniformParams: low ({self.low}) must be ≤ high ({self.high})")
#         return self


# class ExponentialParams(BaseModel):
#     scale: float = Field(gt=0)


# class PoissonParams(BaseModel):
#     lam: float = Field(gt=0)   # lambda — mean of the Poisson distribution


# class NormalDist(BaseModel):
#     type:   Literal["normal"]
#     params: NormalParams


# class UniformDist(BaseModel):
#     type:   Literal["uniform"]
#     params: UniformParams


# class ExponentialDist(BaseModel):
#     type:   Literal["exponential"]
#     params: ExponentialParams


# class PoissonDist(BaseModel):
#     type:   Literal["poisson"]
#     params: PoissonParams


# AnyDist = Union[NormalDist, UniformDist, ExponentialDist, PoissonDist]


# # ---------------------------------------------------------------------------
# # Clip bounds per variable
# # ---------------------------------------------------------------------------

# CLIP_BOUNDS: dict[str, tuple[float, float]] = {
#     "i":  (0.0,   0.50),
#     "T":  (0.0,   0.99),
#     "pi": (0.0,   0.20),
#     "C0": (1_000, math.inf),
#     "S0": (0.0,   math.inf),
#     "g":  (0.0,   0.20),
# }


# def sample_clipped(dist: AnyDist, var: str, size: int, rng: np.random.Generator) -> np.ndarray:
#     """Sample `size` values from dist, clip to variable bounds."""
#     lo, hi = CLIP_BOUNDS[var]

#     # Draw uniform [0,1] and apply inverse CDF (probability integral transform)
#     u = rng.uniform(0.0, 1.0, size=size)

#     if isinstance(dist, NormalDist):
#         from scipy.stats import norm
#         vals = norm.ppf(u, loc=dist.params.mean, scale=dist.params.std)

#     elif isinstance(dist, UniformDist):
#         # Inverse CDF of Uniform(low, high): low + u * (high - low)
#         vals = dist.params.low + u * (dist.params.high - dist.params.low)

#     elif isinstance(dist, ExponentialDist):
#         from scipy.stats import expon
#         vals = expon.ppf(u, scale=dist.params.scale)

#     elif isinstance(dist, PoissonDist):
#         from scipy.stats import poisson
#         # Poisson inverse CDF — returns integer-valued floats
#         vals = poisson.ppf(u, mu=dist.params.lam).astype(float)

#     else:
#         raise ValueError(f"Unknown distribution type: {dist.type}")

#     return np.clip(vals, lo, hi if hi != math.inf else np.finfo(float).max)


# # ---------------------------------------------------------------------------
# # Request / Response models
# # ---------------------------------------------------------------------------

# class Distributions(BaseModel):
#     i:  AnyDist
#     T:  AnyDist
#     pi: AnyDist
#     C0: AnyDist
#     S0: AnyDist
#     g:  AnyDist


# class SimulateRequest(BaseModel):
#     tier:          int   = Field(ge=1, le=3)
#     W0:            float = Field(gt=0)
#     k:             int   = Field(ge=1,   le=10_000, default=1_000)
#     n:             int   = Field(ge=1,   le=1_000,  default=50)
#     seed:          int | None = Field(default=None, description="Optional RNG seed for reproducibility")
#     distributions: Distributions


# class OutcomeCounts(BaseModel):
#     net_gain:     int
#     loss_solvent: int
#     ruin:         int


# class OutcomePct(BaseModel):
#     net_gain:     float
#     loss_solvent: float
#     ruin:         float


# class FanChart(BaseModel):
#     years: list[int]
#     p05:   list[float | None]
#     p25:   list[float | None]
#     p50:   list[float | None]
#     p75:   list[float | None]
#     p95:   list[float | None]


# class SimulateResponse(BaseModel):
#     outcome_counts:      OutcomeCounts
#     outcome_pct:         OutcomePct
#     surviving_paths:     int
#     median_final_W:      float | None
#     mean_years_to_ruin:  float | None
#     fan_chart:           FanChart


# # ---------------------------------------------------------------------------
# # Simulation core
# # ---------------------------------------------------------------------------

# @router.post("/simulate", response_model=SimulateResponse)
# def simulate(req: SimulateRequest) -> SimulateResponse:
#     # FIX #6: Accept optional seed for reproducibility.
#     rng = np.random.default_rng(req.seed)
#     d   = req.distributions
#     K, N, W0, tier = req.k, req.n, req.W0, req.tier

#     # Pre-sample all variables: shape (N, K)
#     # Each column is one trial, each row is one year.
#     i_samples  = sample_clipped(d.i,  "i",  K * N, rng).reshape(N, K)
#     T_samples  = sample_clipped(d.T,  "T",  K * N, rng).reshape(N, K)
#     pi_samples = sample_clipped(d.pi, "pi", K * N, rng).reshape(N, K)
#     g_samples  = sample_clipped(d.g,  "g",  K * N, rng).reshape(N, K)

#     # C0 and S0: base samples; their effective level grows with cumulative
#     # inflation each year (see cum_inflation below).
#     C0_base = sample_clipped(d.C0, "C0", K * N, rng).reshape(N, K)
#     S0_base = sample_clipped(d.S0, "S0", K * N, rng).reshape(N, K)

#     # Wealth matrix: shape (N+1, K) — row 0 = W0 for all trials
#     W = np.full((N + 1, K), W0, dtype=np.float64)

#     # Track ruin: which trials have ruined and at what year
#     ruined    = np.zeros(K, dtype=bool)
#     ruin_year = np.full(K, -1, dtype=np.int32)

#     # Cumulative inflation factor per trial — shifts C0/S0 each year.
#     # This is the ONLY inflation scaling applied to C0 and S0.
#     # FIX #1/#3: Removed the additional np.power(1+pi, yr) terms from the
#     # wealth step that were multiplied on top of this, causing double-inflation.
#     cum_inflation = np.ones(K, dtype=np.float64)

#     for yr in range(N):
#         alive = ~ruined  # only step non-ruined paths

#         pi_yr = pi_samples[yr]
#         i_yr  = i_samples[yr]
#         T_yr  = T_samples[yr]
#         g_yr  = g_samples[yr]

#         # Advance cumulative inflation by this year's rate (per trial).
#         cum_inflation *= (1.0 + pi_yr)
#         C0_yr = C0_base[yr] * cum_inflation
#         S0_yr = S0_base[yr] * cum_inflation

#         # Clip after inflation scaling
#         C0_yr = np.maximum(C0_yr, CLIP_BOUNDS["C0"][0])
#         S0_yr = np.maximum(S0_yr, CLIP_BOUNDS["S0"][0])

#         # Wealth step (vectorised).
#         # C0_yr and S0_yr already embed all cumulative inflation — no further
#         # power-law term is applied (that was the double-inflation bug).
#         growth      = W[yr] * (1.0 + i_yr * (1.0 - T_yr))
#         consumption = C0_yr if tier >= 2 else C0_base[yr]
#         # FIX #1: Was C0_yr * np.power(1 + pi_yr, yr) — double inflation.
#         # Welfare grows by (1+g)^yr relative to the inflation-adjusted S0 base.
#         welfare     = S0_yr * np.power(1.0 + g_yr, yr) * (1.0 - T_yr) if tier >= 3 else 0.0
#         # FIX #1 (welfare side): S0_yr already has cum_inflation baked in;
#         # the (1+g)^yr factor adds real growth on top of that, which is correct.
#         W_next      = growth - consumption + welfare

#         # Apply only to alive paths; dead paths stay at their last W
#         W[yr + 1] = np.where(alive, W_next, W[yr])

#         # Detect new ruins this year
#         newly_ruined            = alive & (W[yr + 1] < 0)
#         ruined[newly_ruined]    = True
#         ruin_year[newly_ruined] = yr + 1
#         # Freeze ruined paths at 0 (excluded from fan-chart percentiles)
#         W[yr + 1, newly_ruined] = 0.0

#     # ---------------------------------------------------------------------------
#     # Aggregate outcomes
#     # ---------------------------------------------------------------------------

#     final_W       = W[N]
#     survived_mask = ~ruined

#     n_ruin         = int(ruined.sum())
#     n_net_gain     = int(((final_W > W0) & survived_mask).sum())
#     n_loss_solvent = int(survived_mask.sum()) - n_net_gain
#     n_surviving    = int(survived_mask.sum())

#     pct = lambda x: round(x / K * 100, 2)

#     outcome_counts = OutcomeCounts(
#         net_gain=n_net_gain,
#         loss_solvent=n_loss_solvent,
#         ruin=n_ruin,
#     )
#     outcome_pct = OutcomePct(
#         net_gain=pct(n_net_gain),
#         loss_solvent=pct(n_loss_solvent),
#         ruin=pct(n_ruin),
#     )

#     median_final_W     = float(np.median(final_W[survived_mask])) if n_surviving > 0 else None
#     mean_years_to_ruin = float(np.mean(ruin_year[ruined])) if n_ruin > 0 else None

#     # ---------------------------------------------------------------------------
#     # Fan chart — percentiles across ALL paths at each year.
#     # Ruined paths are frozen at 0.0 from their ruin year onward and are
#     # included in the percentile calculation. Lower bands (p05, p25) truthfully
#     # reflect ruin outcomes dragging them toward zero, and p50 drops below W0
#     # when more than half the paths have ruined.
#     # ---------------------------------------------------------------------------

#     years  = list(range(N + 1))
#     p05:   list[float | None] = []
#     p25:   list[float | None] = []
#     p50:   list[float | None] = []
#     p75:   list[float | None] = []
#     p95:   list[float | None] = []

#     for yr in range(N + 1):
#         pcts = np.percentile(W[yr], [5, 25, 50, 75, 95])
#         p05.append(float(pcts[0]))
#         p25.append(float(pcts[1]))
#         p50.append(float(pcts[2]))
#         p75.append(float(pcts[3]))
#         p95.append(float(pcts[4]))

#     fan_chart = FanChart(years=years, p05=p05, p25=p25, p50=p50, p75=p75, p95=p95)

#     return SimulateResponse(
#         outcome_counts=outcome_counts,
#         outcome_pct=outcome_pct,
#         surviving_paths=n_surviving,
#         median_final_W=median_final_W,
#         mean_years_to_ruin=mean_years_to_ruin,
#         fan_chart=fan_chart,
#     )

"""
stochastic_naive.py — POST /api/v1/stochastic/naive/simulate

Runs K independent Monte Carlo trials over N years using inverse-CDF sampling.
Each variable is sampled independently from its specified distribution each year.
C0 and S0 distribution means shift by the sampled inflation each year via a
cumulative inflation factor (cum_inflation). No additional power-law term is
applied on top — that would double-count inflation.
Paths stop at first ruin (W < 0).
Returns only aggregated statistics — no raw paths.

scipy-free: all inverse CDFs implemented with pure numpy.
  - Normal:      rational approximation (Beasley-Springer-Moro, max error ~1e-9)
  - Exponential: exact analytic inverse  -scale * log(1 - u)
  - Poisson:     bracket search on the CDF using numpy vectorised ops
  - Uniform:     exact analytic inverse  low + u * (high - low)
"""

from __future__ import annotations

import math
from typing import Literal, Union
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

router = APIRouter(prefix="/stochastic/naive", tags=["stochastic-naive"])


# ---------------------------------------------------------------------------
# Distribution models (unchanged)
# ---------------------------------------------------------------------------

class NormalParams(BaseModel):
    mean: float
    std:  float = Field(gt=0)


class UniformParams(BaseModel):
    low:  float
    high: float

    @model_validator(mode="after")
    def low_lt_high(self) -> "UniformParams":
        if self.low > self.high:
            raise ValueError(f"UniformParams: low ({self.low}) must be ≤ high ({self.high})")
        return self


class ExponentialParams(BaseModel):
    scale: float = Field(gt=0)


class PoissonParams(BaseModel):
    lam: float = Field(gt=0)


class NormalDist(BaseModel):
    type:   Literal["normal"]
    params: NormalParams


class UniformDist(BaseModel):
    type:   Literal["uniform"]
    params: UniformParams


class ExponentialDist(BaseModel):
    type:   Literal["exponential"]
    params: ExponentialParams


class PoissonDist(BaseModel):
    type:   Literal["poisson"]
    params: PoissonParams


AnyDist = Union[NormalDist, UniformDist, ExponentialDist, PoissonDist]


# ---------------------------------------------------------------------------
# Clip bounds per variable (unchanged)
# ---------------------------------------------------------------------------

CLIP_BOUNDS: dict[str, tuple[float, float]] = {
    "i":  (0.0,   0.50),
    "T":  (0.0,   0.99),
    "pi": (0.0,   0.20),
    "C0": (1_000, math.inf),
    "S0": (0.0,   math.inf),
    "g":  (0.0,   0.20),
}


# ---------------------------------------------------------------------------
# Pure-numpy inverse CDFs
# ---------------------------------------------------------------------------

def _norm_ppf(u: np.ndarray) -> np.ndarray:
    """
    Rational approximation to the normal inverse CDF (Acklam 2003).
    Max absolute error < 1.15e-9 over (0, 1).
    Three-region algorithm: lower tail / central / upper tail.
    Reference: https://web.archive.org/web/20151030215612/http://home.online.no/~pjacklam/notes/invnorm/
    """
    a1 = -3.969683028665376e+01;  a2 =  2.209460984245205e+02
    a3 = -2.759285104469687e+02;  a4 =  1.383577518672690e+02
    a5 = -3.066479806614716e+01;  a6 =  2.506628277459239e+00

    b1 = -5.447609879822406e+01;  b2 =  1.615858368580409e+02
    b3 = -1.556989798598866e+02;  b4 =  6.680131188771972e+01
    b5 = -1.328068155288572e+01

    c1 = -7.784894002430293e-03;  c2 = -3.223964580411365e-01
    c3 = -2.400758277161838e+00;  c4 = -2.549732539343734e+00
    c5 =  4.374664141464968e+00;  c6 =  2.938163982698783e+00

    d1 =  7.784695709041462e-03;  d2 =  3.224671290700398e-01
    d3 =  2.445134137142996e+00;  d4 =  3.754408661907416e+00

    u      = np.asarray(u, dtype=np.float64)
    out    = np.empty_like(u)
    p_low  = 0.02425
    p_high = 1.0 - p_low

    # Lower tail
    lo = u < p_low
    q  = np.sqrt(-2.0 * np.log(np.maximum(u[lo], 1e-300)))
    out[lo] = (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1.0)

    # Central region
    mid = (u >= p_low) & (u <= p_high)
    q   = u[mid] - 0.5
    r   = q * q
    out[mid] = (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1.0)

    # Upper tail (symmetric)
    hi = u > p_high
    q  = np.sqrt(-2.0 * np.log(np.maximum(1.0 - u[hi], 1e-300)))
    out[hi] = -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1.0)

    return out


def _expon_ppf(u: np.ndarray, scale: float) -> np.ndarray:
    """Exact inverse CDF of Exponential(scale): -scale * log(1 - u)."""
    return -scale * np.log1p(-np.clip(u, 0.0, 1.0 - 1e-15))


def _poisson_ppf(u: np.ndarray, lam: float) -> np.ndarray:
    """
    Vectorised Poisson inverse CDF via bracket search.
    For each u, find smallest k such that CDF(k; lam) >= u.
    Uses a log-space CDF accumulation to avoid overflow.
    """
    u    = np.asarray(u, dtype=np.float64)
    size = u.size
    k    = np.zeros(size, dtype=np.float64)  # result

    # Start from k=0: P(X=0) = exp(-lam)
    log_pmf = np.full(size, -lam)            # log P(X=k)
    log_cdf = np.full(size, -lam)            # log CDF(k)

    done = np.exp(log_cdf) >= u              # k=0 already satisfies some u values

    # Iterate up to a safe maximum (mean + 20*std covers > 1 - 1e-15)
    k_max = int(lam + 20 * math.sqrt(lam) + 30)
    for kk in range(1, k_max + 1):
        if done.all():
            break
        # log P(X=kk) = log P(X=kk-1) + log(lam) - log(kk)
        log_pmf  += math.log(lam) - math.log(kk)
        # log(CDF + PMF): log-sum-exp for numerical stability
        log_cdf   = np.logaddexp(log_cdf, log_pmf)
        newly     = (~done) & (np.exp(log_cdf) >= u)
        k[newly]  = kk
        done     |= newly

    return k


def sample_clipped(dist: AnyDist, var: str, size: int, rng: np.random.Generator) -> np.ndarray:
    """Sample `size` values from dist, clip to variable bounds."""
    lo, hi = CLIP_BOUNDS[var]
    u = rng.uniform(0.0, 1.0, size=size)

    if isinstance(dist, NormalDist):
        vals = _norm_ppf(u) * dist.params.std + dist.params.mean

    elif isinstance(dist, UniformDist):
        vals = dist.params.low + u * (dist.params.high - dist.params.low)

    elif isinstance(dist, ExponentialDist):
        vals = _expon_ppf(u, dist.params.scale)

    elif isinstance(dist, PoissonDist):
        vals = _poisson_ppf(u, dist.params.lam)

    else:
        raise ValueError(f"Unknown distribution type: {dist.type}")

    return np.clip(vals, lo, hi if hi != math.inf else np.finfo(float).max)


# ---------------------------------------------------------------------------
# Request / Response models (unchanged)
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
    seed:          int | None = Field(default=None, description="Optional RNG seed for reproducibility")
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
# Simulation core (unchanged from original)
# ---------------------------------------------------------------------------

@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    rng = np.random.default_rng(req.seed)
    d   = req.distributions
    K, N, W0, tier = req.k, req.n, req.W0, req.tier

    i_samples  = sample_clipped(d.i,  "i",  K * N, rng).reshape(N, K)
    T_samples  = sample_clipped(d.T,  "T",  K * N, rng).reshape(N, K)
    pi_samples = sample_clipped(d.pi, "pi", K * N, rng).reshape(N, K)
    g_samples  = sample_clipped(d.g,  "g",  K * N, rng).reshape(N, K)
    C0_base    = sample_clipped(d.C0, "C0", K * N, rng).reshape(N, K)
    S0_base    = sample_clipped(d.S0, "S0", K * N, rng).reshape(N, K)

    W         = np.full((N + 1, K), W0, dtype=np.float64)
    ruined    = np.zeros(K, dtype=bool)
    ruin_year = np.full(K, -1, dtype=np.int32)
    cum_inflation = np.ones(K, dtype=np.float64)

    for yr in range(N):
        alive = ~ruined

        pi_yr = pi_samples[yr]
        i_yr  = i_samples[yr]
        T_yr  = T_samples[yr]
        g_yr  = g_samples[yr]

        cum_inflation *= (1.0 + pi_yr)
        C0_yr = np.maximum(C0_base[yr] * cum_inflation, CLIP_BOUNDS["C0"][0])
        S0_yr = np.maximum(S0_base[yr] * cum_inflation, CLIP_BOUNDS["S0"][0])

        growth      = W[yr] * (1.0 + i_yr * (1.0 - T_yr))
        consumption = C0_yr if tier >= 2 else C0_base[yr]
        welfare     = S0_yr * np.power(1.0 + g_yr, yr) * (1.0 - T_yr) if tier >= 3 else 0.0
        W_next      = growth - consumption + welfare

        W[yr + 1] = np.where(alive, W_next, W[yr])

        newly_ruined            = alive & (W[yr + 1] < 0)
        ruined[newly_ruined]    = True
        ruin_year[newly_ruined] = yr + 1
        W[yr + 1, newly_ruined] = 0.0

    final_W       = W[N]
    survived_mask = ~ruined

    n_ruin         = int(ruined.sum())
    n_net_gain     = int(((final_W > W0) & survived_mask).sum())
    n_loss_solvent = int(survived_mask.sum()) - n_net_gain
    n_surviving    = int(survived_mask.sum())

    pct = lambda x: round(x / K * 100, 2)

    outcome_counts = OutcomeCounts(
        net_gain=n_net_gain, loss_solvent=n_loss_solvent, ruin=n_ruin)
    outcome_pct = OutcomePct(
        net_gain=pct(n_net_gain),
        loss_solvent=pct(n_loss_solvent),
        ruin=pct(n_ruin))

    median_final_W     = float(np.median(final_W[survived_mask])) if n_surviving > 0 else None
    mean_years_to_ruin = float(np.mean(ruin_year[ruined])) if n_ruin > 0 else None

    years = list(range(N + 1))
    p05: list[float | None] = []
    p25: list[float | None] = []
    p50: list[float | None] = []
    p75: list[float | None] = []
    p95: list[float | None] = []

    for yr in range(N + 1):
        pcts = np.percentile(W[yr], [5, 25, 50, 75, 95])
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