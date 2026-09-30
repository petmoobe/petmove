/**
 * Motor de precios.
 * El precio lo fija la plataforma (contrato, cláusula 5.1) y se congela en
 * `quotes` al confirmar la reserva. Todos los importes son céntimos de euro.
 */

export class PricingError extends Error {
  constructor(message, detalle = {}) {
    super(message);
    this.name = "PricingError";
    this.detalle = detalle;
  }
}

const RECARGOS_AUTOMATICOS = {
  urgente: "urgencia",
  exclusivo: "transporte_exclusivo",
  asistencia_vet: "asistencia_veterinaria",
};

function aplicarRecargo(base, recargo) {
  if (recargo.tipo === "fijo") return Math.round(recargo.valor);
  return Math.round((base * recargo.valor) / 10000);
}

/**
 * @param {object} input
 * @param {object} input.tarifa  fila de tariff_versions + recargos ya cargados
 * @param {number} input.distanciaKm
 * @param {number} input.duracionH
 * @param {object} input.opciones  { urgencia, exclusivo, asistenciaVet, extras: [] }
 */
export function calcularPrecio(input) {
  const { tarifa, distanciaKm, duracionH, opciones = {} } = input;

  if (!tarifa) throw new PricingError("No hay tarifa vigente");
  if (!Number.isFinite(distanciaKm) || distanciaKm <= 0) {
    throw new PricingError("Distancia no válida", { distanciaKm });
  }
  if (!Number.isFinite(duracionH) || duracionH <= 0) {
    throw new PricingError("Duración no válida", { duracionH });
  }

  const tramos = [];
  let subtotal = 0;

  const add = (concepto, importe) => {
    if (importe === 0) return;
    tramos.push({ concepto, importe });
    subtotal += importe;
  };

  add("Tarifa base", tarifa.base_eur);
  add(`Distancia (${distanciaKm.toFixed(1)} km)`, Math.round(tarifa.por_km_eur * distanciaKm));
  add(`Tiempo estimado (${duracionH.toFixed(1)} h)`, Math.round(tarifa.por_hora_eur * duracionH));

  const claves = [];
  if (opciones.urgencia === "urgente") claves.push(RECARGOS_AUTOMATICOS.urgente);
  if (opciones.exclusivo) claves.push(RECARGOS_AUTOMATICOS.exclusivo);
  if (opciones.asistenciaVet) claves.push(RECARGOS_AUTOMATICOS.asistencia_vet);
  for (const extra of opciones.extras ?? []) claves.push(extra);

  const aplicados = [];
  for (const clave of claves) {
    const recargo = (tarifa.recargos ?? []).find((r) => r.clave === clave);
    if (!recargo) throw new PricingError(`Recargo desconocido: ${clave}`);
    const importe = aplicarRecargo(subtotal, recargo);
    aplicados.push({ clave, etiqueta: recargo.etiqueta, importe });
    add(recargo.etiqueta, importe);
  }

  const tipoAnimal = tarifa.tipo_animal ?? null;
  if (tipoAnimal && tipoAnimal.suplemento_eur > 0) {
    add(tipoAnimal.etiqueta, tipoAnimal.suplemento_eur);
  }

  const comisionCliente = Math.round((subtotal * tarifa.comision_cliente_pct) / 10000);
  const totalCliente = subtotal + comisionCliente;

  // La comisión al transportista se calcula sobre el precio del servicio,
  // no sobre el importe que ya incluye la tarifa de servicio al cliente.
  const comisionCarrier = Math.round((subtotal * tarifa.comision_carrier_pct) / 10000);
  const netoCarrier = subtotal - comisionCarrier;

  const pujaMinimaCarrier = Math.round(netoCarrier * (1 - (tarifa.margen_puja_pct ?? 0) / 10000));

  return {
    tarifaVersion: tarifa.version,
    tramos,
    recargosAplicados: aplicados,
    subtotal,
    comisionCliente,
    totalCliente,
    comisionCarrier,
    netoCarrier,
    pujaMinimaCarrier,
  };
}

export function formatearEuros(centimos) {
  return (centimos / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
