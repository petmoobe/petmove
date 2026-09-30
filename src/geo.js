/**
 * Rutas y distancias.
 *
 * En producción esto llama a un proveedor cartográfico (OSRM autoalojado,
 * Mapbox, Google o similar) y cachea el resultado por par origen/destino.
 * El modo local estima con la distancia en línea recta y un factor de
 * rodeo para que el desarrollo no dependa de una API externa.
 */

const GRADO_KM = 111.32;
const FACTOR_RODEO_CARRETERA = 1.28;
const VELOCIDAD_MEDIA_KMH = 72;

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function estimarRuta(origen, destino) {
  const recta = haversineKm(origen, destino);
  const distanciaKm = Number((recta * FACTOR_RODEO_CARRETERA).toFixed(2));
  const duracionH = Number((distanciaKm / VELOCIDAD_MEDIA_KMH).toFixed(2));

  return {
    distanciaKm,
    duracionH,
    proveedor: "estimacion_local",
    aviso:
      distanciaKm > 400
        ? "Trayecto largo: verificar descansos, ventilación y paradas de bienestar antes de confirmar."
        : null,
    factorRodeo: FACTOR_RODEO_CARRETERA,
    gradoKm: GRADO_KM,
  };
}

/**
 * Ubicación aproximada mostrada al cliente.
 * Se redondea para no exponer la posición exacta del conductor (contrato, 10.2).
 */
export function aproximarPosicion(lat, lng, precision = 2) {
  const f = 10 ** precision;
  return { lat: Math.round(lat * f) / f, lng: Math.round(lng * f) / f, precision };
}

/**
 * Detecta si el vehículo está en movimiento, para bloquear la captura de
 * imágenes durante la conducción (contrato, 10.5).
 */
export function enMovimiento(velocidadKmh, umbral = 8) {
  return Number(velocidadKmh) > umbral;
}
