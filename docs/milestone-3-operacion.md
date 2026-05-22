# Milestone 3 - Guia operativa

Esta guia resume las funciones operativas agregadas para administradores y ejecutivos.

## Portales

- Admin clientes: `/admin/clientes`
  - Alta y edicion de clientes.
  - Asignacion de SAQ, ciclo, pago y ejecutivo.
  - Alta y edicion de usuarios del cliente.

- Admin ejecutivos: `/admin/executives`
  - Alta, edicion y desactivacion logica de ejecutivos.
  - Revision de portafolio asignado.
  - Para desactivar un ejecutivo con clientes, primero reasignar cada cliente desde Admin clientes.

- Admin operaciones: `/admin/operaciones`
  - Reportes de certificaciones, pagos, vencimientos y procesos inactivos.
  - Salud de datos base: roles, SAQ, mapeos, plantillas, pagos y portafolios.
  - Revision de eventos sensibles de auditoria.
  - Ejecucion manual de recordatorios.
  - Guia de respaldo/restauracion para VPS.

- Portal ejecutivo: `/executive`
  - Revision de clientes asignados.
  - Actualizacion de estado de pago.
  - Seguimiento de vencimientos, avance y salidas generadas.
  - Envio de recordatorios al dashboard del cliente.

## Modo mantenimiento

Variables de entorno del backend:

```env
JWT_SECRET=replace-with-a-long-random-production-secret
FRONTEND_ORIGIN=https://nexuspci.com
MAINTENANCE_MODE_ENABLED=false
MAINTENANCE_MESSAGE=La plataforma esta en mantenimiento operativo. El acceso de administracion permanece disponible.
```

`JWT_SECRET` debe ser un valor largo, aleatorio y privado en produccion. No usar valores de ejemplo.

Cuando `MAINTENANCE_MODE_ENABLED=true`, las solicitudes de escritura de usuarios no administradores se bloquean con estado `503`. Los administradores pueden seguir operando para hacer cambios controlados.

## Respaldo en VPS

Crear carpeta:

```bash
mkdir -p backups
```

Respaldar SQLite:

```bash
docker cp $(docker compose ps -q backend):/data/prod.db ./backups/prod-$(date +%F-%H%M).db
```

Respaldar archivos subidos:

```bash
docker run --rm --volumes-from $(docker compose ps -q backend) -v "$PWD/backups":/backup alpine sh -lc 'tar czf /backup/uploads-$(date +%F-%H%M).tgz /uploads'
```

Despues de una instalacion fresca:

```bash
docker compose exec backend npm run saq:import
docker compose exec backend npm run templates:seed
```

## Verificacion antes de liberar

```bash
cd backend && npm run build
cd ../frontend && npm run build
cd ../backend && npm run phase2:verify
```

En sitio vivo, verificar:

- Admin puede abrir `/admin/clientes`, `/admin/executives`, `/admin/saq-evidence`, `/admin/templates` y `/admin/operaciones`.
- Ejecutivo puede abrir `/executive` y solo ve clientes asignados.
- Cliente no puede abrir rutas admin/ejecutivo.
- Un cambio de pago aparece en el portal ejecutivo y en Admin operaciones.
- Un recordatorio enviado aparece como mensaje del cliente.
- Modo mantenimiento bloquea escrituras de cliente/ejecutivo y mantiene admin activo.
