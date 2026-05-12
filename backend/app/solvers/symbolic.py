# """
# symbolic.py
# -----------
# Single source of truth for every mathematical expression in the model.

# All formulae are kept in exact sympy form until the final .evalf() call.
# No floating-point approximations are used internally.

# Tier definitions
# ----------------
# Tier 1 — Base: W0 = C0 / r_real  (constant consumption)
# Tier 2 — Inflation-adjusted consumption: C grows at pi
# Tier 3 — Welfare (after-tax): general formula valid for any g < r_real
#           W0 = C0/(r-pi) - S0*(1-T)/(r-g)
#           g=0   → welfare fixed nominal, PV = S0*(1-T)/r_real
#           g=pi  → welfare inflation-indexed, PV = S0*(1-T)/(r-pi)

# Closed-form solutions
# ---------------------
# All are exact solutions to the governing ODE / recurrence.
# Singularities (r=pi, r=g) are resolved via sympy.limit() — no if-branches
# on floats needed at the call site.

# Continuous system (Tiers 2–3):
#   dW/dt = W*r - C0*exp(pi*t) + S0*(1-T)*exp(g*t)

#   General solution:
#     W(t) = A*exp(r*t) + B*exp(pi*t) + D*exp(g*t)

#   Where (away from singularities):
#     B = -C0 / (r - pi)
#     D =  S0*(1-T) / (r - g)
#     A =  W0 - B - D

#   At r = pi:   B-term becomes  -C0 * t * exp(r*t)
#   At r = g:    D-term becomes   S0*(1-T) * t * exp(r*t)

# Discrete system (Tiers 2–3):
#   W[n+1] = W[n]*(1+r) - C0*(1+pi)^n + S0*(1-T)*(1+g)^n

#   General solution (away from singularities):
#     W[n] = A*(1+r)^n + B*(1+pi)^n + D*(1+g)^n

#   Where:
#     B = -C0 / (r - pi)
#     D =  S0*(1-T) / (r - g)
#     A =  W0 - B - D

#   At r = pi:   B-term becomes  -C0 * n * (1+r)^(n-1)
#   At r = g:    D-term becomes   S0*(1-T) * n * (1+r)^(n-1)
# """

# from __future__ import annotations
# from functools import lru_cache
# from typing import Optional

# import sympy as sp

# # ---------------------------------------------------------------------------
# # Canonical symbolic variables — shared across all expressions
# # ---------------------------------------------------------------------------

# _W0, _C0, _S0 = sp.symbols("W0 C0 S0", positive=True)
# _i,  _T,  _pi  = sp.symbols("i T pi",   positive=True)
# _g,  _t,  _n   = sp.symbols("g t n",    positive=True)
# _r             = sp.Symbol("r",          positive=True)

# # ---------------------------------------------------------------------------
# # Exact real rate
# # r_real = (1 + i*(1-T)) / (1 + pi) - 1
# # This is NOT approximated as i*(1-T) - pi
# # ---------------------------------------------------------------------------

# R_REAL_EXACT: sp.Expr = (1 + _i * (1 - _T)) / (1 + _pi) - 1

# R_REAL_FORMULA: str = "(1 + i*(1 - T)) / (1 + pi) - 1"


# def compute_r_real(i: float, T: float, pi: float) -> sp.Float:
#     """Evaluate r_real exactly for given parameter values."""
#     return R_REAL_EXACT.subs({_i: i, _T: T, _pi: pi}).evalf()


# # ---------------------------------------------------------------------------
# # Tier detection
# # ---------------------------------------------------------------------------

# def detect_tier(C0: float, i: float, T: float, pi: float,
#                 S0: float, g: float) -> int:
#     if S0 > 0:
#         return 4  # welfare present; reinvestment is the most complete model
#     return 2      # inflation-adjusted consumption is always on


# # ---------------------------------------------------------------------------
# # Static W0 formulae
# # ---------------------------------------------------------------------------

# # Tier 1 (constant consumption, no inflation adjustment):
# #   W0 = C0 / r
# W0_TIER1: sp.Expr = _C0 / _r

