from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


# Información que retorna la API sobre una ubicación
class UbicacionResponse(BaseModel):

    id_ubicacion: int
    nombre: str
    latitud: Decimal
    longitud: Decimal
    timezone: str

    model_config = ConfigDict(from_attributes=True)


# Información que retorna la API sobre el cálculo 
# de probabilidad de un arrebol
class PronosticoResponse(BaseModel):

    id_arrebol: int
    nombre_ubicacion: str
    fecha_hora: datetime
    tipo_arrebol: int
    prob: Decimal


# Respuesta de consulta de pronósticos de varios
# arreboles
class PronosticosResponse(BaseModel):

    fecha: date
    pronosticos: list[PronosticoResponse]


