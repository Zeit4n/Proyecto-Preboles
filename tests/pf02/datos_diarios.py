import logging
logger = logging.getLogger(__name__)
from astral.sun import sun
from pvlib import solarposition
from momentos_solares import ubicaciones, momentos
from api_open_meteo import pronosticos
import pandas as pd

sunrises = {ciudad: tiempos[:2] for ciudad, tiempos in momentos.items()}
sunsets = {ciudad: tiempos[2:] for ciudad, tiempos in momentos.items()}

def datos_diarios(eventos):
    logger.info(
        "----- FASE DE PREPROCESAMIENTO INICIADA -----"
    )
    columnas = ["date",	"relative_humidity_2m",	"cloud_cover_low",
                "cloud_cover_mid",	"cloud_cover_high",	"pressure_msl",	"shortwave_radiation",
                "elev", "location", "hour", 'kind', 'cloudm_cloudh']
    
    eventos_df = pd.DataFrame(columns=columnas)    

    for ubicacion, momentos in eventos.items():
        data = pronosticos[ubicacion]
        horas = data['date'].dt.strftime("%H:%M")
        registro = data[(horas == momentos[0]) | (horas == momentos[1])]
        logger.info(
            "Se seleccionaron %d registros meteorológicos para %s",
            len(registro),
            ubicacion
        )
                
        registro['elev'] = registro.apply(
            lambda fila: solarposition.get_solarposition(
                time=fila['date'],
                latitude=ubicaciones[ubicacion]["lat"],
                longitude=ubicaciones[ubicacion]["lon"],
                pressure=fila['pressure_msl']*100
            )['apparent_elevation'].iloc[0],
            axis=1
        )
        logger.info(
            "Elevación solar calculada para los registros seleccionados de %s",
            ubicacion
        )
        
        if momentos[0] == momentos[1]:
            registro['location'] = ubicacion
            registro['hour'] = momentos[0]
            if eventos == sunrises:
                registro['kind'] = 0
            else:
                registro['kind'] = 1
        
        elif momentos[0] != momentos[1]:
            registro['location'] = [ubicacion, ubicacion]
            registro['hour'] = [momentos[0], momentos[1]]
            if eventos == sunrises:
                registro['kind'] = [0, 0]
            else:
                registro['kind'] = [1, 1]

        registro['cloudm_cloudh'] = registro['cloud_cover_mid']*registro['cloud_cover_high']
        logger.info(
            "Variable 'cloudm_cloudh' creada para %s.",
            ubicacion
        )
        eventos_df = pd.concat([eventos_df, registro], ignore_index= True)
        logger.info(
            "Registros meteorológicos añadidos al conjunto de datos."
        )

    eventos_df.rename(columns ={'cloud_cover_low':'cloudsLow',
                                'cloud_cover_mid':'cloudsMid',
                                'cloud_cover_high':'cloudsHigh',
                                'relative_humidity_2m':'humidity',
                                'pressure_msl':'pressure',
                                'shortwave_radiation':'irradiance'
                                }, inplace=True)
    logger.info(
        "Datos listos para el modelo"
    )
    logger.info(
        "----- FASE DE PREPROCESAMIENTO TERMINADA -----"
    )
    
    return eventos_df