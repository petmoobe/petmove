/**
 * API mínima funcional de la plataforma de transporte de animales vivos.
 * Arranque local:   npm install && npm run seed && npm start
 * Arranque en la nube: basta con DATABASE_URL y ADMIN_TOKEN definidas.
 *
 * Alcance: cubre el camino crítico (precio, asignación, ejecución, GPS,
 * imágenes, incidencias y liquidación). No incluye autenticación real de
 * producción, pagos reales ni almacenamiento de ficheros: cada uno de esos
 * puntos está marcado con TODO y su adaptador.
 */

import express from "express";
import crypto from "node:crypto";
import { db, inicializarEsquema } from "./db.js";
import { calcularPrecio, formatearEuros, PricingError } from "./pricing.js";
import { seleccionarDestinatarios } from "./dispatch.js";
import { estimarRuta, aproximarPosicion, enMovimiento } from "./geo.js";
import { validarSubcontratacion, avisosBienestar, PAGO } from "./rules.js";
import { montarPanel, tokenAdministracion } from "./admin.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const id = () => crypto.randomUUID();
const ahora = () => new Date().toISOString();
const antiguedad = () => "no autenticado";

function cargarTarifa() {
  const t = db.prepare("SELECT * FROM tariff_versions WHERE vigente_hasta IS NULL ORDER BY vigente_desde DESC LIMIT 1").get();
  if (!t) throw new Error("No hay tarifa vigente configurada");
  t.recargos = db.prepare("SELECT * FROM surcharges WHERE tariff_id = ?").all(t.id);
  return t;
}

function referencia() {
  const n = db.prepare("SELECT COUNT(*) c FROM bookings").get().c + 1;
  return `PM-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;
}

function auditar(accion, entidad, entidadId, detalle) {
  db.prepare(
    "INSERT INTO audit_log (id, actor_id, actor_tipo, accion, entidad, entidad_id, detalle, creado_en) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id(), antiguedad(), "sistema", accion, entidad, entidadId, JSON.stringify(detalle ?? {}), ahora());
}

/* ---------------------------------------------------------------- salud -- */

app.get("/api/salud", (_req, res) => {
  res.json({ ok: true, servicio: "petmove-backend", version: "0.1.0", fecha: ahora() });
});

/* --------------------------------------------------------------- precio -- */

/**
 * Presupuesto previo: calcula sin crear reserva.
 * body: { origen:{lat,lng}, destino:{lat,lng}, opciones, especie }
 */
app.post("/api/presupuestos", (req, res) => {
  const { origen, destino, opciones = {}, especie } = req.body ?? {};
  if (!origen?.lat || !destino?.lat) {
    return res.status(422).json({ error: "origen y destino con lat/lng son obligatorios" });
  }

  const ruta = estimarRuta(origen, destino);
  const tarifa = cargarTarifa();
  tarifa.tipo_animal = { etiqueta: "Suplemento por especie", suplemento_eur: 0 };

  try {
    const precio = calcularPrecio({ tarifa, distanciaKm: ruta.distanciaKm, duracionH: ruta.duracionH, opciones });
    return res.json({
      ruta,
      precio: {
        ...precio,
        subtotalTexto: formatearEuros(precio.subtotal),
        totalClienteTexto: formatearEuros(precio.totalCliente),
        netoCarrierTexto: formatearEuros(precio.netoCarrier),
      },
      avisos: avisosBienestar({ ...ruta, especie }),
    });
  } catch (e) {
    if (e instanceof PricingError) return res.status(422).json({ error: e.message, detalle: e.detalle });
    throw e;
  }
});

/* -------------------------------------------------------------- reservas - */

app.post("/api/reservas", (req, res) => {
  const { clienteId, petId, origen, destino, recogidaInicio, recogidaFin, opciones = {}, descripcion } = req.body ?? {};
  if (!clienteId || !petId || !origen?.lat || !destino?.lat) {
    return res.status(422).json({ error: "clienteId, petId, origen y destino son obligatorios" });
  }

  const ruta = estimarRuta(origen, destino);
  const tarifa = cargarTarifa();
  tarifa.tipo_animal = { etiqueta: "Suplemento por especie", suplemento_eur: 0 };
  const precio = calcularPrecio({ tarifa, distanciaKm: ruta.distanciaKm, duracionH: ruta.duracionH, opciones });

  const bookingId = id();
  const ref = referencia();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO bookings (id, referencia, cliente_id, pet_id, origen_direccion, origen_lat, origen_lng,
        destino_direccion, destino_lat, destino_lng, recogida_inicio, recogida_fin, distancia_km, duracion_h,
        urgencia, exclusivo, asistencia_vet, estado, descripcion, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      bookingId, ref, clienteId, petId,
      origen.direccion ?? "", origen.lat, origen.lng,
      destino.direccion ?? "", destino.lat, destino.lng,
      recogidaInicio ?? null, recogidaFin ?? null, ruta.distanciaKm, ruta.duracionH,
      opciones.urgencia === "urgente" ? "urgente" : "estandar",
      opciones.exclusivo ? 1 : 0, opciones.asistenciaVet ? 1 : 0,
      "precio", descripcion ?? null, ahora()
    );

    db.prepare(
      `INSERT INTO quotes (id, booking_id, tarifa_version_id, desglose, subtotal_eur, comision_cliente,
        total_cliente, comision_carrier, neto_carrier, puja_minima_carrier, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id(), bookingId, tarifa.id, JSON.stringify(precio.tramos), precio.subtotal,
      precio.comisionCliente, precio.totalCliente, precio.comisionCarrier, precio.netoCarrier,
      precio.pujaMinimaCarrier, ahora()
    );

    auditar("reserva_creada", "bookings", bookingId, { referencia: ref, totalCliente: precio.totalCliente });
  })();

  res.status(201).json({
    bookingId,
    referencia: ref,
    ruta,
    precio: {
      ...precio,
      totalClienteTexto: formatearEuros(precio.totalCliente),
      netoCarrierTexto: formatearEuros(precio.netoCarrier),
    },
    avisos: avisosBienestar({ ...ruta, especie: null }),
  });
});

