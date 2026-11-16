/* ============================================================================
   openMeteoClient.js — cliente de Open-Meteo, autocontenido
   ============================================================================
   Este archivo no depende de nada externo: trae su propio log (usa el
   log() global de la página si existe, o console.log si no) y su propio
   dato por defecto. Se puede copiar a otro proyecto y funciona solo.

   ----------------------------------------------------------------------
   CÓMO EVITAMOS SOBRECARGAR A OPEN-METEO (lee esto si vas a tocar el archivo)
   ----------------------------------------------------------------------
   Open-Meteo empieza a devolver error 429 ("too many requests") cuando
   Préboles pide el clima de muchas ciudades seguidas. Este archivo ataca
   ese problema en CUATRO frentes distintos:

     1) CACHÉ (cache / CACHE_DURATION_MS)
        Una vez que pedimos el clima de una coordenada, lo guardamos por
        20 minutos. Mientras el dato siga "fresco", ni getMeteoData ni
        getMeteoDataBatch vuelven a golpear la red para esa coordenada.

     2) DEDUPLICACIÓN DE PEDIDOS EN VUELO (pendingRequests)
        Si dos tarjetas de la interfaz piden el clima de la misma ciudad
        casi al mismo tiempo, la segunda NO abre una request nueva: espera
        el resultado de la primera. Sin esto, cada refresco de pantalla
        podía disparar el doble (o más) de peticiones necesarias.

     3) LOTES EN UNA SOLA PETICIÓN (getMeteoDataBatch)
        Open-Meteo permite pedir varias coordenadas separadas por coma en
        una sola llamada HTTP. En vez de hacer 80 peticiones para 80
        ciudades, hacemos 1 (o unas pocas, si son más de
        MAX_LOCATIONS_PER_REQUEST). Esto es, con diferencia, lo que más
        alivia la carga sobre la API.

     4) REINTENTO CON ESPERA CRECIENTE ANTE 429 (fetchWithRetry)
        Si aun así Open-Meteo responde 429, no reintentamos al toque:
        esperamos, y cada intento fallido espera más que el anterior
        (medio segundo, un segundo, dos segundos...), respetando el
        header "Retry-After" si el servidor lo manda. Esto evita que
        Préboles insista y empeore la sobrecarga que ya está ocurriendo.

     Además, entre un lote y el siguiente (cuando hay más de
     MAX_LOCATIONS_PER_REQUEST ciudades) metemos una pausa fija de 300ms
     (ver PAUSE_BETWEEN_BATCHES_MS) para no disparar los lotes espalda
     con espalda.

   ----------------------------------------------------------------------
   QUÉ EXPONE
   ----------------------------------------------------------------------
     - getMeteoData(lat, lon)        → clima de una ubicación
     - getMeteoDataBatch(locations)  → clima de varias ubicaciones a la vez
     - getFallbackData()             → los datos "por defecto" cuando algo falla

   Se exponen de dos formas, para no romper código viejo que ya las llama
   como globales sueltas, y para quien prefiera un estilo más ordenado:
     window.getMeteoData(...)
     window.OpenMeteoClient.getMeteoData(...)
   ============================================================================ */
