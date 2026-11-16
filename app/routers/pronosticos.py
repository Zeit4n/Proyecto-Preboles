from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, func, cast, Date 

from app.database import conn
from app.models import Pronostico, Ubicacion
from app.schemas import PronosticoResponse, PronosticosResponse


router = APIRouter(
    prefix = "/pronosticos",
    tags = ["Pronósticos"]
)

'''
Dada la arquitectur actual de Préboles, realizaremos
una consulta sobre todos loss pronósticos diarios
directamente. Incluyendo arreboles de amanecer y 
atardecer en una sola consulta. Luego en Javascript,
la aplicación decidirá que mostrar.
'''


@router.get("/", response_model = PronosticosResponse)
def obtener_pronosticos(
    fecha: date = Query(..., description="fecha de consulta"),
    ubicacion: str | None = Query(
        None,
        min_length=1,
        description="Nombre de la localidad"
    ),
    db: Session = Depends(conn)
):
    # La consulta que realizaremos a PostegreSQL asociado a las ubicaciones
    stmt = (
        select(Pronostico, Ubicacion.nombre)
        .join(
            Ubicacion,
            Pronostico.id_ubicacion == Ubicacion.id_ubicacion
        )
    )

    # Filtramos por fecha local de cada ubicacion    
    fecha_local = cast(
        func.timezone(
            Ubicacion.timezone,
            Pronostico.fecha_hora
        ),
        Date
    )

    stmt = stmt.where(fecha_local == fecha)

    # Filtramos por ubicación si es que se ingresa en la consulta
    if ubicacion is not None:
        stmt = stmt.where(
            func.lower(Ubicacion.nombre) == ubicacion.strip().lower()
        )

        existe_ubicacion = db.scalar(
            select(Ubicacion.id_ubicacion).where(
                func.lower(Ubicacion.nombre) == ubicacion.strip().lower()
            )
        )

        if existe_ubicacion is None:
            raise HTTPException(
                status_code = 404,
                detail = "Ubicación no encontrada"
            )

    # Ejecutamos la consulta
    resultados = db.execute(
        stmt.order_by(
            Ubicacion.nombre,
            Pronostico.fecha_hora
        )
    ).all()

    # Construimos la respuesta
    pronosticos =[
        PronosticoResponse(
            id_arrebol = p.id_arrebol,
            nombre_ubicacion = nombre,
            fecha_hora = p.fecha_hora,
            tipo_arrebol= p.tipo_arrebol,
            prob = p.prob
        )
        for p, nombre in resultados
    ]

    return PronosticosResponse(
        fecha = fecha,
        pronosticos = pronosticos
    )