# # Tier 2 (consumption grows at pi):
# #   W0 = C0 / (r - pi)
# W0_TIER2: sp.Expr = _C0 / (_r - _pi)

# # Tier 3 — general formula valid for any g < r_real:
# #   W0 = C0/(r - pi) - S0*(1-T)/(r - g)
# #
# #   Correctly distinguishes:
# #     g = 0   → welfare fixed nominal, loses real value → PV(S) = S0*(1-T)/r
# #     g = pi  → welfare indexed to inflation, real value constant → PV(S) = S0*(1-T)/(r-pi)
# #     g = r   → singularity (welfare grows as fast as returns, infinite PV)
# W0_TIER3: sp.Expr = _C0 / (_r - _pi) - _S0 * (1 - _T) / (_r - _g)


# def _w0_expr(tier: int) -> sp.Expr:
#     return {1: W0_TIER1, 2: W0_TIER2, 3: W0_TIER3}[tier]


# def w0_formula_string(tier: int) -> str:
#     return {
#         1: "C0 / r_real",
#         2: "C0 / (r_real - pi)",
#         3: "C0 / (r_real - pi) - S0*(1-T) / (r_real - g)",
#     }[tier]


# # ---------------------------------------------------------------------------
# # Continuous closed-form  W(t)
# # ---------------------------------------------------------------------------

# def _continuous_B(r_val: sp.Expr, C0_val: sp.Expr, pi_val: sp.Expr) -> sp.Expr:
#     """
#     B coefficient for the pi-exponential term.
#     Uses sympy.limit to handle r == pi exactly.
#     """
#     expr = -C0_val / (_r - pi_val)
#     return sp.limit(expr, _r, r_val)


# def _continuous_D(r_val: sp.Expr, S0_val: sp.Expr, T_val: sp.Expr,
#                   g_val: sp.Expr) -> sp.Expr:
#     """
#     D coefficient for the g-exponential term.
#     Uses sympy.limit to handle r == g exactly.
#     """
#     if S0_val == 0:
#         return sp.Integer(0)
#     expr = S0_val * (1 - T_val) / (_r - g_val)
#     return sp.limit(expr, _r, r_val)


# def continuous_W(
#     W0: float, C0: float, i: float, T: float,
#     pi: float, S0: float, g: float, t_array: list[float]
# ) -> list[float]:
#     """
#     Evaluate the exact continuous closed-form W(t) at each point in t_array.

#     W(t) = A*exp(r*t) + B*exp(pi*t) + D*exp(g*t)

#     All coefficients are computed symbolically before numerical evaluation.
#     """
#     r_val  = compute_r_real(i, T, pi)
#     C0_s   = sp.Float(C0)
#     S0_s   = sp.Float(S0)
#     T_s    = sp.Float(T)
#     pi_s   = sp.Float(pi)
#     g_s    = sp.Float(g)
#     W0_s   = sp.Float(W0)

#     B = _continuous_B(r_val, C0_s, pi_s)
#     D = _continuous_D(r_val, S0_s, T_s, g_s)
#     A = W0_s - B - D

#     # Lambdify for fast evaluation over the array
#     t_sym  = sp.Symbol("t")
#     expr   = (A * sp.exp(r_val * t_sym)
#               + B * sp.exp(pi_s * t_sym)
#               + D * sp.exp(g_s  * t_sym))
#     f      = sp.lambdify(t_sym, expr, modules="numpy")
#     return [float(f(t)) for t in t_array]


# def continuous_W_expr(
#     W0_sym: sp.Expr, C0_sym: sp.Expr, S0_sym: sp.Expr,
#     T_sym:  sp.Expr, pi_sym: sp.Expr, g_sym: sp.Expr,
#     r_sym:  sp.Expr
# ) -> sp.Expr:
#     """
#     Return the fully symbolic continuous closed form W(t) as a sympy expression.
#     Used for differentiation in sensitivity analysis.
#     """
#     B = -C0_sym / (r_sym - pi_sym)
#     D = S0_sym * (1 - T_sym) / (r_sym - g_sym)
#     A = W0_sym - B - D
#     return (A * sp.exp(r_sym * _t)
#             + B * sp.exp(pi_sym * _t)
#             + D * sp.exp(g_sym  * _t))


