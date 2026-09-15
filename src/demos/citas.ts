// DEMO 04 · Agenda sola y confirma sola (Google Calendar real). Sin cobro por ahora.
import { db, type Sesion } from "../db.ts";
import { interpretarCita } from "../claude.ts";
import { huecosLibres, crearCita, marcarCita, cancelarCita, agregarFila, type Hueco } from "../google.ts";
import { wa, enviarConRespaldo, type MensajeWA } from "../whatsapp.ts";
import { alDueno, esc } from "../telegram.ts";
import { fmtFecha, fmtHora, warn, capitalizar, primerNombre, log } from "../util.ts";
import { cfg } from "../config.ts";

const SERVICIOS = ["Limpieza dental", "Revisión", "Blanqueamiento", "Extracción", "Resina", "Valoración de ortodoncia"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const etiqueta = (h: Hueco) => `${capitalizar(fmtFecha(h.inicio, { weekday: "long", day: "numeric" }))} ${fmtHora(h.inicio)}`;

export async function entrarCitas(s: Sesion) {
  s.paso = "inicio"; s.datos = {};
  await wa.texto(s.telefono, `🗓️ *Consultorio Dental · ${cfg.negocio}*\n\nPuedo agendarte una cita ahora mismo. ¿Qué necesitas y qué día te acomoda?\nEj. "quiero limpieza el jueves" o "me urge una revisión".`);
}

async function ofrecer(s: Sesion, servicio: string, diaPref?: string | null, horaPref?: string | null) {
  let huecos = await huecosLibres();
  if (diaPref && !/hoy|mañana/.test(diaPref) && DIAS.includes(diaPref.toLowerCase())) { const f = huecos.filter(h => fmtFecha(h.inicio, { weekday: "long" }).toLowerCase() === diaPref.toLowerCase()); if (f.length) huecos = f; }
  if (diaPref === "hoy") { const hoy = fmtFecha(new Date(), { day: "numeric" }); const f = huecos.filter(h => fmtFecha(h.inicio, { day: "numeric" }) === hoy); if (f.length) huecos = f; }
  if (diaPref === "mañana") { const m = fmtFecha(new Date(Date.now() + 86400000), { day: "numeric" }); const f = huecos.filter(h => fmtFecha(h.inicio, { day: "numeric" }) === m); if (f.length) huecos = f; }
  if (horaPref) { const f = huecos.filter(h => fmtHora(h.inicio) === horaPref); if (f.length) huecos = f; }
  if (!huecos.length) { s.paso = "inicio"; return wa.texto(s.telefono, "Esta semana está llena. ¿Te apunto en lista de espera y te aviso si se libera un hueco?"); }
  const opciones = huecos.slice(0, 3);
  s.datos.servicio = servicio; s.datos.opciones = opciones.map(h => h.inicio.toISOString()); s.paso = "eligiendo";
  await wa.botones(s.telefono, `Claro, *${servicio.toLowerCase()}*. Tengo estos horarios:`, opciones.map((h, i) => ({ id: `c_op_${i}`, titulo: etiqueta(h) })), "Toca uno o dime otro día");
}

export async function manejarCitas(s: Sesion, m: MensajeWA) {
  let intento;
  try { intento = await interpretarCita(m.texto, { servicios: SERVICIOS, paso: s.paso, opciones: (s.datos.opciones || []).map((iso: string) => etiqueta({ inicio: new Date(iso), fin: new Date(iso) })) }); }
  catch (e) { warn("interpretarCita", (e as Error).message); }
  if (!intento) return wa.texto(s.telefono, "¿Me repites qué servicio necesitas y qué día te acomoda?");

  if (intento.intencion === "cancelar") return cancelarDesdeCliente(s);

  if (s.paso === "esperando_nombre") {
    const nombre = capitalizar(intento.nombre || m.texto.trim().split(/\s+/).slice(0, 3).join(" "));
    return confirmarCreacion(s, nombre);
  }
  if (s.paso === "eligiendo" && intento.intencion === "elegir" && intento.eleccion) return elegir(s, intento.eleccion - 1);
  if (intento.intencion === "agendar" || intento.servicio || intento.dia_preferido) {
    const servicio = intento.servicio || s.datos.servicio;
    if (!servicio) { s.paso = "inicio"; return wa.lista(s.telefono, "¿Para qué es tu cita?", "Ver servicios", SERVICIOS.map((x, i) => ({ id: `c_srv_${i}`, titulo: x }))); }
    return ofrecer(s, servicio, intento.dia_preferido, intento.hora_preferida);
  }
  await wa.texto(s.telefono, intento.respuesta || "Puedo agendarte una cita. ¿Qué servicio necesitas?");
}

export async function botonCitas(s: Sesion, id: string) {
  if (id.startsWith("c_srv_")) return ofrecer(s, SERVICIOS[Number(id.slice(6))] || SERVICIOS[0]);
  if (id.startsWith("c_op_")) return elegir(s, Number(id.slice(5)));
  if (id === "c_confirmo") return confirmarAsistencia(s, true);
  if (id === "c_cancelo") return cancelarDesdeCliente(s);
}

async function elegir(s: Sesion, i: number) {
  const iso = (s.datos.opciones || [])[i]; if (!iso) return wa.texto(s.telefono, "¿Cuál de los horarios te aparto?");
  s.datos.elegido = iso; s.paso = "esperando_nombre";
  if (s.nombre) return confirmarCreacion(s, s.nombre);
  await wa.texto(s.telefono, "Perfecto. ¿A nombre de quién la agendo?");
}

async function confirmarCreacion(s: Sesion, nombre: string) {
  const inicio = new Date(s.datos.elegido), fin = new Date(inicio.getTime() + 60 * 60000);
  const servicio = s.datos.servicio || "Revisión";
  let eventId: string;
  try { eventId = await crearCita({ inicio, fin, nombre, servicio, telefono: s.telefono }); }
  catch (e) { warn("crearCita", (e as Error).message); return wa.texto(s.telefono, "No pude guardar la cita en la agenda. Intenta de nuevo en un momento."); }
  db.prepare("INSERT INTO citas (event_id, telefono, nombre, servicio, inicio, estado, creado) VALUES (?, ?, ?, ?, ?, 'pendiente', ?)").run(eventId, s.telefono, nombre, servicio, inicio.toISOString(), Date.now());
  await agregarFila("citas", [fmtFecha(inicio, { year: "numeric", month: "2-digit", day: "2-digit" }), fmtHora(inicio), nombre, s.telefono, servicio, "Agendada"]);
  s.nombre = nombre; s.paso = "agendada"; s.datos = { eventId };
  await wa.botones(s.telefono, `Listo, ${primerNombre(nombre)}: *${etiqueta({ inicio, fin })}* · ${servicio}.\nYa quedó en la agenda del consultorio. Un día antes te mando recordatorio. 📅`,
    [{ id: "c_recordar_demo", titulo: "Simular recordatorio" }, { id: "menu", titulo: "Menú" }], "El recordatorio real sale solo a las 10:00 del día anterior");
  await alDueno(`🗓️ <b>Nueva cita</b>\n${esc(nombre)} · ${esc(servicio)}\n${esc(etiqueta({ inicio, fin }))}\nWhatsApp: ${esc(s.telefono)}`);
}

/** Recordatorio (lo dispara el cron a las 10:00 para las citas de mañana, o el botón de demo) */
export async function enviarRecordatorio(eventId: string) {
  const c = db.prepare("SELECT * FROM citas WHERE event_id = ?").get(eventId) as any; if (!c) return;
  const inicio = new Date(c.inicio);
  const texto = `Hola ${primerNombre(c.nombre)}, mañana *${fmtHora(inicio)}* es tu cita de ${String(c.servicio).toLowerCase()}. ¿Confirmas?`;
  const r = await wa.botones(c.telefono, texto, [{ id: "c_confirmo", titulo: "Sí, confirmo" }, { id: "c_cancelo", titulo: "No puedo, cancelar" }]);
  if (!r.ok && r.code === 131047 && cfg.meta.tplRecordatorio) await wa.plantilla(c.telefono, cfg.meta.tplRecordatorio, [primerNombre(c.nombre), fmtHora(inicio), String(c.servicio).toLowerCase()]);
  db.prepare("UPDATE citas SET recordatorio_enviado = 1 WHERE event_id = ?").run(eventId);
}

export async function recordatoriosDeManana() {
  const manana = new Date(Date.now() + 86400000);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz }).format(manana);
  const rows = db.prepare("SELECT event_id, inicio FROM citas WHERE estado = 'pendiente' AND recordatorio_enviado = 0").all() as any[];
  for (const r of rows) { const d = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz }).format(new Date(r.inicio)); if (d === ymd) { log("recordatorio", r.event_id); await enviarRecordatorio(r.event_id); } }
}

