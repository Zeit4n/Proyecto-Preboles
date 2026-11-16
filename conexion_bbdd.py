import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, types, text
from pronosticos_prob import pronosticos_prob_bbdd
import pandas as pd

load_dotenv()

db_user = os.getenv("DB_USER")
db_password = os.getenv("DB_PASSWORD")

# Conexión a PostgreSQL
try:
    engine = create_engine(
            f"postgresql+psycopg2://{db_user}:{db_password}@localhost:5432/preboles"
    )

    query_ubicaciones = text("""
        SELECT id_ubicacion, nombre
        FROM ubicaciones
    """)

    with engine.connect() as connection:
        ubicaciones_db = pd.read_sql(query_ubicaciones, connection)

    pronosticos_prob_bbdd = pronosticos_prob_bbdd.merge(
        ubicaciones_db,
        left_on = "location",
        right_on = "nombre",
        how = "left"
    )

    pronosticos_finales_bbdd = pronosticos_prob_bbdd [
        ["id_ubicacion", "date", "kind", "probs"]
    ].rename(columns ={
        "date": "fecha_hora",
        "kind": "tipo_arrebol",
        "probs": "prob"
    })

    pronosticos_finales_bbdd.to_sql(
        "pronosticos",
        engine,
        if_exists="append",
        index=False,
        dtype={
            "fecha_hora": types.DateTime(timezone=True)
        }
    )

except Exception as e:
    print(f"Error al conectar a la base de datos: {e}")



