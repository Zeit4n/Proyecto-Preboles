from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.database import conn
from app.models import Ubicacion

router = APIRouter(
    prefix = "/ubicaciones",
    tags = ["Ubicaciones"]
)

@router.get("/")
def obtener_ubicaciones(db: Session = Depends(conn)):
    stmt = select(Ubicacion)
    ubicaciones = db.scalars(stmt).all()
    return [
        {
            "id_ubicacion": ubicacion.id_ubicacion,
            "nombre": ubicacion.nombre,
            "latitud": ubicacion.latitud,
            "longitud": ubicacion.longitud,
            "timezone": ubicacion.timezone
        }
        for ubicacion in ubicaciones
    ]

@router.get("/{id_ubicacion}")
def obtener_ubicacion(id_ubicacion: int, db: Session = Depends(conn)):
    ubicacion = db.get(Ubicacion, id_ubicacion)
    if ubicacion is None:
        raise HTTPException(
            status_code = 404,
            detail = "No se encontró ubicación"
        )
    return {
            "id_ubicacion": ubicacion.id_ubicacion,
            "nombre": ubicacion.nombre,
            "latitud": ubicacion.latitud,
            "longitud": ubicacion.longitud,
            "timezone": ubicacion.timezone
           }