# # ---------------------------------------------------------------------------
# # Discrete closed-form  W[n]
# # ---------------------------------------------------------------------------

# def _discrete_B(r_val: sp.Expr, C0_val: sp.Expr, pi_val: sp.Expr) -> sp.Expr:
#     expr = -C0_val / (_r - pi_val)
#     return sp.limit(expr, _r, r_val)


# def _discrete_D(r_val: sp.Expr, S0_val: sp.Expr, T_val: sp.Expr,
#                 g_val: sp.Expr) -> sp.Expr:
#     if S0_val == 0:
#         return sp.Integer(0)
#     expr = S0_val * (1 - T_val) / (_r - g_val)
#     return sp.limit(expr, _r, r_val)


# def discrete_W(
#     W0: float, C0: float, i: float, T: float,
#     pi: float, S0: float, g: float, n_array: list[int]
# ) -> list[float]:
#     """
#     Evaluate the exact discrete closed-form W[n] at each integer n in n_array.

#     W[n] = A*(1+r)^n + B*(1+pi)^n + D*(1+g)^n

#     Singularities at r=pi and r=g resolved via sympy.limit.
#     """
#     r_val  = compute_r_real(i, T, pi)
#     C0_s   = sp.Float(C0)
#     S0_s   = sp.Float(S0)
#     T_s    = sp.Float(T)
#     pi_s   = sp.Float(pi)
#     g_s    = sp.Float(g)
#     W0_s   = sp.Float(W0)

#     B = _discrete_B(r_val, C0_s, pi_s)
#     D = _discrete_D(r_val, S0_s, T_s, g_s)
#     A = W0_s - B - D

#     r_f  = float(r_val)
#     pi_f = float(pi_s)
#     g_f  = float(g_s)
#     A_f  = float(A)
#     B_f  = float(B)
#     D_f  = float(D)

#     return [
#         A_f * (1 + r_f)**n + B_f * (1 + pi_f)**n + D_f * (1 + g_f)**n
#         for n in n_array
#     ]


# # ---------------------------------------------------------------------------
# # Sensitivity — exact symbolic differentiation
# # ---------------------------------------------------------------------------

# # Map variable name -> the sympy symbol used in W0 expressions
# _VAR_SYMBOLS: dict[str, sp.Symbol] = {
#     "i":  _i,
#     "T":  _T,
#     "pi": _pi,
#     "C0": _C0,
#     "S0": _S0,
#     "g":  _g,
# }


# @lru_cache(maxsize=64)
# def _build_W0_expr(tier: int) -> sp.Expr:
#     """
#     Return W0 as a fully symbolic expression in terms of i, T, pi, C0, S0, g.
#     r is substituted out so differentiation w.r.t. i, T, pi is exact.
#     """
#     base = _w0_expr(tier)
#     return base.subs(_r, R_REAL_EXACT)


# def sensitivity(
#     var: str, C0: float, i: float, T: float,
#     pi: float, S0: float, g: float, W0: float, tier: int
# ) -> tuple[float, float, float]:
#     """
#     Returns (dW0/dx, elasticity, d2W0/dx2) evaluated at the given parameter point.
#     All derivatives computed exactly via sympy.diff before numerical evaluation.
#     """
#     sym      = _VAR_SYMBOLS[var]
#     W0_expr  = _build_W0_expr(tier)

#     subs_map = {_C0: C0, _i: i, _T: T, _pi: pi, _S0: S0, _g: g}

#     dW0_dx   = sp.diff(W0_expr, sym)
#     d2W0_dx2 = sp.diff(dW0_dx,  sym)

#     dW0_val   = float(dW0_dx.subs(subs_map).evalf())
#     d2W0_val  = float(d2W0_dx2.subs(subs_map).evalf())

#     x_val     = subs_map[sym]
#     elasticity = (dW0_val * x_val / W0) if W0 != 0 else float("nan")

#     return dW0_val, elasticity, d2W0_val


