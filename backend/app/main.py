from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import contact, auth, upload, cleaning, forecast

app = FastAPI(title="VORA API")

# CORS – libera o front rodando em localhost:5500 etc.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # depois você pode restringir
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health():
    return {"status": "ok"}


# Rotas principais
app.include_router(contact.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(cleaning.router, prefix="/api")
app.include_router(forecast.router, prefix="/api")
