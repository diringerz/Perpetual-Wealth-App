"""
deterministic.py
----------------
Orchestrates the symbolic engine to produce SolveResponse and SweepResponse
objects. No math lives here — all computation is delegated to solvers/symbolic.py.
"""

from __future__ import annotations
from typing import Optional

from app.models.wealth import (
    EdgeCase, SolveRequest, SolveResponse, SweepRequest, SweepResponse,
    SweepPoint, SweepVariable, SensitivityResult, Tier, TrajectoryPoint,
    InfeasibleRegion,
)
from app.solvers.symbolic import (
    R_REAL_FORMULA, asymptote_for_var, compute_r_real, continuous_W,
    discrete_W, sensitivity, w0_formula_string,
)


# ---------------------------------------------------------------------------
# Edge-case detection
# ---------------------------------------------------------------------------

_ZERO_TOLERANCE = 1e-10

def _detect_edge_case(
    C0: float, i: float, T: float, pi: float,
    S0: float, g: float, r_real: float, tier: int,
) -> Optional[EdgeCase]:
    if T >= 1.0 - _ZERO_TOLERANCE:
        return EdgeCase.full_taxation

    # Welfare checks before infeasibility —
    # sufficient welfare can make the system solvent regardless of r_real
    if S0 > 0 and tier == 3:
        # Welfare covers all only if it covers consumption nominally at t=0
        # AND grows at least as fast as inflation so it never falls behind
        if (S0 * (1 - T) >= C0 - _ZERO_TOLERANCE
                and g >= pi - _ZERO_TOLERANCE):
            return EdgeCase.welfare_covers_all

        # g >= r_real with positive r_real — welfare PV is infinite
        # but only meaningful when r_real > 0
        if (r_real > _ZERO_TOLERANCE
                and g >= r_real - _ZERO_TOLERANCE
                and S0 * (1 - T) > 0):
            return EdgeCase.welfare_covers_all

        # PV comparison — only valid when both denominators are positive
        if (r_real > pi + _ZERO_TOLERANCE
                and r_real > g + _ZERO_TOLERANCE):
            welfare_pv     = _welfare_pv(S0, T, g, r_real)
            consumption_pv = C0 / (r_real - pi)
            if welfare_pv >= consumption_pv - _ZERO_TOLERANCE:
                return EdgeCase.welfare_covers_all

    # Infeasibility — only applies when investment returns are needed
    if r_real < -_ZERO_TOLERANCE:
        return EdgeCase.infeasible
    if tier > 1:
        if r_real < pi - _ZERO_TOLERANCE:
            return EdgeCase.infeasible
        if abs(r_real - pi) < _ZERO_TOLERANCE:
            return EdgeCase.r_equals_pi

    # Singularity — welfare grows as fast as returns
    if S0 > 0 and g > _ZERO_TOLERANCE and abs(r_real - g) < _ZERO_TOLERANCE:
        return EdgeCase.r_equals_g

    return None


# ---------------------------------------------------------------------------
# W0 evaluation
# ---------------------------------------------------------------------------

def _welfare_pv(S0: float, T: float, g: float, r_real: float) -> float:
    """
    Present value of the welfare stream.
    g = 0:   fixed nominal perpetuity  → S0*(1-T) / r_real
    g > 0:   growing perpetuity        → S0*(1-T) / (r_real - g)
    """
    if g <= _ZERO_TOLERANCE:
        return S0 * (1 - T) / r_real
    return S0 * (1 - T) / (r_real - g)


def _solve_W0(
    C0: float, i: float, T: float, pi: float,
    S0: float, g: float, r_real: float,
    edge_case: Optional[EdgeCase], tier: int,
) -> Optional[float]:
    if edge_case in (EdgeCase.infeasible, EdgeCase.r_equals_pi,
                     EdgeCase.full_taxation, EdgeCase.r_equals_g):
        return None
    if edge_case == EdgeCase.welfare_covers_all:
        return 0.0

    if tier == 1:
        return float(C0 / r_real)

    # Tier 2: no welfare
    consumption_pv = C0 / (r_real - pi)
    if tier == 2 or S0 == 0:
        return float(consumption_pv)

    # Tier 3: general formula valid for any g < r_real
    # W0 = C0/(r_real - pi) - S0*(1-T)/(r_real - g)
    # Correctly distinguishes:
    #   g = 0   → welfare is fixed nominal, loses real value over time
    #   g = pi  → welfare indexed to inflation, real value constant
    #   g = r   → singularity (already caught above as r_equals_g)
    return float(consumption_pv - _welfare_pv(S0, T, g, r_real))


# ---------------------------------------------------------------------------
# Sensitivity for all variables
# ---------------------------------------------------------------------------

_ALL_VARS = ["i", "T", "pi", "C0", "S0", "g"]


def _build_sensitivity(
    C0: float, i: float, T: float, pi: float,
    S0: float, g: float, W0: float, tier: int,
) -> list[SensitivityResult]:
    results = []
    for var in _ALL_VARS:
        try:
            dW0_dx, elas, d2W0_dx2 = sensitivity(
                var, C0, i, T, pi, S0, g, W0, tier
            )
            results.append(SensitivityResult(
                variable=SweepVariable(var),
                dW0_dx=dW0_dx,
                elasticity=elas,
                d2W0_dx2=d2W0_dx2,
            ))
        except Exception:
            # Singular point for this variable — skip gracefully
            pass
    return results


