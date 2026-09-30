# Esquema de la plataforma de transporte de animales vivos.
# Compatible con PostgreSQL (DATABASE_URL definida) y SQLite (desarrollo local).
# Los importes monetarios se guardan en céntimos de euro (INTEGER).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL,
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  telefono      TEXT,
  password_hash TEXT NOT NULL,
  verificado    INTEGER NOT NULL DEFAULT 0,
  creado_en     TEXT NOT NULL
);

-- Empresas y profesionales autónomos registrados (contrato de adhesión)
CREATE TABLE IF NOT EXISTS carriers (
  id                    TEXT PRIMARY KEY,
  owner_user_id         TEXT NOT NULL,
  razon_social          TEXT NOT NULL,
  nif                   TEXT NOT NULL UNIQUE,
  forma_juridica        TEXT NOT NULL,
  registro_datos        TEXT,
  titular_real          TEXT,
  iban                  TEXT,
  autorizacion_numero   TEXT NOT NULL,
  sirentra_alta         INTEGER NOT NULL DEFAULT 0,
  traces_alta           INTEGER NOT NULL DEFAULT 0,
  territorios           TEXT NOT NULL DEFAULT '[]',
  especies_autorizadas  TEXT NOT NULL DEFAULT '[]',
  rcv_eur               INTEGER NOT NULL DEFAULT 0,
  cobertura_animal_eur  INTEGER NOT NULL DEFAULT 0,
  poliza_vencimiento    TEXT,
  estado                TEXT NOT NULL DEFAULT 'pendiente_verificacion',
  verificacion_fecha    TEXT,
  reverificacion_fecha  TEXT,
  creado_en             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS carrier_documents (
  id          TEXT PRIMARY KEY,
  carrier_id  TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  referencia  TEXT,
  vence       TEXT,
  validado    INTEGER NOT NULL DEFAULT 0,
  archivo_url TEXT,
  creado_en   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id               TEXT PRIMARY KEY,
  carrier_id       TEXT NOT NULL,
  nombre           TEXT NOT NULL,
  documento        TEXT,
  formacion_vence  TEXT,
  activo           INTEGER NOT NULL DEFAULT 1,
  creado_en        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id             TEXT PRIMARY KEY,
  carrier_id     TEXT NOT NULL,
  matricula      TEXT NOT NULL,
  tipo           TEXT NOT NULL,
  capacidad      INTEGER NOT NULL DEFAULT 1,
  refrigerado    INTEGER NOT NULL DEFAULT 0,
  itv_vence      TEXT,
  registrado     INTEGER NOT NULL DEFAULT 0,
  activo         INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pets (
  id                 TEXT PRIMARY KEY,
  owner_user_id      TEXT NOT NULL,
  nombre             TEXT NOT NULL,
  especie            TEXT NOT NULL,
  raza               TEXT,
  peso_kg            REAL,
  microchip          TEXT,
  cartilla_url       TEXT,
  seguro_rc          INTEGER NOT NULL DEFAULT 0,
  notas_medicas      TEXT,
  creado_en          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id                 TEXT PRIMARY KEY,
  referencia         TEXT NOT NULL UNIQUE,
  cliente_id         TEXT NOT NULL,
  pet_id             TEXT NOT NULL,
  origen_direccion   TEXT NOT NULL,
  origen_lat         REAL NOT NULL,
  origen_lng         REAL NOT NULL,
  destino_direccion  TEXT NOT NULL,
  destino_lat        REAL NOT NULL,
  destino_lng        REAL NOT NULL,
  recogida_inicio    TEXT,
  recogida_fin       TEXT,
  distancia_km       REAL,
  duracion_h         REAL,
  urgencia           TEXT NOT NULL DEFAULT 'estandar',
  exclusivo          INTEGER NOT NULL DEFAULT 0,
  asistencia_vet     INTEGER NOT NULL DEFAULT 0,
  estado             TEXT NOT NULL DEFAULT 'borrador',
  descripcion        TEXT,
  creado_en          TEXT NOT NULL
);

-- Instantánea del cálculo: el precio queda congelado al confirmar la reserva
CREATE TABLE IF NOT EXISTS quotes (
  id                  TEXT PRIMARY KEY,
  booking_id          TEXT NOT NULL,
  tarifa_version_id   TEXT NOT NULL,
  desglose            TEXT NOT NULL,
  subtotal_eur        INTEGER NOT NULL,
  comision_cliente    INTEGER NOT NULL,
  total_cliente       INTEGER NOT NULL,
  comision_carrier    INTEGER NOT NULL,
  neto_carrier        INTEGER NOT NULL,
  puja_minima_carrier INTEGER NOT NULL,
  creado_en           TEXT NOT NULL
);

-- Propuestas enviadas a transportistas compatibles
CREATE TABLE IF NOT EXISTS dispatch_offers (
  id           TEXT PRIMARY KEY,
  booking_id   TEXT NOT NULL,
  carrier_id   TEXT NOT NULL,
  driver_id    TEXT,
  vehicle_id   TEXT,
  puntuacion   REAL NOT NULL,
  motivos      TEXT NOT NULL,
  neto_eur     INTEGER NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'enviada',
  expira_en    TEXT NOT NULL,
  creado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id                 TEXT PRIMARY KEY,
  booking_id         TEXT NOT NULL UNIQUE,
  carrier_id         TEXT NOT NULL,
  driver_id          TEXT,
  vehicle_id         TEXT,
  estado             TEXT NOT NULL DEFAULT 'asignada',
  iniciada_en        TEXT,
  entregada_en       TEXT,
  pin_entrega_hash   TEXT,
  prueba_entrega_url TEXT,
  creado_en          TEXT NOT NULL
);

-- Traza GPS. En producción se particiona por fecha y se purga por política.
CREATE TABLE IF NOT EXISTS trip_positions (
  id            TEXT PRIMARY KEY,
  trip_id       TEXT NOT NULL,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  velocidad     REAL,
  precision_m   REAL,
  registrado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_requests (
  id             TEXT PRIMARY KEY,
  trip_id        TEXT NOT NULL,
  solicitado_por TEXT NOT NULL,
  motivo         TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendiente',
  rechazo_motivo TEXT,
  creado_en      TEXT NOT NULL,
  atendida_en    TEXT
);

-- El enlace que recibe el cliente es un token: no es una URL pública permanente
CREATE TABLE IF NOT EXISTS trip_photos (
  id               TEXT PRIMARY KEY,
  photo_request_id TEXT,
  trip_id          TEXT NOT NULL,
  url              TEXT NOT NULL,
  lat              REAL,
  lng              REAL,
  en_movimiento    INTEGER NOT NULL DEFAULT 0,
  token            TEXT NOT NULL UNIQUE,
  token_expira     TEXT NOT NULL,
  creado_en        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id            TEXT PRIMARY KEY,
  trip_id       TEXT,
  booking_id    TEXT,
  tipo          TEXT NOT NULL,
  gravedad      TEXT NOT NULL,
  descripcion   TEXT NOT NULL,
  reportado_por TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'abierta',
  creado_en     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  tipo          TEXT NOT NULL,
  importe_eur   INTEGER NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'pendiente',
  proveedor_ref TEXT,
  creado_en     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  autor_id   TEXT NOT NULL,
  destino_id TEXT NOT NULL,
  puntuacion INTEGER NOT NULL,
  comentario TEXT,
  creado_en  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tariff_versions (
  id                   TEXT PRIMARY KEY,
  version              TEXT NOT NULL UNIQUE,
  vigente_desde        TEXT NOT NULL,
  vigente_hasta        TEXT,
  base_eur             INTEGER NOT NULL,
  por_km_eur           INTEGER NOT NULL,
  por_hora_eur         INTEGER NOT NULL,
  comision_cliente_pct REAL NOT NULL,
  comision_carrier_pct REAL NOT NULL,
  margen_puja_pct      REAL,
  nota                 TEXT
);

CREATE TABLE IF NOT EXISTS surcharges (
  id        TEXT PRIMARY KEY,
  tariff_id TEXT NOT NULL,
  clave     TEXT NOT NULL,
  etiqueta  TEXT NOT NULL,
  tipo      TEXT NOT NULL,
  valor     INTEGER NOT NULL
);

-- Motor de descarte automático (contrato, cláusula 4)
CREATE TABLE IF NOT EXISTS eligibility_checks (
  id         TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL,
  booking_id TEXT,
  regla      TEXT NOT NULL,
  resultado  TEXT NOT NULL,
  detalle    TEXT,
  creado_en  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  actor_tipo TEXT,
  accion     TEXT NOT NULL,
  entidad    TEXT,
  entidad_id TEXT,
  detalle    TEXT,
  creado_en  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offers_booking ON dispatch_offers(booking_id, estado);
CREATE INDEX IF NOT EXISTS idx_positions_trip ON trip_positions(trip_id, registrado_en);
CREATE INDEX IF NOT EXISTS idx_bookings_cliente ON bookings(cliente_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_audit_entidad ON audit_log(entidad, entidad_id);
