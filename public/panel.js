/**
 * Panel de administración — interfaz.
 * JavaScript nativo, sin framework ni compilación.
 */

const estado = {
  token: sessionStorage.getItem("panel_token") || "",
  vista: "resumen",
  cache: {},
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, hijos = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const h of [].concat(hijos)) {
    if (h == null) continue;
    n.append(typeof h === "string" ? document.createTextNode(h) : h);
  }
  return n;
};

const eur = (c) => ((c ?? 0) / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const fecha = (iso) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—");
const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES") : "—");

/** Estado → clase visual y etiqueta legible. */
const ESTADOS = {
  borrador: ["neutro", "Borrador"],
  precio: ["neutro", "Precio calculado"],
  buscando: ["aviso", "Buscando empresa"],
  asignada: ["ok", "Asignada"],
  en_curso: ["ok", "En curso"],
  entregada: ["ok", "Entregada"],
  cancelada: ["neutro", "Cancelada"],
  incidente: ["grave", "Incidencia"],
  activo: ["ok", "Activa"],
  bloqueado: ["grave", "Bloqueada"],
  baja: ["neutro", "Baja"],
  pendiente_verificacion: ["aviso", "Pendiente"],
  enviada: ["aviso", "Enviada"],
  vista: ["aviso", "Vista"],
  aceptada: ["ok", "Aceptada"],
  rechazada: ["neutro", "Rechazada"],
  expirada: ["neutro", "Expirada"],
  retirada: ["neutro", "Retirada"],
  abierta: ["grave", "Abierta"],
  en_revision: ["aviso", "En revisión"],
  cerrada: ["ok", "Cerrada"],
  pendiente: ["aviso", "Pendiente"],
  autorizado: ["aviso", "Autorizado"],
  capturado: ["ok", "Cobrado"],
  liberado: ["ok", "Liberado"],
  reembolsado: ["neutro", "Reembolsado"],
  recogida: ["ok", "Recogida"],
  pausa: ["aviso", "En pausa"],
  entrega: ["ok", "Entrega"],
  cerrada: ["ok", "Cerrada"],
};

function etiqueta(valor) {
  const [clase, texto] = ESTADOS[valor] ?? ["neutro", valor];
  return el("span", { className: `estado ${clase}`, textContent: texto });
}

const GRAVEDAD = { baja: "neutro", media: "aviso", alta: "grave", critica: "grave" };

/* -------------------------------------------------------------------- API -- */

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`/api/admin${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", "X-Admin-Token": estado.token, ...(opciones.headers ?? {}) },
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(cuerpo.error || `Error ${res.status}`), { cuerpo });
  return cuerpo;
}

function aviso(texto, tipo = "ok") {
  const caja = $("#aviso");
  caja.textContent = texto;
  caja.className = `aviso ${tipo}`;
  caja.hidden = false;
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => (caja.hidden = true), 4200);
}

/* ------------------------------------------------------------------ vistas -- */

const VISTAS = {};

VISTAS.resumen = async () => {
  const d = await pedir("/resumen");
  const frag = document.createDocumentFragment();

  const tarjetas = [
    { etiqueta: "Reservas totales", valor: d.reservas },
    { etiqueta: "Buscando empresa", valor: d.porEstado.find((e) => e.estado === "buscando")?.n ?? 0, clase: "alerta" },
    { etiqueta: "Viajes en curso", valor: d.viajesEnCurso, clase: "bien" },
    { etiqueta: "Incidencias abiertas", valor: d.incidenciasAbiertas, clase: d.incidenciasAbiertas ? "grave" : "bien" },
    { etiqueta: "Pagos retenidos", valor: d.pagosBloqueados, clase: d.pagosBloqueados ? "alerta" : "" },
    { etiqueta: "Empresas activas", valor: d.activos, pie: `${d.transportistas} registradas` },
    { etiqueta: "Pendientes de verificar", valor: d.pendientesVerificacion, clase: d.pendientesVerificacion ? "alerta" : "" },
    { etiqueta: "Empresas bloqueadas", valor: d.bloqueados, clase: d.bloqueados ? "grave" : "" },
    { etiqueta: "Ofertas sin responder", valor: d.ofertasPendientes },
    { etiqueta: "Facturado al cliente", valor: eur(d.dinero.facturadoCliente), pie: "suma de presupuestos" },
    { etiqueta: "Neto a transportistas", valor: eur(d.dinero.netoTransportistas) },
    { etiqueta: "Ingreso de la plataforma", valor: eur(d.dinero.ingresoPlataforma), clase: "bien", pie: "ambas comisiones" },
  ];

  frag.append(
    el("div", { className: "tarjetas" },
      tarjetas.map((t) => el("div", { className: `tarjeta ${t.clase ?? ""}` }, [
        el("div", { className: "etiqueta", textContent: t.etiqueta }),
        el("div", { className: "valor", textContent: String(t.valor) }),
        t.pie ? el("div", { className: "pie", textContent: t.pie }) : null,
      ]))
    )
  );

  const bloque = el("div", { className: "bloque" }, [el("header", {}, el("h2", { textContent: "Reservas por estado" }))]);
  bloque.append(
    el("div", { className: "tabla-envoltura" },
      el("table", {}, el("tbody", {}, d.porEstado.map((e) =>
        el("tr", {}, [
          el("td", {}, etiqueta(e.estado)),
          el("td", { className: "num", textContent: String(e.n) }),
          el("td", { className: "num", textContent: `${Math.round((e.n / Math.max(1, d.reservas)) * 100)} %` }),
        ])
      )))
    )
  );
  frag.append(bloque);
  return frag;
};

VISTAS.reservas = async () => {
  const filas = await pedir("/reservas");
  if (!filas.length) return el("div", { className: "bloque" }, el("p", { className: "vacio", textContent: "Todavía no hay reservas registradas." }));

  const tabla = el("table");
  tabla.append(el("thead", {}, el("tr", {}, [
    "Referencia", "Cliente", "Mascota", "Trayecto", "Km", "Total cliente", "Neto empresa",
    "Comisión plataforma", "Estado", "Empresa", "Creada", "",
  ].map((h) => el("th", { textContent: h })))));

  const cuerpo = el("tbody");
  for (const r of filas) {
    const comision = (r.comision_cliente ?? 0) + (r.comision_carrier ?? 0);
    const accion = el("td");
    if (r.trip_id) {
      accion.append(el("button", {
        className: "boton suave mini", textContent: "Reasignar",
        onclick: () => modalReasignar(r),
      }));
    }
    cuerpo.append(el("tr", {}, [
      el("td", { textContent: r.referencia }),
      el("td", { textContent: r.cliente ?? "—" }),
      el("td", { textContent: r.mascota ? `${r.mascota} (${r.especie})` : "—" }),
      el("td", { className: "libre", textContent: `${r.origen_direccion} → ${r.destino_direccion}` }),
      el("td", { className: "num", textContent: r.distancia_km?.toFixed(1) ?? "—" }),
      el("td", { className: "num", textContent: eur(r.total_cliente) }),
      el("td", { className: "num", textContent: eur(r.neto_carrier) }),
      el("td", { className: "num", textContent: eur(comision) }),
      el("td", {}, etiqueta(r.estado)),
      el("td", { textContent: r.transportista ?? "—" }),
      el("td", { textContent: fecha(r.creado_en) }),
      accion,
    ]));
  }
  tabla.append(cuerpo);
  return el("div", { className: "bloque" }, [
    el("header", {}, [el("h2", { textContent: "Reservas" }), el("span", { className: "suave", textContent: `${filas.length} registros` })]),
    el("div", { className: "tabla-envoltura" }, tabla),
  ]);
};

VISTAS.asignacion = async () => {
  const [ofertas, descartes] = await Promise.all([pedir("/ofertas"), pedir("/descartes")]);
  const frag = document.createDocumentFragment();

  if (ofertas.length) {
    const tabla = el("table");
    tabla.append(el("thead", {}, el("tr", {}, ["Reserva", "Empresa", "Puntuación", "Neto ofrecido", "Estado", "Expira", "Enviada"].map((h) => el("th", { textContent: h })))));
    const cuerpo = el("tbody");
    for (const o of ofertas) {
      cuerpo.append(el("tr", {}, [
        el("td", { textContent: o.referencia ?? "—" }),
        el("td", { textContent: o.razon_social ?? "—" }),
        el("td", { className: "num", textContent: o.puntuacion?.toFixed(1) ?? "—" }),
        el("td", { className: "num", textContent: eur(o.neto_eur) }),
        el("td", {}, etiqueta(o.estado)),
        el("td", { textContent: fecha(o.expira_en) }),
        el("td", { textContent: fecha(o.creado_en) }),
      ]));
    }
    tabla.append(cuerpo, el("caption", { className: "suave", textContent: "" }));
    frag.append(el("div", { className: "bloque" }, [
      el("header", {}, [el("h2", { textContent: "Propuestas enviadas" }), el("span", { className: "suave", textContent: `${ofertas.length}` })]),
      el("div", { className: "tabla-envoltura" }, tabla),
    ]));
  }

  const bloque = el("div", { className: "bloque" }, [
    el("header", {}, [
      el("h2", { textContent: "Descartes automáticos" }),
      el("span", { className: "suave", textContent: "Empresas excluidas por incumplir requisitos" }),
    ]),
  ]);
  if (!descartes.length) {
    bloque.append(el("p", { className: "vacio", textContent: "No se ha descartado ninguna empresa todavía." }));
  } else {
    const tabla = el("table");
    tabla.append(el("thead", {}, el("tr", {}, ["Empresa", "Reserva", "Reglas incumplidas", "Detalle", "Fecha"].map((h) => el("th", { textContent: h })))));
    const cuerpo = el("tbody");
    for (const d of descartes) {
      let detalle = d.detalle;
      try {
        const arr = JSON.parse(d.detalle ?? "[]");
        detalle = arr.map((f) => f.detalle ?? f.regla).join(", ");
      } catch { /* se conserva el texto original */ }
      cuerpo.append(el("tr", {}, [
        el("td", { textContent: d.razon_social ?? "—" }),
        el("td", { textContent: d.referencia ?? "—" }),
        el("td", { textContent: (d.regla ?? "").split(",").join(", ") }),
        el("td", { className: "libre", textContent: detalle ?? "—" }),
        el("td", { textContent: fecha(d.creado_en) }),
      ]));
    }
    tabla.append(cuerpo);
    bloque.append(el("div", { className: "tabla-envoltura" }, tabla));
  }
  frag.append(bloque);
  return frag;
};

VISTAS.viajes = async () => {
  const filas = await pedir("/viajes");
  if (!filas.length) return el("div", { className: "bloque" }, el("p", { className: "vacio", textContent: "No hay viajes registrados." }));

  const tabla = el("table");
  tabla.append(el("thead", {}, el("tr", {}, ["Reserva", "Destino", "Empresa", "Conductor", "Vehículo", "Estado", "Puntos GPS", "Última señal", "Inicio"].map((h) => el("th", { textContent: h })))));
  const cuerpo = el("tbody");
  for (const v of filas) {
    const sinSenal = v.estado === "en_curso" && (!v.ultima_senal || Date.now() - new Date(v.ultima_senal).getTime() > 10 * 60 * 1000);
    cuerpo.append(el("tr", {}, [
      el("td", { textContent: v.referencia ?? "—" }),
      el("td", { className: "libre", textContent: v.destino_direccion ?? "—" }),
      el("td", { textContent: v.transportista ?? "—" }),
      el("td", { textContent: v.conductor ?? "—" }),
      el("td", { textContent: v.matricula ?? "—" }),
      el("td", {}, etiqueta(v.estado)),
      el("td", { className: "num", textContent: String(v.puntos_gps ?? 0) }),
      el("td", {}, sinSenal ? el("span", { className: "estado grave", textContent: "Sin señal" }) : fecha(v.ultima_senal)),
      el("td", { textContent: fecha(v.iniciada_en) }),
    ]));
  }
  tabla.append(cuerpo);

  const frag = document.createDocumentFragment();
  frag.append(el("div", { className: "bloque" }, [
    el("header", {}, [el("h2", { textContent: "Viajes" }), el("span", { className: "suave", textContent: `${filas.length}` })]),
    el("div", { className: "tabla-envoltura" }, tabla),
  ]));

  const imagenes = await pedir("/imagenes");
  const bloqueFotos = el("div", { className: "bloque" }, el("header", {}, el("h2", { textContent: "Imágenes entregadas al cliente" })));
  if (!imagenes.length) bloqueFotos.append(el("p", { className: "vacio", textContent: "Todavía no se ha enviado ninguna imagen." }));
  else {
    const t = el("table");
    t.append(el("thead", {}, el("tr", {}, ["Reserva", "Capturada", "En movimiento", "Enlace caduca"].map((h) => el("th", { textContent: h })))));
    const c = el("tbody");
    for (const f of imagenes) {
      c.append(el("tr", {}, [
        el("td", { textContent: f.referencia ?? "—" }),
        el("td", { textContent: fecha(f.creado_en) }),
        el("td", {}, f.en_movimiento ? el("span", { className: "estado grave", textContent: "Sí" }) : el("span", { className: "estado ok", textContent: "No" })),
        el("td", { textContent: fecha(f.token_expira) }),
      ]));
    }
    t.append(c);
    bloqueFotos.append(el("div", { className: "tabla-envoltura" }, t));
  }
  frag.append(bloqueFotos);
  return frag;
};

VISTAS.transportistas = async () => {
  const filas = await pedir("/transportistas");
  const frag = document.createDocumentFragment();

  const acciones = el("div", { className: "acciones-cabecera" }, [
    el("button", { className: "boton mini", textContent: "Dar de alta", onclick: () => modalAlta() }),
  ]);
  frag.append(el("div", { className: "bloque" }, [
    el("header", {}, [el("h2", { textContent: "Empresas y profesionales registrados" }), acciones]),
  ]));

  const tabla = el("table");
  tabla.append(el("thead", {}, el("tr", {}, [
    "Razón social", "NIF", "Forma", "Autorización", "SIRENTRA", "TRACES", "Cobertura animal",
    "Póliza vence", "Reverificación", "Conductores", "Vehículos", "Estado", "Acciones",
  ].map((h) => el("th", { textContent: h })))));

  const cuerpo = el("tbody");
  for (const c of filas) {
    const acc = el("td");
    if (c.estado === "pendiente_verificacion") {
      acc.append(el("button", { className: "boton mini", textContent: "Verificar", onclick: () => verificar(c) }));
    } else if (c.estado === "activo") {
      acc.append(el("button", { className: "boton peligro mini", textContent: "Bloquear", onclick: () => bloquear(c) }));
    } else {
      acc.append(el("button", { className: "boton suave mini", textContent: "Reactivar", onclick: () => verificar(c) }));
    }

    cuerpo.append(el("tr", {}, [
      el("td", { className: "libre", textContent: c.razon_social }),
      el("td", { textContent: c.nif }),
      el("td", { textContent: c.forma_juridica === "sociedad" ? "Sociedad" : "Autónomo" }),
      el("td", { textContent: c.autorizacion_numero ?? "—" }),
      el("td", {}, si(c.sirentra_alta)),
      el("td", {}, si(c.traces_alta)),
      el("td", { className: "num", textContent: eur(c.cobertura_animal_eur) }),
      el("td", { textContent: fechaCorta(c.poliza_vencimiento) }),
      el("td", { textContent: fechaCorta(c.reverificacion_fecha) }),
      el("td", { className: "num", textContent: String(c.conductores ?? 0) }),
      el("td", { className: "num", textContent: String(c.vehiculos ?? 0) }),
      el("td", {}, etiqueta(c.estado)),
      acc,
    ]));
  }
  tabla.append(cuerpo);
  frag.append(el("div", { className: "bloque" }, el("div", { className: "tabla-envoltura" }, tabla)));
  return frag;

  function si(valor) {
    return el("span", { className: `estado ${valor ? "ok" : "grave"}`, textContent: valor ? "Sí" : "No" });
  }
};

VISTAS.incidencias = async () => {
  const filas = await pedir("/incidencias");
  const bloque = el("div", { className: "bloque" }, el("header", {}, el("h2", { textContent: "Incidencias" })));
  if (!filas.length) {
    bloque.append(el("p", { className: "vacio", textContent: "Sin incidencias registradas." }));
    return bloque;
  }

  const tabla = el("table");
  tabla.append(el("thead", {}, el("tr", {}, ["Gravedad", "Reserva", "Empresa", "Tipo", "Descripción", "Estado", "Pago", "Fecha", ""].map((h) => el("th", { textContent: h })))));
  const cuerpo = el("tbody");
  for (const i of filas) {
    const acc = el("td");
    if (i.estado !== "cerrada") {
      acc.append(el("button", { className: "boton mini", textContent: "Cerrar", onclick: () => cerrarIncidencia(i) }));
    }
    cuerpo.append(el("tr", {}, [
      el("td", {}, el("span", { className: `estado ${GRAVEDAD[i.gravedad] ?? "neutro"}`, textContent: i.gravedad })),
      el("td", { textContent: i.referencia ?? "—" }),
      el("td", { textContent: i.transportista ?? "—" }),
      el("td", { textContent: i.tipo }),
      el("td", { className: "libre", textContent: i.descripcion }),
      el("td", {}, etiqueta(i.estado)),
      el("td", {}, ["alta", "critica"].includes(i.gravedad) && i.estado !== "cerrada"
        ? el("span", { className: "estado grave", textContent: "Retenido" })
        : el("span", { className: "estado neutro", textContent: "—" })),
      el("td", { textContent: fecha(i.creado_en) }),
      acc,
    ]));
  }
  tabla.append(cuerpo);
  bloque.append(el("div", { className: "tabla-envoltura" }, tabla));
  return bloque;
};

VISTAS.pagos = async () => {
  const filas = await pedir("/pagos");
  const bloque = el("div", { className: "bloque" }, el("header", {}, el("h2", { textContent: "Pagos y liquidaciones" })));
  if (!filas.length) {
    bloque.append(el("p", { className: "vacio", textContent: "Aún no hay movimientos." }));
    return bloque;
  }

  const TIPOS = {
    cobro_cliente: "Cobro al cliente",
    liquidacion_carrier: "Liquidación a la empresa",
    devolucion: "Devolución",
    comision_plataforma: "Comisión de la plataforma",
  };

  const tabla = el("table");
  tabla.append(el("thead", {}, el("tr", {}, ["Reserva", "Concepto", "Importe", "Estado", "Fecha"].map((h) => el("th", { textContent: h })))));
  const cuerpo = el("tbody");
  for (const p of filas) {
    cuerpo.append(el("tr", {}, [
      el("td", { textContent: p.referencia ?? "—" }),
      el("td", { textContent: TIPOS[p.tipo] ?? p.tipo }),
      el("td", { className: "num", textContent: eur(p.importe_eur) }),
      el("td", {}, etiqueta(p.estado)),
      el("td", { textContent: fecha(p.creado_en) }),
    ]));
  }
  tabla.append(cuerpo);
  bloque.append(el("div", { className: "tabla-envoltura" }, tabla));
  return bloque;
};

VISTAS.tarifas = async () => {
  const t = await pedir("/tarifa");
  if (!t.version) return el("div", { className: "bloque" }, el("p", { className: "vacio", textContent: "No hay tarifa vigente configurada." }));

  const frag = document.createDocumentFragment();
  frag.append(el("div", { className: "tarjetas" }, [
    { etiqueta: "Versión vigente", valor: t.version, pie: `Desde ${fechaCorta(t.vigente_desde)}` },
    { etiqueta: "Tarifa base", valor: eur(t.base_eur) },
    { etiqueta: "Por kilómetro", valor: eur(t.por_km_eur) },
    { etiqueta: "Por hora de viaje", valor: eur(t.por_hora_eur) },
    { etiqueta: "Comisión al cliente", valor: `${(t.comision_cliente_pct / 100).toFixed(2)} %` },
    { etiqueta: "Comisión a la empresa", valor: `${(t.comision_carrier_pct / 100).toFixed(2)} %` },
  ].map((x) => el("div", { className: "tarjeta" }, [
    el("div", { className: "etiqueta", textContent: x.etiqueta }),
    el("div", { className: "valor", textContent: String(x.valor) }),
    x.pie ? el("div", { className: "pie", textContent: x.pie }) : null,
  ]))));

  const tabla = el("table");
  tabla.append(el("thead", {}, el("tr", {}, ["Recargo", "Tipo", "Valor"].map((h) => el("th", { textContent: h })))));
  const cuerpo = el("tbody");
  for (const r of t.recargos ?? []) {
    cuerpo.append(el("tr", {}, [
      el("td", { textContent: r.etiqueta }),
      el("td", { textContent: r.tipo === "fijo" ? "Importe fijo" : "Porcentaje" }),
      el("td", { className: "num", textContent: r.tipo === "fijo" ? eur(r.valor) : `${(r.valor / 100).toFixed(2)} %` }),
    ]));
  }
  tabla.append(cuerpo);

  frag.append(el("div", { className: "bloque" }, [
    el("header", {}, el("h2", { textContent: "Recargos aplicables" })),
    el("div", { className: "tabla-envoltura" }, tabla),
  ]));
  frag.append(el("p", { className: "suave nota", textContent: "Los cambios de tarifa deben comunicarse en el Anexo I y quedar reflejados en el desglose de cada presupuesto." }));
  return frag;
};

VISTAS.auditoria = async () => {
  const filas = await pedir("/auditoria");
  const bloque = el("div", { className: "bloque" }, el("header", {}, [el("h2", { textContent: "Registro de auditoría" }), el("span", { className: "suave", textContent: `${filas.length} entradas` })]));
  if (!filas.length) {
    bloque.append(el("p", { className: "vacio", textContent: "Sin actividad registrada." }));
    return bloque;
  }

  const tabla = el("table");
  tabla.append(el("thead", {}, el("tr", {}, ["Acción", "Entidad", "Detalle", "Actor", "Fecha"].map((h) => el("th", { textContent: h })))));
  const cuerpo = el("tbody");
  for (const a of filas) {
    cuerpo.append(el("tr", {}, [
      el("td", { textContent: a.accion }),
      el("td", { textContent: a.entidad ?? "—" }),
      el("td", { className: "libre", textContent: a.detalle ?? "—" }),
      el("td", { textContent: a.actor_tipo ?? "—" }),
      el("td", { textContent: fecha(a.creado_en) }),
    ]));
  }
  tabla.append(cuerpo);
  bloque.append(el("div", { className: "tabla-envoltura" }, tabla));
  return bloque;
};

/* ------------------------------------------------------------------ modales */

function modal(titulo, contenido, alGuardar) {
  const fondo = el("div", { className: "modal-fondo" });
  const caja = el("div", { className: "modal" });
  caja.append(el("h2", { textContent: titulo }), contenido);
  const pie = el("div", { className: "pie" });
  const cancelar = el("button", { className: "boton suave", textContent: "Cancelar", onclick: () => fondo.remove() });
  const guardar = el("button", { className: "boton", textContent: "Guardar" });
  guardar.onclick = async () => {
    guardar.disabled = true;
    try { await alGuardar(); fondo.remove(); }
    catch (e) {
      let mensaje = e.message;
      if (e.cuerpo?.faltantes) mensaje += ": " + e.cuerpo.faltantes.join(", ");
      aviso(mensaje, "grave");
      guardar.disabled = false;
    }
  };
  pie.append(cancelar, guardar);
  caja.append(pie);
  fondo.append(caja);
  fondo.addEventListener("click", (ev) => { if (ev.target === fondo) fondo.remove(); });
  document.body.append(fondo);
}

function campo(etiquetaTexto, nombre, tipo = "text") {
  const caja = el("div", { className: "campo" });
  caja.append(el("label", { textContent: etiquetaTexto }), el("input", { name: nombre, type: tipo }));
  return caja;
}

function modalReasignar(reserva) {
  const contenido = document.createDocumentFragment();
  contenido.append(el("p", { className: "suave", textContent: `${reserva.referencia} · ${reserva.origen_direccion} → ${reserva.destino_direccion}` }));
  const caja = el("div", { className: "campo" });
  const select = el("select", { name: "carrierId" });
  caja.append(el("label", { textContent: "Empresa destino (solo verificadas y activas)" }), select);
  contenido.append(caja, campo("Motivo del cambio", "motivo"));

  pedir("/transportistas").then((lista) => {
    for (const c of lista.filter((x) => x.estado === "activo")) {
      select.append(el("option", { value: c.id, textContent: `${c.razon_social} · ${c.nif}` }));
    }
    if (!select.options.length) select.append(el("option", { value: "", textContent: "No hay empresas activas disponibles" }));
  });

  modal("Reasignar transporte", contenido, async () => {
    const carrierId = select.value;
    if (!carrierId) throw new Error("Selecciona una empresa activa");
    const motivo = contenido.querySelector('[name="motivo"]')?.value ?? "";
    await pedir(`/reservas/${reserva.id}/reasignar`, { method: "POST", body: JSON.stringify({ carrierId, motivo }) });
    aviso("Transporte reasignado y registrado en auditoría.");
    cargar();
  });
}

function modalAlta() {
  const contenido = document.createDocumentFragment();
  const rejilla = el("div", { className: "rejilla" }, [
    campo("Razón social", "razonSocial"),
    campo("NIF", "nif"),
    campo("Nº de autorización", "autorizacionNumero"),
    campo("Titular real", "titularReal"),
    campo("IBAN", "iban"),
    campo("Vencimiento de póliza", "polizaVencimiento", "date"),
    campo("Cobertura por animal (céntimos)", "coberturaAnimalEur", "number"),
    campo("RC de explotación (céntimos)", "rcvEur", "number"),
  ]);
  contenido.append(rejilla);

  const cajaForma = el("div", { className: "campo" });
  const forma = el("select", { name: "formaJuridica" });
  forma.append(el("option", { value: "sociedad", textContent: "Persona jurídica (sociedad)" }), el("option", { value: "autonomo", textContent: "Profesional autónomo" }));
  cajaForma.append(el("label", { textContent: "Forma jurídica" }), forma);
  contenido.append(cajaForma);

  const checks = el("div", { className: "rejilla" });
  for (const [nombre, texto] of [["sirentraAlta", "Inscrito en SIRENTRA"], ["tracesAlta", "Alta en TRACES NT"]]) {
    const c = el("div", { className: "campo" });
    const i = el("input", { type: "checkbox", name: nombre, style: "width:auto" });
    c.append(el("label", { textContent: texto }), i);
    checks.append(c);
  }
  contenido.append(checks, el("p", { className: "suave nota", textContent: "El alta queda en estado pendiente: no podrá activarse hasta superar la verificación documental." }));

  modal("Alta de empresa o profesional", contenido, async () => {
    const datos = {};
    for (const input of contenido.querySelectorAll("input, select")) {
      if (!input.name) continue;
      datos[input.name] = input.type === "checkbox" ? input.checked : input.value;
    }
    await pedir("/transportistas", { method: "POST", body: JSON.stringify(datos) });
    aviso("Empresa creada en estado pendiente de verificación.");
    cargar();
  });
}

async function verificar(c) {
  if (!confirm(`¿Activar a ${c.razon_social}? Se comprobarán autorización, SIRENTRA, cobertura y póliza.`)) return;
  try {
    const r = await pedir(`/transportistas/${c.id}/verificar`, { method: "POST" });
    aviso(`Empresa activa. Próxima reverificación: ${fechaCorta(r.proximaReverificacion)}.`);
    cargar();
  } catch (e) {
    const faltantes = e.cuerpo?.faltantes ? ` Falta: ${e.cuerpo.faltantes.join(", ")}.` : "";
    aviso(`No se puede activar.${faltantes}`, "grave");
  }
}

async function bloquear(c) {
  const motivo = prompt(`Motivo del bloqueo de ${c.razon_social}:`);
  if (motivo === null) return;
  await pedir(`/transportistas/${c.id}/bloquear`, { method: "POST", body: JSON.stringify({ motivo }) });
  aviso("Empresa bloqueada.");
  cargar();
}

function cerrarIncidencia(i) {
  const contenido = document.createDocumentFragment();
  contenido.append(el("p", { className: "suave", textContent: `${i.tipo} · ${i.descripcion}` }));
  contenido.append(campo("Resolución adoptada", "resolucion"));
  contenido.append(el("p", { className: "suave nota", textContent: "Al cerrar la última incidencia grave se desbloquea la liquidación retenida a la empresa." }));
  modal("Cerrar incidencia", contenido, async () => {
    const resolucion = contenido.querySelector('[name="resolucion"]').value;
    const r = await pedir(`/incidencias/${i.id}/cerrar`, { method: "POST", body: JSON.stringify({ resolucion }) });
    aviso(r.pagoDesbloqueado ? "Incidencia cerrada y liquidación desbloqueada." : "Incidencia cerrada.");
    cargar();
  });
}

/* -------------------------------------------------------------------- app -- */

async function cargar() {
  const contenedor = $("#vista");
  contenedor.replaceChildren(el("p", { className: "suave", textContent: "Cargando…" }));
  try {
    contenedor.replaceChildren(await VISTAS[estado.vista]());
    $("#titulo-vista").textContent = $("#pestanas").querySelector(`[data-vista="${estado.vista}"]`).textContent;
  } catch (e) {
    contenedor.replaceChildren(el("div", { className: "bloque" }, el("p", { className: "vacio", textContent: e.message })));
  }
}

$("#pestanas").addEventListener("click", (ev) => {
  const boton = ev.target.closest("button[data-vista]");
  if (!boton) return;
  estado.vista = boton.dataset.vista;
  for (const b of $("#pestanas").querySelectorAll("button")) b.classList.toggle("activa", b === boton);
  cargar();
});

$("#boton-recargar").onclick = cargar;

$("#boton-revision").onclick = async () => {
  if (!confirm("¿Ejecutar la revisión anual? Se bloqueará a las empresas sin reverificación vigente.")) return;
  const r = await pedir("/revision-anual", { method: "POST" });
  aviso(r.bloqueados ? `Revisión completada: ${r.bloqueados} empresa(s) bloqueada(s).` : "Revisión completada: ninguna empresa pendiente.");
  cargar();
};

$("#boton-salir").onclick = () => {
  sessionStorage.removeItem("panel_token");
  estado.token = "";
  $("#app").hidden = true;
  $("#acceso").hidden = false;
};

$("#form-acceso").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const token = $("#token").value.trim();
  const error = $("#error-acceso");
  error.hidden = true;
  try {
    const res = await fetch("/api/admin/sesion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error("Token incorrecto");
    estado.token = token;
    sessionStorage.setItem("panel_token", token);
    entrar();
  } catch {
    error.textContent = "El token no es válido.";
    error.hidden = false;
  }
});

function entrar() {
  $("#acceso").hidden = true;
  $("#app").hidden = false;
  cargar();
}

if (estado.token) entrar();
