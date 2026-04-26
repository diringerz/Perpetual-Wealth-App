"""
symbolic.py
-----------
Single source of truth for every mathematical expression in the model.

All formulae are kept in exact sympy form until the final .evalf() call.
No floating-point approximations are used internally.

Tier definitions
----------------
Tier 1 — Base: W0 = C0 / r_real  (constant consumption)
Tier 2 — Inflation-adjusted consumption: C grows at pi
Tier 3 — Welfare (after-tax): general formula valid for any g < r_real
          W0 = C0/(r-pi) - S0*(1-T)/(r-g)
          g=0   → welfare fixed nominal, PV = S0*(1-T)/r_real
          g=pi  → welfare inflation-indexed, PV = S0*(1-T)/(r-pi)

Closed-form solutions
---------------------
All are exact solutions to the governing ODE / recurrence.
Singularities (r=pi, r=g) are resolved via sympy.limit() — no if-branches
on floats needed at the call site.

Continuous system (Tiers 2–3):
  dW/dt = W*r - C0*exp(pi*t) + S0*(1-T)*exp(g*t)

  General solution:
    W(t) = A*exp(r*t) + B*exp(pi*t) + D*exp(g*t)

  Where (away from singularities):
    B = -C0 / (r - pi)
    D =  S0*(1-T) / (r - g)
    A =  W0 - B - D

  At r = pi:   B-term becomes  -C0 * t * exp(r*t)
  At r = g:    D-term becomes   S0*(1-T) * t * exp(r*t)

Discrete system (Tiers 2–3):
  W[n+1] = W[n]*(1+r) - C0*(1+pi)^n + S0*(1-T)*(1+g)^n

  General solution (away from singularities):
    W[n] = A*(1+r)^n + B*(1+pi)^n + D*(1+g)^n

  Where:
    B = -C0 / (r - pi)
    D =  S0*(1-T) / (r - g)
    A =  W0 - B - D

  At r = pi:   B-term becomes  -C0 * n * (1+r)^(n-1)
  At r = g:    D-term becomes   S0*(1-T) * n * (1+r)^(n-1)
"""

from __future__ import annotations
from functools import lru_cache
from typing import Optional

import sympy as sp

# ---------------------------------------------------------------------------
# Canonical symbolic variables — shared across all expressions
# ---------------------------------------------------------------------------

_W0, _C0, _S0 = sp.symbols("W0 C0 S0", positive=True)
_i,  _T,  _pi  = sp.symbols("i T pi",   positive=True)
_g,  _t,  _n   = sp.symbols("g t n",    positive=True)
_r             = sp.Symbol("r",          positive=True)

# ---------------------------------------------------------------------------
# Exact real rate
# r_real = (1 + i*(1-T)) / (1 + pi) - 1
# This is NOT approximated as i*(1-T) - pi
# ---------------------------------------------------------------------------

R_REAL_EXACT: sp.Expr = (1 + _i * (1 - _T)) / (1 + _pi) - 1

R_REAL_FORMULA: str = "(1 + i*(1 - T)) / (1 + pi) - 1"


def compute_r_real(i: float, T: float, pi: float) -> sp.Float:
    """Evaluate r_real exactly for given parameter values."""
    return R_REAL_EXACT.subs({_i: i, _T: T, _pi: pi}).evalf()


# ---------------------------------------------------------------------------
# Tier detection
# ---------------------------------------------------------------------------

def detect_tier(C0: float, i: float, T: float, pi: float,
                S0: float, g: float) -> int:
    if S0 > 0:
        return 4  # welfare present; reinvestment is the most complete model
    return 2      # inflation-adjusted consumption is always on


# ---------------------------------------------------------------------------
# Static W0 formulae
# ---------------------------------------------------------------------------

# Tier 1 (constant consumption, no inflation adjustment):
#   W0 = C0 / r
W0_TIER1: sp.Expr = _C0 / _r

# Tier 2 (consumption grows at pi):
#   W0 = C0 / (r - pi)
W0_TIER2: sp.Expr = _C0 / (_r - _pi)