# def asymptote_for_var(
#     var: str, C0: float, i: float, T: float,
#     pi: float, S0: float, g: float, tier: int
# ) -> Optional[float]:
#     """
#     Solve analytically for the value of `var` where W0 -> infinity.
#     Returns None if no finite asymptote exists for this variable.
#     """
#     sym      = _VAR_SYMBOLS[var]
#     W0_expr  = _build_W0_expr(tier)
#     subs_map = {_C0: C0, _i: i, _T: T, _pi: pi, _S0: S0, _g: g}
#     del subs_map[sym]  # leave the sweep variable free

#     # Denominator of W0 — asymptote is where it equals zero
#     _, denom = sp.fraction(sp.cancel(W0_expr))
#     solutions = sp.solve(denom.subs(subs_map), sym)

#     real_sols = [
#         float(s.evalf()) for s in solutions
#         if s.is_real and s.evalf().is_real
#     ]
#     return real_sols[0] if real_sols else None

"""
symbolic.py
-----------
Drop-in replacement for the sympy-based symbolic engine.
All derivatives and closed-form expressions are pre-derived analytically
and implemented as plain Python/numpy. No sympy dependency.

Tier definitions
----------------
Tier 1 — Base:                W0 = C0 / r
Tier 2 — Inflation-adjusted:  W0 = C0 / (r - pi)
Tier 3 — Welfare:             W0 = C0 / (r - pi) - S0*(1-T) / (r - g)

Real rate (exact, not approximated):
    r = (1 + i*(1-T)) / (1+pi) - 1

All first and second derivatives are derived via the chain rule through r.
    dr/di  =  (1-T) / (1+pi)
    dr/dT  = -i     / (1+pi)
    dr/dpi = -(1 + i*(1-T)) / (1+pi)^2  =  -(1+r) / (1+pi)
"""

from __future__ import annotations
import math
from typing import Optional
import numpy as np

# ---------------------------------------------------------------------------
# Public constants (match original interface)
# ---------------------------------------------------------------------------

R_REAL_FORMULA: str = "(1 + i*(1 - T)) / (1 + pi) - 1"


# ---------------------------------------------------------------------------
# Real rate
# ---------------------------------------------------------------------------

def compute_r_real(i: float, T: float, pi: float) -> float:
    return (1.0 + i * (1.0 - T)) / (1.0 + pi) - 1.0


# ---------------------------------------------------------------------------
# W0 formula strings (unchanged)
# ---------------------------------------------------------------------------

def w0_formula_string(tier: int) -> str:
    return {
        1: "C0 / r_real",
        2: "C0 / (r_real - pi)",
        3: "C0 / (r_real - pi) - S0*(1-T) / (r_real - g)",
    }[tier]


# ---------------------------------------------------------------------------
# Tier detection (kept for compatibility)
# ---------------------------------------------------------------------------

def detect_tier(C0: float, i: float, T: float, pi: float,
                S0: float, g: float) -> int:
    if S0 > 0:
        return 4
    return 2


# ---------------------------------------------------------------------------
# Continuous closed-form W(t) — analytic coefficients, numpy evaluation
#
# W(t) = A*exp(r*t) + B*exp(pi*t) + D*exp(g*t)
#
# Away from singularities:
#   B = -C0 / (r - pi)
#   D =  S0*(1-T) / (r - g)
#   A =  W0 - B - D
#
# At r == pi (limit):   B term → -C0 * t * exp(r*t)
# At r == g  (limit):   D term →  S0*(1-T) * t * exp(r*t)
# ---------------------------------------------------------------------------

_EPS = 1e-10


