"""
Tests for the deterministic solver.

Philosophy: test mathematical correctness first, API contract second.
All expected values are derived analytically — no magic numbers.
"""

import math
import pytest
from app.models.wealth import (
    EdgeCase, SolveRequest, SweepRequest, SweepVariable, Tier, WealthParams,
    SweepRange,
)
from app.services.deterministic.solver import solve, sweep
from app.solvers.symbolic import compute_r_real


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def base_params(**overrides) -> WealthParams:
    defaults = dict(C0=80_000, i=0.07, T=0.25, pi=0.03, S0=0.0, g=0.0)
    return WealthParams(**{**defaults, **overrides})


# ---------------------------------------------------------------------------
# r_real exactness
# ---------------------------------------------------------------------------

def test_r_real_exact_vs_approximation():
    """
    Exact:  r = (1 + i*(1-T)) / (1+pi) - 1
    Approx: r ≈ i*(1-T) - pi
    These must differ — we verify the exact form is used.
    """
    i, T, pi = 0.07, 0.25, 0.03
    r_exact  = float(compute_r_real(i, T, pi))
    r_approx = i * (1 - T) - pi
    assert not math.isclose(r_exact, r_approx, rel_tol=1e-9), (
        "Exact and approximate r_real must differ"
    )
    # Exact form is always slightly below the approximation
    # because denominator (1+pi) > 1 reduces the return
    assert r_exact < r_approx


# ---------------------------------------------------------------------------
# Solve — correctness
# ---------------------------------------------------------------------------

def test_solve_W0_basic():
    """W0 * r_real should equal C0 at equilibrium (no welfare, no inflation growth)."""
    p   = base_params()
    r   = float(compute_r_real(p.i, p.T, p.pi))
    req = SolveRequest(params=p, t_horizon=1)
    res = solve(req)
    # W0 = (C0 - 0) / (r - pi)  [Tier 2, inflation-adjusted]
    expected = p.C0 / (r - p.pi)
    assert math.isclose(res.W0, expected, rel_tol=1e-9)


def test_solve_with_welfare():
    p   = base_params(S0=15_000, g=0.02)
    r   = float(compute_r_real(p.i, p.T, p.pi))
    req = SolveRequest(params=p, t_horizon=1)
    res = solve(req)
    expected = (p.C0 - p.S0 * (1 - p.T)) / (r - p.pi)
    assert math.isclose(res.W0, expected, rel_tol=1e-9)


def test_solve_tier_with_welfare():
    p   = base_params(S0=15_000, g=0.02)
    res = solve(SolveRequest(params=p, t_horizon=1))
    assert res.tier == Tier.welfare_reinvested


def test_solve_trajectory_length():
    horizon = 30
    res = solve(SolveRequest(params=base_params(), t_horizon=horizon))
    assert len(res.trajectory) == horizon + 1


def test_solve_trajectory_starts_at_W0():
    res = solve(SolveRequest(params=base_params(), t_horizon=20))
    assert math.isclose(res.trajectory[0].W, res.W0, rel_tol=1e-6)


def test_solve_trajectory_equilibrium():
    """At the exact W0, the continuous closed form should hold W approximately
    constant (perpetual solvency). Check that W(50) is within 1% of W(0)."""
    res = solve(SolveRequest(params=base_params(), t_horizon=50))
    W0  = res.trajectory[0].W
    W50 = res.trajectory[-1].W
    assert math.isclose(W0, W50, rel_tol=0.01)


# ---------------------------------------------------------------------------
# Solve — edge cases
# ---------------------------------------------------------------------------

def test_edge_full_taxation():
    # T very close to 1 — validator requires T < 1, so use 0.9999
    p   = base_params(T=0.9999)
    res = solve(SolveRequest(params=p, t_horizon=1))
    assert res.edge_case == EdgeCase.infeasible or res.edge_case == EdgeCase.full_taxation


def test_edge_infeasible_low_return():
    """When r_real < pi, perpetual wealth is impossible."""
    # pi=0.08 and i=0.05 with T=0.25 gives r < pi
    p   = base_params(i=0.05, pi=0.08)
    res = solve(SolveRequest(params=p, t_horizon=1))
    assert res.edge_case == EdgeCase.infeasible
    assert res.W0 is None


