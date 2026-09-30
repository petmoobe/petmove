/**
 * Reglas de negocio transversales: comisiones, disponibilidad de estados y
 * mensajes de aviso al usuario.
 */

export const PAGO = {
  proveedor: "stripe_connect",
  moneda: "eur",
  capturaAlConfirmar: true,
  liberacionTrasEntregaHoras: 48,
  retencionSiIncidenciaGrave: true,
};

export const DOCUMENTOS_OBLIGATORIOS = [
  "nif_representante",
  "autorizacion_transporte_animales",
  "sirentra",
  "seguro_rc_explotacion",
  "seguro_cobertura_animal",
  "vehiculos_registrados",
  "conductores_formados",
  "aceptacion_contrato_anual",
];

export const TRANSICIONES_ESTADO = {
  borrador: ["precio", "cancelada"],
  precio: ["buscando", "borrador", "cancelada"],
  buscando: ["asignada", "cancelada", "incidente"],
  asignada: ["en_curso", "cancelada", "incidente"],
  en_curso: ["entregada", "incidente"],
  entregada: ["cancelada"],
  cancelada: [],
  incidente: ["asignada", "cancelada"],
};

export function puedeTransicionar(desde, hacia) {
  return (TRANSICIONES_ESTADO[desde] ?? []).includes(hacia);
}

/**
 * El contrato exige que la subcontratación esté autorizada y verificada.
 * Esta función devuelve el motivo por el que una cesión no puede registrarse.
 */
export function validarSubcontratacion({ carrierPadre, subcontratista, autorizacion }) {
  const fallos = [];
  if (!autorizacion?.aprobada) fallos.push("La subcontratación requiere autorización previa de la plataforma");
  if (!subcontratista) fallos.push("Subcontratista no identificado");
  else {
    if (!["sociedad", "autonomo"].includes(subcontratista.forma_juridica)) fallos.push("El subcontratista no es empresa ni profesional autónomo registrado");
    if (subcontratista.estado !== "activo") fallos.push("El subcontratista no está verificado y activo");
    if (!subcontratista.sirentra_alta) fallos.push("El subcontratista no consta inscrito en SIRENTRA");
    if (!subcontratista.cobertura_animal_eur) fallos.push("El subcontratista no acredita cobertura de animales bajo custodia");
  }
  if (carrierPadre?.estado !== "activo") fallos.push("El transportista cedente no está activo");
  return { ok: fallos.length === 0, fallos };
}

export function avisosBienestar({ distanciaKm, duracionH, temperaturaC, especie }) {
  const avisos = [];
  if (duracionH >= 8) avisos.push("Trayecto de 8 horas o más: programar parada de descanso, hidratación y supervisión.");
  if (duracionH >= 12) avisos.push("Trayecto de 12 horas o más: exigir plan de bienestar documentado y vehículo acondicionado.");
  if (temperaturaC != null && (temperaturaC > 30 || temperaturaC < 5)) {
    avisos.push("Temperatura exterior fuera del rango recomendado: verificar climatización del compartimento.");
  }
  if (especie === "gato") avisos.push("Gato: verificar transportín rígido, ventilado y asegurado, y evitar contacto con otros animales.");
  return avisos;
}

export function calcularVencimientoReverificacion(fechaAlta) {
  const d = new Date(fechaAlta);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
