import logging
logger = logging.getLogger(__name__)
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

logging.info(
    "----- FASE DE ENTRENAMIENTO DE MODELO INICIADO -----"
)
data = pd.read_csv("PrebolesII.csv", usecols=['elev', 'cloudsLow', 'cloudsMid', 'cloudsHigh', 'humidity', 'pressure',
                                               'irradiance', 'kind', 'actualArrebol'])

logging.info(
    "Carga de base de datos histórica exitosa."
)

data['cloudm_cloudh'] = data['cloudsHigh']*data['cloudsMid']

logging.info(
    "Variable 'cloudm_cloudh' creada a partir de base de datos histórica."
)

x = data.drop("actualArrebol", axis=1)
y = data["actualArrebol"]

modelo = Pipeline([
    ('scaler', StandardScaler()),
    ("logistic", LogisticRegression(max_iter=7500))
])

# Entrenamiento final
modelo.fit(x, y)

logging.info(
    "Modelo entrenado. Variables predictoras: %s",
    x.columns.tolist()
)
logging.info(
    "----- FASE DE ENTRENAMIENTO DE MODELO FINALIZADO -----"
)

def calcular_probabilidades(data_input):
    logger.info(
        "Iniciando inferencia para %d registros.",
        len(data_input)
    )
    probs =  modelo.predict_proba(data_input)[:, 1]

    logger.info(
        "Inferencia finalizada. Probabilidades generadas: %d",
        len(probs)
    )
    return probs