def continuous_W(
    W0: float, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, t_array: list[float]
) -> list[float]:
    r   = compute_r_real(i, T, pi)
    t   = np.asarray(t_array, dtype=np.float64)
    out = np.zeros_like(t)

    r_eq_pi = abs(r - pi) < _EPS
    r_eq_g  = abs(r - g)  < _EPS and S0 > 0

    if r_eq_pi and r_eq_g:
        # Both singularities: W(t) = (W0 + (S0*(1-T) - C0)*t) * exp(r*t)
        out = (W0 + (S0 * (1.0 - T) - C0) * t) * np.exp(r * t)
    elif r_eq_pi:
        D = S0 * (1.0 - T) / (r - g) if not r_eq_g and S0 > 0 else 0.0
        A = W0 - D
        # B-term at limit: -C0 * t * exp(r*t)
        out = A * np.exp(r * t) - C0 * t * np.exp(r * t) + D * np.exp(g * t)
    elif r_eq_g and S0 > 0:
        B = -C0 / (r - pi)
        A = W0 - B
        # D-term at limit: S0*(1-T) * t * exp(r*t)
        out = (A * np.exp(r * t) + B * np.exp(pi * t)
               + S0 * (1.0 - T) * t * np.exp(r * t))
    else:
        B = -C0 / (r - pi)         if abs(r - pi) > _EPS else 0.0
        D = S0 * (1.0 - T) / (r - g) if S0 > 0 else 0.0
        A = W0 - B - D
        out = (A * np.exp(r * t)
               + B * np.exp(pi * t)
               + D * np.exp(g  * t))

    return [float(v) for v in out]


# ---------------------------------------------------------------------------
# Discrete closed-form W[n]
# ---------------------------------------------------------------------------

def discrete_W(
    W0: float, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, n_array: list[int]
) -> list[float]:
    r = compute_r_real(i, T, pi)

    r_eq_pi = abs(r - pi) < _EPS
    r_eq_g  = abs(r - g)  < _EPS and S0 > 0

    results = []
    for n in n_array:
        if r_eq_pi and r_eq_g:
            val = (W0 + (S0 * (1.0 - T) - C0) * n) * (1.0 + r) ** n
        elif r_eq_pi:
            D = S0 * (1.0 - T) / (r - g) if S0 > 0 else 0.0
            A = W0 - D
            val = (A * (1 + r) ** n
                   - C0 * n * (1 + r) ** (n - 1)
                   + D * (1 + g) ** n)
        elif r_eq_g and S0 > 0:
            B = -C0 / (r - pi)
            A = W0 - B
            val = (A * (1 + r) ** n
                   + B * (1 + pi) ** n
                   + S0 * (1.0 - T) * n * (1 + r) ** (n - 1))
        else:
            B = -C0 / (r - pi)
            D = S0 * (1.0 - T) / (r - g) if S0 > 0 else 0.0
            A = W0 - B - D
            val = (A * (1 + r) ** n
                   + B * (1 + pi) ** n
                   + D * (1 + g)  ** n)
        results.append(float(val))
    return results


# ---------------------------------------------------------------------------
# Analytic sensitivity — pre-derived closed-form derivatives
#
# Notation:
#   r  = (1 + i*(1-T)) / (1+pi) - 1
#
# Chain-rule partials of r w.r.t. original parameters:
#   dr/di  =  (1-T)  / (1+pi)
#   dr/dT  = -i      / (1+pi)
#   dr/dpi = -(1+r)  / (1+pi)          [exact, no approximation]
#
# ── Tier 1:  W0 = C0 / r ──────────────────────────────────────────────────
#   dW0/dC0  =  1/r
#   dW0/di   = -C0/r^2 * dr/di
#   dW0/dT   = -C0/r^2 * dr/dT
#   dW0/dpi  = -C0/r^2 * dr/dpi
#   dW0/dS0  =  0
#   dW0/dg   =  0
#
#   d2W0/dC0^2  =  0
#   d2W0/di^2   =  2*C0/r^3 * (dr/di)^2
#   d2W0/dT^2   =  2*C0/r^3 * (dr/dT)^2
#   d2W0/dpi^2  =  2*C0/r^3 * (dr/dpi)^2  +  (-C0/r^2) * d2r/dpi^2
#                  where d2r/dpi^2 = 2*(1+r)/(1+pi)^2
#
# ── Tier 2:  W0 = C0 / (r - pi) ───────────────────────────────────────────
#   Let D2 = r - pi
#   dW0/dC0  =  1/D2
#   dW0/di   = -C0/D2^2 * (dr/di)
#   dW0/dT   = -C0/D2^2 * (dr/dT)
#   dW0/dpi  = -C0/D2^2 * (dr/dpi - 1)
#   dW0/dS0  =  0
#   dW0/dg   =  0
#
#   Second derivatives (f = C0, h = D2):
#   d2W0/dx^2 = 2*C0/D2^3 * (dD2/dx)^2   for x in {i, T}
#   d2W0/dpi^2 = 2*C0/D2^3*(dr/dpi-1)^2 + (-C0/D2^2)*d2r/dpi^2
#
# ── Tier 3:  W0 = C0/(r-pi) - S0*(1-T)/(r-g) ─────────────────────────────
#   Let D2 = r - pi,  Dg = r - g
#   Consumption term (same as Tier 2, above)
#   Welfare term: W_s = S0*(1-T) / Dg
#   dWs/di   = -S0*(1-T)/Dg^2 * dr/di
#   dWs/dT   = -S0/Dg   +  S0*(1-T)/Dg^2 * i/(1+pi)   [product rule on (1-T)]
#              = S0*(-1/Dg + (1-T)*dr_dT_neg/Dg^2)
#              simplified: dWs/dT = -S0/Dg - S0*(1-T)/Dg^2 * dr/dT
#   dWs/dpi  = -S0*(1-T)/Dg^2 * dr/dpi
#   dWs/dS0  =  (1-T)/Dg
#   dWs/dg   =  S0*(1-T)/Dg^2          [d/dg of -S0*(1-T)/(r-g) = +S0*(1-T)/Dg^2]
#
#   dW0/dx = d(consumption)/dx - d(welfare)/dx  for each x
# ---------------------------------------------------------------------------

