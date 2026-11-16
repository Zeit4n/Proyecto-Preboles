-- Probamos ck_lat
INSERT INTO Ubicaciones (nombre, latitud, longitud, timezone)
VALUES ('Valdivia', -139, -73, 'America/Santiago');

-- Probamos ck_lon
INSERT INTO Ubicaciones (nombre, latitud, longitud, timezone)
VALUES ('Valdivia', -39, 206, 'America/Santiago');

-- Probamos ck_proba_arrebol
INSERT INTO pronosticos (id_ubicacion, fecha_hora, tipo_arrebol, prob)
VALUES (3,'2026-11-12 06:00:00-03:00', 0, 1.15);

-- Probamos la condición de unicidad de id_ubicacion y fecha_hora
INSERT INTO pronosticos (id_ubicacion, fecha_hora, tipo_arrebol, prob)
VALUES (3,'2026-11-12 06:00:00-03:00', 0, 0.85), 
	   (3,'2026-11-12 06:00:00-03:00', 1, 0.78);