# DirectorOS

Sistema de gestión ejecutiva de tiempo y delegación para Dirección Comercial multi-empresa.

**App en vivo:** activar GitHub Pages para ver la URL.

## Qué hace

Aplicación web de página única (single-file HTML) para administrar:

- **Dashboard de productividad** — KPIs en vivo, distribución de tiempo 70/20/10, alertas y actividad reciente
- **Smart Calendar** — bloqueo de tiempo semanal con visualización por workspace
- **Delegación de tareas (Kanban)** — seguimiento del equipo con alertas automáticas a 24h sin actualización
- **Agendamiento del equipo** — booking con OKR/KPI obligatorio
- **Centro de Administración** — gestión completa de personas, empresas, tipos de reunión, roles y permisos
- **Centro de Recuperación** — exclusivo para Superusuario

## Roles del sistema

| Rol | Acceso |
|-----|--------|
| Superusuario (Root) | Total · puede recuperar accesos perdidos |
| Director Comercial | Acceso a las 3 áreas de trabajo, todas las funciones |
| Líder MKT | Dashboard, calendario, ver todas las tareas |
| Merchandiser / Diseñador / Practicante | Solo sus propias tareas y agendar reuniones |
| Almacenista / Repartidor | Solo sus propias tareas (workspace Texas) |

## Credenciales demo

**Acceso normal (uso diario):**
```
director@maraga.mx · demo
marco@maraga.mx · demo
luis@maraga.mx · demo
... (cualquier email del seed con contraseña "demo")
```

**Credenciales de emergencia (para recuperación):**
- Superusuario: `root@directoros.local` / `maraga-root-2026`
- Director master: `director@maraga.mx` / `director-maraga-2026`

Las credenciales de emergencia funcionan incluso si el usuario fue desactivado o eliminado — el sistema se autorepara.

## Workspaces

- **Maraga México** (70% tiempo) — E-commerce: ML, Amazon, Walmart, sitio propio
- **San Antonio, Texas** (20% tiempo) — Tienda física + integraciones SAP/QuickBooks
- **Consultoría de Ventas** (10% tiempo) — Proyectos independientes

## Almacenamiento

Single-file HTML con persistencia en `localStorage` del navegador. Sin backend.

**Limitación actual:** cada dispositivo tiene su propia copia de los datos. Para sincronización en tiempo real entre el equipo, migrar a Supabase (siguiente paso del roadmap).

## Tecnología

- HTML + CSS + JavaScript vanilla (sin frameworks)
- Chart.js para visualizaciones
- Tabler Icons + Google Fonts (Inter + Instrument Serif)
- Storage: localStorage con versionado `directoros:*:v2`

## Cómo instalar como app

**iOS / Android:**
Abre la URL → menú del navegador → "Agregar a pantalla de inicio"

**Desktop (Chrome / Edge):**
Abre la URL → menú ⋮ → "Instalar DirectorOS"

## Próximos pasos del roadmap

1. Migración a Supabase para sincronización multi-usuario en tiempo real
2. Notificaciones push para alertas de tareas
3. Integraciones con Mercado Libre / Amazon / QuickBooks
4. Reportes ejecutivos exportables a PDF
