import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

data = pd.read_csv("PrebolesII.csv", usecols=['elev', 'cloudsLow', 'cloudsMid', 'cloudsHigh', 'humidity', 'pressure',
                                               'irradiance', 'kind', 'actualArrebol'])
data['cloudm_cloudh'] = data['cloudsHigh']*data['cloudsMid']

x = data.drop("actualArrebol", axis=1)
y = data["actualArrebol"]

modelo = Pipeline([
    ('scaler', StandardScaler()),
    ("logistic", LogisticRegression(max_iter=7500))
])

# Entrenamiento final
modelo.fit(x, y)

def calcular_probabilidades(data_input):
    return modelo.predict_proba(data_input)[:, 1]