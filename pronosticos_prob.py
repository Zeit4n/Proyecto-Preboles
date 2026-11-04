from modelo_ml import calcular_probabilidades
from datos_diarios import datos_diarios, sunrises, sunsets
import pandas as pd

#Variables meteorológicas diarias en torno a amanecer (sunrises) y atardecer (sunsets)
sunrises_diarios = datos_diarios(sunrises)
sunsets_diarios = datos_diarios(sunsets)

#Elegimos las variables de interés para aplicarla al modelo 
vars_meteo_model = ['elev','cloudsLow','cloudsMid','cloudsHigh','humidity',
                     'pressure','irradiance','kind','cloudm_cloudh']

var_sunrises = sunrises_diarios[vars_meteo_model]
var_sunsets = sunsets_diarios[vars_meteo_model]

#Llamamos al modelo y añadimos una columna en sunrises_diarios y sunsets_diarios con las probabilidades
sunrises_diarios['probs'] = calcular_probabilidades(var_sunrises)
sunsets_diarios['probs'] = calcular_probabilidades(var_sunsets)

#Construimos una sola tabla que enviaremos a la base de datos
pronosticos_prob = pd.concat([sunrises_diarios, sunsets_diarios], ignore_index= True)

#Seleccionamos un subconjunto de los datos que serán enviados a la base de datos
pronosticos_prob_bbdd = pronosticos_prob[['location', 'date', 'kind', 'probs']]

print(pronosticos_prob_bbdd["date"].dtype)
print(pronosticos_prob_bbdd['date'][0])

registro = pronosticos_prob_bbdd[
    (pronosticos_prob_bbdd["location"] == "Rapa Nui") & (pronosticos_prob_bbdd["kind"] == 1)
].iloc[0]

fecha = registro["date"]

print("Fecha:", fecha)
print("Tipo:", type(fecha))
print("Zona horaria:", fecha.tzinfo)
print("Desplazamiento UTC:", fecha.utcoffset())
print("Formato ISO:", fecha.isoformat())

