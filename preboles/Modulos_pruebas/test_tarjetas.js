/* ============================================================================
   tarjetas.js — genera y actualiza las tarjetas de ciudades/observatorios
   ============================================================================
   Este archivo se encarga de la grilla de tarjetas (ciudades y
   observatorios): crear el HTML de cada tarjeta "vacía", pedirle la
   predicción a window.PrebolesPredictor, y pintar el resultado (color de
   fondo según probabilidad, hora exacta, mensaje de visibilidad, etc.)

   CARGA EN LOTES — por qué existe
   --------------------------------
   Si pidiéramos la predicción de las ~90 ciudades/observatorios todas al
   mismo tiempo, dispararíamos ~90 cálculos (y sus llamadas a Open-Meteo)
   de golpe. En vez de eso, loadCardsInBatches pide de a BATCH_SIZE tarjetas
   por vez, con una pausa de DELAY_MS entre lote y lote. Esto reparte la
   carga en el tiempo — complementa (no reemplaza) la caché y el batching
   HTTP que ya hace openMeteoClient.js.

   API PÚBLICA (window.*) — se mantienen estos nombres para no romper el
   resto de la app, que ya los llama así desde index.html:
     - getProbabilityStyles(probability)
     - mountCityCardView()
     - mountObservatoryCardView()
     - refreshCardProbabilities()
   ============================================================================ */
