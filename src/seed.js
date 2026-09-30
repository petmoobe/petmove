/**
 * Datos de ejemplo para arrancar la plataforma sin configurar nada.
 * Idempotente: puede ejecutarse varias veces sin duplicar registros.
 *
 * Uso:  npm run seed
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, inicializarEsquema } from "./db.js";

const id = () => crypto.randomUUID();
const ahora = () => new Date().toISOString();
const hoy = () => new Date().toISOString().slice(0, 10);

await inicializarEsquema();

/* --------------------------------------------------------------- tarifa -- */

const existente = await db.get("SELECT * FROM tariff_versions WHERE vigente_hasta IS NULL ORDER BY vigente_desde DESC LIMIT 1");
const tarifaId = existente?.id ?? id();

if (!existente) {
  await db.run(
    `INSERT INTO tariff_versions (id, version, vigente_desde, vigente_hasta, base_eur, por_km_eur,
       por_hora_eur, comision_cliente_pct, comision_carrier_pct, margen_puja_pct, nota)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    tarifaId, "2026.1", "2026-01-01", null,
    1500, 75, 400, 1000, 1500, 800,
    "Tarifa de lanzamiento. El margen de puja permite operar por encima del umbral mínimo."
  );

  const recargos = [
    ["urgencia", "Recargo por urgencia", "porcentaje", 2000],
    ["transporte_exclusivo", "Transporte exclusivo del animal", "porcentaje", 2500],
    ["asistencia_veterinaria", "Asistencia veterinaria a bordo", "fijo", 4500],
  ];
  for (const [clave, etiqueta, tipo, valor] of recargos) {
    await db.run(
      "INSERT INTO surcharges (id, tariff_id, clave, etiqueta, tipo, valor) VALUES (?,?,?,?,?,?)",
      id(), tarifaId, clave, etiqueta, tipo, valor
    );
  }
}

/* ---------------------------------------------------------------- users -- */

const pass = bcrypt.hashSync("demo1234", 10);

async function usuario(role, nombre, email, telefono) {
  const previo = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (previo) return previo.id;
  const uid = id();
  await db.run(
    "INSERT INTO users (id, role, nombre, email, telefono, password_hash, verificado, creado_en) VALUES (?,?,?,?,?,?,?,?)",
    uid, role, nombre, email, telefono, pass, 1, ahora()
  );
  return uid;
}

const clienteId = await usuario("cliente", "Laura Méndez", "laura@example.com", "+34600000001");
const carrierUserId = await usuario("transportista", "TransMascotas Ibérica SL", "operaciones@transmascotas.example", "+34600000002");

/* ------------------------------------------------------------ transportista */

let carrier = await db.get("SELECT * FROM carriers WHERE nif = ?", "B12345678");
if (!carrier) {
  const carrierId = id();
  await db.run(
    `INSERT INTO carriers (id, owner_user_id, razon_social, nif, forma_juridica, registro_datos, titular_real, iban,
       autorizacion_numero, sirentra_alta, traces_alta, territorios, especies_autorizadas, rcv_eur,
       cobertura_animal_eur, poliza_vencimiento, estado, verificacion_fecha, reverificacion_fecha, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    carrierId, carrierUserId, "TransMascotas Ibérica SL", "B12345678", "sociedad",
    "Registro Mercantil de Madrid, tomo 1000, folio 10", "Ana Ruiz", "ES9121000418450200051332",
    "AT-28-000123", 1, 1, JSON.stringify(["ES"]), JSON.stringify(["perro", "gato"]),
    600000, 1200000, "2027-03-31", "activo", hoy(), "2027-09-30", ahora()
  );

  await db.run(
    "INSERT INTO drivers (id, carrier_id, nombre, documento, formacion_vence, activo, creado_en) VALUES (?,?,?,?,?,1,?)",
    id(), carrierId, "Carlos Núñez", "12345678X", "2028-05-20", ahora()
  );

  await db.run(
    `INSERT INTO vehicles (id, carrier_id, matricula, tipo, capacidad, refrigerado, itv_vence, registrado, activo, creado_en)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
    id(), carrierId, "1234 KLM", "furgoneta acondicionada", 4, 1, "2027-06-15", 1, ahora()
  );

  // Una segunda empresa en estado pendiente, para ver la verificación en el panel.
  await db.run(
    `INSERT INTO carriers (id, owner_user_id, razon_social, nif, forma_juridica, registro_datos, titular_real, iban,
       autorizacion_numero, sirentra_alta, traces_alta, territorios, especies_autorizadas, rcv_eur,
       cobertura_animal_eur, poliza_vencimiento, estado, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pendiente_verificacion',?)`,
    id(), carrierUserId, "Mascotas del Norte, S.L.", "B87654321", "sociedad",
    null, "Iván Soto", "ES1000492352082412345678", "AT-48-000456",
    0, 0, JSON.stringify(["ES"]), JSON.stringify(["perro"]), 300000, 0, null, ahora()
  );

  carrier = { id: carrierId };
}

/* ---------------------------------------------------------------- mascota */

const petPrevia = await db.get("SELECT * FROM pets WHERE owner_user_id = ? AND nombre = ?", clienteId, "Nala");
if (!petPrevia) {
  await db.run(
    `INSERT INTO pets (id, owner_user_id, nombre, especie, raza, peso_kg, microchip, cartilla_url, seguro_rc, notas_medicas, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id(), clienteId, "Nala", "perro", "Mestiza", 12.4, "981000012345678",
    "/docs/cartilla-nala.pdf", 1, "Vacunación al día. Viaja con arnés y manta.", ahora()
  );
}

console.log("Datos de ejemplo cargados.");
console.log("  Motor ................", db.motor);
console.log("  Cliente .............. laura@example.com");
console.log("  Empresa activa ....... TransMascotas Ibérica SL");
console.log("  Empresa pendiente .... Mascotas del Norte, S.L.");
console.log("  Contraseña demo ...... demo1234");
