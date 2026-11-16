/* ============================================================================
   timeUtils.js — cálculo del momento exacto de "sol a -2°" e interpolación
   de datos meteorológicos a ese instante
   ============================================================================
   QUÉ RESUELVE ESTE ARCHIVO
   -------------------------
   Un arrebol se evalúa cuando el sol está a 2° bajo el horizonte (más una
   pequeña corrección si el observador está en altura). SunCalc no da ese
   momento directamente — solo da amanecer/atardecer estándar (elevación
   0°, con corrección de refracción) — así que acá lo calculamos nosotros:

     1) Partimos del amanecer/atardecer que ya calcula SunCalc.
     2) Hacemos una búsqueda binaria alrededor de ese horario, moviéndonos
        hacia donde la elevación del sol se acerque a -2°.
     3) Afinamos el resultado con el método de Newton-Raphson, que converge
        mucho más rápido que seguir con binaria (unas pocas iteraciones
        alcanzan precisión de milisegundos).
     4) Una vez que tenemos el instante exacto, interpolamos linealmente
        los datos horarios de Open-Meteo (nubes, viento, humedad, etc.)
        entre la hora anterior y la siguiente, para no quedarnos con el
        valor "redondeado a la hora" de esa variable.

   Todo esto es caro de calcular (SunCalc.getPosition se llama varias
   veces por ubicación), así que hay dos cachés (timeCache / indexCache)
   que evitan repetir el cálculo si ya se pidió la misma combinación de
   coordenadas + fecha hace menos de CACHE_TTL_MS.

   EL TRUCO DE "MEDIODÍA LOCAL" (localNoonDate)
   ---------------------------------------------
   SunCalc calcula internamente en UTC. Si le pasamos "ahora mismo" tal
   cual, pasadas las 20:00 hora de Chile (UTC-4) la medianoche UTC ya
   quedó atrás y SunCalc entiende que estamos hablando del día SIGUIENTE.
   Para evitar ese salto, cada vez que trabajamos con "el día X" fijamos
   la hora a las 12:00 del mediodía de ese día antes de dársela a SunCalc
   — a mediodía nunca hay ambigüedad de a qué día UTC corresponde.

   API PÚBLICA (global.timeUtils) — no se tocaron estos nombres para no
   romper al resto de la app, que ya los llama así.
   ============================================================================ */