def sensitivity(
    var: str, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, W0: float, tier: int
) -> tuple[float, float, float]:
    """
    Returns (dW0/dx, elasticity, d2W0/dx2) for variable `var` at the given point.
    All derivatives are exact closed-form expressions.
    """
    r = compute_r_real(i, T, pi)

    # Partials of r w.r.t. original params
    dr_di  =  (1.0 - T)  / (1.0 + pi)
    dr_dT  = -i           / (1.0 + pi)
    dr_dpi = -(1.0 + r)  / (1.0 + pi)   # exact chain rule

    # Second partial of r w.r.t. pi:
    # r = (1 + i*(1-T))/(1+pi) - 1
    # dr/dpi = -(1+i*(1-T))/(1+pi)^2
    # d2r/dpi2 = 2*(1+i*(1-T))/(1+pi)^3 = 2*(1+r)/(1+pi)^2... wait, let's be exact:
    # d2r/dpi2 = 2*(1 + i*(1-T)) / (1+pi)^3
    numer      = 1.0 + i * (1.0 - T)   # = (1+r)*(1+pi)
    d2r_dpi2   = 2.0 * numer / (1.0 + pi) ** 3

    dW0_dx  = 0.0
    d2W0_dx = 0.0

    if tier == 1:
        # W0 = C0 / r
        if abs(r) < _EPS:
            raise ValueError("r=0 singularity")
        r2 = r * r
        r3 = r2 * r

        if var == "C0":
            dW0_dx  = 1.0 / r
            d2W0_dx = 0.0
        elif var == "i":
            dW0_dx  = -C0 / r2 * dr_di
            d2W0_dx =  2.0 * C0 / r3 * dr_di ** 2
        elif var == "T":
            dW0_dx  = -C0 / r2 * dr_dT
            d2W0_dx =  2.0 * C0 / r3 * dr_dT ** 2
        elif var == "pi":
            dW0_dx  = -C0 / r2 * dr_dpi
            d2W0_dx = (2.0 * C0 / r3 * dr_dpi ** 2
                       - C0 / r2 * d2r_dpi2)
        elif var in ("S0", "g"):
            dW0_dx  = 0.0
            d2W0_dx = 0.0

    elif tier == 2:
        D2 = r - pi
        if abs(D2) < _EPS:
            raise ValueError("r=pi singularity")
        D2_2 = D2 * D2
        D2_3 = D2_2 * D2

        # dD2/dx for each variable
        dD2_di  = dr_di
        dD2_dT  = dr_dT
        dD2_dpi = dr_dpi - 1.0

        if var == "C0":
            dW0_dx  =  1.0 / D2
            d2W0_dx =  0.0
        elif var == "i":
            dW0_dx  = -C0 / D2_2 * dD2_di
            d2W0_dx =  2.0 * C0 / D2_3 * dD2_di ** 2
        elif var == "T":
            dW0_dx  = -C0 / D2_2 * dD2_dT
            d2W0_dx =  2.0 * C0 / D2_3 * dD2_dT ** 2
        elif var == "pi":
            dW0_dx  = -C0 / D2_2 * dD2_dpi
            d2W0_dx = (2.0 * C0 / D2_3 * dD2_dpi ** 2
                       - C0 / D2_2 * d2r_dpi2)
        elif var in ("S0", "g"):
            dW0_dx  = 0.0
            d2W0_dx = 0.0

    elif tier == 3:
        D2 = r - pi
        Dg = r - g
        if abs(D2) < _EPS:
            raise ValueError("r=pi singularity")
        if abs(Dg) < _EPS:
            raise ValueError("r=g singularity")

        D2_2 = D2 * D2;  D2_3 = D2_2 * D2
        Dg_2 = Dg * Dg;  Dg_3 = Dg_2 * Dg

        dD2_di  = dr_di;        dD2_dT  = dr_dT;        dD2_dpi = dr_dpi - 1.0
        dDg_di  = dr_di;        dDg_dT  = dr_dT;        dDg_dpi = dr_dpi

        # Consumption term partials (same as Tier 2)
        if var == "C0":
            dc =  1.0 / D2;        dc2 = 0.0
        elif var == "i":
            dc  = -C0 / D2_2 * dD2_di
            dc2 =  2.0 * C0 / D2_3 * dD2_di ** 2
        elif var == "T":
            dc  = -C0 / D2_2 * dD2_dT
            dc2 =  2.0 * C0 / D2_3 * dD2_dT ** 2
        elif var == "pi":
            dc  = -C0 / D2_2 * dD2_dpi
            dc2 = (2.0 * C0 / D2_3 * dD2_dpi ** 2
                   - C0 / D2_2 * d2r_dpi2)
        elif var == "S0":
            dc = 0.0;  dc2 = 0.0
        elif var == "g":
            dc = 0.0;  dc2 = 0.0
        else:
            dc = 0.0;  dc2 = 0.0

        # Welfare term: Ws = S0*(1-T) / Dg
        # dW0/dx = dc - dWs/dx
        if var == "C0":
            dws  = 0.0;    dws2 = 0.0
        elif var == "i":
            dws  = -S0 * (1.0 - T) / Dg_2 * dDg_di
            dws2 =  2.0 * S0 * (1.0 - T) / Dg_3 * dDg_di ** 2
        elif var == "T":
            # Ws = S0*(1-T)/Dg  — both (1-T) and Dg depend on T
            # dWs/dT = -S0/Dg + S0*(1-T) * (-1/Dg^2) * dDg/dT
            #        = -S0/Dg - S0*(1-T)/Dg^2 * dr/dT
            dws  = -S0 / Dg - S0 * (1.0 - T) / Dg_2 * dDg_dT
            # d2Ws/dT2: product rule again (messy but exact)
            # Let u=(1-T), v=1/Dg; Ws=S0*u*v
            # du/dT=-1, dv/dT=-dDg_dT/Dg^2
            # d2v/dT2 = 2*(dDg_dT)^2/Dg^3  (since d2r/dT2=0 exactly)
            # d2Ws/dT2 = S0*(d2u/dT2*v + 2*du/dT*dv/dT + u*d2v/dT2)
            #           = S0*(0 + 2*(-1)*(-dDg_dT/Dg^2) + (1-T)*2*(dDg_dT)^2/Dg^3)
            dws2 = S0 * (2.0 * dDg_dT / Dg_2
                         + (1.0 - T) * 2.0 * dDg_dT ** 2 / Dg_3)
        elif var == "pi":
            dws  = -S0 * (1.0 - T) / Dg_2 * dDg_dpi
            dws2 = (2.0 * S0 * (1.0 - T) / Dg_3 * dDg_dpi ** 2
                    - S0 * (1.0 - T) / Dg_2 * d2r_dpi2)
        elif var == "S0":
            dws  =  (1.0 - T) / Dg
            dws2 = 0.0
        elif var == "g":
            # Ws = S0*(1-T)/(r-g);  d/dg of 1/(r-g) = 1/(r-g)^2
            dws  =  S0 * (1.0 - T) / Dg_2
            dws2 =  2.0 * S0 * (1.0 - T) / Dg_3
        else:
            dws = 0.0;  dws2 = 0.0

        dW0_dx  = dc  - dws
        d2W0_dx = dc2 - dws2

    x_val     = {"C0": C0, "i": i, "T": T, "pi": pi, "S0": S0, "g": g}[var]
    elasticity = (dW0_dx * x_val / W0) if abs(W0) > _EPS else math.nan

    return dW0_dx, elasticity, d2W0_dx