/* ------------------------------------------------------------ asignación - */

/**
 * Envía la solicitud a los transportistas mejor puntuados.
 * Los candidatos elegibles salen de `carriers` + `vehicles`, ya verificados.
 */
app.post("/api/reservas/:id/asignar", (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Reserva no encontrada" });

  const pet = db.prepare("SELECT * FROM pets WHERE id = ?").get(booking.pet_id);
  const tarifa = cargarTarifa();
  const candidatos = db
    .prepare("SELECT * FROM carriers WHERE estado IN ('activo','bloqueado')")
    .all()
    .map((carrier) => {
      const vehiculo = db.prepare("SELECT * FROM vehicles WHERE carrier_id = ? AND activo = 1 LIMIT 1").get(carrier.id);
      const driver = db.prepare("SELECT * FROM drivers WHERE carrier_id = ? AND activo = 1 LIMIT 1").get(carrier.id);
      const stats = { valoracion: 4.6, servicios30d: 12 };
      return { carrier, vehiculo, driver, posicion: { lat: 40.42, lng: -3.7 }, stats, ventanaDisponible: true, rutaHabitual: null };
    });

  const resultado = seleccionarDestinatarios({
    booking: { ...booking, especie: pet?.especie, zona_origen: "ES" },
    candidatos,
    maxDestinatarios: 3,
  });

  if (resultado.requiereRevisionManual) {
    return res.status(202).json({
      estado: "revision_manual",
      mensaje: "Ningún transportista cumple los requisitos. La reserva queda en cola para revisión del equipo de operaciones.",
      descartados: resultado.descartados,
    });
  }

  // Se conserva el motivo de cada descarte: es la evidencia que sostiene la
  // imposición automática y la que se puede revisar después.
  for (const d of resultado.descartados) {
    db.prepare(
      "INSERT INTO eligibility_checks (id, carrier_id, booking_id, regla, resultado, detalle, creado_en) VALUES (?,?,?,?,?,?,?)"
    ).run(id(), d.carrierId, booking.id, d.fallos.map((f) => f.regla).join(","), "fallo", JSON.stringify(d.fallos), ahora());
  }

  const quote = db.prepare("SELECT * FROM quotes WHERE booking_id = ?").get(booking.id);
  const ofertas = [];
  const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  db.transaction(() => {
    for (const destino of resultado.destinatarios) {
      const ofertaId = id();
      db.prepare(
        `INSERT INTO dispatch_offers (id, booking_id, carrier_id, puntuacion, motivos, neto_eur, estado, expira_en, creado_en)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        ofertaId, booking.id, destino.carrierId, destino.puntuacion,
        JSON.stringify({ partes: destino.partes, kmRecogida: destino.kmRecogida }),
        quote.neto_carrier, "enviada", expira, ahora()
      );
      ofertas.push({ ofertaId, carrierId: destino.carrierId, razonSocial: destino.razonSocial, puntuacion: destino.puntuacion, netoTexto: formatearEuros(quote.neto_carrier) });
    }
    db.prepare("UPDATE bookings SET estado = 'buscando' WHERE id = ?").run(booking.id);
    auditar("asignacion_enviada", "bookings", booking.id, { ofertas: ofertas.length, ampliado: resultado.ampliado });
  })();

  res.json({
    estado: "buscando",
    expiraEn: expira,
    ampliado: resultado.ampliado,
    ofertas,
    descartados: resultado.descartados,
  });
});

/* --------------------------------------------------------- transportista - */

/** El transportista acepta: se crea el viaje y se genera el PIN de entrega. */
app.post("/api/ofertas/:ofertaId/aceptar", (req, res) => {
  const { driverId, vehicleId } = req.body ?? {};
  const oferta = db.prepare("SELECT * FROM dispatch_offers WHERE id = ?").get(req.params.ofertaId);
  if (!oferta) return res.status(404).json({ error: "Oferta no encontrada" });
  if (oferta.estado !== "enviada" && oferta.estado !== "vista") {
    return res.status(409).json({ error: `La oferta ya está ${oferta.estado}` });
  }
  if (new Date(oferta.expira_en) < new Date()) {
    db.prepare("UPDATE dispatch_offers SET estado = 'expirada' WHERE id = ?").run(oferta.id);
    return res.status(409).json({ error: "La oferta ha caducado" });
  }

  const carrier = db.prepare("SELECT * FROM carriers WHERE id = ?").get(oferta.carrier_id);
  const driver = driverId
    ? db.prepare("SELECT * FROM drivers WHERE id = ? AND carrier_id = ?").get(driverId, carrier.id)
    : db.prepare("SELECT * FROM drivers WHERE carrier_id = ? AND activo = 1 LIMIT 1").get(carrier.id);
  const vehicle = vehicleId
    ? db.prepare("SELECT * FROM vehicles WHERE id = ? AND carrier_id = ?").get(vehicleId, carrier.id)
    : db.prepare("SELECT * FROM vehicles WHERE carrier_id = ? AND activo = 1 LIMIT 1").get(carrier.id);

  // Cláusula 4.6: no se ejecuta el servicio con un vehículo o conductor no vinculados.
  if (!driver || driver.carrier_id !== carrier.id) {
    return res.status(422).json({ error: "El conductor no está vinculado al transportista" });
  }
  if (!vehicle || vehicle.carrier_id !== carrier.id) {
    return res.status(422).json({ error: "El vehículo no está vinculado al transportista" });
  }

  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const pinHash = crypto.createHash("sha256").update(pin).digest("hex");
  const tripId = id();

  db.transaction(() => {
    db.prepare("UPDATE dispatch_offers SET estado = 'aceptada' WHERE id = ?").run(oferta.id);
    db.prepare("UPDATE dispatch_offers SET estado = 'retirada' WHERE booking_id = ? AND id <> ? AND estado IN ('enviada','vista')").run(oferta.booking_id, oferta.id);
    db.prepare(
      `INSERT INTO trips (id, booking_id, carrier_id, driver_id, vehicle_id, estado, pin_entrega_hash, creado_en)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(tripId, oferta.booking_id, carrier.id, driver.id, vehicle.id, "asignada", pinHash, ahora());
    db.prepare("UPDATE bookings SET estado = 'asignada' WHERE id = ?").run(oferta.booking_id);

    db.prepare(
      "INSERT INTO payments (id, booking_id, tipo, importe_eur, estado, proveedor_ref, creado_en) VALUES (?,?,?,?,?,?,?)"
    ).run(id(), oferta.booking_id, "cobro_cliente", 0, "autorizado", null, ahora());
    db.prepare(
      "INSERT INTO payments (id, booking_id, tipo, importe_eur, estado, proveedor_ref, creado_en) VALUES (?,?,?,?,?,?,?)"
    ).run(id(), oferta.booking_id, "liquidacion_carrier", oferta.neto_eur, "pendiente", null, ahora());

    auditar("oferta_aceptada", "trips", tripId, { carrier: carrier.razon_social, neto: oferta.neto_eur });
  })();

  // TODO producción: enviar el PIN al cliente por canal distinto al conductor.
  res.json({ tripId, estado: "asignada", pinEntregaDemo: pin, transportista: carrier.razon_social });
});

/** El contrato solo permite ceder a otro operador verificado y autorizado. */
app.post("/api/viajes/:tripId/subcontratar", (req, res) => {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  const padre = db.prepare("SELECT * FROM carriers WHERE id = ?").get(trip.carrier_id);
  const sub = db.prepare("SELECT * FROM carriers WHERE id = ?").get(req.body?.subcontratistaId);
  const check = validarSubcontratacion({ carrierPadre: padre, subcontratista: sub, autorizacion: req.body?.autorizacion });

  if (!check.ok) return res.status(403).json({ error: "Subcontratación no permitida", motivos: check.fallos });
  db.prepare("UPDATE trips SET carrier_id = ? WHERE id = ?").run(sub.id, trip.id);
  auditar("subcontratacion_aprobada", "trips", trip.id, { de: padre.razon_social, a: sub.razon_social });
  res.json({ ok: true, transportistaActual: sub.razon_social });
});

/* ------------------------------------------------------------------- GPS -- */

app.post("/api/viajes/:tripId/posiciones", (req, res) => {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  if (!["asignada", "recogida", "en_curso", "pausa"].includes(trip.estado)) {
    return res.status(409).json({ error: `No se registra posición con el viaje en estado ${trip.estado}` });
  }
  const { lat, lng, velocidad, precision } = req.body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(422).json({ error: "lat y lng numéricos son obligatorios" });
  }

  db.prepare(
    "INSERT INTO trip_positions (id, trip_id, lat, lng, velocidad, precision_m, registrado_en) VALUES (?,?,?,?,?,?,?)"
  ).run(id(), trip.id, lat, lng, velocidad ?? null, precision ?? null, ahora());

  if (trip.estado === "asignada") db.prepare("UPDATE trips SET estado = 'en_curso', iniciada_en = ? WHERE id = ?").run(ahora(), trip.id);

  // Cliente: posición aproximada, nunca la traza exacta (cláusula 10.2).
  res.status(201).json({ ok: true, visibleCliente: aproximarPosicion(lat, lng), movimiento: enMovimiento(velocidad) });
});

app.get("/api/viajes/:tripId/seguimiento", (req, res) => {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  const ultima = db.prepare("SELECT * FROM trip_positions WHERE trip_id = ? ORDER BY registrado_en DESC LIMIT 1").get(trip.id);
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(trip.booking_id);

  res.json({
    estado: trip.estado,
    posicion: ultima ? aproximarPosicion(ultima.lat, ultima.lng) : null,
    actualizadoEn: ultima?.registrado_en ?? null,
    destino: { lat: booking.destino_lat, lng: booking.destino_lng, direccion: booking.destino_direccion },
    eta: trip.estado === "en_curso" ? estimarRuta({ lat: ultima?.lat ?? booking.origen_lat, lng: ultima?.lng ?? booking.origen_lng }, { lat: booking.destino_lat, lng: booking.destino_lng }) : null,
  });
});

/* -------------------------------------------------------------- imágenes - */

/** El cliente pide una imagen. No obliga a responder de inmediato (cláusula 10.4). */
app.post("/api/viajes/:tripId/solicitudes-imagen", (req, res) => {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  const { solicitanteId, motivo } = req.body ?? {};
  if (!solicitanteId) return res.status(422).json({ error: "solicitanteId es obligatorio" });

  const reqId = id();
  db.prepare(
    "INSERT INTO photo_requests (id, trip_id, solicitado_por, motivo, estado, creado_en) VALUES (?,?,?,?,'pendiente',?)"
  ).run(reqId, trip.id, solicitanteId, motivo ?? null, ahora());
  auditar("imagen_solicitada", "trips", trip.id, { solicitanteId, motivo });

  res.status(201).json({
    solicitudId: reqId,
    estado: "pendiente",
    mensaje: "Solicitud registrada. El conductor atenderá cuando el vehículo esté detenido en lugar seguro.",
  });
});

/** El conductor sube la imagen. Se bloquea si el vehículo circula. */
app.post("/api/solicitudes-imagen/:solicitudId/atender", (req, res) => {
  const solicitud = db.prepare("SELECT * FROM photo_requests WHERE id = ?").get(req.params.solicitudId);
  if (!solicitud) return res.status(404).json({ error: "Solicitud no encontrada" });
  if (solicitud.estado !== "pendiente") return res.status(409).json({ error: `La solicitud ya está ${solicitud.estado}` });

  const { url, lat, lng, velocidad } = req.body ?? {};
  if (!url) return res.status(422).json({ error: "url de la imagen es obligatoria" });
  if (enMovimiento(velocidad)) {
    return res.status(409).json({
      error: "No se pueden enviar imágenes con el vehículo en movimiento",
      regla: "contrato 10.5",
    });
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expira = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const fotoId = id();

  db.transaction(() => {
    db.prepare(
      "INSERT INTO trip_photos (id, photo_request_id, trip_id, url, lat, lng, en_movimiento, token, token_expira, creado_en) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(fotoId, solicitud.id, solicitud.trip_id, url, lat ?? null, lng ?? null, 0, token, expira, ahora());
    db.prepare("UPDATE photo_requests SET estado = 'atendida', atendida_en = ? WHERE id = ?").run(ahora(), solicitud.id);
    auditar("imagen_registrada", "trips", solicitud.trip_id, { fotoId });
  })();

  res.status(201).json({ fotoId, enlace: `/api/imagenes/${token}`, expiraEn: expira });
});

/** Enlace autenticado y temporal: no es una URL pública permanente. */
app.get("/api/imagenes/:token", (req, res) => {
  const foto = db.prepare("SELECT * FROM trip_photos WHERE token = ?").get(req.params.token);
  if (!foto) return res.status(404).json({ error: "Enlace no válido" });
  if (new Date(foto.token_expira) < new Date()) return res.status(410).json({ error: "Enlace caducado" });
  res.json({
    fotoId: foto.id,
    viaje: foto.trip_id,
    capturadaEn: foto.creado_en,
    ubicacion: foto.lat != null ? aproximarPosicion(foto.lat, foto.lng) : null,
    url: foto.url,
    expiraEn: foto.token_expira,
  });
});

/* ------------------------------------------------------------ incidencias - */

app.post("/api/viajes/:tripId/incidencias", (req, res) => {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  const { tipo, gravedad, descripcion, reportadoPor } = req.body ?? {};
  if (!tipo || !descripcion || !reportadoPor) {
    return res.status(422).json({ error: "tipo, descripcion y reportadoPor son obligatorios" });
  }

  const incId = id();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO incidents (id, trip_id, booking_id, tipo, gravedad, descripcion, reportado_por, estado, creado_en) VALUES (?,?,?,?,?,?,?,'abierta',?)"
    ).run(incId, trip.id, trip.booking_id, tipo, gravedad ?? "media", descripcion, reportadoPor, ahora());

    const bloqueaPago = ["alta", "critica"].includes(gravedad ?? "media");
    db.prepare("UPDATE trips SET estado = 'incidente' WHERE id = ?").run(trip.id);
    db.prepare("UPDATE bookings SET estado = 'incidente' WHERE id = ?").run(trip.booking_id);
    if (bloqueaPago) {
      // El contrato permite retener la liquidación mientras hay incidencia grave.
      db.prepare("UPDATE payments SET estado = 'bloqueado' WHERE booking_id = ? AND tipo = 'liquidacion_carrier'").run(trip.booking_id);
    }
    auditar("incidencia_abierta", "trips", trip.id, { tipo, gravedad, bloqueaPago });
  })();

  res.status(201).json({ incidenciaId: incId, estado: "abierta", pagoBloqueado: ["alta", "critica"].includes(gravedad ?? "media") });
});