(function () {
    'use strict';

    // ============================================================================
    // CONFIGURACIÓN
    // ============================================================================

    const BATCH_SIZE = 5;   // tarjetas que se piden en paralelo por lote
    const DELAY_MS   = 80;  // pausa entre un lote y el siguiente

    // 'sunset' o 'sunrise' — qué momento del día muestran las tarjetas ahora mismo
    window.cardPredictionMode = 'sunset';

    // ============================================================================
    // ESTILOS POR NIVEL DE PROBABILIDAD
    // Define el color de fondo/borde de la tarjeta según qué tan probable
    // es el arrebol (escala roja=muy probable → gris=poco probable).
    // ============================================================================

    function getProbabilityStyles(probability) {
        const percent = probability * 100;
        let background, border, boxShadow;

        if (percent > 70) {
            background = 'rgba(255, 80, 80, 0.55)';
            boxShadow  = '0 4px 16px rgba(255, 80, 80, 0.1)';
            border     = '1px solid rgba(255, 80, 80, 0.3)';
        } else if (percent > 50) {
            background = 'rgba(255, 165, 0, 0.3)';
            boxShadow  = '0 4px 16px rgba(255, 165, 0, 0.2)';
            border     = '1px solid rgba(255, 165, 0, 0.2)';
        } else if (percent > 30) {
            background = 'rgba(255, 200, 0, 0.25)';
            border     = '1px solid rgba(255, 200, 0, 0.2)';
        } else if (percent > 15) {
            background = 'rgba(200, 200, 255, 0.15)';
            border     = '1px solid rgba(200, 200, 255, 0.1)';
        } else {
            background = 'rgba(255, 255, 255, 0.05)';
            border     = '1px solid rgba(255, 255, 255, 0.05)';
        }

        return { background, border, color: '#ffffff', boxShadow };
    }

    // ============================================================================
    // HELPERS DE DATOS
    // ============================================================================

    // Según el toggle amanecer/atardecer, cuál mitad del objeto de
    // predicción hay que mirar.
    function getMomentPrediction(probs) {
        return window.cardPredictionMode === 'sunrise' ? probs.sunrise : probs.sunset;
    }

    function getMomentData(probs) {
        return window.cardPredictionMode === 'sunrise' ? probs.sunriseMoment : probs.sunsetMoment;
    }

    // Con qué categoría de pantalla estamos trabajando, para elegir el
    // rango de tamaño de fuente correspondiente. Se centraliza acá para
    // no repetir las mismas dos consultas matchMedia en cada función de
    // tamaño de fuente.
    function getScreenSizeCategory() {
        if (window.matchMedia('(max-width: 400px)').matches) return 'smallMobile';
        if (window.matchMedia('(max-width: 768px)').matches) return 'mobile';
        return 'desktop';
    }

    // Tamaño de fuente del número grande de probabilidad: crece con el
    // valor. Nota: a propósito NO se limita t a 1 — para probabilidades
    // muy altas (30-50%) el texto sigue creciendo un poco más allá del
    // tamaño "típico" de 30%, para que un evento muy probable resalte más.
    function probabilityFontSize(value) {
        const percent = Math.max(0, Math.min(50, value ?? 0));
        const t = percent / 30;

        const rangeByScreen = {
            smallMobile: [0.75, 1.0],
            mobile:      [0.85, 1.15],
            desktop:     [1.6, 2.3]
        };
        const [min, max] = rangeByScreen[getScreenSizeCategory()];
        return `${(min + t * (max - min)).toFixed(2)}rem`;
    }

    // Tamaño del mensaje de advertencia, proporcional al grado de
    // bloqueo del horizonte (weighted, típicamente 0..~0.7). Cuanto más
    // probable el bloqueo, más grande y notorio el texto.
    function visibilityFontSize(weighted) {
        const CAP = 0.7; // tope de normalización: valores típicos rara vez superan esto
        const t = Math.max(0, Math.min(1, (weighted ?? 0) / CAP));

        const rangeByScreen = {
            smallMobile: [0.55, 0.72],
            mobile:      [0.6, 0.8],
            desktop:     [0.8, 1.05]
        };
        const [min, max] = rangeByScreen[getScreenSizeCategory()];
        return `${(min + t * (max - min)).toFixed(2)}rem`;
    }

    // Devuelve { text, weighted }: weighted es el grado (0..1 aprox.) de
    // qué tan bloqueado/interferido está el horizonte, usando el mismo
    // factor que ya calcula computeProbability(). visibilityFontSize lo
    // usa para agrandar el texto cuanto más probable es el bloqueo.
    function getWarningText(prediction) {
        if (!prediction) return { text: '', weighted: 0 };

        if (prediction.blockers?.length) {
            const blocker = prediction.blockers[0];
            return { text: '⚠ ' + blocker.label, weighted: blocker.weighted ?? 0.5 };
        }

        const irradianceUncertainty = prediction.factors?.find(f => f.isUncertainty);
        if (irradianceUncertainty) {
            // Mensaje corto a propósito: el detalle en W/m² sobraba en
            // una tarjeta chica.
            return { text: 'MALA VISIBILIDAD', weighted: irradianceUncertainty.weighted ?? 0 };
        }

        return { text: '✓ Sin limitaciones', weighted: 1.0 };
    }

    // ============================================================================
    // RENDERIZADO DE TARJETAS
    // ============================================================================

    // Escalón de tamaño de fuente del nombre según su largo. Los nombres
    // cortos usan la fuente más grande porque igual les sobra la fila entera.
    function nameSizeClass(name) {
        const length = name.length;
        if (length > 26) return 'city-name--xs';
        if (length > 20) return 'city-name--sm';
        if (length > 15) return 'city-name--md';
        return 'city-name--lg';
    }

    // HTML "vacío" de una tarjeta, antes de tener la predicción real.
    function cardSkeleton(displayLabel, regionLabel, weatherCamera) {
        const safeLabel = displayLabel && displayLabel.trim() ? displayLabel : 'Ubicación sin nombre';
        const cameraIcon = weatherCamera
            ? `<a href="${weatherCamera}" target="_blank" rel="noopener" class="webcam-link" title="Ver cámara en vivo" onclick="event.stopPropagation()">  📷</a>`
            : '';

        return `
            <div class="card-header">
                <div class="card-info">
                    <div class="city-region">${regionLabel || ''}</div>
                </div>
                <div class="card-score">
                    <div class="probability-big"><span class="probability-value">--</span>%</div>
                    <div class="probability-uncertainty">&nbsp;</div>
                </div>
            </div>
            <div class="city-name-row">
                <div class="city-name ${nameSizeClass(safeLabel)}">${safeLabel}</div>
                ${cameraIcon}
            </div>
            <div class="card-meta">
                <div class="meta-row time-row">🕐 --:--</div>
                <div class="meta-row visibility-row">Calculando...</div>
            </div>
            <div class="probability-bar" style="width: 0%"></div>
        `;
    }

    function renderCityCard(nombre, info) {
        const card = document.createElement('div');
        card.className = 'city-card';
        card.dataset.cityName = nombre;
        card.innerHTML = cardSkeleton(nombre, info?.region, info?.weatherCamera);
        card.addEventListener('click', () => showPrediction(nombre, 'city'));
        return card;
    }

    function renderObservatoryCard(nombre, info) {
        const displayName = nombre.replace('Observatorio ', '');
        const regionLabel = info?.altitude
            ? `${info.region} · ${info.altitude.toLocaleString()} m`
            : info?.region;

        const card = document.createElement('div');
        card.className = 'city-card';
        card.dataset.cityName = nombre;
        card.innerHTML = cardSkeleton(displayName, regionLabel, info?.weatherCamera);
        card.addEventListener('click', () => showPrediction(nombre, 'observatory'));
        return card;
    }

    // ============================================================================
    // ACTUALIZACIÓN DE TARJETAS INDIVIDUALES
    // ============================================================================

    function findCard(containerSelector, nombre) {
        return document.querySelector(`${containerSelector} .city-card[data-city-name="${CSS.escape(nombre)}"]`);
    }

    // Normaliza a porcentaje entero: acepta tanto fracciones (0..1) como
    // porcentajes ya calculados (0..100).
    function toPercent(n) {
        if (n == null) return null;
        return n <= 1 ? Math.round(n * 100) : Math.round(n);
    }

    function formatTime(raw) {
        if (!raw) return '--:--';
        const date = raw instanceof Date ? raw : new Date(raw);
        if (isNaN(date)) return String(raw);
        return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    }

    // Pinta la tarjeta según window.cardPredictionMode. Nunca toca
    // .city-name ni .city-region — esos ya quedaron fijos al crear la tarjeta.
    function applyProbabilityToCard(card, probs) {
        const prediction = getMomentPrediction(probs);
        const moment = getMomentData(probs);

        if (!prediction) {
            showCardError(card);
            return;
        }

        const value = toPercent(prediction.probability);
        card.querySelector('.probability-value').textContent = value ?? '--';

        const probBig = card.querySelector('.probability-big');
        if (probBig) probBig.style.fontSize = probabilityFontSize(value);

        // ±1σ de incertidumbre, calculado por Monte Carlo.
        const uncertaintyEl = card.querySelector('.probability-uncertainty');
        if (prediction.confidence && Number.isFinite(prediction.std)) {
            uncertaintyEl.textContent = `±${Math.round(prediction.std * 100)}%`;
            uncertaintyEl.style.color = prediction.confidence.color;
        } else {
            uncertaintyEl.innerHTML = '&nbsp;';
        }

        const timeRow = card.querySelector('.time-row');
        if (timeRow) timeRow.textContent = `🕐 ${formatTime(moment?.optimalTime)}`;

        const visibilityRow = card.querySelector('.visibility-row');
        if (visibilityRow) {
            const warning = getWarningText(prediction);
            visibilityRow.textContent = warning.text;
            visibilityRow.style.fontSize = visibilityFontSize(warning.weighted);
        }

        // Barra de probabilidad (la franja verde→amarillo→rojo)
        const bar = card.querySelector('.probability-bar');
        if (bar) bar.style.width = `${value ?? 0}%`;

        const styles = getProbabilityStyles((value ?? 0) / 100);
        card.style.background = styles.background;
        card.style.border     = styles.border    || '';
        card.style.boxShadow  = styles.boxShadow || 'none';
    }

    function showCardError(card) {
        const visibilityRow = card.querySelector('.visibility-row');
        if (visibilityRow) visibilityRow.textContent = 'Error al cargar';
        card.style.background = 'rgba(255, 0, 0, 0.1)';
    }

    // ============================================================================
    // OBTENCIÓN DE PROBABILIDADES
    // ============================================================================

    async function computeCardProbability(info) {
        if (!window.PrebolesPredictor?.getProbabilities) {
            console.error(
                'Falta window.PrebolesPredictor.getProbabilities(lat, lon). ' +
                'Revisa que el módulo predictor esté cargado antes que tarjetas.js.'
            );
            return null;
        }
        return window.PrebolesPredictor.getProbabilities(info.lat, info.lon, {
            altitude: info.altitude || 0,
            nSimulations: null // Monte Carlo desactivado para la vista de tarjetas
        });
    }

    async function loadCard(nombre, info, containerSelector, checkStillActive) {
        if (checkStillActive && !checkStillActive()) return;

        const card = findCard(containerSelector, nombre);
        if (!card) return;

        try {
            const probs = await computeCardProbability(info);
            if (!probs) { showCardError(card); return; }

            card._prediction = probs; // guardado para poder repintar sin recalcular al cambiar amanecer/atardecer
            applyProbabilityToCard(card, probs);
        } catch (err) {
            console.error(`Error cargando ${nombre}:`, err);
            showCardError(card);
        }
    }

    // ============================================================================
    // CARGA EN LOTES (ver nota al principio del archivo sobre por qué)
    // ============================================================================

    async function loadCardsInBatches(entries, containerSelector, checkStillActive) {
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            if (checkStillActive && !checkStillActive()) break;

            const batch = entries.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
                batch.map(([nombre, info]) => loadCard(nombre, info, containerSelector, checkStillActive))
            );

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    // ============================================================================
    // PUNTO DE ENTRADA: VISTA DE CIUDADES
    // ============================================================================

    // Evita que dos cargas en lote corran en paralelo si el usuario
    // cambia de día varias veces rápido, o si se refresca la vista.
    let isLoadingCities = false;

    // El delay artificial de 3s (para no mostrar la grilla "en blanco"
    // mientras cargan las tarjetas) solo tiene sentido en la carga
    // inicial de la página. En refrescos posteriores (p. ej. al cambiar
    // el día consultado) la grilla ya está visible, así que mostrarla de
    // inmediato se ve mejor que ocultarla de nuevo.
    let isFirstLoad = true;

    async function mountCityCardView() {
        if (isLoadingCities) return;
        isLoadingCities = true;

        const menu = document.getElementById('cityMenu');
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (!menu) { isLoadingCities = false; return; }

        // Limpia antes de repoblar: sin esto, volver a llamar a esta
        // función (p. ej. al cambiar el día consultado) duplicaría las tarjetas.
        menu.innerHTML = '';

        const cities = Object.entries(window.chileanCities || {}).filter(
            ([, info]) => !info.type || info.type !== 'observatory'
        );

        cities.forEach(([nombre, info]) => menu.appendChild(renderCityCard(nombre, info)));

        if (isFirstLoad) {
            isFirstLoad = false;
            setTimeout(() => {
                if (loadingIndicator) loadingIndicator.style.display = 'none';
                menu.style.display = 'grid';
            }, 3000);
        } else {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            menu.style.display = 'grid';
        }

        try {
            await loadCardsInBatches(cities, '#cityMenu', null);
        } finally {
            isLoadingCities = false;
        }
    }

    // ============================================================================
    // PUNTO DE ENTRADA: VISTA DE OBSERVATORIOS
    // ============================================================================

    let isLoadingObservatories = false;

    async function mountObservatoryCardView() {
        if (isLoadingObservatories) return;
        isLoadingObservatories = true;

        const menu = document.getElementById('observatoryMenu');
        if (!menu) { isLoadingObservatories = false; return; }

        const isTabStillActive = () =>
            document.getElementById('tab-observatories')?.classList.contains('active');

        const observatories = Object.entries(window.chileanCities || {}).filter(
            ([, info]) => info.type === 'observatory'
        );

        menu.innerHTML = '';
        observatories.forEach(([nombre, info]) => menu.appendChild(renderObservatoryCard(nombre, info)));

        if (isTabStillActive()) {
            await loadCardsInBatches(observatories, '#observatoryMenu', isTabStillActive);
        }

        isLoadingObservatories = false;
    }

    // ============================================================================
    // TOGGLE AMANECER / ATARDECER
    // Repinta las tarjetas ya cargadas con la predicción que ya tienen
    // guardada (card._prediction), sin volver a pedirle nada al predictor.
    // ============================================================================

    function refreshCardProbabilities() {
        document.querySelectorAll('.city-card').forEach(card => {
            if (card._prediction) applyProbabilityToCard(card, card._prediction);
        });
    }

    // ============================================================================
    // EXPORTAR
    // ============================================================================

    window.getProbabilityStyles     = getProbabilityStyles;
    window.mountCityCardView        = mountCityCardView;
    window.mountObservatoryCardView = mountObservatoryCardView;
    window.refreshCardProbabilities = refreshCardProbabilities;

})();