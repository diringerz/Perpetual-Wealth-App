# Perpetual Wealth API

Stateless FastAPI backend for computing the initial wealth required to never
work again, with exact symbolic mathematics throughout.

## Architecture

```
app/
  main.py                          # FastAPI app, mounts routers
  api/
    v1/
      router.py                    # Aggregates all v1 endpoint routers
      endpoints/
        deterministic.py           # /api/v1/deterministic/{solve,sweep}
        stochastic.py              # (future) Monte Carlo / SDE endpoints
  models/
    wealth.py                      # Pydantic request/response schemas
  services/
    deterministic/
      solver.py                    # Orchestrates symbolic engine → responses
    stochastic/
      solver.py                    # (future)
  solvers/
    symbolic.py                    # All sympy expressions — single source of truth
```

## Key design decisions

**Exact arithmetic** — `r_real = (1 + i*(1-T)) / (1+pi) - 1` is never
approximated as `i*(1-T) - pi`. Sympy carries all expressions symbolically
until the final `.evalf()`.

**Singularity handling via `sympy.limit`** — the closed-form solutions for
W(t) and W[n] have poles at r=pi and r=g. Rather than float-comparison
branches, `sympy.limit(expr, r, r_val)` resolves these analytically, yielding
the correct `t·e^(rt)` form automatically.

**Stateless** — every request carries all parameters. No database, no session.
Future stochastic endpoints follow the same pattern with a `seed` parameter
for reproducibility.

**Versioned routing** — all endpoints live under `/api/v1/`. Adding v2 or
stochastic endpoints requires only a new router file and one line in
`api/v1/router.py`.

## Endpoints

### POST /api/v1/deterministic/solve
Returns W0, r_real (exact), tier, trajectory W(t) over t_horizon years,
and exact sensitivity derivatives ∂W0/∂x for all parameters.

### POST /api/v1/deterministic/sweep
Sweeps one parameter over a range. Returns (x, W0) coordinate pairs,
analytically-derived asymptotes, infeasible regions, and sensitivity at base.

## Running

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
# Docs at http://localhost:8000/docs
```

## Testing

```bash
pytest tests/ -v
```

## Adding stochastic endpoints (future)

1. Create `app/services/stochastic/solver.py`
2. Create `app/api/v1/endpoints/stochastic.py` with its router
3. Add one line to `app/api/v1/router.py`:
   `router.include_router(stochastic_router)`

No other files change.