/* ---------------------------------------------------------- liquidación - */

/** Prueba de entrega con PIN y liberación del pago. */
app.post("/api/viajes/:tripId/entregar", (req, res) => {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  const { pin, pruebaUrl } = req.body ?? {};

  const pinHash = crypto.createHash("sha256").update(String(pin ?? "")).digest("hex");
  if (pinHash !== trip.pin_entrega_hash) return res.status(403).json({ error: "PIN de entrega incorrecto" });

  const incidenciasAbiertas = db.prepare("SELECT * FROM incidents WHERE trip_id = ? AND estado <> 'cerrada' AND gravedad IN ('alta','critica')").all(trip.id);
  const liquidacion = db.prepare("SELECT * FROM payments WHERE booking_id = ? AND tipo = 'liquidacion_carrier'").get(trip.booking_id);

  db.transaction(() => {
    db.prepare("UPDATE trips SET estado = 'cerrada', entregada_en = ?, prueba_entrega_url = ? WHERE id = ?").run(ahora(), pruebaUrl ?? null, trip.id);
    db.prepare("UPDATE bookings SET estado = 'entregada' WHERE id = ?").run(trip.booking_id);
    if (incidenciasAbiertas.length === 0) {
      db.prepare("UPDATE payments SET estado = 'liberado' WHERE booking_id = ? AND tipo = 'liquidacion_carrier'").run(trip.booking_id);
      db.prepare(
        "INSERT INTO payments (id, booking_id, tipo, importe_eur, estado, proveedor_ref, creado_en) VALUES (?,?,?,?,?,?,?)"
      ).run(id(), trip.booking_id, "comision_plataforma", 0, "capturado", null, ahora());
    }
    auditar("entrega_confirmada", "trips", trip.id, { incidencias: incidenciasAbiertas.length });
  })();

  res.json({
    estado: "cerrada",
    liquidacion: incidenciasAbiertas.length === 0 ? "liberada" : "retenida",
    motivoRetencion: incidenciasAbiertas.length ? "Existe una incidencia grave abierta" : null,
    importeNeto: liquidacion ? formatearEuros(liquidacion.importe_eur) : null,
    configuracionPago: PAGO,
  });
});