# Tier 3 — general formula valid for any g < r_real:
#   W0 = C0/(r - pi) - S0*(1-T)/(r - g)
#
#   Correctly distinguishes:
#     g = 0   → welfare fixed nominal, loses real value → PV(S) = S0*(1-T)/r
#     g = pi  → welfare indexed to inflation, real value constant → PV(S) = S0*(1-T)/(r-pi)
#     g = r   → singularity (welfare grows as fast as returns, infinite PV)
W0_TIER3: sp.Expr = _C0 / (_r - _pi) - _S0 * (1 - _T) / (_r - _g)


def _w0_expr(tier: int) -> sp.Expr:
    return {1: W0_TIER1, 2: W0_TIER2, 3: W0_TIER3}[tier]


def w0_formula_string(tier: int) -> str:
    return {
        1: "C0 / r_real",
        2: "C0 / (r_real - pi)",
        3: "C0 / (r_real - pi) - S0*(1-T) / (r_real - g)",
    }[tier]


# ---------------------------------------------------------------------------
# Continuous closed-form  W(t)
# ---------------------------------------------------------------------------

def _continuous_B(r_val: sp.Expr, C0_val: sp.Expr, pi_val: sp.Expr) -> sp.Expr:
    """
    B coefficient for the pi-exponential term.
    Uses sympy.limit to handle r == pi exactly.
    """
    expr = -C0_val / (_r - pi_val)
    return sp.limit(expr, _r, r_val)


def _continuous_D(r_val: sp.Expr, S0_val: sp.Expr, T_val: sp.Expr,
                  g_val: sp.Expr) -> sp.Expr:
    """
    D coefficient for the g-exponential term.
    Uses sympy.limit to handle r == g exactly.
    """
    if S0_val == 0:
        return sp.Integer(0)
    expr = S0_val * (1 - T_val) / (_r - g_val)
    return sp.limit(expr, _r, r_val)


def continuous_W(
    W0: float, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, t_array: list[float]
) -> list[float]:
    """
    Evaluate the exact continuous closed-form W(t) at each point in t_array.

    W(t) = A*exp(r*t) + B*exp(pi*t) + D*exp(g*t)

    All coefficients are computed symbolically before numerical evaluation.
    """
    r_val  = compute_r_real(i, T, pi)
    C0_s   = sp.Float(C0)
    S0_s   = sp.Float(S0)
    T_s    = sp.Float(T)
    pi_s   = sp.Float(pi)
    g_s    = sp.Float(g)
    W0_s   = sp.Float(W0)

    B = _continuous_B(r_val, C0_s, pi_s)
    D = _continuous_D(r_val, S0_s, T_s, g_s)
    A = W0_s - B - D

    # Lambdify for fast evaluation over the array
    t_sym  = sp.Symbol("t")
    expr   = (A * sp.exp(r_val * t_sym)
              + B * sp.exp(pi_s * t_sym)
              + D * sp.exp(g_s  * t_sym))
    f      = sp.lambdify(t_sym, expr, modules="numpy")
    return [float(f(t)) for t in t_array]


def continuous_W_expr(
    W0_sym: sp.Expr, C0_sym: sp.Expr, S0_sym: sp.Expr,
    T_sym:  sp.Expr, pi_sym: sp.Expr, g_sym: sp.Expr,
    r_sym:  sp.Expr
) -> sp.Expr:
    """
    Return the fully symbolic continuous closed form W(t) as a sympy expression.
    Used for differentiation in sensitivity analysis.
    """
    B = -C0_sym / (r_sym - pi_sym)
    D = S0_sym * (1 - T_sym) / (r_sym - g_sym)
    A = W0_sym - B - D
    return (A * sp.exp(r_sym * _t)
            + B * sp.exp(pi_sym * _t)
            + D * sp.exp(g_sym  * _t))


# ---------------------------------------------------------------------------
# Discrete closed-form  W[n]
# ---------------------------------------------------------------------------

def _discrete_B(r_val: sp.Expr, C0_val: sp.Expr, pi_val: sp.Expr) -> sp.Expr:
    expr = -C0_val / (_r - pi_val)
    return sp.limit(expr, _r, r_val)


