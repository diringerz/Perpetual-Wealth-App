from fastapi import FastAPI
from app.api.v1.router import router as v1_router
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Perpetual Wealth API",
    description=(
        "Stateless API for computing the initial wealth required for perpetual "
        "solvency. All formulae are exact (sympy) — no floating-point "
        "approximations are used internally."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],  # your Angular dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(v1_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
