import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, types
from pronosticos_prob import pronosticos_prob_bbdd

load_dotenv()

db_user = os.getenv("DB_USER")
db_password = os.getenv("DB_PASSWORD")

# Conexión a PostgreSQL
try:
    engine = create_engine(
            f"postgresql+psycopg2://{db_user}:{db_password}@localhost:5432/preboles"
    )

    pronosticos_prob_bbdd.to_sql(
        "pronosticos",
        engine,
        if_exists="replace",
        index=False,
        dtype={
            "date": types.DateTime(timezone=True)
        }
    )

except Exception as e:
    print(f"Error al conectar a la base de datos: {e}")



