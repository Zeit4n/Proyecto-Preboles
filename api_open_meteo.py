import openmeteo_requests

import pandas as pd
import requests_cache
from retry_requests import retry
from datetime import datetime
from zoneinfo import ZoneInfo
from momentos_solares import ubicaciones


# Setup the Open-Meteo API client with cache and retry on error
cache_session = requests_cache.CachedSession('.cache', expire_after = 3600)
retry_session = retry(cache_session, retries = 5, backoff_factor = 0.2)
openmeteo = openmeteo_requests.Client(session = retry_session)

# Make sure all required weather variables are listed here
# The order of variables in hourly or daily is important to assign them correctly below
# Forecast para pronósticos - NOS SIRVE
url = "https://api.open-meteo.com/v1/forecast"

#Variables que extraeremos de Open-Meteo
variables = [
    "relative_humidity_2m",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "pressure_msl",
    "shortwave_radiation"
]

#Diccionario que almacena los DataFrame obtenidos en cada localidad
pronosticos = {}

for ubicacion, datos in ubicaciones.items():
    hoy = datetime.now(ZoneInfo(datos['timezone'])).date()

    params = {
        "latitude": datos['lat'],
        "longitude": datos['lon'],
        "hourly": "relative_humidity_2m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,pressure_msl,shortwave_radiation",
        "start_hour": f"{hoy}T00:00",
        "end_hour": f"{hoy}T23:00",
        "timezone": datos["timezone"]
    }

    responses = openmeteo.weather_api(url, params = params)
    response = responses[0]
    hourly = response.Hourly()
    data = {
    "date": pd.date_range(
        start=pd.to_datetime(hourly.Time(), unit="s", utc=True),
        end=pd.to_datetime(hourly.TimeEnd(), unit="s", utc=True),
        freq=pd.Timedelta(seconds=hourly.Interval()),
        inclusive="left"
        )
    }

    #Convertimos los datos
    for i, variable in enumerate(variables):
        data[variable] = hourly.Variables(i).ValuesAsNumpy()

    #Creamos DataFrame
    hourly_dataframe = pd.DataFrame(data = data)

    # Convertir fechas a la zona horaria de la localidad
    hourly_dataframe["date"] = (
        hourly_dataframe["date"].dt.tz_convert(datos["timezone"])
    )

    pronosticos[ubicacion] = hourly_dataframe