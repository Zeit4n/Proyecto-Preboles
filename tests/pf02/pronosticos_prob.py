import config_logging

from modelo_ml import calcular_probabilidades
from datos_diarios import datos_diarios, sunrises, sunsets
import pandas as pd

import logging
logger = logging.getLogger(__name__)


#Variables meteorológicas diarias en torno a amanecer (sunrises) y atardecer (sunsets)
sunrises_diarios = datos_diarios(sunrises)
sunsets_diarios = datos_diarios(sunsets)
logger.info(
    "Datos meteorológicos preparados: %d registros de amanecer y %d de atardecer.",
    len(sunrises_diarios),
    len(sunsets_diarios)
)

#Elegimos las variables de interés para aplicarla al modelo 
vars_meteo_model = ['elev','cloudsLow','cloudsMid','cloudsHigh','humidity',
                     'pressure','irradiance','kind','cloudm_cloudh']

var_sunrises = sunrises_diarios[vars_meteo_model]
var_sunsets = sunsets_diarios[vars_meteo_model]

#Llamamos al modelo y añadimos una columna en sunrises_diarios y sunsets_diarios con las probabilidades
sunrises_diarios['probs'] = calcular_probabilidades(var_sunrises)
sunsets_diarios['probs'] = calcular_probabilidades(var_sunsets)

logger.info("Probabilidades de amanecer y atardecer generadas.")

#Construimos una sola tabla que enviaremos a la base de datos
pronosticos_prob = pd.concat([sunrises_diarios, sunsets_diarios], ignore_index= True)
logger.info(
    "Pronósticos consolidados: %d registros.",
    len(pronosticos_prob)
)

#Seleccionamos un subconjunto de los datos que serán enviados a la base de datos
pronosticos_prob_bbdd = pronosticos_prob[['location', 'date', 'kind', 'probs']]
logger.info(
    "Resultados preparados para almacenamiento: %d registros.",
    len(pronosticos_prob_bbdd)
)
logger.info(
    pronosticos_prob_bbdd
)

