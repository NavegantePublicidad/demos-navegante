// DEMO 03 · A las 8:00 el negocio manda su reporte. Datos: pestañas Ventas, Gastos y Pendientes de la hoja.
import type { Sesion } from "../db.ts";
import { redactarReporte, responderSobreReporte } from "../claude.ts";
import { leerPestana, urlHoja } from "../google.ts";
import { wa, enviarConRespaldo, type MensajeWA } from "../whatsapp.ts";
import { alDueno } from "../telegram.ts";
import { ayerISO, warn, log } from "../util.ts";
import { cfg } from "../config.ts";

const num = (v: unknown) => parseFloat(String(v ?? "").replace(/[$,%\s]/g, "")) || 0;

export async function datosDeAyer() {
  const [ventas, gastos, pendientes] = await Promise.all([leerPestana("ventas"), leerPestana("gastos"), leerPestana("pendientes")]);
  const ayer = ayerISO();
  const hace7 = new Date(new Date(ayer + "T12:00:00Z").getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const fila = (d: string) => ventas.find(f => (f[0] || "").startsWith(d));
  const vAyer = fila(ayer), vPrev = fila(hace7);
  const ventasAyer = num(vAyer?.[1]), pedidos = num(vAyer?.[2]), ventasPrev = num(vPrev?.[1]);
  const gastosAyer = gastos.filter(f => (f[0] || "").startsWith(ayer)).reduce((a, f) => a + num(f[4]), 0);
  const costoPct = 0.29; // supuesto de demo; en producción sale del catálogo
  return {
    fecha: ayer,
    ventas: { monto: ventasAyer, pedidos, ticket_promedio: pedidos ? Math.round(ventasAyer / pedidos) : 0, mismo_dia_semana_pasada: ventasPrev, variacion_pct: ventasPrev ? Math.round((ventasAyer - ventasPrev) / ventasPrev * 100) : null, sin_datos: !vAyer },
    gastos: { monto: gastosAyer },
    margen_estimado: Math.round(ventasAyer * (1 - costoPct) - gastosAyer),
    pendientes: pendientes.filter(f => f[0]).map(f => ({ tipo: f[0], detalle: f[1], desde: f[2] || "" })),
    hoja: urlHoja(),
  };
}

export async function enviarReporteDiario(destino?: string) {
  const datos = await datosDeAyer();
  let texto: string;
  try { texto = await redactarReporte(datos, cfg.dueno, cfg.negocio); } catch (e) { warn("redactarReporte", (e as Error).message); texto = `Buenos días, ${cfg.dueno}. Ventas de ayer $${datos.ventas.monto} en ${datos.ventas.pedidos} pedidos; gastos $${datos.gastos.monto}. Pendientes: ${datos.pendientes.length}.`; }
  const to = destino || cfg.ownerWhatsapp;
  if (to) {
    const r = await enviarConRespaldo(to, texto, cfg.meta.tplReporte, [cfg.dueno]);
    if (!r.ok) log("reporte por WhatsApp no salió (", r.code, ") → va por Telegram");
  }
  await alDueno(`☀️ <b>Reporte diario</b>\n${texto.replace(/\*(.+?)\*/g, "<b>$1</b>")}`, [[{ texto: "Abrir hoja", url: urlHoja() }]]);
  return texto;
}

export async function entrarReporte(s: Sesion) {
  s.paso = "conversando";
  await wa.botones(s.telefono, `☀️ *Reporte Diario*\n\nCada mañana a las 8:00 tu negocio te manda un resumen: ventas, gastos, margen y lo que urge hoy. Los datos salen de la hoja (pestañas Ventas, Gastos y Pendientes).\n\n¿Te mando el de hoy ahora mismo?`,
    [{ id: "r_ahora", titulo: "Mándamelo ahora" }, { id: "r_hoja", titulo: "Ver la hoja" }, { id: "menu", titulo: "Menú" }]);
}

export async function botonReporte(s: Sesion, id: string) {
  if (id === "r_ahora") { await wa.texto(s.telefono, "Juntando datos de Shopify, la hoja y los canales… ⏳"); const txt = await enviarReporteDiario(s.telefono); s.datos.ultimoReporte = Date.now(); if (s.telefono !== cfg.ownerWhatsapp) await wa.texto(s.telefono, txt); return; }
  if (id === "r_hoja") return wa.texto(s.telefono, `Hoja de datos del demo: ${urlHoja()}\nCambia los números de *Ventas* o *Pendientes* y pide el reporte otra vez.`);
}

export async function manejarReporte(s: Sesion, m: MensajeWA) {
  const t = m.texto.trim().toLowerCase();
  if (/^(reporte|mándamelo|mandamelo|ahora|dame el reporte)/.test(t)) return botonReporte(s, "r_ahora");
  let r: string;
  try { r = await responderSobreReporte(m.texto, await datosDeAyer(), cfg.negocio); } catch (e) { warn("responderSobreReporte", (e as Error).message); r = "Ahorita no pude consultar los datos. Intenta en un momento."; }
  await wa.texto(s.telefono, r);
}
