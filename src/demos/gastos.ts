// DEMO 01 · Foto del ticket → Claude lo lee → fila en Google Sheets → aviso al dueño
import type { Sesion } from "../db.ts";
import { leerTicket } from "../claude.ts";
import { agregarFila, urlHoja, leerPestana } from "../google.ts";
import { wa, type MensajeWA } from "../whatsapp.ts";
import { alDueno, esc } from "../telegram.ts";
import { mxn, mxn0, hoyISO, warn } from "../util.ts";
import { cfg } from "../config.ts";

export async function entrarGastos(s: Sesion) {
  s.paso = "esperando";
  await wa.texto(s.telefono, `🧾 *Asistente de Gastos*\n\nMándame la *foto del ticket* (o escríbeme comercio y monto, ej. "Pemex 800") y lo registro en tu hoja de gastos con el IVA desglosado.\n\nEscribe *resumen* para ver el mes, o *menú* para cambiar de demo.`);
}

export async function manejarGastos(s: Sesion, m: MensajeWA, imagen?: { base64: string; mime: string }) {
  const t = m.texto.trim().toLowerCase();
  if (t === "resumen") return resumen(s.telefono);
  if (!imagen && !m.texto.trim()) return wa.texto(s.telefono, "Mándame la foto del ticket o escríbeme comercio y monto.");

  await wa.texto(s.telefono, imagen ? "Leyendo el ticket… 👀" : "Registrando… ✍️");
  let ticket;
  try { ticket = await leerTicket({ imagen, texto: m.texto }); } catch (e) { warn("leerTicket", (e as Error).message); }
  if (!ticket || !ticket.total) return wa.texto(s.telefono, "No alcancé a leer el monto. ¿Me mandas otra foto más de cerca, o me escribes el comercio y el total? Ej. *Office Depot 1248*");

  const fecha = ticket.fecha || hoyISO();
  await agregarFila("gastos", [fecha, ticket.proveedor, ticket.categoria, ticket.iva, ticket.total, ticket.deducible, imagen ? "WhatsApp · foto" : "WhatsApp · texto", ticket.confianza]);
  const dudoso = ticket.confianza < 0.6 ? "\n\n_(No estoy 100 % seguro de la lectura; revísalo en la hoja.)_" : "";
  await wa.botones(s.telefono,
    `Listo, lo registré:\n*${ticket.proveedor} · ${mxn(ticket.total)}*\nIVA ${mxn(ticket.iva)} · ${ticket.categoria}\n${ticket.deducible}\n\nYa está en tu hoja de gastos. ✅${dudoso}`,
    [{ id: "g_resumen", titulo: "Ver resumen del mes" }, { id: "g_hoja", titulo: "Abrir la hoja" }, { id: "menu", titulo: "Menú" }]);
  await alDueno(`🧾 <b>Nuevo gasto</b> (${esc(s.nombre || s.telefono)})\n${esc(ticket.proveedor)} · <b>${mxn(ticket.total)}</b>\nIVA ${mxn(ticket.iva)} · ${esc(ticket.categoria)} · ${esc(ticket.deducible)}`, [[{ texto: "Abrir hoja de gastos", url: urlHoja() }]]);
}

export async function botonGastos(s: Sesion, id: string) {
  if (id === "g_resumen") return resumen(s.telefono);
  if (id === "g_hoja") return wa.texto(s.telefono, `Tu hoja de gastos: ${urlHoja()}`);
}

async function resumen(telefono: string) {
  const filas = await leerPestana("gastos");
  const mes = hoyISO().slice(0, 7);
  const delMes = filas.filter(f => (f[0] || "").startsWith(mes));
  const total = delMes.reduce((a, f) => a + (parseFloat(String(f[4]).replace(/[$,]/g, "")) || 0), 0);
  const iva = delMes.reduce((a, f) => a + (parseFloat(String(f[3]).replace(/[$,]/g, "")) || 0), 0);
  const porCat: Record<string, number> = {};
  delMes.forEach(f => { porCat[f[2] || "Otros"] = (porCat[f[2] || "Otros"] || 0) + (parseFloat(String(f[4]).replace(/[$,]/g, "")) || 0); });
  const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `• ${c}: ${mxn0(v)}`).join("\n");
  await wa.texto(telefono, `📊 *Gastos del mes* (${cfg.negocio})\n\nTotal: *${mxn0(total)}*\nIVA acreditable: ${mxn0(iva)}\nTickets capturados: ${delMes.length}\n\n${top || "Aún no hay gastos este mes."}\n\nHoja: ${urlHoja()}`);
}
