/**
 * Capa de datos.
 *
 * Usa PostgreSQL si existe DATABASE_URL (entorno de despliegue) y SQLite en
 * local para desarrollo sin configuración.
 *
 * La API expone tres métodos que las consultas usan del mismo modo en ambos
 * motores: get() devuelve una fila, all() una lista y run() ejecuta escritura.
 * El marcador `?` de cada consulta se traduce al formato del motor activo.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const usaPostgres = Boolean(process.env.DATABASE_URL);

let db;
let motor;

if (usaPostgres) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
    max: 8,
  });

  // PostgreSQL usa $1, $2… en lugar de ?. Se traduce una vez por consulta.
  const traducir = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };

  motor = "postgresql";
  db = {
    motor,
    async get(sql, ...args) {
      const r = await pool.query(traducir(sql), args);
      return r.rows[0];
    },
    async all(sql, ...args) {
      const r = await pool.query(traducir(sql), args);
      return r.rows;
    },
    async run(sql, ...args) {
      const r = await pool.query(traducir(sql), args);
      return { changes: r.rowCount };
    },
    async exec(sql) {
      await pool.query(sql);
    },
  };
} else {
  const { default: Database } = await import("better-sqlite3");
  const archivo = process.env.DB_PATH || path.join(here, "..", "petmove.db");
  const lite = new Database(archivo);
  lite.pragma("journal_mode = WAL");
  lite.pragma("foreign_keys = ON");

  motor = "sqlite";
  db = {
    motor,
    async get(sql, ...args) {
      return lite.prepare(sql).get(...args);
    },
    async all(sql, ...args) {
      return lite.prepare(sql).all(...args);
    },
    async run(sql, ...args) {
      const r = lite.prepare(sql).run(...args);
      return { changes: r.changes };
    },
    async exec(sql) {
      lite.exec(sql);
    },
  };
}

export { db };

/**
 * Inicializa el esquema. El archivo .sql está escrito para funcionar en los
 * dos motores: solo se retiran las instrucciones PRAGMA, exclusivas de SQLite.
 */
export async function inicializarEsquema() {
  const ruta = path.join(here, "schema.sql");
  let sql = fs.readFileSync(ruta, "utf8");

  if (usaPostgres) sql = sql.replace(/^\s*PRAGMA.*$/gm, "");

  for (const sentencia of sql.split(";")) {
    const limpia = sentencia.trim();
    if (!limpia) continue;
    try {
      await db.exec(limpia + ";");
    } catch (e) {
      // Una tabla o índice ya existente no debe impedir el arranque.
      if (!/already exists|duplicate/i.test(e.message)) throw e;
    }
  }

  return motor;
}

/** Ejecuta varias operaciones de escritura de forma atómica. */
export async function tx(fn) {
  if (!usaPostgres) return await fn();
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const r = await fn();
    await cliente.query("COMMIT");
    return r;
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}
