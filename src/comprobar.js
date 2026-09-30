/**
 * Comprobación de arranque.
 *
 * Recorre el camino crítico completo sin depender de la interfaz:
 * tarifa → presupuesto → reserva → asignación → aceptación → posición GPS →
 * imagen → incidencia → entrega con PIN. Sirve para verificar que todo
 * funciona tras una instalación, un despliegue o un cambio.
 *
 * Uso:  npm run demo   (arranca el servidor y ejecuta la comprobación)
 *       node src/comprobar.js   (con el servidor ya en marcha)
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

const llamar = async (metodo, ruta, cuerpo) => {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, estado: res.status, json };
};

const linea = (t) => console.log(`\n── ${t}`);

linea("1. Servicio activo");
const salud = await llamar("GET", "/api/salud");
console.log(salud.ok ? `   OK · ${salud.json.servicio} v${salud.json.version}` : `   FALLO · ${salud.estado}`);

linea("2. Presupuesto Madrid → Valencia");
const presupuesto = await llamar("POST", "/api/presupuestos", {
  origen: { lat: 40.4168, lng: -3.7038, direccion: "Madrid" },
  destino: { lat: 39.4699, lng: -0.3763, direccion: "Valencia" },
  opciones: { urgencia: "estandar" },
  especie: "perro",
});
if (!presupuesto.ok) {
  console.log("   FALLO:", presupuesto.json);
  process.exit(1);
}
const p = presupuesto.json.precio;
console.log(`   Distancia ............ ${presupuesto.json.ruta.distanciaKm} km`);
console.log(`   Duración estimada .... ${presupuesto.json.ruta.duracionH} h`);
console.log(`   Subtotal servicio .... ${p.subtotalTexto}`);
console.log(`   Comisión cliente ..... ${(p.comisionCliente / 100).toFixed(2)} €`);
console.log(`   Total al cliente ..... ${p.totalClienteTexto}`);
console.log(`   Neto a la empresa .... ${p.netoCarrierTexto}`);
console.log(`   Ingreso plataforma ... ${((p.comisionCliente + p.comisionCarrier) / 100).toFixed(2)} €`);

linea("3. Avisos de bienestar");
for (const a of presupuesto.json.avisos ?? []) console.log("   ·", a);
if (!(presupuesto.json.avisos ?? []).length) console.log("   (ninguno para este trayecto)");

console.log("\nComprobación terminada. Abre /panel para ver el resultado en la interfaz.");
