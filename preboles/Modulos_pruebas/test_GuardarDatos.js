/* ================================================================
 * Préboles · Recolector de datos ML para etiquetado de arreboles
 * VERSIÓN MEJORADA: Guarda AMBOS eventos (sunrise Y sunset) en cada visita
 * ================================================================ */

(function(global) {
    'use strict';

    var ML_STORAGE_KEY_OLD = 'preboles_ml_data_v2';
    var ML_STORAGE_KEY     = 'preboles_ml_data_v3';
    var ML_MAX_RECORDS     = 4000;
    var ML_THRESHOLD_KEY   = 'preboles_ml_threshold_v1';
    var ML_ACTIVE_KIND_KEY = 'preboles_ml_active_kind_v1';
    var ML_MAX_AGE_DAYS    = 3;
    var SHEET_SYNC_URL     = 'https://script.google.com/macros/s/AKfycbw3hYuqXZu5GL_IA5l_a5YCWCbGXXATjEpH_JmQX3N_j0Ul0DCzy6W_u-tjUqKGbF9l/exec'; 

    var RENDER_DEBOUNCE_MS  = 200;
    var renderDebounceTimer = null;
    var isCalculating       = false;

    // Sub-pestaña activa - SOLO para UI, NO afecta qué eventos se guardan
    var activeLabelKind = (function() {
        var saved = localStorage.getItem(ML_ACTIVE_KIND_KEY);
        return saved === 'sunrise' ? 'sunrise' : 'sunset';
    })();

    function nowISO() {
        var now = new Date();
        var year = now.getFullYear();
        var month = String(now.getMonth() + 1).padStart(2, '0');
        var day = String(now.getDate()).padStart(2, '0');
        var hours = String(now.getHours()).padStart(2, '0');
        var minutes = String(now.getMinutes()).padStart(2, '0');
        var seconds = String(now.getSeconds()).padStart(2, '0');
        var ms = String(now.getMilliseconds()).padStart(3, '0');
        return year + '-' + month + '-' + day + 'T' +
            hours + ':' + minutes + ':' + seconds + '.' + ms;
    }

    function scheduleRender() {
        // Ya no renderizamos inmediatamente - solo usamos debounce
        if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
        renderDebounceTimer = setTimeout(function() {
            renderDebounceTimer = null;
            isCalculating = false;
            renderHistoryTab();
        }, RENDER_DEBOUNCE_MS);

    }
    function loadData() {
        try {
            return JSON.parse(localStorage.getItem(ML_STORAGE_KEY) || '[]');
        } catch(e) {
            console.warn('⚠ Error leyendo localStorage:', e);
            return [];
        }
    }

    function saveData(data) {
        try {
            var toSave = data.length > ML_MAX_RECORDS ? data.slice(-ML_MAX_RECORDS) : data;
            localStorage.setItem(ML_STORAGE_KEY, JSON.stringify(toSave));
            return toSave;
        } catch(e) {
            console.warn('⚠ localStorage lleno, recortando a 1000 registros…');
            var trimmed = data.slice(-1000);
            localStorage.setItem(ML_STORAGE_KEY, JSON.stringify(trimmed));
            return trimmed;
        }
    }

    // ================================
    // Migración one-shot
    // ================================
    function migrateOldDataIfNeeded() {
        try {
            if (localStorage.getItem(ML_STORAGE_KEY)) return;
            var oldRaw = localStorage.getItem(ML_STORAGE_KEY_OLD);
            if (!oldRaw) return;
            var oldData = JSON.parse(oldRaw);
            if (!oldData || !oldData.length) return;

            var migrated = [];
            oldData.forEach(function(r) {
                if (r.sunriseProb != null || (r.actualArrebolSunrise !== null && r.actualArrebolSunrise !== undefined)) {
                    migrated.push({
                        id: r.id + '-sunrise',
                        timestamp: r.timestamp, date: r.date, hour: r.hour, weekday: r.weekday,
                        locationName: r.locationName, locationType: r.locationType,
                        lat: r.lat, lon: r.lon, altitude: r.altitude,
                        kind: 'sunrise',
                        prob: r.sunriseProb ?? null, elev: r.sunriseElev ?? null, time: r.sunriseTime ?? null,
                        optimalArrebolTime: null,
                        cloudsLow: r.sunriseCloudsLow ?? null, cloudsMid: r.sunriseCloudsM ?? null,
                        cloudsHigh: r.sunriseCloudsHigh ?? null, cloudsTotal: r.sunriseCloudsTotal ?? null,
                        temperature: r.sunriseTemperature ?? null, humidity: r.sunriseHumidity ?? null,
                        pressure: r.sunrisePressure ?? null, dewpoint: r.sunriseDewpoint ?? null, irradiance: r.sunriseIrradiance ?? null,
                        directRad: r.sunriseDirectRad ?? null, diffuseRad: r.sunriseDiffuseRad ?? null,
                        wind10m: r.sunriseWind10m ?? null, windDir10m: r.sunriseWindDir10m ?? null,
                        windLow: r.sunriseWindLow ?? null, windMid: r.sunriseWindMid ?? null, windHigh: r.sunriseWindHigh ?? null,
                        visibility: r.sunriseVisibility ?? null, freezingLevel: r.sunriseFreezingLevel ?? null,
                        actualArrebol: r.actualArrebolSunrise ?? null, userRating: r.userRatingSunrise ?? null, userNotes: r.userNotesSunrise ?? null,
                        updatedAt: r.updatedAt
                    });
                }
                if (r.sunsetProb != null || (r.actualArrebol !== null && r.actualArrebol !== undefined)) {
                    migrated.push({
                        id: r.id + '-sunset',
                        timestamp: r.timestamp, date: r.date, hour: r.hour, weekday: r.weekday,
                        locationName: r.locationName, locationType: r.locationType,
                        lat: r.lat, lon: r.lon, altitude: r.altitude,
                        kind: 'sunset',
                        prob: r.sunsetProb ?? null, elev: r.sunsetElev ?? null, time: r.sunsetTime ?? null,
                        optimalArrebolTime: r.optimalArrebolTime ?? null,
                        cloudsLow: r.sunsetCloudsLow ?? null, cloudsMid: r.sunsetCloudsMid ?? null,
                        cloudsHigh: r.sunsetCloudsHigh ?? null, cloudsTotal: r.sunsetCloudsTotal ?? null,
                        temperature: r.sunsetTemperature ?? null, humidity: r.sunsetHumidity ?? null,
                        pressure: r.sunsetPressure ?? null, dewpoint: r.sunsetDewpoint ?? null, irradiance: r.sunsetIrradiance ?? null,
                        directRad: r.sunsetDirectRad ?? null, diffuseRad: r.sunsetDiffuseRad ?? null,
                        wind10m: r.sunsetWind10m ?? null, windDir10m: r.sunsetWindDir10m ?? null,
                        windLow: r.sunsetWindLow ?? null, windMid: r.sunsetWindMid ?? null, windHigh: r.sunsetWindHigh ?? null,
                        visibility: r.sunsetVisibility ?? null, freezingLevel: r.sunsetFreezingLevel ?? null,
                        actualArrebol: r.actualArrebol ?? null, userRating: r.userRating ?? null, userNotes: r.userNotes ?? null,
                        updatedAt: r.updatedAt
                    });
                }
            });

            localStorage.setItem(ML_STORAGE_KEY, JSON.stringify(migrated));
            console.log('🔄 Migración de datos: ' + oldData.length + ' registros antiguos → ' + migrated.length + ' eventos.');
        } catch (e) {
            console.warn('⚠ Error migrando datos antiguos:', e);
        }
    }

    // ================================
    // Purga automática
    // ================================
    function purgeOldRecords() {
        try {
            var data = loadData();
            if (!data.length) return;
            var cutoff = Date.now() - ML_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
            var filtered = data.filter(function(r) {
                var t = r.timestamp ? new Date(r.timestamp).getTime() : NaN;
                return isNaN(t) || t >= cutoff;
            });
            if (filtered.length !== data.length) {
                localStorage.setItem(ML_STORAGE_KEY, JSON.stringify(filtered));
                console.log('🗑️ Purga automática: ' + (data.length - filtered.length) + ' registro(s) eliminados.');
            }
        } catch (e) {
            console.warn('⚠ Error purgando registros antiguos:', e);
        }
    }

    function localDateStr(d) {
        d = d || new Date();
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function toHHMM(value) {
        if (!value) return null;
        try {
            return new Date(value).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        } catch(e) { return null; }
    }

    function optimalTimeToString(value) {
        if (!value) return null;
        if (value instanceof Date) return value.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        return String(value);
    }

    // ================================
    // Umbral de probabilidad
    // ================================
    function loadThreshold() {
        var v = localStorage.getItem(ML_THRESHOLD_KEY);
        var n = v !== null ? parseFloat(v) : 0.6;
        return isNaN(n) ? 0.6 : n;
    }

    function saveThreshold(v) {
        localStorage.setItem(ML_THRESHOLD_KEY, String(v));
    }

    window.setLabelingThreshold = function(v) {
        saveThreshold(parseFloat(v));
        renderHistoryTab();
    };

    window.setLabelKind = function(kind) {
        activeLabelKind = (kind === 'sunrise') ? 'sunrise' : 'sunset';
        localStorage.setItem(ML_ACTIVE_KIND_KEY, activeLabelKind);
        renderHistoryTab();
        if (typeof window.saveKindForAllCities === 'function') {
            window.saveKindForAllCities(activeLabelKind);
        }
    };

    function getActiveLabelKind() {
        return activeLabelKind;
    }

    // ================================
    // FUNCIÓN PRINCIPAL: Guarda AMBOS eventos
    // ================================
    function collectBothPredictions(rawSunrise, rawSunset, targetDate) {
        // targetDate: 'YYYY-MM-DD' (opcional). Sin ella, todo funciona como siempre.
        purgeOldRecords();
        var data = loadData();
        var now = new Date();
        var recDate    = targetDate || localDateStr(now);
        var recWeekday = targetDate ? new Date(targetDate + 'T12:00:00').getDay() : now.getDay();
        // Con fecha pasada ninguna marca de tiempo supera '9999': nunca reutiliza registros de hoy.
        var sixHoursAgo = targetDate ? '9999-12-31' : new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
        var saved = [];
        
        // === FUNCIÓN INTERNA PARA CREAR/ACTUALIZAR REGISTRO ===
        function createOrUpdate(raw) {
            if (!raw) return null;
            var kind = raw.kind === 'sunrise' ? 'sunrise' : 'sunset';
            
            // Buscar si ya existe
            var existingIndex = -1;

            // Fecha pasada: si ya existe ese ciudad/evento/fecha, se respeta tal cual
            // (no se pisan sus datos ni su etiqueta).
            if (targetDate) {
                for (var j = data.length - 1; j >= 0; j--) {
                    if (data[j].locationName === (raw.locationName || null) &&
                        data[j].kind === kind && data[j].date === targetDate) {
                        return data[j];
                    }
                }
            }            for (var i = data.length - 1; i >= 0; i--) {
                if (data[i].locationName === (raw.locationName || null) && 
                    data[i].kind === kind && 
                    data[i].timestamp > sixHoursAgo) {
                    existingIndex = i;
                    break;
                }
            }
            
            var record;
            if (existingIndex >= 0) {
                // ACTUALIZAR EXISTENTE
                record = data[existingIndex];
                record.prob = raw.prob != null ? raw.prob : record.prob;
                record.elev = raw.elev != null ? raw.elev : record.elev;
                record.time = toHHMM(raw.time);
                record.optimalArrebolTime = optimalTimeToString(raw.optimalArrebolTime);
                if (raw.clouds) {
                    record.cloudsLow   = raw.clouds.low   || 0;
                    record.cloudsMid   = raw.clouds.mid   || 0;
                    record.cloudsHigh  = raw.clouds.high  || 0;
                    record.cloudsTotal = raw.clouds.total || 0;
                }
                if (raw.weather) {
                    record.temperature   = raw.weather.temperature       ?? null;
                    record.humidity      = raw.weather.humidity          ?? null;
                    record.pressure      = raw.weather.pressure          ?? null;
                    record.dewpoint      = raw.weather.dewpoint          ?? null;
                    record.irradiance    = raw.weather.shortwave         ?? null;
                    record.directRad     = raw.weather.directRadiation   ?? null;
                    record.diffuseRad    = raw.weather.diffuseRadiation  ?? null;
                    record.wind10m       = raw.weather.wind10m           ?? null;
                    record.windDir10m    = raw.weather.windDir10m        ?? null;
                    record.windLow       = raw.weather.windLow           ?? null;
                    record.windMid       = raw.weather.windMid           ?? null;
                    record.windHigh      = raw.weather.windHigh          ?? null;
                    record.visibility    = raw.weather.visibility        ?? null;
                    record.freezingLevel = raw.weather.freezingLevel     ?? null;
                }
                record.updatedAt = nowISO();
                console.log('📊 Actualizado [' + record.locationName + ' · ' + kind + ']');
            } else {
                // CREAR NUEVO
                record = {
                    id: generateUUID(),
                    timestamp: now.toISOString(),
                    date: recDate,
                    hour: now.getHours(),
                    weekday: recWeekday,
                    locationName: raw.locationName || null,
                    locationType: raw.locationType || 'city',
                    lat: raw.lat != null ? raw.lat : null,
                    lon: raw.lon != null ? raw.lon : null,
                    altitude: raw.altitude != null ? raw.altitude : null,
                    kind: kind,
                    prob: raw.prob != null ? raw.prob : null,
                    elev: raw.elev != null ? raw.elev : null,
                    time: toHHMM(raw.time),
                    optimalArrebolTime: optimalTimeToString(raw.optimalArrebolTime),
                    cloudsLow:   raw.clouds ? (raw.clouds.low   || 0) : null,
                    cloudsMid:   raw.clouds ? (raw.clouds.mid   || 0) : null,
                    cloudsHigh:  raw.clouds ? (raw.clouds.high  || 0) : null,
                    cloudsTotal: raw.clouds ? (raw.clouds.total || 0) : null,
                    temperature: raw.weather ? (raw.weather.temperature ?? null) : null,
                    humidity:    raw.weather ? (raw.weather.humidity    ?? null) : null,
                    pressure:    raw.weather ? (raw.weather.pressure    ?? null) : null,
                    dewpoint:    raw.weather ? (raw.weather.dewpoint    ?? null) : null,
                    irradiance:  raw.weather ? (raw.weather.shortwave   ?? null) : null,
                    directRad:   raw.weather ? (raw.weather.directRadiation  ?? null) : null,
                    diffuseRad:  raw.weather ? (raw.weather.diffuseRadiation ?? null) : null,
                    wind10m:     raw.weather ? (raw.weather.wind10m       ?? null) : null,
                    windDir10m:  raw.weather ? (raw.weather.windDir10m    ?? null) : null,
                    windLow:     raw.weather ? (raw.weather.windLow       ?? null) : null,
                    windMid:     raw.weather ? (raw.weather.windMid       ?? null) : null,
                    windHigh:    raw.weather ? (raw.weather.windHigh      ?? null) : null,
                    visibility:  raw.weather ? (raw.weather.visibility    ?? null) : null,
                    freezingLevel: raw.weather ? (raw.weather.freezingLevel ?? null) : null,
                    actualArrebol: null,
                    userRating:    null,
                    userNotes:     null,
                    updatedAt: nowISO()
                };
                data.push(record);
                console.log('📊 Guardado [' + record.locationName + ' · ' + kind + ']');
            }
            saved.push(record);
            return record;
        }
        
        // PROCESAR AMBOS EVENTOS
        if (rawSunrise) createOrUpdate(rawSunrise);
        if (rawSunset) createOrUpdate(rawSunset);
        
        // === UNA SOLA ESCRITURA ===
        data = saveData(data);
        
        // === UNA SOLA RENDERIZACIÓN (con debounce) ===
        scheduleRender();
        
        return saved;
    }

    // ================================
    // Función individual (mantenida por compatibilidad)
    // ================================
    function collectPrediction(raw) {
        purgeOldRecords();
        var kind = raw.kind === 'sunrise' ? 'sunrise' : 'sunset';
        var data = loadData();
        var now  = new Date();
        var sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();

        var exists = data.some(function(r) {
            return r.locationName === (raw.locationName || null) && r.kind === kind && r.timestamp > sixHoursAgo;
        });

        if (exists) {
            for (var i = data.length - 1; i >= 0; i--) {
                if (data[i].locationName === (raw.locationName || null) && data[i].kind === kind && data[i].timestamp > sixHoursAgo) {
                    data[i].prob = raw.prob != null ? raw.prob : data[i].prob;
                    data[i].elev = raw.elev != null ? raw.elev : data[i].elev;
                    data[i].time = toHHMM(raw.time);
                    data[i].optimalArrebolTime = optimalTimeToString(raw.optimalArrebolTime);
                    if (raw.clouds) {
                        data[i].cloudsLow   = raw.clouds.low   || 0;
                        data[i].cloudsMid   = raw.clouds.mid   || 0;
                        data[i].cloudsHigh  = raw.clouds.high  || 0;
                        data[i].cloudsTotal = raw.clouds.total || 0;
                    }
                    if (raw.weather) {
                        data[i].temperature   = raw.weather.temperature       ?? null;
                        data[i].humidity      = raw.weather.humidity          ?? null;
                        data[i].pressure      = raw.weather.pressure          ?? null;
                        data[i].dewpoint      = raw.weather.dewpoint          ?? null;
                        data[i].irradiance    = raw.weather.shortwave         ?? null;
                        data[i].directRad     = raw.weather.directRadiation   ?? null;
                        data[i].diffuseRad    = raw.weather.diffuseRadiation  ?? null;
                        data[i].wind10m       = raw.weather.wind10m           ?? null;
                        data[i].windDir10m    = raw.weather.windDir10m        ?? null;
                        data[i].windLow       = raw.weather.windLow           ?? null;
                        data[i].windMid       = raw.weather.windMid           ?? null;
                        data[i].windHigh      = raw.weather.windHigh          ?? null;
                        data[i].visibility    = raw.weather.visibility        ?? null;
                        data[i].freezingLevel = raw.weather.freezingLevel     ?? null;
                    }
                    data[i].updatedAt = nowISO();
                    saveData(data);
                    console.log('📊 Registro actualizado [' + data[i].locationName + ' · ' + kind + ']');
                    scheduleRender();
                    return data[i];
                }
            }
        }

        var record = {
            id: generateUUID(),
            timestamp: now.toISOString(),
            date: localDateStr(now),
            hour: now.getHours(),
            weekday: now.getDay(),
            locationName: raw.locationName || null,
            locationType: raw.locationType || 'city',
            lat: raw.lat != null ? raw.lat : null,
            lon: raw.lon != null ? raw.lon : null,
            altitude: raw.altitude != null ? raw.altitude : null,
            kind: kind,
            prob: raw.prob != null ? raw.prob : null,
            elev: raw.elev != null ? raw.elev : null,
            time: toHHMM(raw.time),
            optimalArrebolTime: optimalTimeToString(raw.optimalArrebolTime),
            cloudsLow:   raw.clouds ? (raw.clouds.low   || 0) : null,
            cloudsMid:   raw.clouds ? (raw.clouds.mid   || 0) : null,
            cloudsHigh:  raw.clouds ? (raw.clouds.high  || 0) : null,
            cloudsTotal: raw.clouds ? (raw.clouds.total || 0) : null,
            temperature: raw.weather ? (raw.weather.temperature ?? null) : null,
            humidity:    raw.weather ? (raw.weather.humidity    ?? null) : null,
            pressure:    raw.weather ? (raw.weather.pressure    ?? null) : null,
            dewpoint:    raw.weather ? (raw.weather.dewpoint    ?? null) : null,
            irradiance:  raw.weather ? (raw.weather.shortwave   ?? null) : null,
            directRad:   raw.weather ? (raw.weather.directRadiation  ?? null) : null,
            diffuseRad:  raw.weather ? (raw.weather.diffuseRadiation ?? null) : null,
            wind10m:     raw.weather ? (raw.weather.wind10m       ?? null) : null,
            windDir10m:  raw.weather ? (raw.weather.windDir10m    ?? null) : null,
            windLow:     raw.weather ? (raw.weather.windLow       ?? null) : null,
            windMid:     raw.weather ? (raw.weather.windMid       ?? null) : null,
            windHigh:    raw.weather ? (raw.weather.windHigh      ?? null) : null,
            visibility:  raw.weather ? (raw.weather.visibility    ?? null) : null,
            freezingLevel: raw.weather ? (raw.weather.freezingLevel ?? null) : null,
            actualArrebol: null,
            userRating:    null,
            userNotes:     null,
            updatedAt: nowISO()
        };

        data.push(record);
        data = saveData(data);
        console.log('📊 Registro guardado [' + record.locationName + ' · ' + kind + '] id=' + record.id);
        scheduleRender();
        return record;
    }

    // ================================
    // Etiquetar un registro
    // ================================
    function updateLabel(id, actualArrebol, userRating, userNotes) {
        var data  = loadData();
        var found = false;
        for (var i = 0; i < data.length; i++) {
            if (data[i].id === id) {
                data[i].actualArrebol = actualArrebol;
                data[i].userRating    = userRating != null ? userRating : null;
                data[i].userNotes     = userNotes  != null ? userNotes  : null;
                data[i].updatedAt = nowISO();
                found = true;
                break;
            }
        }
        if (found) { saveData(data); renderHistoryTab(); }
        return found;
    }

    // ================================
    // Getters
    // ================================
    function getAllData()  { return loadData(); }
    function getCount()   { return loadData().length; }
    function getLast(n)   { var d = loadData(); return d.slice(-(n || 10)).reverse(); }
    function clearAll()   { localStorage.removeItem(ML_STORAGE_KEY); }

    function getStats() {
        var data = loadData();
        if (!data.length) return null;
        var sumProb = 0, labeled = 0, byKind = {}, byType = {}, names = {};
        data.forEach(function(r) {
            sumProb += r.prob || 0;
            if (r.actualArrebol !== null && r.actualArrebol !== undefined) labeled++;
            byKind[r.kind] = (byKind[r.kind] || 0) + 1;
            byType[r.locationType] = (byType[r.locationType] || 0) + 1;
            names[r.locationName] = true;
        });
        return {
            total: data.length,
            labeled: labeled,
            byKind: byKind,
            unique: Object.keys(names).length,
            byType: byType,
            avgProb: (sumProb / data.length).toFixed(3),
            firstDate: data[0] ? data[0].date : null,
            lastDate: data[data.length - 1] ? data[data.length - 1].date : null
        };
    }

    // ================================
    // Descarga de archivo
    // ================================
    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a   = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
            URL.revokeObjectURL(url);
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 1000);
    }

    var CSV_COLS = [
        'id','timestamp','date','hour','weekday','kind',
        'locationName','locationType','lat','lon','altitude',
        'prob','elev','time','optimalArrebolTime',
        'cloudsLow','cloudsMid','cloudsHigh','cloudsTotal',
        'temperature','humidity','pressure','dewpoint','irradiance',
        'directRad','diffuseRad',
        'wind10m','windDir10m','windLow','windMid','windHigh',
        'visibility','freezingLevel',
        'actualArrebol','userRating','userNotes','updatedAt'
    ];

    function escapeCSV(v) {
        if (v === null || v === undefined) return '';
        var s = String(v);
        if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1)
            return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function exportCSV() {
        var data = loadData();
        if (!data.length) { alert('No hay datos para exportar.'); return; }
        var rows = [CSV_COLS.join(',')];
        for (var i = 0; i < data.length; i++) {
            rows.push(CSV_COLS.map(function(c) { return escapeCSV(data[i][c]); }).join(','));
        }
        downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' }),
            'preboles_historial_' + new Date().toISOString().slice(0,10) + '.csv');
    }

    function exportJSON() {
        var data = loadData();
        if (!data.length) { alert('No hay datos para exportar.'); return; }
        var payload = {
            meta: { exported: new Date().toISOString(), total: data.length,
                    schema_ver: '3.0', description: 'Datos de predicción de arrebol – Préboles (formato largo: 1 fila por evento)' },
            records: data
        };
        downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
            'preboles_historial_' + new Date().toISOString().slice(0,10) + '.json');
    }

    function compareByDateThenProb(a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (b.prob || 0) - (a.prob || 0);
    }

    function roundTo(v, decimals) {
        if (v === null || v === undefined || typeof v !== 'number' || !isFinite(v)) return v;
        var f = Math.pow(10, decimals);
        return Math.round(v * f) / f;
    }

    function prepareRecordForSync(r) {
        var copy = Object.assign({}, r);
        copy.prob = roundTo(copy.prob, 2);
        copy.elev = roundTo(copy.elev, 2);
        ['cloudsLow','cloudsMid','cloudsHigh','cloudsTotal'].forEach(function(k) { copy[k] = roundTo(copy[k], 2); });
        ['temperature','humidity','pressure','dewpoint'].forEach(function(k) { copy[k] = roundTo(copy[k], 2); });
        copy.irradiance = roundTo(copy.irradiance, 2);
        ['directRad','diffuseRad'].forEach(function(k) { copy[k] = roundTo(copy[k], 2); });
        ['wind10m','windLow','windMid','windHigh'].forEach(function(k) { copy[k] = roundTo(copy[k], 2); });
        copy.windDir10m    = roundTo(copy.windDir10m, 0);
        copy.visibility    = roundTo(copy.visibility, 0);
        copy.freezingLevel = roundTo(copy.freezingLevel, 0);
        return copy;
    }

    function syncAllToSheet() {
        var password = window.prompt('Contraseña para sincronizar con la Sheet:');
        if (!password) return;

        var data = loadData()
            .filter(function(r) { return r.actualArrebol !== null && r.actualArrebol !== undefined; })
            .sort(compareByDateThenProb)
            .map(prepareRecordForSync);
        if (!data.length) { alert('No hay registros etiquetados para sincronizar.'); return; }

        fetch(SHEET_SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ key: password, records: data })
        })
        .then(function(res) { return res.json(); })
        .then(function(json) {
            if (json.error === 'unauthorized') alert('❌ Contraseña incorrecta.');
            else if (json.error) alert('❌ Error: ' + json.error);
            else alert('✅ Sincronizado: ' + json.inserted + ' nuevos, ' + json.updated + ' actualizados.');
        })
        .catch(function(e) { alert('⚠ No se pudo conectar con la Sheet: ' + e.message); });
    }
    window.syncAllToSheet = syncAllToSheet;


    // ================================
    // Cargar un día anterior (1–3 días atrás) para todas las ubicaciones
    // ================================
    function buildRawEvent(name, city, kind, moment, prob, standardTime) {
        var d = moment.data || {};
        return {
            locationName: name, locationType: city.type || 'city',
            lat: city.lat, lon: city.lon, altitude: city.altitude ?? 0,
            kind: kind, prob: prob, elev: moment.elevDeg,
            time: standardTime ? standardTime.toISOString() : null,
            optimalArrebolTime: kind === 'sunset' ? moment.optimalTime : null,
            clouds: { low: d.low ?? 0, mid: d.mid ?? 0, high: d.high ?? 0, total: d.total ?? 0 },
            weather: {
                temperature: d.temperature ?? null, humidity: d.humidity ?? null,
                pressure: d.pressure ?? null, dewpoint: d.dewpoint ?? null,
                shortwave: d.shortwave ?? null,
                wind10m: d.wind10m ?? null, windDir10m: d.windDir10m ?? null,
                windLow: d.windLow ?? null, windMid: d.windMid ?? null, windHigh: d.windHigh ?? null,
                directRadiation: d.directRadiation ?? null, diffuseRadiation: d.diffuseRadiation ?? null,
                visibility: d.visibility ?? null, freezingLevel: d.freezingLevel ?? null
            }
        };
    }

    var loadingPastDay = false;

    async function loadPastDay(daysAgo) {
        daysAgo = Math.min(3, Math.max(1, Math.floor(daysAgo) || 1));
        if (loadingPastDay) return;
        if (typeof chileanCities === 'undefined' || typeof computeCityPrediction !== 'function') {
            alert('Módulos de predicción no disponibles'); return;
        }
        loadingPastDay = true;

        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        var dateStr = localDateStr(d);
        var noon    = timeUtils.localNoonDate(d);
        var names   = Object.keys(chileanCities);
        var done = 0, failed = 0;

        try {
            await getMeteoDataBatch(names.map(function(n) {
                return { lat: chileanCities[n].lat, lon: chileanCities[n].lon };
            }), daysAgo);

            for (var i = 0; i < names.length; i++) {
                var name = names[i], city = chileanCities[name];
                try {
                    var res = await computeCityPrediction(city.lat, city.lon,
                        { nSimulations: null, returnFactors: false, altitude: city.altitude ?? 0, daysAgo: daysAgo });
                    if (!res) { failed++; continue; }
                    var times = SunCalc.getTimes(noon, city.lat, city.lon);
                    var srP = typeof res.sunrise === 'number' ? res.sunrise : res.sunrise.probability;
                    var ssP = typeof res.sunset  === 'number' ? res.sunset  : res.sunset.probability;
                    collectBothPredictions(
                        buildRawEvent(name, city, 'sunrise', res.sunriseMoment, srP, times.sunrise),
                        buildRawEvent(name, city, 'sunset',  res.sunsetMoment,  ssP, times.sunset),
                        dateStr
                    );
                    done++;
                } catch (e) {
                    failed++;
                    console.warn('⚠ ' + name + ':', e.message);
                }
            }
        } finally {
            loadingPastDay = false;
        }
        alert('📅 ' + dateStr + ': ' + done + ' ubicaciones cargadas' + (failed ? ', ' + failed + ' fallaron' : '') + '.');
    }
    window.loadPastDay = loadPastDay;


    // ================================
    // Bloque de ayuda
    // ================================
    function buildHelpBlock() {
        return (
            '<details style="margin-bottom:14px;">' +
            '<summary style="cursor:pointer;font-size:0.8rem;opacity:0.6;user-select:none;">' +
                'ℹ️ ¿Qué es esta sección?' +
            '</summary>' +
            '<div style="font-size:0.78rem;opacity:0.65;line-height:1.55;margin-top:8px;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:8px;">' +
                '<p style="margin:0 0 8px;">Sección de uso interno, con el fin de cuantificar los parámetros atmosféricos de las ciudades al momento del arrebol. Cada vez que visitas una ciudad, la app guarda automáticamente AMBOS eventos (amanecer Y atardecer) como registros separados.</p>' +
                '<p style="margin:0;">El <strong>umbral</strong> controla desde qué probabilidad predicha aparece un evento en la lista.</p>' +
            '</div>' +
            '</details>'
        );
    }

    function buildThresholdSelector(current, disabled) {
        var opts = [0, 0.2, 0.4, 0.6, 0.8];
        return (
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">' +
            '<label style="font-size:0.72rem;opacity:0.55;">Umbral mínimo de probabilidad:</label>' +
            '<select' + (disabled ? ' disabled' : '') + ' onchange="window.setLabelingThreshold(this.value)" style="background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:3px 8px;font-size:0.75rem;' + (disabled ? 'opacity:0.45;cursor:not-allowed;' : '') + '">' +
            opts.map(function(o) {
                return '<option value="' + o + '"' + (Math.abs(o - current) < 0.001 ? ' selected' : '') + '>' +
                    (o === 0 ? '0% (todas)' : (o * 100) + '%') + '</option>';
            }).join('') +
            '</select>' +
            (disabled ? '<span style="font-size:0.68rem;opacity:0.4;">calculando ciudades…</span>' : '') +
            '</div>'
        );
    }

    function buildLabelKindTabs(active, data) {
        var threshold = loadThreshold();

        function pendingCount(kind) {
            return data.filter(function(r) {
                return r.kind === kind
                    && (r.actualArrebol === null || r.actualArrebol === undefined)
                    && (r.prob || 0) >= threshold;
            }).length;
        }

        var countSunset  = pendingCount('sunset');
        var countSunrise = pendingCount('sunrise');

        function tabBtn(kind, label, count) {
            var isActive = kind === active;
            return (
                '<button onclick="window.setLabelKind(\'' + kind + '\')" style="' +
                'border:none;border-radius:7px 7px 0 0;cursor:pointer;padding:7px 14px;' +
                'font-size:0.78rem;font-weight:600;color:inherit;' +
                (isActive ? 'background:rgba(255,255,255,0.1);opacity:1;' : 'background:transparent;opacity:0.45;') +
                '">' + label + (count ? ' (' + count + ')' : '') + '</button>'
            );
        }

        return (
            '<div style="display:flex;gap:2px;border-bottom:1px solid rgba(255,255,255,0.1);">' +
            tabBtn('sunset',  '🌇 Atardecer', countSunset) +
            tabBtn('sunrise', '🌅 Amanecer',  countSunrise) +
            '</div>'
        );
    }

    function buildLabelingList(allData, kind) {
        kind = kind || 'sunset';
        var threshold = loadThreshold();
        var data = allData.filter(function(r) { return r.kind === kind; });

        var pending = data.filter(function(r) {
            return (r.actualArrebol === null || r.actualArrebol === undefined) && (r.prob || 0) >= threshold;
        }).sort(compareByDateThenProb);

        var labeled = data.filter(function(r) {
            return r.actualArrebol !== null && r.actualArrebol !== undefined;
        }).sort(compareByDateThenProb);

        var BTN = [
            'border:none','border-radius:5px','cursor:pointer','font-size:0.7rem','font-weight:600',
            'padding:4px 8px','line-height:1.3','white-space:nowrap','flex-shrink:0','min-width:32px'
        ].join(';');

        var pendingHTML = '';
        if (!pending.length) {
            pendingHTML =
                '<p style="font-size:0.8rem;opacity:0.45;text-align:center;padding:12px 0;margin:0;">' +
                'Sin ' + (kind === 'sunrise' ? 'amaneceres' : 'atardeceres') + ' pendientes sobre ese umbral.' +
                '</p>';
        } else {
            pendingHTML =
                '<div style="overflow-x:auto;margin:0 -2px;padding:0 2px;">' +
                '<table style="width:100%;border-collapse:collapse;font-size:0.75rem;">' +
                '<thead>' +
                '<tr style="opacity:0.5;border-bottom:1px solid rgba(255,255,255,0.1);">' +
                '<th style="text-align:left;padding:8px 4px;font-weight:500;">Ciudad</th>' +
                '<th style="text-align:center;padding:8px 4px;font-weight:500;">Fecha</th>' +
                '<th style="text-align:center;padding:8px 4px;font-weight:500;">Hora</th>' +
                '<th style="text-align:center;padding:8px 4px;font-weight:500;">Prob</th>' +
                '<th style="text-align:center;padding:8px 4px;font-weight:500;">Acciones</th>' +
                '</tr>' +
                '</thead>' +
                '<tbody>' +
                pending.map(function(r) {
                    var prob   = r.prob || 0;
                    var pct    = (prob * 100).toFixed(0);
                    var pctClr = prob > 0.8 ? '#ff6f60' : (prob > 0.6 ? '#ffb74d' : '#90a4ae');
                    var fechaParts = (r.date || '').split('-');
                    var fechaCorta = fechaParts.length === 3
                        ? fechaParts[2] + '/' + fechaParts[1]
                        : (r.date || '—');
                    var hora = r.time || '—';
                    return (
                        '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">' +
                        '<td style="padding:8px 4px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (r.locationName || '') + '">' +
                            (r.locationName || '—') +
                        '</td>' +
                        '<td style="padding:8px 4px;text-align:center;white-space:nowrap;">' + fechaCorta + '</td>' +
                        '<td style="padding:8px 4px;text-align:center;white-space:nowrap;opacity:0.7;">' + hora + '</td>' +
                        '<td style="padding:8px 4px;text-align:center;font-weight:700;color:' + pctClr + ';">' + pct + '%</td>' +
                        '<td style="padding:8px 4px;text-align:center;white-space:nowrap;">' +
                            '<div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;">' +
                            '<button onclick="window.labelFromCard(\'' + r.id + '\',1)"   style="' + BTN + ';background:#2e7d32;color:#fff;" title="Sí, hubo arrebol">✅</button>' +
                            '<button onclick="window.labelFromCard(\'' + r.id + '\',0.5)" style="' + BTN + ';background:#e65100;color:#fff;" title="Regular/parcial">🙄</button>' +
                            '<button onclick="window.labelFromCard(\'' + r.id + '\',0)"   style="' + BTN + ';background:#b71c1c;color:#fff;" title="No hubo arrebol">❌</button>' +
                            '</div>' +
                        '</td>' +
                        '</tr>'
                    );
                }).join('') +
                '</tbody>' +
                '</table>' +
                '</div>';
        }

        var labeledHTML = '';
        if (labeled.length) {
            var iconMap = { '1': '✅', '0.5': '🙄', '0': '❌' };

            labeledHTML =
                '<details style="margin-top:12px;">' +
                '<summary style="cursor:pointer;font-size:0.75rem;opacity:0.45;user-select:none;list-style:none;padding:6px 0;">' +
                    '📋 ' + labeled.length + ' ya etiquetados' +
                '</summary>' +
                '<div style="margin-top:8px;overflow-x:auto;">' +
                '<table style="width:100%;border-collapse:collapse;font-size:0.7rem;">' +
                '<tbody>' +
                labeled.slice(0, 30).map(function(r) {
                    var icon = iconMap[String(r.actualArrebol)] || '—';
                    var pct  = r.prob != null ? (r.prob * 100).toFixed(0) + '%' : '—';
                    var fechaCorta = (r.date || '').slice(5, 10).replace('-', '/');
                    return (
                        '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">' +
                        '<td style="padding:6px 4px;white-space:nowrap;">' + icon + '</td>' +
                        '<td style="padding:6px 4px;width:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (r.locationName || '') + '">' +
                            (r.locationName || '—') +
                        '</td>' +
                        '<td style="padding:6px 4px;white-space:nowrap;text-align:right;opacity:0.5;">' + fechaCorta + '</td>' +
                        '<td style="padding:6px 4px;white-space:nowrap;text-align:right;opacity:0.5;">' + pct + '</td>' +
                        '<td style="padding:6px 4px;text-align:center;">' +
                            '<button onclick="window.unlabelRecord(\'' + r.id + '\')" ' +
                                'style="background:none;border:1px solid rgba(255,255,255,0.2);border-radius:4px;' +
                                'color:rgba(255,255,255,0.5);cursor:pointer;font-size:0.65rem;padding:2px 8px;white-space:nowrap;">↩ Desetiquetar</button>' +
                        '</td>' +
                        '</tr>'
                    );
                }).join('') +
                '</tbody>' +
                '</table>' +
                '</div>' +
                '</details>';
        }

        return (
            '<div class="info-card" style="width:100%;box-sizing:border-box;overflow:hidden;border-radius:0 0 10px 10px;border-top:none;">' +
                '<h4 style="margin-bottom:8px;">🏷️ Por etiquetar</h4>' +
                buildThresholdSelector(threshold, isCalculating) +
                pendingHTML +
                labeledHTML +
            '</div>'
        );
    }

    function renderHistoryTab() {
        var container = document.getElementById('tab-history');
        if (!container) return;
        if (!container.classList.contains('active')) return;

        var data = loadData();

        container.innerHTML =
            '<div class="container">' +
            '<h2>📜 Historial</h2>' +
            buildHelpBlock() +
            '<div style="display:flex;flex-direction:column;gap:14px;margin-bottom:20px;">' +

                (data.length
                    ? ('<div style="width:100%;box-sizing:border-box;">' +
                        buildLabelKindTabs(activeLabelKind, data) +
                        buildLabelingList(data, activeLabelKind) +
                       '</div>')
                    : '<div class="info-card" style="width:100%;box-sizing:border-box;text-align:center;padding:24px;opacity:0.6;">' +
                        '<div style="font-size:2.5rem;margin-bottom:8px;">🌅</div>' +
                        '<p style="margin:0;">Aún no hay registros.</p>' +
                        '<p style="font-size:0.85rem;margin:4px 0 0;">Cada ciudad que visites quedará guardada automáticamente aquí.</p>' +
                      '</div>'
                ) +

                '<div class="info-card" style="width:100%;box-sizing:border-box;">' +
                    '<h4>📅 Cargar días anteriores</h4>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<button onclick="window.loadPastDay(1)" class="btn-small" style="background:#607D8B;">Ayer</button>' +
                        '<button onclick="window.loadPastDay(2)" class="btn-small" style="background:#607D8B;">Hace 2 días</button>' +
                        '<button onclick="window.loadPastDay(3)" class="btn-small" style="background:#607D8B;">Hace 3 días</button>' +
                    '</div>' +
                '</div>' +

                '<div class="info-card" style="width:100%;box-sizing:border-box;">' +
                    '<h4>💾 Exportar</h4>' +
                    (data.length === 0
                        ? '<p style="font-size:0.82rem;opacity:0.5;">Visita ciudades para acumular datos.</p>'
                        : '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                            '<button onclick="window.exportMLDataCSV()" class="btn-small" style="background:#4CAF50;">📥 CSV (' + data.length + ')</button>' +
                            '<button onclick="window.exportMLDataJSON()" class="btn-small" style="background:#2196F3;">📄 JSON</button>' +
                            '<button onclick="window.syncAllToSheet()" class="btn-small" style="background:#9C27B0;">☁️ Sincronizar con Sheet</button>' +
                          '</div>'
                    ) +
                '</div>' +

            '</div></div>';
    }

    function showStats() { renderHistoryTab(); }

    function injectStyles() {
        if (document.getElementById('ml-collector-styles')) return;
        var s = document.createElement('style');
        s.id  = 'ml-collector-styles';
        s.textContent =
            '.stat-box{display:flex;flex-direction:column;align-items:center;background:rgba(255,255,255,0.07);border-radius:10px;padding:10px 6px;}' +
            '.stat-val{font-size:1.4rem;font-weight:700;line-height:1;}' +
            '.stat-label{font-size:0.7rem;opacity:0.7;margin-top:4px;text-align:center;}';
        document.head.appendChild(s);
    }

    migrateOldDataIfNeeded();
    purgeOldRecords();
    injectStyles();

    global.dataCollector = {
        collectPrediction: collectPrediction,
        collectBothPredictions: collectBothPredictions,  // NUEVA FUNCIÓN
        updateLabel:       updateLabel,
        getAllData:        getAllData,
        getCount:          getCount,
        getLast:           getLast,
        clearAll:          clearAll,
        getStats:          getStats,
        exportCSV:         exportCSV,
        exportJSON:        exportJSON,
        showStats:         showStats,
        renderHistoryTab:  renderHistoryTab,
        getThreshold:      loadThreshold,
        setThreshold:      saveThreshold,
        getActiveLabelKind: getActiveLabelKind
    };

})(window);

