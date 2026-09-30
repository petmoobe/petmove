# Plataforma de transporte puerta a puerta de animales vivos

Backend y panel de operaciones. Node.js + Express + SQLite. Sin paso de compilación.

## Arranque

```bash
cd backend
npm install
npm run seed     # datos de ejemplo: cliente, empresa activa, conductor, vehículo, mascota
npm start
```

El arranque imprime en consola:

- API: `http://localhost:3000`
- Panel: `http://localhost:3000/panel`
- Token de administración (generado en cada arranque)

Para fijar un token estable entre reinicios:

```bash
ADMIN_TOKEN=mi-token-seguro npm start
```

## Estructura

```
backend/
├── src/
│   ├── server.js    API pública (precio, reservas, asignación, GPS, imágenes)
│   ├── admin.js     API de administración + servidor de la interfaz
│   ├── pricing.js   Motor de tarifas, comisiones y recargos
│   ├── dispatch.js  Elegibilidad, puntuación y selección de empresas
│   ├── geo.js       Rutas, distancias y aproximación de posiciones
│   ├── rules.js     Comisiones, transiciones de estado, subcontratación
│   ├── schema.sql   Esquema completo
│   ├── db.js        Conexión SQLite
│   └── seed.js      Datos de ejemplo
└── public/
    ├── index.html   Interfaz del panel
    ├── panel.css    Estilos
    └── panel.js     Lógica del panel
```

## Panel de administración

Nueve vistas: resumen operativo, reservas, asignación, viajes en curso, empresas,
incidencias, pagos, tarifas y auditoría.

Acciones que permite:

- Ver métricas: reservas, dinero facturado, neto a transportistas, ingreso de la plataforma.
- Alta de empresas y profesionales, con verificación documental obligatoria antes de activar.
- Bloqueo manual y reactivación.
- Ejecución de la revisión anual: bloquea a quien no tiene reverificación vigente.
- Reasignación manual de un transporte ya asignado.
- Cierre de incidencias, con desbloqueo automático de la liquidación retenida.
- Consulta del motivo por el que cada empresa fue descartada en una asignación.
- Trazabilidad completa en el registro de auditoría.

## Camino crítico cubierto por la API

| Etapa | Endpoint |
|---|---|
| Presupuesto previo | `POST /api/presupuestos` |
| Crear reserva con precio congelado | `POST /api/reservas` |
| Enviar solicitud a empresas | `POST /api/reservas/:id/asignar` |
| Aceptar oferta | `POST /api/ofertas/:id/aceptar` |
| Subcontratar (con autorización) | `POST /api/viajes/:id/subcontratar` |
| Registrar posición GPS | `POST /api/viajes/:id/posiciones` |
| Seguimiento del cliente | `GET /api/viajes/:id/seguimiento` |
| Solicitar imagen | `POST /api/viajes/:id/solicitudes-imagen` |
| Atender solicitud de imagen | `POST /api/solicitudes-imagen/:id/atender` |
| Ver imagen por enlace temporal | `GET /api/imagenes/:token` |
| Registrar incidencia | `POST /api/viajes/:id/incidencias` |
| Prueba de entrega y liquidación | `POST /api/viajes/:id/entregar` |

## Pendiente para producción

Los cuatro adaptadores están marcados en el código con `TODO`:

1. **Autenticación real** con sesión, roles y segundo factor de administración.
2. **Pasarela de pagos** con retención de fondos y reparto de comisiones.
3. **Almacenamiento privado** de imágenes, documentos y cartillas.
4. **Proveedor cartográfico real** (OSRM, Mapbox o Google) en lugar de la estimación local.

Además: notificaciones push, aplicación móvil de cliente, aplicación de conductor,
y firma electrónica del contrato de adhesión.
