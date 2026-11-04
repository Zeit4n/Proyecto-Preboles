from astral import LocationInfo
from datetime import date, datetime, timedelta
from astral.sun import sun
from zoneinfo import ZoneInfo

hoy = datetime.now(ZoneInfo("America/Santiago")).date()
hoy_rapa = datetime.now(ZoneInfo("Pacific/Easter")).date()
hoy_williams = datetime.now(ZoneInfo("America/Punta_Arenas")).date()

t_inicio = f"{hoy}T00:00"
t_final = f"{hoy}T23:00"

t_inicio_rapa = f"{hoy_rapa}T00:00"
t_final_rapa = f"{hoy_rapa}T23:00"

t_inicio_williams = f"{hoy_williams}T00:00"
t_final_williams = f"{hoy_williams}T23:00"

def posiciones_solares(name, lat, lon, timezone):
    loc = LocationInfo(name, "Chile", timezone, lat, lon)
    s = sun(loc.observer, date=date.today(), tzinfo=loc.timezone)
    return [s["dawn"], s["sunrise"], s["sunset"], s["dusk"]]

def hora_mas_cercana(tiempo) :
    t = datetime.strptime(tiempo, "%H:%M")

    if t.minute >= 30:
        t = t.replace(minute=0, second=0) + timedelta(hours=1)

    else:
        t = t.replace(minute=0, second=0)
    
    return t.strftime("%H:00")    