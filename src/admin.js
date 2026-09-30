/**
 * Panel de administración.
 *
 * Se sirve como web estática desde el mismo servidor Express que la API
 * (carpeta /public). Sin dependencias de build: HTML, CSS y JavaScript
 * nativos, para que funcione con solo `npm start`.
 *
 * Autenticación: token de administración en cabecera X-Admin-Token.
 * El token se genera en el arranque y se imprime en consola.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { db } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

const hoyIso = () => new Date().toISOString().slice(0, 10);
const ts = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

function auditar(accion, entidad, entidadId, detalle) {
  db.prepare(
    "INSERT INTO audit_log (id, actor_id, actor_tipo, accion, entidad, entidad_id, detalle, creado_en) VALUES (?,?,?,?,?,?,?,?)"
  ).run(uid(), "admin", "admin", accion, entidad, entidadId, JSON.stringify(detalle ?? {}), ts());
}

/* ------------------------------------------------------------------ auth -- */

// TODO producción: sustituir por autenticación real con sesión, roles y 2FA.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(18).toString("hex");

export function tokenAdministracion() {
  return ADMIN_TOKEN;
}

/* ------------------------------------------------------------- consultas -- */

const q = {
  resumen: () => {
    const uno = (sql, ...args) => db.prepare(sql).get(...args).n;
    const facturado = db.prepare(
      "SELECT COALESCE(SUM(total_cliente),0) total, COALESCE(SUM(neto_carrier),0) neto, COALESCE(SUM(comision_cliente + comision_carrier),0) comision FROM quotes"
    ).get();
    return {
      reservas: uno("SELECT COUNT(*) n FROM bookings"),
      porEstado: db.prepare("SELECT estado, COUNT(*) n FROM bookings GROUP BY estado ORDER BY n DESC").all(),
      transportistas: uno("SELECT COUNT(*) n FROM carriers"),
      activos: uno("SELECT COUNT(*) n FROM carriers WHERE estado = 'activo'"),
      bloqueados: uno("SELECT COUNT(*) n FROM carriers WHERE estado = 'bloqueado'"),
      pendientesVerificacion: uno("SELECT COUNT(*) n FROM carriers WHERE estado = 'pendiente_verificacion'"),
      viajesEnCurso: uno("SELECT COUNT(*) n FROM trips WHERE estado IN ('recogida','en_curso','pausa')"),
      incidenciasAbiertas: uno("SELECT COUNT(*) n FROM incidents WHERE estado <> 'cerrada'"),
      pagosBloqueados: uno("SELECT COUNT(*) n FROM payments WHERE estado = 'bloqueado'"),
      ofertasPendientes: uno("SELECT COUNT(*) n FROM dispatch_offers WHERE estado IN ('enviada','vista')"),
      dinero: {
        facturadoCliente: facturado.total,
        netoTransportistas: facturado.neto,
        ingresoPlataforma: facturado.comision,
      },
    };
  },

  reservas: () =>
    db.prepare(
      `SELECT b.id, b.referencia, b.estado, b.origen_direccion, b.destino_direccion, b.distancia_km,
              b.creado_en, u.nombre AS cliente, p.nombre AS mascota, p.especie,
              q.total_cliente, q.neto_carrier, q.subtotal_eur, q.comision_cliente, q.comision_carrier,
              t.id AS trip_id, t.estado AS trip_estado, c.razon_social AS transportista
         FROM bookings b
         LEFT JOIN users u ON u.id = b.cliente_id
         LEFT JOIN pets p ON p.id = b.pet_id
         LEFT JOIN quotes q ON q.booking_id = b.id
         LEFT JOIN trips t ON t.booking_id = b.id
         LEFT JOIN carriers c ON c.id = t.carrier_id
        ORDER BY b.creado_en DESC`
    ).all(),

  transportistas: () =>
    db.prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM drivers d WHERE d.carrier_id = c.id) AS conductores,
              (SELECT COUNT(*) FROM vehicles v WHERE v.carrier_id = c.id) AS vehiculos
         FROM carriers c ORDER BY c.razon_social`
    ).all(),

  documentos: (carrierId) =>
    db.prepare("SELECT * FROM carrier_documents WHERE carrier_id = ? ORDER BY tipo").all(carrierId),

  viajes: () =>
    db.prepare(
      `SELECT t.id, t.estado, t.iniciada_en, t.entregada_en, b.referencia, b.destino_direccion,
              c.razon_social AS transportista, d.nombre AS conductor, v.matricula,
              (SELECT registrado_en FROM trip_positions tp WHERE tp.trip_id = t.id ORDER BY registrado_en DESC LIMIT 1) AS ultima_senal,
              (SELECT COUNT(*) FROM trip_positions tp WHERE tp.trip_id = t.id) AS puntos_gps
         FROM trips t
         LEFT JOIN bookings b ON b.id = t.booking_id
         LEFT JOIN carriers c ON c.id = t.carrier_id
         LEFT JOIN drivers d ON d.id = t.driver_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
        ORDER BY t.creado_en DESC`
    ).all(),

  incidencias: () =>
    db.prepare(
      `SELECT i.*, b.referencia, c.razon_social AS transportista
         FROM incidents i
         LEFT JOIN bookings b ON b.id = i.booking_id
         LEFT JOIN trips t ON t.id = i.trip_id
         LEFT JOIN carriers c ON c.id = t.carrier_id
        ORDER BY CASE i.gravedad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 i.creado_en DESC`
    ).all(),

  pagos: () =>
    db.prepare(
      `SELECT pay.*, b.referencia FROM payments pay
         LEFT JOIN bookings b ON b.id = pay.booking_id
        ORDER BY pay.creado_en DESC`
    ).all(),

  descartes: () =>
    db.prepare(
      `SELECT e.*, c.razon_social, b.referencia FROM eligibility_checks e
         LEFT JOIN carriers c ON c.id = e.carrier_id
         LEFT JOIN bookings b ON b.id = e.booking_id
        ORDER BY e.creado_en DESC LIMIT 100`
    ).all(),

  ofertas: () =>
    db.prepare(
      `SELECT o.*, c.razon_social, b.referencia, b.origen_direccion, b.destino_direccion
         FROM dispatch_offers o
         LEFT JOIN carriers c ON c.id = o.carrier_id
         LEFT JOIN bookings b ON b.id = o.booking_id
        ORDER BY o.creado_en DESC LIMIT 100`
    ).all(),

  imagenes: () =>
    db.prepare(
      `SELECT f.id, f.trip_id, f.creado_en, f.en_movimiento, f.token_expira, b.referencia,
              (SELECT COUNT(*) FROM photo_requests r WHERE r.trip_id = f.trip_id) AS peticiones
         FROM trip_photos f LEFT JOIN trips t ON t.id = f.trip_id
         LEFT JOIN bookings b ON b.id = t.booking_id ORDER BY f.creado_en DESC LIMIT 100`
    ).all(),

  auditoria: () =>
    db.prepare("SELECT * FROM audit_log ORDER BY creado_en DESC LIMIT 200").all(),

  tarifa: () => {
    const t = db.prepare("SELECT * FROM tariff_versions WHERE vigente_hasta IS NULL ORDER BY vigente_desde DESC LIMIT 1").get();
    if (!t) return null;
    return { ...t, recargos: db.prepare("SELECT * FROM surcharges WHERE tariff_id = ?").all(t.id) };
  },
};

/* ---------------------------------------------------------------- rutas --- */

export function montarPanel(app, { requiereSesion }) {
  app.use("/panel", express_static(publicDir));

  const api = express_router();

  api.post("/sesion", (req, res) => {
    if ((req.body?.token ?? "") !== ADMIN_TOKEN) {
      return res.status(401).json({ error: "Token de administración incorrecto" });
    }
    res.json({ ok: true });
  });

  api.use(requiereAdmin);

  api.get("/resumen", (_req, res) => res.json(q.resumen()));
  api.get("/reservas", (_req, res) => res.json(q.reservas()));
  api.get("/transportistas", (_req, res) => res.json(q.transportistas()));
  api.get("/transportistas/:id/documentos", (req, res) => res.json(q.documentos(req.params.id)));
  api.get("/viajes", (_req, res) => res.json(q.viajes()));
  api.get("/incidencias", (_req, res) => res.json(q.incidencias()));
  api.get("/pagos", (_req, res) => res.json(q.pagos()));
  api.get("/descartes", (_req, res) => res.json(q.descartes()));
  api.get("/ofertas", (_req, res) => res.json(q.ofertas()));
  api.get("/imagenes", (_req, res) => res.json(q.imagenes()));
  api.get("/auditoria", (_req, res) => res.json(q.auditoria()));
  api.get("/tarifa", (_req, res) => res.json(q.tarifa() ?? {}));

  // Reasignación manual (contrato: la operación puede intervenir)
  api.post("/reservas/:id/reasignar", (req, res) => {
    const trip = db.prepare("SELECT * FROM trips WHERE booking_id = ?").get(req.params.id);
    if (!trip) return res.status(404).json({ error: "No hay viaje asignado para esa reserva" });
    const destino = db.prepare("SELECT * FROM carriers WHERE id = ?").get(req.body?.carrierId);
    if (!destino || destino.estado !== "activo") {
      return res.status(422).json({ error: "El transportista destino debe estar verificado y activo" });
    }
    db.prepare("UPDATE trips SET carrier_id = ?, estado = 'asignada' WHERE id = ?").run(destino.id, trip.id);
    db.prepare("INSERT INTO audit_log (id, actor_id, actor_tipo, accion, entidad, entidad_id, detalle, creado_en) VALUES (?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), "admin", "admin", "reasignacion_manual", "trips", trip.id, JSON.stringify({ a: destino.razon_social }), new Date().toISOString());
    res.json({ ok: true, transportista: destino.razon_social });
  });

  // Cierre de incidencia: desbloquea la liquidación si procede
  api.post("/incidencias/:id/cerrar", (req, res) => {
    const inc = db.prepare("SELECT * FROM incidents WHERE id = ?").get(req.params.id);
    if (!inc) return res.status(404).json({ error: "Incidencia no encontrada" });
    db.transaction(() => {
      db.prepare("UPDATE incidents SET estado = 'cerrada' WHERE id = ?").run(inc.id);
      const otras = db.prepare("SELECT COUNT(*) n FROM incidents WHERE trip_id = ? AND estado <> 'cerrada' AND gravedad IN ('alta','critica')").get(inc.trip_id).n;
      if (otras === 0 && inc.booking_id) {
        db.prepare("UPDATE payments SET estado = 'pendiente' WHERE booking_id = ? AND tipo = 'liquidacion_carrier' AND estado = 'bloqueado'").run(inc.booking_id);
      }
      db.prepare("INSERT INTO audit_log (id, actor_id, actor_tipo, accion, entidad, entidad_id, detalle, creado_en) VALUES (?,?,?,?,?,?,?,?)")
        .run(crypto.randomUUID(), "admin", "admin", "incidencia_cerrada", "incidents", inc.id, JSON.stringify({ resolucion: req.body?.resolucion ?? null }), new Date().toISOString());
    })();
    res.json({ ok: true, pagoDesbloqueado: true });
  });

  // Revisión anual completa: bloquea transportistas sin reverificación vigente
  api.post("/revision-anual", (_req, res) => {
    const hoyIso = new Date().toISOString().slice(0, 10);
    const caducados = db.prepare("SELECT * FROM carriers WHERE estado = 'activo' AND (reverificacion_fecha IS NULL OR reverificacion_fecha < ?)").all(hoyIso);
    for (const c of caducados) {
      db.prepare("UPDATE carriers SET estado = 'bloqueado' WHERE id = ?").run(c.id);
      db.prepare("INSERT INTO audit_log (id, actor_id, actor_tipo, accion, entidad, entidad_id, detalle, creado_en) VALUES (?,?,?,?,?,?,?,?)")
        .run(crypto.randomUUID(), "admin", "admin", "bloqueo_revision_anual", "carriers", c.id, JSON.stringify({ motivo: "Reverificación anual pendiente" }), new Date().toISOString());
    }
    res.json({ bloqueados: caducados.length, transportistas: caducados.map((c) => c.razon_social) });
  });

  // Alta de transportista desde el panel
  api.post("/transportistas", (req, res) => {
    const b = req.body ?? {};
    const faltan = ["razonSocial", "nif", "formaJuridica", "autorizacionNumero"].filter((k) => !b[k]);
    if (faltan.length) return res.status(422).json({ error: "Faltan campos", faltan });
    if (!["sociedad", "autonomo"].includes(b.formaJuridica)) {
      return res.status(422).json({ error: "Solo se admiten sociedades o profesionales autónomos registrados" });
    }
    const carrierId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO carriers (id, owner_user_id, razon_social, nif, forma_juridica, registro_datos, titular_real, iban,
        autorizacion_numero, sirentra_alta, traces_alta, territorios, especies_autorizadas, rcv_eur,
        cobertura_animal_eur, poliza_vencimiento, estado, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pendiente_verificacion',?)`
    ).run(
      carrierId, b.ownerUserId ?? "admin", b.razonSocial, b.nif, b.formaJuridica,
      b.registroDatos ?? null, b.titularReal ?? null, b.iban ?? null, b.autorizacionNumero,
      b.sirentraAlta ? 1 : 0, b.tracesAlta ? 1 : 0,
      JSON.stringify(b.territorios ?? ["ES"]), JSON.stringify(b.especiesAutorizadas ?? ["perro", "gato"]),
      b.rcvEur ?? 0, b.coberturaAnimalEur ?? 0, b.polizaVencimiento ?? null, new Date().toISOString()
    );
    res.status(201).json({ carrierId, estado: "pendiente_verificacion" });
  });

  // Verificación: comprueba requisitos antes de activar
  api.post("/transportistas/:id/verificar", (req, res) => {
    const c = db.prepare("SELECT * FROM carriers WHERE id = ?").get(req.params.id);
    if (!c) return res.status(404).json({ error: "Transportista no encontrado" });
    const faltantes = [];
    if (!c.autorizacion_numero) faltantes.push("Autorización de transporte de animales");
    if (!c.sirentra_alta) faltantes.push("Inscripción en SIRENTRA");
    if (!c.cobertura_animal_eur) faltantes.push("Cobertura de animales bajo custodia");
    if (!c.poliza_vencimiento) faltantes.push("Vencimiento de póliza");
    if (!c.iban) faltantes.push("Cuenta bancaria verificada");
    if (faltantes.length) return res.status(422).json({ error: "No se puede activar", faltantes });

    const hoy = new Date();
    const rever = new Date(hoy);
    rever.setFullYear(rever.getFullYear() + 1);
    db.prepare("UPDATE carriers SET estado = 'activo', verificacion_fecha = ?, reverificacion_fecha = ? WHERE id = ?")
      .run(hoy.toISOString().slice(0, 10), rever.toISOString().slice(0, 10), c.id);
    db.prepare("INSERT INTO audit_log (id, actor_id, actor_tipo, accion, entidad, entidad_id, detalle, creado_en) VALUES (?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), "admin", "admin", "transportista_verificado", "carriers", c.id, JSON.stringify({ reverificacion: rever.toISOString().slice(0, 10) }), new Date().toISOString());
    res.json({ ok: true, estado: "activo", proximaReverificacion: rever.toISOString().slice(0, 10) });
  });

  // Bloqueo manual
  api.post("/transportistas/:id/bloquear", (req, res) => {
    const c = db.prepare("SELECT * FROM carriers WHERE id = ?").get(req.params.id);
    if (!c) return res.status(404).json({ error: "Transportista no encontrado" });
    db.prepare("UPDATE carriers SET estado = 'bloqueado' WHERE id = ?").run(c.id);
    db.prepare("INSERT INTO audit_log (id, actor_id, actor_tipo, accion, entidad, entidad_id, detalle, creado_en) VALUES (?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), "admin", "admin", "bloqueo_manual", "carriers", c.id, JSON.stringify({ motivo: req.body?.motivo ?? "Sin motivo indicado" }), new Date().toISOString());
    res.json({ ok: true, estado: "bloqueado" });
  });

  app.use("/api/admin", api);
}

/* -------------------------------------------------------------- estáticos -- */

function express_static(dir) {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
  };
  return (req, res, next) => {
    const rel = req.path === "/" || req.path === "" ? "index.html" : req.path.replace(/^\/+/, "");
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) return res.status(403).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
    res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  };
}
