from fastapi import APIRouter
from app.models.wealth import SolveRequest, SolveResponse, SweepRequest, SweepResponse
from app.services.deterministic.solver import solve, sweep

router = APIRouter(prefix="/deterministic", tags=["deterministic"])


@router.post("/solve", response_model=SolveResponse)
def solve_endpoint(req: SolveRequest) -> SolveResponse:
    """
    Solve for the initial wealth W0 required for perpetual solvency.

    Returns the exact W0, the real return rate (exact formula, not approximated),
    the governing tier, a wealth trajectory over t_horizon years, and exact
    sensitivity derivatives for all parameters.
    """
    return solve(req)


@router.post("/sweep", response_model=SweepResponse)
def sweep_endpoint(req: SweepRequest) -> SweepResponse:
    """
    Sweep one parameter over a range, holding all others constant.

    Returns (x, W0) coordinate pairs for plotting, analytically-derived
    asymptotes, infeasible regions, and the exact sensitivity at the base point.
    """
    return sweep(req)
