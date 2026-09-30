/**
 * Migración del esquema sobre PostgreSQL o SQLite.
 *
 * Se ejecuta sola al arrancar el servidor, así que en Render no hace falta
 * lanzar nada a mano: el primer arranque crea las tablas.
 *
 * Uso manual:
 *   npm run migrar
 */

import { inicializarEsquema, usaPostgres, db } from "./db.js";

const motor = await inicializarEsquema();
const tablas = usaPostgres
  ? (await db.all("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).map((r) => r.tablename)
  : (await db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);

console.log(`Esquema aplicado sobre ${motor}.`);
console.log(`Tablas (${tablas.length}): ${tablas.join(", ")}`);
