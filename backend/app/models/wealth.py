from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SweepVariable(str, Enum):
    i    = "i"
    T    = "T"
    pi   = "pi"
    C0   = "C0"
    S0   = "S0"
    g    = "g"


class EdgeCase(str, Enum):
    r_equals_pi        = "r_equals_pi"
    r_equals_g         = "r_equals_g"
    infeasible         = "infeasible"          # r_real < pi
    welfare_covers_all = "welfare_covers_all"  # S0*(1-T) >= C0
    full_taxation      = "full_taxation"       # T = 1


class Tier(int, Enum):
    base                  = 1   # W0, C0, i, T, pi only
    inflation_consumption = 2   # consumption grows at pi
    welfare               = 3   # + S0, g, T on welfare
    # welfare_reinvested    = 4   # S reinvested into W before interest


# ---------------------------------------------------------------------------
# Core parameter block — shared across all requests
# ---------------------------------------------------------------------------

class WealthParams(BaseModel):
    C0:  float = Field(...,  gt=0,          description="Annual consumption (must be positive)")
    i:   float = Field(...,  gt=0,  lt=1,   description="Nominal annual return rate (e.g. 0.07)")
    T:   float = Field(...,  ge=0,  lt=1,   description="Marginal tax rate on investment income (e.g. 0.25)")
    pi:  float = Field(...,  ge=0,          description="Annual inflation rate (e.g. 0.03)")
    S0:  float = Field(0.0, ge=0,           description="Initial annual welfare/subsidy (pre-tax)")
    g:   float = Field(0.0, ge=0,           description="Annual welfare growth rate")

    @model_validator(mode="after")
    def welfare_growth_below_return(self) -> "WealthParams":
        # Warn callers early; the solver will handle the singularity gracefully
        # but we can surface the constraint clearly here.
        r_approx = self.i * (1 - self.T) - self.pi
        if self.S0 > 0 and self.g >= r_approx and r_approx > 0:
            # Not a hard error — solver handles singularity — but attach a flag
            pass
        return self


# ---------------------------------------------------------------------------
# /solve
# ---------------------------------------------------------------------------

class SolveRequest(BaseModel):
    params:     WealthParams
    t_horizon:  int = Field(50, ge=1, le=200)
    tier:       int = Field(2, ge=1, le=4)    # add this

class TrajectoryPoint(BaseModel):
    t:  float
    W:  float


class SensitivityResult(BaseModel):
    """Exact sympy-derived sensitivity at the base point."""
    variable:    SweepVariable
    dW0_dx:      float   # dW0/d(variable)
    elasticity:  float   # (dW0/dx) * (x/W0) — dimensionless
    d2W0_dx2:    float   # convexity


class SolveResponse(BaseModel):
    tier:               Tier
    W0:                 Optional[float]
    r_real:             float            # exact (1+i(1-T))/(1+pi) - 1
    r_real_formula:     str              # human-readable exact expression
    W0_formula:         str
    edge_case:          Optional[EdgeCase]
    trajectory:         list[TrajectoryPoint]
    sensitivity:        list[SensitivityResult]


# ---------------------------------------------------------------------------
# /sweep
# ---------------------------------------------------------------------------

class SweepRange(BaseModel):
    min:      float
    max:      float
    n_points: int = Field(200, ge=10, le=2000)

    @model_validator(mode="after")
    def min_lt_max(self) -> "SweepRange":
        if self.min >= self.max:
            raise ValueError("sweep_range.min must be strictly less than sweep_range.max")
        return self


class SweepRequest(BaseModel):
    base_params:  WealthParams
    sweep_var:    SweepVariable
    sweep_range:  SweepRange
    tier:         int = Field(2, ge=1, le=4)    # add this

class SweepPoint(BaseModel):
    x:          float
    W0:         Optional[float]
    edge_case:  Optional[EdgeCase]


class InfeasibleRegion(BaseModel):
    from_x:  float
    to_x:    float


class SweepResponse(BaseModel):
    sweep_var:          SweepVariable
    points:             list[SweepPoint]
    asymptotes:         list[float]          # x values where W0 -> ±inf
    infeasible_regions: list[InfeasibleRegion]
    base_point:         SweepPoint
    sensitivity_at_base: SensitivityResult   # dW0/dx at the user's param value