async function confirmarAsistencia(s: Sesion, si: boolean) {
  const c = db.prepare("SELECT * FROM citas WHERE telefono = ? AND estado = 'pendiente' ORDER BY creado DESC LIMIT 1").get(s.telefono) as any;
  if (!c) return wa.texto(s.telefono, "No encuentro una cita pendiente a tu nombre. ¿Quieres agendar una?");
  db.prepare("UPDATE citas SET estado = 'confirmada' WHERE event_id = ?").run(c.event_id);
  await marcarCita(c.event_id, "✅");
  await wa.texto(s.telefono, "Gracias por confirmar. Te esperamos. Si necesitas la ubicación, dime. 🦷");
  await alDueno(`✅ <b>Cita confirmada</b>: ${esc(c.nombre)} · ${esc(c.servicio)} · ${esc(etiqueta({ inicio: new Date(c.inicio), fin: new Date(c.inicio) }))}`);
}

async function cancelarDesdeCliente(s: Sesion) {
  const c = db.prepare("SELECT * FROM citas WHERE telefono = ? AND estado IN ('pendiente','confirmada') ORDER BY creado DESC LIMIT 1").get(s.telefono) as any;
  if (!c) return wa.texto(s.telefono, "No tienes citas activas. ¿Quieres agendar una?");
  db.prepare("UPDATE citas SET estado = 'cancelada' WHERE event_id = ?").run(c.event_id);
  await cancelarCita(c.event_id);
  s.paso = "inicio";
  await wa.texto(s.telefono, "Sin problema, la cancelé y el hueco ya se ofrece a la lista de espera. Cuando quieras reagendar, escríbeme. 👋");
  await alDueno(`❌ <b>Cita cancelada</b>: ${esc(c.nombre)} · ${esc(etiqueta({ inicio: new Date(c.inicio), fin: new Date(c.inicio) }))} — hueco liberado`);
}

export async function botonDemoRecordatorio(s: Sesion) {
  const c = db.prepare("SELECT event_id FROM citas WHERE telefono = ? AND estado = 'pendiente' ORDER BY creado DESC LIMIT 1").get(s.telefono) as any;
  if (!c) return wa.texto(s.telefono, "Primero agenda una cita.");
  await wa.texto(s.telefono, "_(Así se vería el recordatorio de mañana a las 10:00)_");
  await enviarRecordatorio(c.event_id);
}