# ---------------------------------------------------------------------------
# Asymptote — analytic solution, no sympy needed
#
# Tier 1:  W0 = C0/r            → asymptote at r=0
#   r=0 ↔ i*(1-T) = pi/(1+pi)... not a simple closed form in one variable;
#   we solve numerically for the sweep variable analytically where possible.
#
# Tier 2:  W0 = C0/(r-pi)       → asymptote where r - pi = 0
# Tier 3:  W0 = C0/(r-pi) - S0*(1-T)/(r-g)
#          Two possible asymptotes: r=pi or r=g
#          For a single sweep variable we check both and return the one in range.
#
# For each variable we solve the denominator=0 condition analytically:
#
# r - pi = 0:
#   (1 + i*(1-T))/(1+pi) - 1 = pi
#   1 + i*(1-T) = (1+pi)^2
#   Solving for each variable:
#     i:  i = ((1+pi)^2 - 1) / (1-T)
#     T:  T = 1 - ((1+pi)^2 - 1) / i
#     pi: (1+pi)^2 = 1 + i*(1-T)  → pi = sqrt(1+i*(1-T)) - 1
#   C0, S0, g: no asymptote (C0 in numerator; S0,g don't affect denominator)
#
# r - g = 0:
#   (1 + i*(1-T))/(1+pi) - 1 = g
#   Solving:
#     i:  i = ((1+g)*(1+pi) - 1) / (1-T)
#     T:  T = 1 - ((1+g)*(1+pi) - 1) / i
#     pi: pi = (1+i*(1-T))/(1+g) - 1
#     g:  g = r  (direct — solve same as above for g given other params)
# ---------------------------------------------------------------------------

