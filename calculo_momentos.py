from astral import LocationInfo
from datetime import date, datetime, timedelta
from astral.sun import sun
from zoneinfo import ZoneInfo

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