(function(global) {
    'use strict';

    // ================================
    // CACHÉS — evitan recalcular lo mismo dos veces
    // ================================
    const timeCache = new Map();      // clave: lat+lon+día+tipo → instante "-2°" ya calculado
    const indexCache = new Map();     // clave: lat+lon+día+tipo → índice en el arreglo horario
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos de validez

    // ================================
    // ESTADO GLOBAL: qué día se está consultando
    // (la app permite mirar "hoy", "mañana", etc. — esto guarda cuál)
    // ================================
    function getQueryDate() {
        return global.PrebolesQueryDate || new Date();
    }

    function setQueryDate(date) {
        global.PrebolesQueryDate = localNoonDate(date);
        return global.PrebolesQueryDate;
    }

    function resetQueryDateToToday() {
        setQueryDayOffset(0);
        return setQueryDate(new Date());
    }

    // Offset en días respecto de hoy (0 = hoy, 1 = mañana...). Se usa para
    // ubicar el bloque de 24 horas correcto dentro del arreglo horario de
    // Open-Meteo sin tener que comparar fechas con zona horaria de por medio.
    function setQueryDayOffset(offset) {
        global.PrebolesQueryDayOffset = offset;
    }

    function getQueryDayOffset() {
        return global.PrebolesQueryDayOffset ?? 0;
    }

    global.PrebolesQueryDate = null;
    global.PrebolesQueryDayOffset = 0;
    resetQueryDateToToday();

    // Fija la hora al mediodía local — ver explicación arriba sobre por
    // qué esto evita el salto de día de SunCalc.
    function localNoonDate(date = new Date()) {
        const noon = new Date(date);
        noon.setHours(12, 0, 0, 0);
        return noon;
    }

    function isSameLocalDay(dateA, dateB) {
        return dateA.getFullYear() === dateB.getFullYear() &&
               dateA.getMonth() === dateB.getMonth() &&
               dateA.getDate() === dateB.getDate();
    }

    // Interpolación lineal simple entre dos valores, según una fracción
    // de 0 (puro y1) a 1 (puro y2). Si falta uno de los dos, devuelve el
    // que sí exista en vez de romper.
    function linearInterpolate(valueBefore, valueAfter, fraction) {
        if (valueBefore == null || valueAfter == null) return valueBefore ?? valueAfter ?? null;
        return valueBefore + (valueAfter - valueBefore) * fraction;
    }

    // ================================
    // findClosestTimes — búsqueda binaria
    // Dado un arreglo de horas (strings ISO) y un instante objetivo,
    // encuentra la hora inmediatamente anterior y la inmediatamente
    // posterior. Usa búsqueda binaria (O(log n)) en vez de recorrer todo
    // el arreglo, porque esto se llama muy seguido.
    // ================================
    function findClosestTimes(hourlyTimes, targetTime) {
        if (!hourlyTimes || hourlyTimes.length === 0) {
            return { prevTime: null, nextTime: null, prevIndex: -1, nextIndex: -1 };
        }

        const targetMs = targetTime.getTime();

        // Convertimos las horas a milisegundos una sola vez y lo guardamos
        // pegado al mismo arreglo, para no repetir la conversión si se
        // vuelve a buscar sobre el mismo arreglo de horas más adelante.
        const timesInMs = hourlyTimes._timestampCache || hourlyTimes.map(t => new Date(t).getTime());
        if (!hourlyTimes._timestampCache) hourlyTimes._timestampCache = timesInMs;

        let left = 0;
        let right = timesInMs.length - 1;
        let prevIndex = -1;
        let nextIndex = -1;

        while (left <= right) {
            const middle = Math.floor((left + right) / 2);
            if (timesInMs[middle] <= targetMs) {
                prevIndex = middle;
                left = middle + 1;
            }
            if (timesInMs[middle] >= targetMs) {
                nextIndex = middle;
                right = middle - 1;
            }
        }

        // Casos borde: el objetivo cae antes de la primera hora o después
        // de la última — nos quedamos con el extremo disponible.
        if (prevIndex === -1 && nextIndex > 0) prevIndex = nextIndex;
        if (nextIndex === -1 && prevIndex < timesInMs.length - 1) nextIndex = prevIndex + 1;
        else if (nextIndex === -1) nextIndex = prevIndex;

        // Si por algún motivo prev y next quedaron iguales, forzamos que
        // sean horas distintas para poder interpolar entre dos puntos.
        if (prevIndex === nextIndex) {
            if (prevIndex > 0) prevIndex--;
            else if (nextIndex < timesInMs.length - 1) nextIndex++;
        }

        return {
            prevTime: prevIndex >= 0 ? new Date(hourlyTimes[prevIndex]) : null,
            nextTime: nextIndex >= 0 ? new Date(hourlyTimes[nextIndex]) : null,
            prevIndex,
            nextIndex
        };
    }

    // ================================
    // interpolateMeteoData
    // Toma los datos horarios completos (meteoData.cloudSeries) y calcula
    // el valor interpolado de cada variable exactamente en targetTime,
    // en vez de quedarse con el valor de la hora más cercana.
    // ================================
    function interpolateMeteoData(meteoData, targetTime) {
        if (!meteoData?.cloudSeries?.time || meteoData.cloudSeries.time.length < 2) return null;

        const { prevTime, nextTime, prevIndex, nextIndex } =
            findClosestTimes(meteoData.cloudSeries.time, targetTime);

        if (!prevTime || !nextTime || prevIndex === -1 || nextIndex === -1) return null;

        const prevMs = prevTime.getTime();
        const nextMs = nextTime.getTime();
        const targetMs = targetTime.getTime();
        // Qué tan cerca está el objetivo de la hora siguiente (0 = justo
        // en prevTime, 1 = justo en nextTime).
        const fraction = nextMs > prevMs
            ? Math.max(0, Math.min(1, (targetMs - prevMs) / (nextMs - prevMs)))
            : 0;

        // Interpolación de un campo puntual del arreglo horario. Si al
        // valor siguiente le falta el dato, repite el anterior en vez de
        // romper la interpolación.
        function interpolateField(hourlyArray) {
            if (!hourlyArray || hourlyArray.length === 0) return null;
            const valueBefore = hourlyArray[prevIndex] ?? 0;
            const valueAfter = hourlyArray[nextIndex] ?? valueBefore;
            return valueBefore + (valueAfter - valueBefore) * fraction;
        }

        const series = meteoData.cloudSeries;
        return {
            time: targetTime,
            // Nubosidad
            low: interpolateField(series.cloudcover_low),
            mid: interpolateField(series.cloudcover_mid),
            high: interpolateField(series.cloudcover_high),
            total: interpolateField(series.cloudcover),
            // Meteorología de superficie
            temperature: interpolateField(series.temperature_2m),
            humidity: interpolateField(series.relativehumidity_2m),
            pressure: interpolateField(series.pressure_msl),
            dewpoint: interpolateField(series.dewpoint_2m),
            // Viento por capas de altura (asociadas a cada capa de nubes)
            wind300: interpolateField(series.windspeed_300hPa),
            wind500: interpolateField(series.windspeed_500hPa),
            wind850: interpolateField(series.windspeed_850hPa),
            // Irradiancia solar en superficie
            shortwave: interpolateField(series.shortwave_radiation),
            // Info de depuración: entre qué horas se interpoló y con qué fracción
            _debug: {
                prevIndex, nextIndex,
                fraction: Math.round(fraction * 1000) / 1000,
                prevTime: prevTime.toLocaleTimeString('es-CL'),
                nextTime: nextTime.toLocaleTimeString('es-CL'),
                targetTime: targetTime.toLocaleTimeString('es-CL')
            }
        };
    }

    // ================================
    // refineWithNewton — método de Newton-Raphson
    // Recibe un instante aproximado (de la búsqueda binaria) y lo afina
    // hasta que la elevación del sol coincide con targetElevation con
    // precisión de milisegundos. Converge muy rápido: normalmente entre
    // 3 y 5 iteraciones alcanzan submilisegundo, por eso el límite de
    // iteraciones es bajo.
    // ================================
    function refineWithNewton(approximateTimeMs, lat, lon, targetElevation) {
        const cursor = new Date(approximateTimeMs);
        const PRECISION_MS = 50;       // dejamos de afinar bajo esta precisión
        const DERIVATIVE_STEP_MS = 60000; // 1 minuto, para estimar qué tan rápido cambia la elevación
        const MAX_ITERATIONS = 5;

        let time = approximateTimeMs;
        let iteration = 0;

        while (iteration < MAX_ITERATIONS) {
            // Elevación del sol en el instante actual
            cursor.setTime(time);
            const elevationNow = SunCalc.getPosition(cursor, lat, lon).altitude;

            // Elevación un minuto después, para estimar la "velocidad"
            // angular del sol (derivada) en grados por milisegundo
            cursor.setTime(time + DERIVATIVE_STEP_MS);
            const elevationAfterStep = SunCalc.getPosition(cursor, lat, lon).altitude;
            const degreesPerMs = (elevationAfterStep - elevationNow) / DERIVATIVE_STEP_MS;

            if (Math.abs(degreesPerMs) < 1e-10) break; // el sol casi no se mueve acá; evitar dividir por ~0

            // Paso de Newton: cuánto hay que mover el tiempo para cerrar
            // la diferencia entre la elevación actual y la buscada
            const adjustmentMs = (targetElevation - elevationNow) / degreesPerMs;
            time += adjustmentMs;

            if (Math.abs(adjustmentMs) < PRECISION_MS) break; // ya convergió

            iteration++;
        }

        cursor.setTime(Math.max(time, 0));
        return cursor;
    }

    // ================================
    // calculateTimeToMinus2Degrees
    // Función principal: devuelve el instante exacto en que el sol está
    // a -2° (más la corrección "dip" por altura) para una ubicación,
    // fecha y tipo de evento (amanecer o atardecer) dados.
    //
    // Estrategia: 8 pasos de búsqueda binaria para acercarse rápido,
    // seguidos de refineWithNewton para la precisión final. Todo el
    // resultado se cachea por CACHE_TTL_MS.
    // ================================
    function calculateTimeToMinus2Degrees(lat, lon, isSunrise = false, altitude = 0, targetDate = getQueryDate()) {
        const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)},${isSunrise},${altitude},${targetDate.toDateString()}`;
        const cached = timeCache.get(cacheKey);
        if (cached) {
            if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
                return new Date(cached.time);
            }
            timeCache.delete(cacheKey);
        }

        const noonThatDay = localNoonDate(targetDate);
        const sunTimes = SunCalc.getTimes(noonThatDay, lat, lon);

        // "Dip": cuánto más bajo hay que mirar el horizonte cuando el
        // observador está en altura (el horizonte se aleja con la altura).
        // Fórmula estándar: dip(°) ≈ 0.0293·√altura(m)
        const dip = 0.0293 * Math.sqrt(Math.max(0, altitude || 0));
        const targetElevation = -(2 + dip);

        // Ventana de búsqueda alrededor del amanecer/atardecer estándar.
        // El sol se mueve ~0.25°/minuto, así que para cubrir 2° bastan
        // ~8 minutos; usamos 12 de margen para no quedarnos cortos.
        const MARGIN_MS = 12 * 60000;

        let low, high;
        if (isSunrise) {
            // Antes del amanecer estándar el sol todavía está bajo -2°;
            // buscamos en la ventana [amanecer - margen, amanecer + margen]
            low = sunTimes.sunrise.getTime() - MARGIN_MS;
            high = sunTimes.sunrise.getTime() + MARGIN_MS;
        } else {
            // Para el atardecer, -2° ocurre DESPUÉS del atardecer estándar,
            // así que la ventana se extiende hacia adelante (24 min)
            low = sunTimes.sunset.getTime();
            high = sunTimes.sunset.getTime() + MARGIN_MS * 2;
        }

        const cursor = new Date();
        let midMs;
        let elevationAtMid;

        for (let i = 0; i < 8; i++) {
            midMs = (low + high) / 2;
            cursor.setTime(midMs);
            elevationAtMid = SunCalc.getPosition(cursor, lat, lon).altitude;

            // Ya estamos lo bastante cerca: afinamos con Newton y listo
            if (Math.abs(elevationAtMid - targetElevation) < 0.005) {
                const result = refineWithNewton(midMs, lat, lon, targetElevation);
                timeCache.set(cacheKey, { time: result.getTime(), timestamp: Date.now() });
                return result;
            }

            // Movemos el extremo de la ventana según hacia dónde haya que
            // seguir buscando (el sol sube en el amanecer, baja en el atardecer)
            const needToSearchLater = (isSunrise && elevationAtMid < targetElevation) ||
                                       (!isSunrise && elevationAtMid > targetElevation);
            if (needToSearchLater) low = midMs;
            else high = midMs;
        }

        // Si las 8 iteraciones no cerraron por debajo del umbral, afinamos
        // igual desde el punto medio final — Newton converge solo.
        const finalResult = refineWithNewton((low + high) / 2, lat, lon, targetElevation);
        timeCache.set(cacheKey, { time: finalResult.getTime(), timestamp: Date.now() });
        return finalResult;
    }

    // ================================
    // getSunsetDataWithInterpolation
    // Junta las dos funciones de arriba: calcula el instante -2° y
    // devuelve los datos meteorológicos ya interpolados a ese instante.
    // El nombre quedó de cuando solo servía para atardecer; ahora sirve
    // para ambos casos según isSunrise.
    // ================================
    function getSunsetDataWithInterpolation(meteoData, lat, lon, isSunrise = false, altitude = 0, targetDate = getQueryDate()) {
        if (!meteoData?.cloudSeries) return null;

        const optimalTime = calculateTimeToMinus2Degrees(lat, lon, isSunrise, altitude, targetDate);
        const interpolatedData = interpolateMeteoData(meteoData, optimalTime);

        if (!interpolatedData) return null;

        // Log solo si el modo debug está activo — evita ensuciar la
        // consola (y el costo de armar el objeto de log) en producción.
        if (global.DEBUG_MODE) {
            console.log(`✓ ${isSunrise ? 'Amanecer' : 'Atardecer'} interpolado para ${optimalTime.toLocaleTimeString('es-CL')}:`, {
                horaAnterior: interpolatedData._debug.prevTime,
                horaSiguiente: interpolatedData._debug.nextTime,
                fraccion: interpolatedData._debug.fraction,
                nubesBajas: Math.round(interpolatedData.low),
                nubesMedias: Math.round(interpolatedData.mid),
                nubesAltas: Math.round(interpolatedData.high)
            });
        }

        return {
            data: interpolatedData,
            optimalTime: optimalTime,
            elevDeg: SunCalc.getPosition(optimalTime, lat, lon).altitude
        };
    }

    // ================================
    // getSunsetIndex
    // Encuentra el índice, dentro del arreglo horario de Open-Meteo, que
    // corresponde a la hora "redonda" del amanecer/atardecer (sin
    // interpolar) — lo usan partes de la UI que solo necesitan un índice,
    // no el valor interpolado exacto.
    // ================================
    function getSunsetIndex(meteoData, lat, lon, isSunrise = false, targetDate = getQueryDate()) {
        if (!meteoData?.cloudSeries?.time || meteoData.cloudSeries.time.length === 0) {
            return isSunrise ? 6 : 18; // valores por defecto razonables si no hay datos
        }

        const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)},${isSunrise},${targetDate.toDateString()}`;
        if (indexCache.has(cacheKey)) {
            return indexCache.get(cacheKey);
        }

        const noonThatDay = localNoonDate(targetDate);
        const sunTimes = SunCalc.getTimes(noonThatDay, lat, lon);
        const targetTime = isSunrise ? sunTimes.sunrise : sunTimes.sunset;

        const hourlyTimes = meteoData.cloudSeries.time;
        const targetHour = targetTime.getHours();
        const targetDateStr = targetTime.toISOString().slice(0, 10);

        // Primero intentamos encontrar la hora exacta (mismo día y misma hora)
        let result = -1;
        for (let i = 0; i < hourlyTimes.length; i++) {
            if (hourlyTimes[i].startsWith(targetDateStr) && parseInt(hourlyTimes[i].slice(11, 13)) === targetHour) {
                result = i;
                break;
            }
        }

        // Si no hay coincidencia exacta, nos quedamos con la hora más cercana
        if (result === -1) {
            const targetMs = targetTime.getTime();
            let closestIndex = isSunrise ? 6 : 18;
            let smallestDiff = Infinity;

            for (let i = 0; i < hourlyTimes.length; i++) {
                const diff = Math.abs(new Date(hourlyTimes[i]).getTime() - targetMs);
                if (diff < smallestDiff) {
                    smallestDiff = diff;
                    closestIndex = i;
                }
            }
            result = closestIndex;
        }

        indexCache.set(cacheKey, result);
        return result;
    }

    // ================================
    // getDayStartIndex
    // Índice del arreglo horario que corresponde a las 00:00 del día
    // consultado. Preferimos el offset en días (0=hoy, 1=mañana...)
    // porque Open-Meteo entrega bloques de exactamente 24 horas por día,
    // así que "día N" siempre empieza en el índice N*24 — sin tener que
    // andar comparando fechas y arriesgarse a líos de zona horaria.
    // ================================
    function getDayStartIndex(meteoData, offsetOrDate = getQueryDayOffset()) {
        if (!meteoData?.cloudSeries?.time || meteoData.cloudSeries.time.length === 0) return 0;

        const hourlyTimes = meteoData.cloudSeries.time;

        // Camino rápido: nos pasaron un offset en días
        if (typeof offsetOrDate === 'number') {
            const index = offsetOrDate * 24;
            return index < hourlyTimes.length ? index : 0;
        }

        // Camino antiguo: nos pasaron una fecha concreta (se mantiene por
        // compatibilidad con código que todavía llama así a esta función)
        const targetDate = offsetOrDate;
        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const wantedExact = `${year}-${month}-${day}T00:00`;
        const wantedPrefix = `${year}-${month}-${day}`;

        const exactIndex = hourlyTimes.indexOf(wantedExact);
        if (exactIndex !== -1) return exactIndex;

        const prefixIndex = hourlyTimes.findIndex(h => h.startsWith(wantedPrefix));
        return prefixIndex !== -1 ? prefixIndex : 0;
    }

    // ================================
    // getDataAtIndex
    // Extrae todos los campos meteorológicos de un índice puntual del
    // arreglo horario — el equivalente "sin interpolar" de interpolateMeteoData.
    // ================================
    function getDataAtIndex(meteoData, index) {
        if (!meteoData?.cloudSeries || index < 0 || index >= meteoData.cloudSeries.time?.length) return null;

        const series = meteoData.cloudSeries;
        return {
            time: series.time[index],
            // Nubosidad
            low: series.cloudcover_low?.[index] ?? null,
            mid: series.cloudcover_mid?.[index] ?? null,
            high: series.cloudcover_high?.[index] ?? null,
            total: series.cloudcover?.[index] ?? null,
            // Meteorología de superficie
            temperature: series.temperature_2m?.[index] ?? null,
            humidity: series.relativehumidity_2m?.[index] ?? null,
            pressure: series.pressure_msl?.[index] ?? null,
            dewpoint: series.dewpoint_2m?.[index] ?? null,
            // Viento por capas
            wind300: series.windspeed_300hPa?.[index] ?? null,
            wind500: series.windspeed_500hPa?.[index] ?? null,
            wind850: series.windspeed_850hPa?.[index] ?? null,
            // Irradiancia solar
            shortwave: series.shortwave_radiation?.[index] ?? null
        };
    }

    function clearTimeCache() {
        timeCache.clear();
        indexCache.clear();
    }

    // ================================
    // API pública — mismos nombres que antes, para no romper el resto
    // de la app que ya llama global.timeUtils.xxx
    // ================================
    global.timeUtils = {
        linearInterpolate,
        findClosestTimes,
        interpolateMeteoData,
        getSunsetDataWithInterpolation,
        calculateTimeToMinus2Degrees,
        refineWithNewton,
        getSunsetIndex,
        getDayStartIndex,
        getDataAtIndex,

        localNoonDate,
        isSameLocalDay,

        getQueryDate,
        setQueryDate,
        resetQueryDateToToday,
        getQueryDayOffset,
        setQueryDayOffset,

        clearTimeCache
    };

    global.DEBUG_MODE = false;

})(window);