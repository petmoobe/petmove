/**
 * Motor de asignación (contrato, cláusula 6).
 * Ordena candidatos por compatibilidad y devuelve los mejores N junto con
 * los motivos, para que el Anexo III pueda describir los parámetros reales.
 */

export const PESOS = {
  encaje_ruta: 30,
  cercania_recogida: 20,
  calidad_verificada: 20,
  disponibilidad_ventana: 15,
  capacidad_y_vehiculo: 10,
  actividad_reciente: 5,
};

export const UMBRAL_MINIMO = 45;

function normalizar(valor, min, max) {
  if (max === min) return 1;
  return Math.min(1, Math.max(0, (valor - min) / (max - min)));
}

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Comprueba el descarte automático antes de puntuar.
 * Devuelve { ok, fallos: [] }.
 */
export function comprobarElegibilidad({ carrier, vehiculo, booking, ahora = new Date() }) {
  const fallos = [];
  const hoy = ahora.toISOString().slice(0, 10);

  if (carrier.estado !== "activo") fallos.push({ regla: "carrier_activo", detalle: carrier.estado });
  if (!carrier.autorizacion_numero) fallos.push({ regla: "autorizacion", detalle: "sin número" });
  if (!carrier.sirentra_alta) fallos.push({ regla: "sirentra", detalle: "no inscrito" });
  if (carrier.poliza_vencimiento && carrier.poliza_vencimiento < hoy) {
    fallos.push({ regla: "seguro_vigente", detalle: carrier.poliza_vencimiento });
  }
  if (carrier.cobertura_animal_eur <= 0) fallos.push({ regla: "cobertura_animal", detalle: "sin cobertura" });
  if (carrier.reverificacion_fecha && carrier.reverificacion_fecha < hoy) {
    fallos.push({ regla: "reverificacion_anual", detalle: carrier.reverificacion_fecha });
  }

  const territorios = JSON.parse(carrier.territorios || "[]");
  const especies = JSON.parse(carrier.especies_autorizadas || "[]");
  if (territorios.length && !territorios.includes(booking.zona_origen)) {
    fallos.push({ regla: "territorio", detalle: booking.zona_origen });
  }
  if (especies.length && !especies.includes(booking.especie)) {
    fallos.push({ regla: "especie", detalle: booking.especie });
  }

  if (vehiculo) {
    if (!vehiculo.registrado) fallos.push({ regla: "vehiculo_registrado", detalle: vehiculo.matricula });
    if (vehiculo.itv_vence && vehiculo.itv_vence < hoy) {
      fallos.push({ regla: "itv", detalle: vehiculo.itv_vence });
    }
    if (vehiculo.capacidad < 1) fallos.push({ regla: "capacidad", detalle: "0" });
  }

  return { ok: fallos.length === 0, fallos };
}

/**
 * @param {object} ctx
 * @param {object} ctx.booking
 * @param {Array}  ctx.candidatos  [{ carrier, vehiculo, driver, posicion, stats, ventanaDisponible }]
 */
export function ordenarCandidatos({ booking, candidatos }) {
  const descartados = [];
  const puntuados = [];

  for (const c of candidatos) {
    const elegibilidad = comprobarElegibilidad({ carrier: c.carrier, vehiculo: c.vehiculo, booking });
    if (!elegibilidad.ok) {
      descartados.push({ carrierId: c.carrier.id, razonSocial: c.carrier.razon_social, fallos: elegibilidad.fallos });
      continue;
    }

    const kmRecogida = c.posicion ? haversineKm(c.posicion, { lat: booking.origen_lat, lng: booking.origen_lng }) : 999;

    const desvioKm = c.rutaHabitual
      ? haversineKm(
          { lat: booking.origen_lat, lng: booking.origen_lng },
          { lat: booking.destino_lat, lng: booking.destino_lng }
        ) - c.rutaHabitual.longitudKm
      : 0;

    const partes = {
      encaje_ruta: normalizar(-Math.max(0, desvioKm), -300, 0),
      cercania_recogida: 1 - normalizar(kmRecogida, 0, 150),
      calidad_verificada: ((c.stats?.valoracion ?? 4) - 1) / 4,
      disponibilidad_ventana: c.ventanaDisponible ? 1 : 0.4,
      capacidad_y_vehiculo: c.vehiculo?.capacidad >= (booking.plazas ?? 1) ? 1 : 0.3,
      actividad_reciente: normalizar(c.stats?.servicios30d ?? 0, 0, 40),
    };

    let puntuacion = 0;
    for (const [clave, peso] of Object.entries(PESOS)) puntuacion += peso * (partes[clave] ?? 0);

    puntuados.push({
      carrierId: c.carrier.id,
      razonSocial: c.carrier.razon_social,
      puntuacion: Number(puntuacion.toFixed(2)),
      kmRecogida: Number(kmRecogida.toFixed(1)),
      partes,
    });
  }

  puntuados.sort((a, b) => b.puntuacion - a.puntuacion);
  return { puntuados, descartados };
}

/**
 * Selecciona a quién se envía la solicitud. Si no hay nadie por encima del
 * umbral, amplía radio y número de candidatos en lugar de fallar en silencio.
 */
export function seleccionarDestinatarios({ booking, candidatos, maxDestinatarios = 3 }) {
  const { puntuados, descartados } = ordenarCandidatos({ booking, candidatos });
  let elegidos = puntuados.filter((c) => c.puntuacion >= UMBRAL_MINIMO).slice(0, maxDestinatarios);
  let ampliado = false;

  if (elegidos.length === 0 && puntuados.length > 0) {
    elegidos = puntuados.slice(0, Math.min(maxDestinatarios, puntuados.length));
    ampliado = true;
  }

  return {
    destinatarios: elegidos,
    descartados,
    ampliado,
    requiereRevisionManual: elegidos.length === 0,
  };
}
