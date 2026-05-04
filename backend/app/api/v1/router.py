from fastapi import APIRouter
from app.api.v1.endpoints.deterministic import router as deterministic_router
from app.api.v1.endpoints.simulator import router as simulator_router
from app.api.v1.endpoints.stochastic_naive import router as stochastic_naive_router
# Future routers slot in here without touching main.py
# from app.api.v1.endpoints.stochastic import router as stochastic_router

router = APIRouter(prefix="/api/v1")
router.include_router(deterministic_router)
router.include_router(stochastic_naive_router)
router.include_router(simulator_router)
# router.include_router(stochastic_router)