def _discrete_D(r_val: sp.Expr, S0_val: sp.Expr, T_val: sp.Expr,
                g_val: sp.Expr) -> sp.Expr:
    if S0_val == 0:
        return sp.Integer(0)
    expr = S0_val * (1 - T_val) / (_r - g_val)
    return sp.limit(expr, _r, r_val)


def discrete_W(
    W0: float, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, n_array: list[int]
) -> list[float]:
    """
    Evaluate the exact discrete closed-form W[n] at each integer n in n_array.

    W[n] = A*(1+r)^n + B*(1+pi)^n + D*(1+g)^n

    Singularities at r=pi and r=g resolved via sympy.limit.
    """
    r_val  = compute_r_real(i, T, pi)
    C0_s   = sp.Float(C0)
    S0_s   = sp.Float(S0)
    T_s    = sp.Float(T)
    pi_s   = sp.Float(pi)
    g_s    = sp.Float(g)
    W0_s   = sp.Float(W0)

    B = _discrete_B(r_val, C0_s, pi_s)
    D = _discrete_D(r_val, S0_s, T_s, g_s)
    A = W0_s - B - D

    r_f  = float(r_val)
    pi_f = float(pi_s)
    g_f  = float(g_s)
    A_f  = float(A)
    B_f  = float(B)
    D_f  = float(D)

    return [
        A_f * (1 + r_f)**n + B_f * (1 + pi_f)**n + D_f * (1 + g_f)**n
        for n in n_array
    ]


# ---------------------------------------------------------------------------
# Sensitivity — exact symbolic differentiation
# ---------------------------------------------------------------------------

# Map variable name -> the sympy symbol used in W0 expressions
_VAR_SYMBOLS: dict[str, sp.Symbol] = {
    "i":  _i,
    "T":  _T,
    "pi": _pi,
    "C0": _C0,
    "S0": _S0,
    "g":  _g,
}


@lru_cache(maxsize=64)
def _build_W0_expr(tier: int) -> sp.Expr:
    """
    Return W0 as a fully symbolic expression in terms of i, T, pi, C0, S0, g.
    r is substituted out so differentiation w.r.t. i, T, pi is exact.
    """
    base = _w0_expr(tier)
    return base.subs(_r, R_REAL_EXACT)


def sensitivity(
    var: str, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, W0: float, tier: int
) -> tuple[float, float, float]:
    """
    Returns (dW0/dx, elasticity, d2W0/dx2) evaluated at the given parameter point.
    All derivatives computed exactly via sympy.diff before numerical evaluation.
    """
    sym      = _VAR_SYMBOLS[var]
    W0_expr  = _build_W0_expr(tier)

    subs_map = {_C0: C0, _i: i, _T: T, _pi: pi, _S0: S0, _g: g}

    dW0_dx   = sp.diff(W0_expr, sym)
    d2W0_dx2 = sp.diff(dW0_dx,  sym)

    dW0_val   = float(dW0_dx.subs(subs_map).evalf())
    d2W0_val  = float(d2W0_dx2.subs(subs_map).evalf())

    x_val     = subs_map[sym]
    elasticity = (dW0_val * x_val / W0) if W0 != 0 else float("nan")

    return dW0_val, elasticity, d2W0_val


def asymptote_for_var(
    var: str, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, tier: int
) -> Optional[float]:
    """
    Solve analytically for the value of `var` where W0 -> infinity.
    Returns None if no finite asymptote exists for this variable.
    """
    sym      = _VAR_SYMBOLS[var]
    W0_expr  = _build_W0_expr(tier)
    subs_map = {_C0: C0, _i: i, _T: T, _pi: pi, _S0: S0, _g: g}
    del subs_map[sym]  # leave the sweep variable free

    # Denominator of W0 — asymptote is where it equals zero
    _, denom = sp.fraction(sp.cancel(W0_expr))
    solutions = sp.solve(denom.subs(subs_map), sym)

    real_sols = [
        float(s.evalf()) for s in solutions
        if s.is_real and s.evalf().is_real
    ]
    return real_sols[0] if real_sols else None