// ================================================================
// Funciones globales
// ================================================================
window.exportMLDataCSV = function() {
    if (typeof dataCollector !== 'undefined' && dataCollector.exportCSV)
        dataCollector.exportCSV();
    else alert('Exportador no disponible');
};

window.exportMLDataJSON = function() {
    if (typeof dataCollector !== 'undefined' && dataCollector.exportJSON)
        dataCollector.exportJSON();
    else alert('Exportador no disponible');
};

window.showMLStats = function() {
    if (typeof dataCollector !== 'undefined' && dataCollector.renderHistoryTab)
        dataCollector.renderHistoryTab();
    else console.warn('⚠ dataCollector no disponible');
};

window.renderHistoryTab = function() {
    if (typeof dataCollector !== 'undefined' && dataCollector.renderHistoryTab)
        dataCollector.renderHistoryTab();
    else console.warn('⚠ dataCollector no disponible');
};

window.clearMLData = function() {
    if (typeof dataCollector === 'undefined') { alert('Módulo no disponible'); return; }
    if (confirm('¿Borrar los ' + dataCollector.getCount() + ' registros guardados? Esta acción no se puede deshacer.')) {
        dataCollector.clearAll();
        dataCollector.renderHistoryTab();
    }
};

window.labelRecord = function(id, value) {
    if (typeof dataCollector !== 'undefined' && dataCollector.updateLabel)
        dataCollector.updateLabel(id, value, null, null);
    else console.warn('⚠ dataCollector no disponible');
};

window.labelFromCard = function(id, value) {
    if (typeof dataCollector === 'undefined') return;
    dataCollector.updateLabel(id, value, null, null);
};

window.unlabelRecord = function(id) {
    if (typeof dataCollector === 'undefined') return;
    dataCollector.updateLabel(id, null, null, null);
};

console.log('✅ Historial ML inicializado - AHORA guarda AMBOS eventos (sunrise + sunset)');