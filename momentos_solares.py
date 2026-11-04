import json
from pathlib import Path
from zoneinfo import ZoneInfo
from datetime import datetime
from calculo_momentos import posiciones_solares, hora_mas_cercana

ruta = Path(__file__).parent / "ubicaciones.json"

with open(ruta, "r", encoding="utf-8") as archivo:
    ubicaciones = json.load(archivo)

momentos = {}
for ciudad, datos in ubicaciones.items():
    
    tiempos = posiciones_solares(ciudad, datos["lat"], datos["lon"], datos["timezone"])
    # Convertir cada datetime a string "HH:MM" y encontrar hora más cercana
    #momentos[ciudad] = [t.strftime("%H:%M") for t in tiempos]
    momentos[ciudad] = [hora_mas_cercana(t.strftime("%H:%M")) for t in tiempos]
    
'''
# Guardar en JSON
ruta_salida = Path(__file__).parent / "momentos_solares.json"
with open(ruta_salida, "w", encoding="utf-8") as f:
    json.dump(momentos, f, ensure_ascii=False, indent=4)

print(f"Archivo guardado en: {ruta_salida}")
'''