(function () {
  'use strict';

  // --- Configuración ---------------------------------------------------

  // Cuántas coordenadas mandamos como máximo en una sola petición HTTP.
  const MAX_LOCATIONS_PER_REQUEST = 80;

  // Pausa entre un lote y el siguiente, cuando hay que trocear en varios
  // lotes (más ubicaciones que MAX_LOCATIONS_PER_REQUEST).
  const PAUSE_BETWEEN_BATCHES_MS = 300;

  // Cuánto tiempo consideramos "fresco" un dato ya pedido antes de volver a consultarlo
  const CACHE_DURATION_MS = 20 * 60 * 1000; // 20 minutos

  // Variables horarias que pedimos a Open-Meteo.
  const WEATHER_VARIABLES = [
    'cloudcover', 'cloudcover_low', 'cloudcover_mid', 'cloudcover_high',
    'pressure_msl', 'relativehumidity_2m', 'temperature_2m', 'dewpoint_2m',
    'windspeed_10m', 'winddirection_10m',
    'windspeed_300hPa', 'windspeed_500hPa', 'windspeed_850hPa',
    'shortwave_radiation', 'direct_radiation', 'diffuse_radiation',
    'visibility', 'freezing_level_height'
  ].join(',');

  // --- Estado interno ----------------------------------------------------
  const cache = {};            // coordenada → { data, timestamp }
  const pendingRequests = {};  // coordenada → promesa en curso (evita pedidos duplicados)

  // --- Utilidades pequeñas -------------------------------------------

  // Escribe en el panel de "registro" de la página si existe esa función
  // global; si no, cae a la consola del navegador. Así la librería
  // funciona igual de bien en cualquier página, tenga o no ese panel.
  function log(message) {
    if (typeof window.log === 'function') window.log(message);
    else console.log(message);
  }

  // Datos de fallback
  function getFallbackData() {
    return {
      cloudSeries: null,
      current: {
        pressure: 1013, humidity: 50, temperature: 20, dewpoint: 10,
        shortwave: null, wind10m: null, windDir10m: null,
        windLow: null, windMid: null, windHigh: null,
        directRadiation: null, diffuseRadiation: null,
        visibility: null, freezingLevel: null,
        timestamp: new Date().toISOString()
      }
    };
  }

  // pastDays (0–3): días previos que se piden además del pronóstico.
  function normalizePastDays(pastDays) {
    const n = Math.floor(Number(pastDays));
    return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0;
  }

  function buildCacheKey(lat, lon, pastDays = 0) {
    const suffix = pastDays > 0 ? `_p${pastDays}` : '';
    return `meteo_${lat.toFixed(2)}_${lon.toFixed(2)}${suffix}`;
  }

  function areCoordinatesValid(lat, lon) {
    return typeof lat === 'number' && typeof lon === 'number' &&
           Number.isFinite(lat) && Number.isFinite(lon) &&
           lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function getFromCache(key) {
    const entry = cache[key];
    if (!entry) return null;
    const isExpired = Date.now() - entry.timestamp > CACHE_DURATION_MS;
    if (isExpired) {
      delete cache[key];
      return null;
    }
    return entry.data;
  }

  function saveToCache(key, data) {
    cache[key] = { data, timestamp: Date.now() };
  }

  // Convierte la respuesta de Open-Meteo (arreglos hora por hora)
  // en el objeto "current" que usa el resto de la app
  function parseWeatherResponse(response) {
    if (!response || typeof response !== 'object' || !response.hourly || !response.hourly.time) {
      return getFallbackData();
    }

    // Tener en consideración: como pedimos timezone=auto, Open-Meteo devuelve
    // hourly.time en la hora LOCAL de esa ubicación, no en UTC. Por eso
    // hay que correr "ahora" por el mismo offset antes de comparar; si
    // se compara contra la hora UTC del navegador directamente, la
    // búsqueda de abajo falla para cualquier huso horario distinto de 0
    // y siempre termina en el fallback, sin ningún error visible.
    const utcOffsetMs = (response.utc_offset_seconds ?? 0) * 1000;
    const currentLocalHour = new Date(Date.now() + utcOffsetMs).toISOString().slice(0, 13);
    const hourIndex = response.hourly.time.findIndex(t => t.startsWith(currentLocalHour));

    if (hourIndex < 0) {
      return { cloudSeries: response.hourly, current: getFallbackData().current };
    }

    const hourly = response.hourly;
    const current = {
      pressure:         hourly.pressure_msl?.[hourIndex]         ?? 1013,
      humidity:         hourly.relativehumidity_2m?.[hourIndex]  ?? 50,
      temperature:      hourly.temperature_2m?.[hourIndex]       ?? 20,
      dewpoint:         hourly.dewpoint_2m?.[hourIndex]          ?? 10,
      shortwave:        hourly.shortwave_radiation?.[hourIndex]  ?? null,
      wind10m:          hourly.windspeed_10m?.[hourIndex]        ?? null,
      windDir10m:       hourly.winddirection_10m?.[hourIndex]    ?? null,
      windLow:          hourly.windspeed_850hPa?.[hourIndex]     ?? null,
      windMid:          hourly.windspeed_500hPa?.[hourIndex]     ?? null,
      windHigh:         hourly.windspeed_300hPa?.[hourIndex]     ?? null,
      directRadiation:  hourly.direct_radiation?.[hourIndex]     ?? null,
      diffuseRadiation: hourly.diffuse_radiation?.[hourIndex]    ?? null,
      visibility:       hourly.visibility?.[hourIndex]           ?? null,
      freezingLevel:    hourly.freezing_level_height?.[hourIndex] ?? null,
      timestamp: hourly.time[hourIndex]
    };

    return { cloudSeries: hourly, current };
  }

  // fetch() con reintento ante error 429 ("demasiadas peticiones"). Cada
  // reintento espera más que el anterior (backoff exponencial)
  async function fetchWithRetry(url, maxRetries = 3) {
    let attempt = 0;
    while (true) {
      const response = await fetch(url);
      if (response.status !== 429) return response;

      attempt++;
      if (attempt > maxRetries) return response;

      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
      const serverSuggestedMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? Math.min(retryAfterSeconds * 1000, 30000)
        : null;
      const waitMs = serverSuggestedMs ?? Math.min(8000, 500 * Math.pow(2, attempt));

      log(`⏳ 429 de Open-Meteo, reintentando en ${(waitMs / 1000).toFixed(1)}s (intento ${attempt}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  // --- Funciones públicas ----------------------------------------------
  async function getMeteoData(lat, lon, pastDays = 0) {
    if (!areCoordinatesValid(lat, lon)) {
      console.warn('Coordenadas inválidas');
      return getFallbackData();
    }

    pastDays = normalizePastDays(pastDays);
    const pastParam = pastDays > 0 ? `&past_days=${pastDays}` : '';
    const key = buildCacheKey(lat, lon, pastDays);

    const cached = getFromCache(key);
    if (cached) return cached;

    // Si ya hay una petición en curso para esta misma coordenada, nos
    // enganchamos a esa en vez de abrir una nueva.
    if (pendingRequests[key]) return pendingRequests[key];

    pendingRequests[key] = (async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${WEATHER_VARIABLES}&timezone=auto${pastParam}`;        const response = await fetchWithRetry(url);
        if (!response.ok) {
          console.warn(`Open-Meteo respondió con error: ${response.status}`);
          return getFallbackData();
        }
        const result = parseWeatherResponse(await response.json());
        saveToCache(key, result);
        return result;
      } catch (error) {
        console.warn('Error obteniendo datos meteorológicos:', error);
        return getFallbackData();
      } finally {
        delete pendingRequests[key];
      }
    })();

    return pendingRequests[key];
  }

  // Pide el clima de VARIAS ubicaciones de una sola vez: es la forma más
  // efectiva de no sobrecargar a Open-Meteo, porque reemplaza decenas de
  // peticiones individuales por una sola (o unas pocas, si hay más de
  // MAX_LOCATIONS_PER_REQUEST ubicaciones).
  async function getMeteoDataBatch(locations, pastDays = 0) {
    pastDays = normalizePastDays(pastDays);
    const pastParam = pastDays > 0 ? `&past_days=${pastDays}` : '';
    // Ignoramos las ubicaciones que ya tenemos en caché o que ya fueron pedidas
    const locationsToFetch = locations.filter(({ lat, lon }) => {
      const key = buildCacheKey(lat, lon, pastDays);
      return areCoordinatesValid(lat, lon) && !getFromCache(key) && !pendingRequests[key];
    });

    if (locationsToFetch.length === 0) return true;

    let allBatchesOk = true; // pasa a false si algún lote falla o revienta

    for (let start = 0; start < locationsToFetch.length; start += MAX_LOCATIONS_PER_REQUEST) {
      const batch = locationsToFetch.slice(start, start + MAX_LOCATIONS_PER_REQUEST);
      const latitudes = batch.map(loc => loc.lat).join(',');
      const longitudes = batch.map(loc => loc.lon).join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitudes}&longitude=${longitudes}&hourly=${WEATHER_VARIABLES}&timezone=auto${pastParam}`;
      try {
        const response = await fetchWithRetry(url);
        if (!response.ok) {
          log(`⚠ Lote de clima falló (HTTP ${response.status}) para ${batch.length} ubicaciones — usarán datos por defecto`);
          allBatchesOk = false;
          continue;
        }

        const data = await response.json();
        const items = Array.isArray(data) ? data : [data];

        if (items.length !== batch.length) {
          log(`⚠ Lote desalineado: se pidieron ${batch.length} ubicaciones y llegaron ${items.length} — se descarta el lote`);
          allBatchesOk = false;
          continue;
        }

        let savedCount = 0;
        items.forEach((item, index) => {
          const location = batch[index];
          if (!item?.hourly?.time) return; // esta ubicación puntual vino sin datos; se resuelve sola después vía getMeteoData
          saveToCache(buildCacheKey(location.lat, location.lon, pastDays), parseWeatherResponse(item));          savedCount++;
        });

        // No marcamos todo el lote como fallido por esto: las que faltan se piden solas más adelante.
        if (savedCount < items.length) {
          log(`⚠ ${items.length - savedCount} de ${items.length} ubicaciones del lote vinieron sin datos horarios`);
        }

        log(`✓ Lote de clima OK: ${savedCount} ubicaciones en 1 sola petición`);
      } catch (error) {
        log(`⚠ Error en lote de clima: ${error.message}`);
        allBatchesOk = false;
      }

      // Pausa entre lotes consecutivos, para no dispararlos uno pegado
      // al otro cuando hay más ubicaciones de las que caben en un lote.
      const isLastBatch = start + MAX_LOCATIONS_PER_REQUEST >= locationsToFetch.length;
      if (!isLastBatch) {
        await new Promise(resolve => setTimeout(resolve, PAUSE_BETWEEN_BATCHES_MS));
      }
    }

    return allBatchesOk;
  }

  // --- Exportar ----------------------------------------------------------
  //funciones agrupadas en un namespace para quien prefiera ese estilo.
  window.getMeteoData = getMeteoData;
  window.getMeteoDataBatch = getMeteoDataBatch;
  window.getFallbackData = getFallbackData;
  window.OpenMeteoClient = { getMeteoData, getMeteoDataBatch, getFallbackData };
})();