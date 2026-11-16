from fastapi import FastAPI
from app.routers import pronosticos, ubicaciones

app = FastAPI(
    title = "API Préboles",
    description = "API REST para consultar las probabilidades de ocurrencia de arrebol",
    version = "1.0.0"
)

app.include_router(pronosticos.router)
app.include_router(ubicaciones.router)

@app.get("/")
def root():
    return "Bienvenido a la API REST de Préboles."