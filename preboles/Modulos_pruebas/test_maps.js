(function(global) {
    'use strict';

    /* ==========================================================================
       CONFIG Y ESTADO INTERNO
       ========================================================================== */
    const CONFIG = {
        BATCH_SIZE: 3,
        DELAY: 500
    };

    let state = {
        map: null,
        marker: null,
        heatLayer: null,
        labelLayer: null,
        heatmapEnabled: true,
        labelsEnabled: true,
        weatherCache: {}
    };

    /* ==========================================================================
       Geometría / visualización
       ========================================================================== */
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(dLat/2)**2 +
                  Math.cos(lat1*Math.PI/180) *
                  Math.cos(lat2*Math.PI/180) *
                  Math.sin(dLon/2)**2;

        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
    }

    function calculateDestinationPoint(lat, lon, azimuth, distanceKm) {
        const R = 6371;
        const latRad = lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;
        const azRad = azimuth * Math.PI / 180;
        const dDivR = distanceKm / R;

        const destLat = Math.asin(
            Math.sin(latRad) * Math.cos(dDivR) +
            Math.cos(latRad) * Math.sin(dDivR) * Math.cos(azRad)
        );

        const destLon = lonRad + Math.atan2(
            Math.sin(azRad) * Math.sin(dDivR) * Math.cos(latRad),
            Math.cos(dDivR) - Math.sin(latRad) * Math.sin(destLat)
        );

        return {
            lat: destLat * 180 / Math.PI,
            lon: destLon * 180 / Math.PI
        };
    }

    function calculateSunsetAzimuth(lat, lon) {
        const targetDate = (typeof timeUtils !== 'undefined' && timeUtils.getQueryDate)
            ? timeUtils.getQueryDate()
            : new Date();
        const sunset = SunCalc.getTimes(timeUtils.localNoonDate(targetDate), lat, lon).sunset;
        const pos = SunCalc.getPosition(sunset, lat, lon);
        return (pos.azimuth * 180 / Math.PI + 180) % 360;
    }

    function getGradientColorForProbability(probability) {
      const gradientStops = [
        { pos: 0.0, color: '#2b83ba' }, { pos: 0.25, color: '#abdda4' },
        { pos: 0.5, color: '#ffffbf' }, { pos: 0.75, color: '#fdae61' },
        { pos: 1.0, color: '#d7191c' }
      ];
      
      for (let i = 0; i < gradientStops.length - 1; i++) {
        const start = gradientStops[i], end = gradientStops[i + 1];
        if (probability >= start.pos && probability <= end.pos) {
          const t = (probability - start.pos) / (end.pos - start.pos);
          return interpolateColor(start.color, end.color, t);
        }
      }
      return gradientStops[gradientStops.length - 1].color;
    }

    function interpolateColor(color1, color2, factor) {
      if (factor === 0) return color1;
      if (factor === 1) return color2;
      
      const r1 = parseInt(color1.substring(1, 3), 16);
      const g1 = parseInt(color1.substring(3, 5), 16);
      const b1 = parseInt(color1.substring(5, 7), 16);
      
      const r2 = parseInt(color2.substring(1, 3), 16);
      const g2 = parseInt(color2.substring(3, 5), 16);
      const b2 = parseInt(color2.substring(5, 7), 16);
      
      const r = Math.round(r1 + factor * (r2 - r1));
      const g = Math.round(g1 + factor * (g2 - g1));
      const b = Math.round(b1 + factor * (b2 - b1));
      
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    /* ==========================================================================
       Utilidades mapa
       ========================================================================== */

    function initMap(lat, lon, cityName) {
      if (map) {
        map.setView([lat, lon], 10);
        if (marker) {
          marker.setLatLng([lat, lon]);
          marker.setPopupContent(`<b>${cityName}</b><br>Lat: ${lat.toFixed(4)}<br>Lon: ${lon.toFixed(4)}`);
        } else {
          marker = L.marker([lat, lon]).addTo(map)
            .bindPopup(`<b>${cityName}</b><br>Lat: ${lat.toFixed(4)}<br>Lon: ${lon.toFixed(4)}`)
            .openPopup();
        }
        return;
      }
      
      map = L.map('map').setView([lat, lon], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      
      marker = L.marker([lat, lon]).addTo(map)
        .bindPopup(`<b>${cityName}</b><br>Lat: ${lat.toFixed(4)}<br>Lon: ${lon.toFixed(4)}`)
        .openPopup();
    }

    function clearMapLayers() {
        //console.log("Limpiando capas del mapa...");
        
        if (heatLayer) {
            try {
                heatLayer.clearLayers();
                if (map && map.hasLayer(heatLayer)) {
                    map.removeLayer(heatLayer);
                }
            } catch (e) {
                console.warn("Error limpiando heatLayer:", e);
            }
            heatLayer = null;
        }
        
        if (labelLayer) {
            try {
                labelLayer.clearLayers();
                if (map && map.hasLayer(labelLayer)) {
                    map.removeLayer(labelLayer);
                }
            } catch (e) {
                console.warn("Error limpiando labelLayer:", e);
            }
            labelLayer = null;
        }
    }


    function calculateSpatialUncertainty(probabilities) {
      const n = probabilities.length;
      const mean = probabilities.reduce((a, b) => a + b, 0) / n;
      const variance = probabilities.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const std = Math.sqrt(variance);

      const confidenceLevel = std < 0.08 ? 'Alta' : std < 0.15 ? 'Media' : 'Baja';
      const confidenceColor = std < 0.08 ? '#4CAF50' : std < 0.15 ? '#FFC107' : '#F44336';

      return {
        mean, std, n,
        values: probabilities,
        confidence: { level: confidenceLevel, color: confidenceColor, std }
      };
    }


    function get7HexagonCenters(centerLat, centerLon, sunsetAzimuth) {
        const hexRadiusKm = 10;
        const hexWidth = Math.sqrt(3) * hexRadiusKm;
        const hexHeight = 1.5 * hexRadiusKm;
        const perpendicularAzimuth = (sunsetAzimuth + 90) % 360;

        const hexCoordinates = [
            { q: 0,  r: 0 },  { q: 1, r: 0 },  { q: 0, r: 1 },
            { q: -1, r: 1 },  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }
        ];

        const centers = hexCoordinates.map(({ q, r }, index) => {
            const x = hexWidth * (q + r / 2);
            const y = hexHeight * r;

            if (x === 0 && y === 0) {
                return { index, q, r, lat: centerLat, lon: centerLon, isCenter: true };
            }

            let point = { lat: centerLat, lon: centerLon };
            if (x !== 0) {
                const dirX = x > 0 ? perpendicularAzimuth : (perpendicularAzimuth + 180) % 360;
                point = calculateDestinationPoint(centerLat, centerLon, dirX, Math.abs(x));
            }
            if (y !== 0) {
                const dirY = y > 0 ? sunsetAzimuth : (sunsetAzimuth + 180) % 360;
                point = calculateDestinationPoint(point.lat, point.lon, dirY, Math.abs(y));
            }
            return { index, q, r, lat: point.lat, lon: point.lon, isCenter: false };
        });

        return { center: centers[0], neighbors: centers.slice(1), all: centers };
    }


    async function generate7HexagonGrid(centerLat, centerLon, sunsetAzimuth, altitude = 0) {

      const hexRadiusKm = 10;   // necesitamos definir la variable
      const grid = MapUtils.get7HexagonCenters(centerLat, centerLon, sunsetAzimuth);
      const hexCenters = grid.all.map(c => ({ lat: c.lat, lon: c.lon }));


      // 2) Las 7 probabilidades en paralelo (esto es lo que queríamos optimizar)
      const collectedProbabilities = await Promise.all(
        hexCenters.map(hc => calculateGridPointProbability(hc.lat, hc.lon, altitude))
      );

      // 3) Dibujar cada hexágono, ya con su probabilidad resuelta
      hexCenters.forEach((hexCenter, idx) => {
        const probability = collectedProbabilities[idx];

        const vertices = [];
        for (let i = 0; i < 6; i++) {
          const angle = sunsetAzimuth + (i * 60);
          const vertex = MapUtils.calculateDestinationPoint(hexCenter.lat, hexCenter.lon, angle, hexRadiusKm);
          vertices.push([vertex.lat, vertex.lon]);
        }

        const hexagon = L.polygon(vertices, {
          color: '#ffffff',
          fillColor: MapUtils.getGradientColorForProbability(probability),
          fillOpacity: 0.6,
          weight: 1.5,
          opacity: 0.9
        }).addTo(heatLayer);

        const distance = MapUtils.calculateDistance(centerLat, centerLon, hexCenter.lat, hexCenter.lon);
        hexagon.bindPopup(`
            <div style="text-align:center; min-width:150px;">
                <strong>${(probability * 100).toFixed(0)}% Probabilidad</strong><br>
                Distancia: ${distance.toFixed(0)} km<br>
                <small>${hexCenter.lat.toFixed(3)}, ${hexCenter.lon.toFixed(3)}</small><br>
                <small style="color:#888; font-size:0.8em;">Cálculo interpolado a la hora exacta</small>
            </div>
        `);

        hexagon.on('mouseover', () => hexagon.setStyle({ fillOpacity: 0.9, weight: 2.5, color: '#ffff00' }));
        hexagon.on('mouseout', () => hexagon.setStyle({ fillOpacity: 0.7, weight: 1.5, color: '#ffffff' }));

        if (labelsEnabled) {
          const percentage = (probability * 100).toFixed(0);
          L.marker([hexCenter.lat, hexCenter.lon], {
            icon: L.divIcon({
              className: 'hexagon-label',
              html: `<div style="color:white;font-weight:900;font-size:18px;text-shadow:0 1px 3px rgba(0,0,0,0.8)">${percentage}%</div>`,
              iconSize: [50, 25],
              iconAnchor: [25, 12]
            })
          }).addTo(labelLayer);
        }
      });

      // calcular incerteza espacial al terminar el grid
      const spatialStats = calculateSpatialUncertainty(collectedProbabilities);
      window.PrebolesPredictor = window.PrebolesPredictor || {};
      window.PrebolesPredictor.spatialUncertainty = spatialStats;

      return spatialStats;
    }

    async function updateHeatmap(cityLat, cityLon, altitude = 0) {
          if (!map || !heatmapEnabled) return;
          
          if (heatLayer) try { map.removeLayer(heatLayer); } catch(e) {}
          if (labelLayer) try { map.removeLayer(labelLayer); } catch(e) {}
          
          heatLayer = L.layerGroup().addTo(map);
          labelLayer = L.layerGroup().addTo(map);
          document.getElementById('mapLoading').style.display = 'block';
          
          try {
            const sunsetAzimuth = MapUtils.calculateSunsetAzimuth(cityLat, cityLon);
            await MapUtils.generate7HexagonGrid(cityLat, cityLon, sunsetAzimuth, altitude);
          } catch (error) {
            console.error('Error actualizando mapa de calor:', error);
            log('Error creando hexágonos: ' + (error && error.message));
          } finally {
            document.getElementById('mapLoading').style.display = 'none';
          }
        }

    function toggleHeatmap() {
        heatmapEnabled = !heatmapEnabled;
        const button = document.getElementById('toggleHeatmap');
        
        if (heatmapEnabled && currentState.lat && currentState.lon) {
            button.classList.add('active');
            updateHeatmap(currentState.lat, currentState.lon, currentState.altitude ?? 0);
        } else {
            button.classList.remove('active');
            MapUtils.clearMapLayers();
        }
    }

    /* ==========================================================================
       Calculo espacial del grid
       ========================================================================== */
 
    // mismo cálculo que usan las tarjetas, la vista detallada y el background.
    // Así el hexágono sobre la ciudad siempre coincide con el porcentaje
    
    async function computeProbabilityFromData(weatherData, lat, lon, altitude = 0) {
        const result = await window.computeCityPrediction(lat, lon, { altitude }); // sin Monte Carlo, rápido para el grid
        if (!result) return { sunrise: 0, sunset: 0 };
 
        const sunset  = typeof result.sunset  === 'number' ? result.sunset  : result.sunset.probability;
        const sunrise = typeof result.sunrise === 'number' ? result.sunrise : result.sunrise.probability;
 
        return { sunrise, sunset };
    }

 
    function _dateCacheSuffix() {
        const d = (typeof timeUtils !== 'undefined' && timeUtils.getQueryDate)
            ? timeUtils.getQueryDate()
            : new Date();
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    async function getGridPointBothProbabilities(lat, lon, altitude = 0) {
        const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)},${_dateCacheSuffix()}`;
        if (weatherDataCache[cacheKey] !== undefined) {
            return weatherDataCache[cacheKey];
        }
        try {
            const probs = await computeProbabilityFromData(null, lat, lon, altitude);
            weatherDataCache[cacheKey] = probs;
            return probs;
        } catch (error) {
            console.warn(`Error calculando probabilidad para ${lat}, ${lon}:`, error);
            return { sunrise: 0, sunset: 0 };
        }
    }
 
    // Valor único según el modo activo — la usa el pintado del hexágono.
    async function calculateGridPointProbability(lat, lon, altitude = 0) {
        const probs = await getGridPointBothProbabilities(lat, lon, altitude);
        return window.cardPredictionMode === 'sunrise' ? probs.sunrise : probs.sunset;
    }



    global.MapUtils = {
        initMap,
        calculateDistance,
        calculateDestinationPoint,
        calculateSunsetAzimuth,
        getGradientColorForProbability,
        interpolateColor,
        clearMapLayers,
        generate7HexagonGrid,
        get7HexagonCenters,
        updateHeatmap,
        toggleHeatmap,
        calculateGridPointProbability,
        computeProbabilityFromData
    };

})(window);