def test_edge_welfare_covers_all():
    """When S0*(1-T) >= C0, W0 should be 0."""
    # S0*(1-T) = 80000*(0.75) = 60000 < C0=80000 — not enough
    # S0 = 120000*(1-0.25)=90000 >= 80000 — covers all
    p   = base_params(S0=120_000, g=0.02)
    res = solve(SolveRequest(params=p, t_horizon=1))
    assert res.edge_case == EdgeCase.welfare_covers_all
    assert res.W0 == 0.0


# ---------------------------------------------------------------------------
# Sensitivity
# ---------------------------------------------------------------------------

def test_sensitivity_return_rate_negative():
    """Higher return rate should require less initial wealth — dW0/di < 0."""
    p   = base_params()
    res = solve(SolveRequest(params=p, t_horizon=1))
    i_sens = next(s for s in res.sensitivity if s.variable == SweepVariable.i)
    assert i_sens.dW0_dx < 0


def test_sensitivity_inflation_positive():
    """Higher inflation requires more wealth — dW0/dpi > 0."""
    p   = base_params()
    res = solve(SolveRequest(params=p, t_horizon=1))
    pi_sens = next(s for s in res.sensitivity if s.variable == SweepVariable.pi)
    assert pi_sens.dW0_dx > 0


def test_sensitivity_consumption_positive():
    """Higher consumption requires more wealth — dW0/dC0 > 0."""
    p   = base_params()
    res = solve(SolveRequest(params=p, t_horizon=1))
    c_sens = next(s for s in res.sensitivity if s.variable == SweepVariable.C0)
    assert c_sens.dW0_dx > 0


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------

def test_sweep_returns_correct_n_points():
    req = SweepRequest(
        base_params=base_params(),
        sweep_var=SweepVariable.i,
        sweep_range=SweepRange(min=0.04, max=0.15, n_points=100),
    )
    res = sweep(req)
    assert len(res.points) == 100


def test_sweep_base_point_matches_solve():
    """The sweep's base_point W0 should match the standalone solve."""
    p       = base_params()
    solve_r = solve(SolveRequest(params=p, t_horizon=1))
    req     = SweepRequest(
        base_params=p,
        sweep_var=SweepVariable.i,
        sweep_range=SweepRange(min=0.04, max=0.15, n_points=50),
    )
    sweep_r = sweep(req)
    assert math.isclose(sweep_r.base_point.W0, solve_r.W0, rel_tol=1e-6)


def test_sweep_asymptote_detected():
    """Sweeping i should detect an asymptote where r_real = pi."""
    req = SweepRequest(
        base_params=base_params(pi=0.03, T=0.25),
        sweep_var=SweepVariable.i,
        sweep_range=SweepRange(min=0.01, max=0.15, n_points=200),
    )
    res = sweep(req)
    # Asymptote at i where (1+i*(1-T))/(1+pi)-1 = pi
    # i.e. i*(1-T) = pi*(2+pi) => i = pi*(2+pi)/(1-T)
    pi, T = 0.03, 0.25
    expected_asym = pi * (2 + pi) / (1 - T)
    assert len(res.asymptotes) == 1
    assert math.isclose(res.asymptotes[0], expected_asym, rel_tol=1e-4)


def test_sweep_infeasible_region_tagged():
    """Points below the asymptote should be tagged infeasible."""
    req = SweepRequest(
        base_params=base_params(pi=0.03, T=0.25),
        sweep_var=SweepVariable.i,
        sweep_range=SweepRange(min=0.01, max=0.15, n_points=200),
    )
    res = sweep(req)
    assert len(res.infeasible_regions) >= 1
    # Infeasible region should start at or near min of sweep range
    assert res.infeasible_regions[0].from_x <= 0.02


def test_sweep_monotone_in_return():
    """W0 should decrease monotonically as i increases (above the asymptote)."""
    req = SweepRequest(
        base_params=base_params(pi=0.03, T=0.25),
        sweep_var=SweepVariable.i,
        sweep_range=SweepRange(min=0.06, max=0.20, n_points=100),
    )
    res  = sweep(req)
    vals = [pt.W0 for pt in res.points if pt.W0 is not None]
    assert all(vals[k] > vals[k+1] for k in range(len(vals)-1))
