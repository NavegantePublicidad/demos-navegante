# demos-navegante

Demos **funcionales** de Navegante Publicidad. Un solo servicio Node/TypeScript (Hono) que:

- recibe mensajes de **WhatsApp** (Meta Cloud API, número de prueba de tu app de Facebook),
- piensa con **Claude Sonnet** (lee tickets con visión, califica leads, redacta reportes, entiende citas),
- escribe en **Google Sheets** y **Google Calendar** con una cuenta de servicio,
- avisa al dueño / asesora por **Telegram**.

Un número de WhatsApp sirve los 4 demos con un menú:

| Demo | Qué hace de verdad |
|---|---|
| 🧾 Gastos por foto | Foto del ticket → Claude lo lee → fila en pestaña `Gastos` (IVA, categoría, deducible) → aviso a Telegram |
| 🎯 Leads calificados | Charla natural → puntaje 0-100 → fila en `Leads`; CALIENTE/TIBIO llegan como tarjeta a Telegram con botón "Abrir chat" |
| ☀️ Reporte diario | Cron 8:00 → lee `Ventas`, `Gastos`, `Pendientes` → Claude redacta → WhatsApp al dueño + Telegram; el dueño puede preguntar detalle |
| 🗓️ Citas | Ofrece huecos **libres reales** del calendario → crea el evento → recordatorio 10:00 del día anterior con botones Confirmo/Cancelar → marca ✅/❌ en Calendar |

Sin cobros por ahora (queda como fase 2).

---

## 1. Requisitos (todo gratis para demo)

| Pieza | Dónde | Qué copiar |
|---|---|---|
| App de Facebook con WhatsApp | developers.facebook.com → Mis apps → Crear app → Empresa → agregar producto **WhatsApp** | `META_PHONE_NUMBER_ID` (Phone number ID del número de prueba) y `META_ACCESS_TOKEN` (token temporal de 24 h para probar; para que dure, crea un **System User** en Business Settings y genera un token permanente con permiso `whatsapp_business_messaging`) |
| Números de prueba | Misma pantalla "API Setup" → *To* → Manage phone number list | Agrega hasta **5 celulares** (el tuyo, el de Kike, el del prospecto). Solo esos pueden chatear con el número de prueba. |
| Bot de Telegram | @BotFather → `/newbot` | `TELEGRAM_BOT_TOKEN` |
| Anthropic | console.anthropic.com → API Keys | `ANTHROPIC_API_KEY` (la misma que usas en Yamete sirve) |
| Cuenta de servicio de Google | console.cloud.google.com → proyecto nuevo "navegante-demos" → APIs y servicios → **habilitar Google Sheets API y Google Calendar API** → Credenciales → Crear credencial → Cuenta de servicio → Claves → Agregar clave JSON | El JSON completo va en `GOOGLE_SERVICE_ACCOUNT_JSON` (en una línea, o en base64: `base64 -w0 archivo.json`) |
| Hoja de Google | Crea una hoja vacía y **compártela** con el correo de la cuenta de servicio (`xxx@xxx.iam.gserviceaccount.com`) como Editor | `GOOGLE_SHEET_ID` = lo que va entre `/d/` y `/edit` en la URL |
| Calendario | Google Calendar → crea un calendario "Consultorio Demo" → Configuración → Compartir con personas específicas → correo de la cuenta de servicio, permiso "Hacer cambios en eventos" | `GOOGLE_CALENDAR_ID` (en la misma configuración, abajo: "ID del calendario") |

## 2. Deploy en EasyPanel (VPS Hostinger)

1. Sube esta carpeta a GitHub como `NavegantePublicidad/demos-navegante` (privado está bien).
2. EasyPanel → proyecto `n8n` (o uno nuevo `navegante`) → **+ Servicio → App** → nombre `demos`.
3. **Fuente**: tipo *Github* → `NavegantePublicidad/demos-navegante`, rama `main`, compilación *Dockerfile*.
4. **Entorno**: pega el contenido de `.env.example` con tus valores. Mínimo obligatorio: las 8 variables que lista `GET /` en `faltan`.
5. **Almacenamiento** → Volumen → nombre `demos-data`, ruta de montaje `/data` (ahí vive la base SQLite de sesiones y citas).
6. **Dominios**: EasyPanel te da `https://<proyecto>-demos.re2h9x.easypanel.host` → puerto **8080**. Anótalo: es tu `URL_BASE`.
7. Implementar. Abre `URL_BASE/` en el navegador: debe responder `{"ok":true,"faltan":[]}`.