def asymptote_for_var(
    var: str, C0: float, i: float, T: float,
    pi: float, S0: float, g: float, tier: int
) -> Optional[float]:
    """
    Return the x-value where W0 → ±∞ for the given sweep variable.
    Returns None if no finite asymptote exists for this variable.
    """
    candidates: list[float] = []

    # ── Asymptote from r - pi = 0 (Tiers 2 and 3) ─────────────────────────
    if tier >= 2:
        if var == "i" and abs(1.0 - T) > _EPS:
            candidates.append(((1.0 + pi) ** 2 - 1.0) / (1.0 - T))
        elif var == "T" and abs(i) > _EPS:
            candidates.append(1.0 - ((1.0 + pi) ** 2 - 1.0) / i)
        elif var == "pi":
            val = math.sqrt(max(0.0, 1.0 + i * (1.0 - T))) - 1.0
            candidates.append(val)
        # C0, S0, g: numerator variable or absent from Tier-2 denominator

    # ── Asymptote from r - g = 0 (Tier 3 only) ────────────────────────────
    if tier == 3 and S0 > 0:
        if var == "i" and abs(1.0 - T) > _EPS:
            candidates.append(((1.0 + g) * (1.0 + pi) - 1.0) / (1.0 - T))
        elif var == "T" and abs(i) > _EPS:
            candidates.append(1.0 - ((1.0 + g) * (1.0 + pi) - 1.0) / i)
        elif var == "pi":
            candidates.append((1.0 + i * (1.0 - T)) / (1.0 + g) - 1.0)
        elif var == "g":
            candidates.append(compute_r_real(i, T, pi))

    if not candidates:
        return None

    # Return first real, finite candidate (caller filters by sweep range)
    for c in candidates:
        if math.isfinite(c):
            return c
    return None