# ---------------------------------------------------------------------------
# Public: solve
# ---------------------------------------------------------------------------

def solve(req: SolveRequest) -> SolveResponse:
    p         = req.params
    r_real    = float(compute_r_real(p.i, p.T, p.pi))
    tier_int  = req.tier
    tier      = Tier(tier_int)
    edge_case = _detect_edge_case(p.C0, p.i, p.T, p.pi, p.S0, p.g, r_real, tier_int)
    W0        = _solve_W0(p.C0, p.i, p.T, p.pi, p.S0, p.g, r_real, edge_case, tier_int)

    # Trajectory — continuous closed form
    t_array     = list(range(req.t_horizon + 1))
    w0_for_traj = W0 if W0 is not None else 0.0
    cont_vals   = continuous_W(w0_for_traj, p.C0, p.i, p.T, p.pi, p.S0, p.g, t_array)
    trajectory  = [
        TrajectoryPoint(t=float(t), W=w)
        for t, w in zip(t_array, cont_vals)
    ]

    # Sensitivity — only meaningful when W0 is defined and non-zero
    sens = []
    if W0 is not None and W0 != 0.0:
        sens = _build_sensitivity(p.C0, p.i, p.T, p.pi, p.S0, p.g, W0, tier_int)

    return SolveResponse(
        tier=tier,
        W0=W0,
        r_real=r_real,
        r_real_formula=R_REAL_FORMULA,
        W0_formula=w0_formula_string(tier_int),
        edge_case=edge_case,
        trajectory=trajectory,
        sensitivity=sens,
    )


# ---------------------------------------------------------------------------
# Public: sweep
# ---------------------------------------------------------------------------

def sweep(req: SweepRequest) -> SweepResponse:
    p        = req.base_params
    var      = req.sweep_var.value
    tier_int = req.tier

    # Build sweep x-values
    lo, hi, n = req.sweep_range.min, req.sweep_range.max, req.sweep_range.n_points
    step      = (hi - lo) / (n - 1)
    x_values  = [lo + k * step for k in range(n)]

    # Analytical asymptote
    asym       = asymptote_for_var(var, p.C0, p.i, p.T, p.pi, p.S0, p.g, tier_int)
    asymptotes = [asym] if asym is not None and lo <= asym <= hi else []

    # Evaluate each sweep point
    points: list[SweepPoint] = []
    for x in x_values:
        params = _params_with_override(p, var, x)
        r_real = float(compute_r_real(params["i"], params["T"], params["pi"]))
        ec     = _detect_edge_case(**params, r_real=r_real, tier=tier_int)
        W0     = _solve_W0(**params, r_real=r_real, edge_case=ec, tier=tier_int)
        points.append(SweepPoint(x=round(x, 10), W0=W0, edge_case=ec))

    # Infeasible regions
    infeasible_regions = _find_infeasible_regions(points, lo, hi)

    # Base point
    base_x   = getattr(p, var)
    base_r   = float(compute_r_real(p.i, p.T, p.pi))
    base_ec  = _detect_edge_case(p.C0, p.i, p.T, p.pi, p.S0, p.g, base_r, tier_int)
    base_W0  = _solve_W0(p.C0, p.i, p.T, p.pi, p.S0, p.g, base_r, base_ec, tier_int)
    base_point = SweepPoint(x=base_x, W0=base_W0, edge_case=base_ec)

    # Sensitivity at base point
    sens_at_base = None
    if base_W0 is not None and base_W0 != 0.0:
        dW0_dx, elas, d2 = sensitivity(
            var, p.C0, p.i, p.T, p.pi, p.S0, p.g, base_W0, tier_int
        )
        sens_at_base = SensitivityResult(
            variable=req.sweep_var,
            dW0_dx=dW0_dx,
            elasticity=elas,
            d2W0_dx2=d2,
        )

    return SweepResponse(
        sweep_var=req.sweep_var,
        points=points,
        asymptotes=asymptotes,
        infeasible_regions=infeasible_regions,
        base_point=base_point,
        sensitivity_at_base=sens_at_base,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _params_with_override(p, var: str, x: float) -> dict:
    """Return a dict of all parameters with one variable overridden."""
    return {
        "C0": p.C0 if var != "C0" else x,
        "i":  p.i  if var != "i"  else x,
        "T":  p.T  if var != "T"  else x,
        "pi": p.pi if var != "pi" else x,
        "S0": p.S0 if var != "S0" else x,
        "g":  p.g  if var != "g"  else x,
    }


def _find_infeasible_regions(
    points: list[SweepPoint], lo: float, hi: float
) -> list[InfeasibleRegion]:
    """Identify contiguous runs of infeasible sweep points."""
    regions: list[InfeasibleRegion] = []
    in_region    = False
    region_start = lo

    for pt in points:
        is_inf = pt.edge_case in (
            EdgeCase.infeasible, EdgeCase.r_equals_pi, EdgeCase.full_taxation
        )
        if is_inf and not in_region:
            region_start = pt.x
            in_region    = True
        elif not is_inf and in_region:
            regions.append(InfeasibleRegion(from_x=region_start, to_x=pt.x))
            in_region = False

    if in_region:
        regions.append(InfeasibleRegion(from_x=region_start, to_x=hi))

    return regions