## 3. Conectar los webhooks (una sola vez)

**WhatsApp** — en la app de Facebook → WhatsApp → Configuration → Webhook → *Edit*:
- Callback URL: `URL_BASE/webhooks/whatsapp`
- Verify token: el valor de `META_VERIFY_TOKEN` (por defecto `navegante-demos`)
- *Verify and save* → luego en *Webhook fields* suscribe **`messages`**.

**Telegram** — desde tu terminal:
```bash
curl -X POST "URL_BASE/setup/telegram" -H "Authorization: Bearer $CRON_TOKEN"
```
Luego escríbele al bot `/id`: te contesta tu `chat_id` → pégalo en `TELEGRAM_CHAT_ID_DUENO` y vuelve a implementar.

**Hoja** — crea las pestañas con encabezados en un comando:
```bash
curl -X POST "URL_BASE/setup/hoja" -H "Authorization: Bearer $CRON_TOKEN"
```
Llena a mano un par de filas en `Ventas` (Fecha `YYYY-MM-DD`, Ventas, Pedidos — pon la de ayer y la de hace 7 días) y en `Pendientes` (Tipo, Detalle, Desde) para que el reporte tenga qué decir.

## 4. Probar

Desde un celular de la lista de prueba, manda **"hola"** al número de prueba → aparece el menú. Atajos sin menú: manda una **foto de un ticket**, escribe **"quiero info del crédito Mejoravit"** o **"quiero cita para limpieza el jueves"**.

Lado del dueño (Telegram): `/reporte` genera el reporte ahora, `/hoja` da el link, `/recordatorios` fuerza el envío de recordatorios de mañana, y una **foto de ticket** también se registra.

Endpoints útiles (con `Authorization: Bearer CRON_TOKEN`): `POST /cron/reporte`, `POST /cron/recordatorios`.

## 5. Cosas que conviene saber (para que no te sorprendan en la demo)

- **Ventana de 24 h.** WhatsApp solo deja mandar texto libre a alguien que te escribió en las últimas 24 h. El reporte de las 8 AM y el recordatorio de citas son *iniciados por el negocio*: si el dueño no ha escrito ese día, Meta devuelve el error 131047 y el servicio hace respaldo: manda el reporte por Telegram, y si configuraste `META_TEMPLATE_REPORTE` / `META_TEMPLATE_RECORDATORIO` usa esa plantilla. Para la demo basta con que el "dueño" escriba "hola" al número antes de grabar. Plantillas sugeridas (WhatsApp Manager → Message templates, categoría *Utility*, `es_MX`):
  - `reporte_diario`: "Buenos días {{1}}, ya está listo el reporte de ayer. Responde *ver* para recibirlo."
  - `recordatorio_cita`: "Hola {{1}}, mañana a las {{2}} es tu cita de {{3}}. ¿Confirmas?"
- **Número de prueba**: máximo 5 destinatarios y se muestra como número de Meta. Para producción se agrega un número real del cliente en la misma app (requiere verificación del negocio).
- **Token temporal** caduca en 24 h; usa System User para uno permanente.
- **Tope diario** de llamadas a Claude (`CLAUDE_TOPE_DIARIO`, 300) — un seguro para que un curioso no te gaste la cuenta.
- Costo de Claude Sonnet por demo completo: ~$0.01–0.03 USD.
- Horarios de citas: lunes a viernes 10, 11, 12, 16 y 17 h, 60 min. Se cambian en `huecosLibres()` en `src/google.ts`.
- Rúbrica de leads (Infonavit activo 40 · puntos 30 · antigüedad 15 · interés 15; CALIENTE ≥75, TIBIO ≥45) en `src/demos/leads.ts`.

## 6. Correr en tu compu (opcional)

```bash
npm install
copy .env.example .env   # y llénalo
npm run dev
```
Para que Meta te alcance en local usa un túnel (`npx localtunnel --port 8080` o ngrok) y pon esa URL como callback.

## Estructura

```
src/index.ts        servidor, webhooks, crons, endpoints de setup
src/router.ts       menú y sesión por teléfono → despacha a cada demo
src/whatsapp.ts     Meta Cloud API (texto, botones, listas, plantillas, media)
src/telegram.ts     Bot API por fetch
src/claude.ts       prompts y llamadas a Claude (tope diario, JSON estricto, visión)
src/google.ts       Sheets + Calendar con cuenta de servicio
src/db.ts           SQLite nativo de Node (sesiones, citas, contador)
src/demos/*.ts      gastos · leads · reporte · citas
```