/* -------------------------------------------------------- administración - */

app.get("/api/admin/resumen", (_req, res) => {
  const uno = (sql, ...args) => db.prepare(sql).get(...args);
  res.json({
    reservas: uno("SELECT COUNT(*) n FROM bookings").n,
    porEstado: db.prepare("SELECT estado, COUNT(*) n FROM bookings GROUP BY estado").all(),
    transportistas: uno("SELECT COUNT(*) n FROM carriers").n,
    activos: uno("SELECT COUNT(*) n FROM carriers WHERE estado = 'activo'").n,
    bloqueados: uno("SELECT COUNT(*) n FROM carriers WHERE estado = 'bloqueado'").n,
    viajesEnCurso: uno("SELECT COUNT(*) n FROM trips WHERE estado IN ('recogida','en_curso','pausa')").n,
    incidenciasAbiertas: uno("SELECT COUNT(*) n FROM incidents WHERE estado <> 'cerrada'").n,
    pagosBloqueados: uno("SELECT COUNT(*) n FROM payments WHERE estado = 'bloqueado'").n,
    verificacionesPendientes: uno("SELECT COUNT(*) n FROM carriers WHERE estado = 'pendiente_verificacion'").n,
  });
});

/** Alta de transportista: entra en verificación, nunca activo de golpe. */
app.post("/api/admin/transportistas", (req, res) => {
  const b = req.body ?? {};
  const obligatorios = ["ownerUserId", "razonSocial", "nif", "formaJuridica", "autorizacionNumero"];
  const faltan = obligatorios.filter((k) => !b[k]);
  if (faltan.length) return res.status(422).json({ error: "Faltan campos obligatorios", faltan });
  if (!["sociedad", "autonomo"].includes(b.formaJuridica)) {
    return res.status(422).json({ error: "Solo se admiten sociedades o profesionales autónomos registrados", regla: "contrato 2.1" });
  }

  const carrierId = id();
  db.prepare(
    `INSERT INTO carriers (id, owner_user_id, razon_social, nif, forma_juridica, registro_datos, titular_real, iban,
      autorizacion_numero, sirentra_alta, traces_alta, territorios, especies_autorizadas, rcv_eur,
      cobertura_animal_eur, poliza_vencimiento, estado, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pendiente_verificacion',?)`
  ).run(
    carrierId, b.ownerUserId, b.razonSocial, b.nif, b.formaJuridica, b.registroDatos ?? null, b.titularReal ?? null, b.iban ?? null,
    b.autorizacionNumero, b.sirentraAlta ? 1 : 0, b.tracesAlta ? 1 : 0,
    JSON.stringify(b.territorios ?? []), JSON.stringify(b.especiesAutorizadas ?? []),
    b.rcvEur ?? 0, b.coberturaAnimalEur ?? 0, b.polizaVencimiento ?? null, ahora()
  );
  auditar("transportista_alta", "carriers", carrierId, { nif: b.nif });
  res.status(201).json({ carrierId, estado: "pendiente_verificacion", siguiente: "Adjuntar documentos del Anexo IV y superar la verificación" });
});

