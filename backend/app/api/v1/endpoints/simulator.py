"""
simulator.py — POST /api/v1/deterministic/simulate/advise

Accepts the current wealth, year, parameters, and tier.
Reuses the existing solve logic to compute W_required and generate
targeted suggestions for restoring solvency.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import math

router = APIRouter(prefix="/api/v1/deterministic/simulate", tags=["simulator"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SimParams(BaseModel):
    i:   float   # nominal return rate (decimal)
    T:   float   # tax rate (decimal)
    pi:  float   # inflation rate (decimal)
    C0:  float   # annual consumption
    S0:  float = 0.0  # annual welfare
    g:   float = 0.0  # welfare growth rate


class AdviseRequest(BaseModel):
    W_current: float
    year:      int
    params:    SimParams
    tier:      int


class Suggestion(BaseModel):
    variable: str
    action:   str          # "increase" | "reduce"
    current:  float
    target:   float
    plain:    str


class AdviseResponse(BaseModel):
    bankrupt:    bool
    W_required:  Optional[float]
    shortfall:   Optional[float]
    suggestions: list[Suggestion]


# ---------------------------------------------------------------------------
# Solve helpers — mirrors the deterministic solve logic
# ---------------------------------------------------------------------------

def _r_real(p: SimParams) -> float:
    return (1 + p.i * (1 - p.T)) / (1 + p.pi) - 1


def _W_required(p: SimParams, tier: int) -> Optional[float]:
    """Return W0 required for perpetual solvency under given tier."""
    r = _r_real(p)

    if tier == 1:
        # W0 = C0 / (i*(1-T) - pi)  [simplified constant consumption]
        denom = p.i * (1 - p.T) - p.pi
        if denom <= 0:
            return None
        return p.C0 / denom

    if tier == 2:
        # W0 = C0 / (r_real - pi)
        denom = r - p.pi
        if denom <= 0:
            return None
        return p.C0 / denom

    if tier == 3:
        # W0 = C0 / (r_real - pi) - S0*(1-T) / (r_real - g)
        denom1 = r - p.pi
        denom2 = r - p.g
        if denom1 <= 0 or denom2 <= 0:
            return None
        return p.C0 / denom1 - p.S0 * (1 - p.T) / denom2

    return None


def _suggest_consumption(p: SimParams, tier: int, W_current: float) -> Optional[Suggestion]:
    """Find C0 that makes W_current sufficient."""
    r = _r_real(p)
    denom = r - p.pi
    if denom <= 0:
        return None

    if tier == 3:
        welfare_term = p.S0 * (1 - p.T) / (r - p.g) if (r - p.g) > 0 else 0
        target_C0 = (W_current + welfare_term) * denom
    else:
        target_C0 = W_current * denom

    if target_C0 <= 0 or target_C0 >= p.C0:
        return None

    return Suggestion(
        variable="C0",
        action="reduce",
        current=round(p.C0),
        target=round(target_C0),
        plain=f"Reduce annual consumption from "
              f"${p.C0:,.0f} to ${target_C0:,.0f}",
    )


def _suggest_return_rate(p: SimParams, tier: int, W_current: float) -> Optional[Suggestion]:
    """Find i that makes W_current sufficient."""
    # W_current = C0 / (r - pi) => r = C0/W_current + pi
    # r = (1 + i*(1-T))/(1+pi) - 1 => i = ((r+1)*(1+pi) - 1) / (1-T)
    if W_current <= 0:
        return None

    if tier == 3:
        # Simplified: ignore welfare term interaction for suggestion
        target_r = p.C0 / W_current + p.pi
    else:
        target_r = p.C0 / W_current + p.pi

    target_i = ((target_r + 1) * (1 + p.pi) - 1) / (1 - p.T)

    if target_i <= p.i or target_i > 0.50:
        return None

    return Suggestion(
        variable="i",
        action="increase",
        current=round(p.i * 100, 2),
        target=round(target_i * 100, 2),
        plain=f"Increase return rate from "
              f"{p.i*100:.2f}% to {target_i*100:.2f}%",
    )


def _suggest_tax_rate(p: SimParams, tier: int, W_current: float) -> Optional[Suggestion]:
    """Find T that makes W_current sufficient."""
    if W_current <= 0:
        return None

    # r_real = C0/W + pi  =>  (1 + i*(1-T))/(1+pi) - 1 = C0/W + pi
    # 1 + i*(1-T) = (C0/W + pi + 1)*(1+pi)
    # i*(1-T) = (C0/W + pi + 1)*(1+pi) - 1
    # T = 1 - [(C0/W + pi + 1)*(1+pi) - 1] / i
    if p.i <= 0:
        return None

    needed_i_net = (p.C0 / W_current + p.pi + 1) * (1 + p.pi) - 1
    target_T = 1 - needed_i_net / p.i

    if target_T >= p.T or target_T < 0:
        return None

    return Suggestion(
        variable="T",
        action="reduce",
        current=round(p.T * 100, 1),
        target=round(target_T * 100, 1),
        plain=f"Reduce tax rate from "
              f"{p.T*100:.1f}% to {target_T*100:.1f}%",
    )


def _suggest_welfare(p: SimParams, tier: int, W_current: float) -> Optional[Suggestion]:
    """Find S0 that makes W_current sufficient (Tier 3 only)."""
    if tier != 3:
        return None

    r = _r_real(p)
    denom1 = r - p.pi
    denom2 = r - p.g

    if denom1 <= 0 or denom2 <= 0:
        return None

    # W = C0/denom1 - S0*(1-T)/denom2
    # S0*(1-T)/denom2 = C0/denom1 - W
    # S0 = (C0/denom1 - W) * denom2 / (1-T)
    target_S0 = (p.C0 / denom1 - W_current) * denom2 / (1 - p.T)

    if target_S0 <= p.S0 or target_S0 > 500_000:
        return None

    return Suggestion(
        variable="S0",
        action="increase",
        current=round(p.S0),
        target=round(target_S0),
        plain=f"Increase annual welfare from "
              f"${p.S0:,.0f} to ${target_S0:,.0f}",
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/advise", response_model=AdviseResponse)
def advise(req: AdviseRequest) -> AdviseResponse:
    bankrupt   = req.W_current < 0
    W_required = _W_required(req.params, req.tier)
    shortfall  = (W_required - req.W_current) if W_required is not None else None

    if not bankrupt:
        return AdviseResponse(
            bankrupt=False,
            W_required=W_required,
            shortfall=shortfall,
            suggestions=[],
        )

    # Generate suggestions — use absolute value of W_current as target
    # (user needs to at least reach 0, ideally W_required)
    target_W = max(0.0, W_required or 0.0)

    suggestions: list[Suggestion] = []
    for fn in [
        _suggest_consumption,
        _suggest_return_rate,
        _suggest_tax_rate,
        _suggest_welfare,
    ]:
        s = fn(req.params, req.tier, target_W)
        if s is not None:
            suggestions.append(s)

    return AdviseResponse(
        bankrupt=True,
        W_required=W_required,
        shortfall=shortfall,
        suggestions=suggestions,
    )