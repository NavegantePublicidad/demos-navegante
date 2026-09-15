// DEMO 02 · El bot califica al prospecto → puntaje → tarjeta a la asesora por Telegram + fila en Sheets
import { type Sesion } from "../db.ts";
import { turnoLead } from "../claude.ts";
import { agregarFila, urlHoja } from "../google.ts";
import { wa, type MensajeWA } from "../whatsapp.ts";
import { alDueno, esc } from "../telegram.ts";
import { hoyISO, warn, primerNombre } from "../util.ts";
import { cfg } from "../config.ts";

type Campos = { nombre?: string; infonavit_activo?: boolean; anios_empresa?: number; puntos?: number | null; interes?: string };

export function puntuar(c: Campos): number {
  let s = 0;
  const pts = Number(c.puntos) || 0, anios = Number(c.anios_empresa) || 0;
  if (c.infonavit_activo) { s += 40; s += Math.min(30, Math.round(30 * Math.min(pts, 1200) / 1080)); s += anios >= 2 ? 15 : anios >= 1 ? 10 : anios > 0 ? 5 : 0; }
  else { s += Math.min(10, Math.round(10 * Math.min(pts, 1200) / 1080)); s += anios >= 1 ? 4 : 0; }
  const i = (c.interes || "").toLowerCase();
  s += /mejoravit|remodel|ampli|constru|comprar|casa|terreno|cr[eé]dito/.test(i) ? 15 : /informaci|curios|saber|ver/.test(i) ? 4 : 8;
  return Math.max(0, Math.min(100, s));
}
export const nivel = (p: number) => (p >= 75 ? "CALIENTE" : p >= 45 ? "TIBIO" : "FRÍO");

export async function entrarLeads(s: Sesion) {
  s.paso = "charla"; s.datos = { historial: [], campos: {} };
  const saludo = `Hola 👋 Soy el asistente de *${cfg.negocio}* (créditos Mejoravit). Te hago unas preguntas rápidas y te digo si calificas. ¿Cómo te llamas?`;
  s.datos.historial.push({ rol: "bot", texto: saludo });
  await wa.texto(s.telefono, saludo);
}

export async function manejarLeads(s: Sesion, m: MensajeWA) {
  const historial: { rol: "cliente" | "bot"; texto: string }[] = s.datos.historial || [];
  const campos: Campos = s.datos.campos || {};
  historial.push({ rol: "cliente", texto: m.texto });
  let turno;
  try { turno = await turnoLead(historial.slice(-12), campos, cfg.negocio); } catch (e) { warn("turnoLead", (e as Error).message); }
  if (!turno) return wa.texto(s.telefono, "Perdón, se me trabó un segundo. ¿Me lo repites?");
  Object.assign(campos, turno.campos || {});
  historial.push({ rol: "bot", texto: turno.respuesta });
  s.datos = { historial, campos };
  await wa.texto(s.telefono, turno.respuesta);

  if (turno.completo) {
    const puntaje = puntuar(campos), niv = nivel(puntaje);
    const nombre = campos.nombre || s.nombre || "Sin nombre";
    await agregarFila("leads", [hoyISO(), nombre, s.telefono, campos.infonavit_activo ? "Sí" : "No", campos.anios_empresa ?? "", campos.puntos ?? "", campos.interes || "", puntaje, niv, "WhatsApp"]);
    if (niv !== "FRÍO") {
      const emoji = niv === "CALIENTE" ? "🔥" : "🌤️";
      await alDueno(`${emoji} <b>Nuevo lead ${niv} · ${puntaje}/100</b>\n<b>${esc(nombre)}</b> · ${esc(s.telefono)}\nInfonavit activo: ${campos.infonavit_activo ? "Sí" : "No"}${campos.anios_empresa != null ? " · " + campos.anios_empresa + " años" : ""}\nPuntos: ${campos.puntos ?? "no sabe"}\nInterés: ${esc(campos.interes || "—")}\nOrigen: WhatsApp`,
        [[{ texto: "Abrir chat", url: `https://wa.me/${s.telefono}` }, { texto: "Ver hoja", url: urlHoja() }]]);
    }
    s.paso = "cerrado";
    setTimeout(() => wa.botones(s.telefono, `Gracias, ${primerNombre(nombre)}. ¿Quieres probar otro demo?`, [{ id: "menu", titulo: "Ver menú" }, { id: "demo_leads", titulo: "Otra conversación" }]).catch(() => {}), 1500);
  }
}