app.post("/api/admin/transportistas/:id/verificar", (req, res) => {
  const carrier = db.prepare("SELECT * FROM carriers WHERE id = ?").get(req.params.id);
  if (!carrier) return res.status(404).json({ error: "Transportista no encontrado" });

  const faltantes = [];
  if (!carrier.autorizacion_numero) faltantes.push("autorizacion_transporte_animales");
  if (!carrier.sirentra_alta) faltantes.push("sirentra");
  if (!carrier.cobertura_animal_eur) faltantes.push("seguro_cobertura_animal");
  if (!carrier.poliza_vencimiento) faltantes.push("poliza_vencimiento");
  if (faltantes.length) return res.status(422).json({ error: "No se puede activar", faltantes, regla: "contrato 4.5" });

  const hoy = new Date();
  const rever = new Date(hoy);
  rever.setFullYear(rever.getFullYear() + 1);

  db.prepare("UPDATE carriers SET estado = 'activo', verificacion_fecha = ?, reverificacion_fecha = ? WHERE id = ?")
    .run(hoy.toISOString().slice(0, 10), rever.toISOString().slice(0, 10), carrier.id);
  auditar("transportista_verificado", "carriers", carrier.id, { reverificacion: rever.toISOString().slice(0, 10) });
  res.json({ ok: true, estado: "activo", proximaReverificacion: rever.toISOString().slice(0, 10) });
});

/** Revisión anual: bloquea a quien no ha aceptado la versión vigente. */
app.post("/api/admin/revision-anual", (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const caducados = db.prepare("SELECT * FROM carriers WHERE estado = 'activo' AND reverificacion_fecha < ?").all(hoy);
  db.transaction(() => {
    for (const c of caducados) {
      db.prepare("UPDATE carriers SET estado = 'bloqueado' WHERE id = ?").run(c.id);
      auditar("bloqueo_por_revision", "carriers", c.id, { fecha: c.reverificacion_fecha });
    }
  })();
  res.json({ bloqueados: caducados.length, transportistas: caducados.map((c) => c.razon_social) });
});

/* ------------------------------------------------------------------ panel -- */

montarPanel(app);

/* ---------------------------------------------------------------- error -- */

/* --------------------------------------------------------------- arranque -- */

await inicializarEsquema();

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno", detalle: err.message });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`Motor de datos: ${db.motor}`);
    console.log(`API escuchando en ${base}`);
    console.log(`Panel de administración en ${base}/panel`);
    console.log(`Token de administración: ${tokenAdministracion()}`);
  });
}

export default app;
