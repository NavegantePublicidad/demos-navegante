// Un solo número de WhatsApp sirve los 4 demos: menú + sesión por teléfono.
import { getSesion, saveSesion, mensajeYaVisto, type Sesion } from "./db.ts";
import { wa, type MensajeWA } from "./whatsapp.ts";
import { entrarGastos, manejarGastos, botonGastos } from "./demos/gastos.ts";
import { entrarLeads, manejarLeads } from "./demos/leads.ts";
import { entrarReporte, manejarReporte, botonReporte } from "./demos/reporte.ts";
import { entrarCitas, manejarCitas, botonCitas, botonDemoRecordatorio } from "./demos/citas.ts";
import { log, warn } from "./util.ts";
import { cfg } from "./config.ts";

export async function menu(s: Sesion) {
  s.demo = "menu"; s.paso = ""; s.datos = {};
  await wa.lista(s.telefono,
    `Hola${s.nombre ? ", " + s.nombre.split(" ")[0] : ""} 👋 Soy el asistente de *${cfg.negocio}*. Elige qué demo quieres probar:`,
    "Ver demos",
    [
      { id: "demo_gastos", titulo: "🧾 Gastos por foto", desc: "Manda un ticket y cae en tu hoja" },
      { id: "demo_leads", titulo: "🎯 Leads calificados", desc: "El bot califica y avisa a la asesora" },
      { id: "demo_reporte", titulo: "☀️ Reporte diario", desc: "Tu negocio te escribe a las 8 AM" },
      { id: "demo_citas", titulo: "🗓️ Citas automáticas", desc: "Agenda y confirma sola" },
    ]);
}

const ES_MENU = (t: string) => /^(men[uú]|hola|inicio|demos|0|salir|cambiar)\b/i.test(t.trim());

export async function procesarMensaje(m: MensajeWA) {
  if (mensajeYaVisto(m.id)) return;
  const s = getSesion(m.de);
  s.ultimo_msg_cliente = Date.now();
  if (!s.nombre && m.nombre) s.nombre = m.nombre;
  wa.marcarLeido(m.id).catch(() => {});
  log("←", m.de, s.demo, m.tipo, m.botonId || m.texto.slice(0, 60));

  try {
    // Botones globales / cambio de demo
    const id = m.botonId || "";
    if (id === "menu" || (m.tipo === "text" && ES_MENU(m.texto))) { await menu(s); return saveSesion(s); }
    if (id.startsWith("demo_")) {
      s.demo = id.slice(5) as Sesion["demo"]; s.paso = ""; s.datos = {};
      if (s.demo === "gastos") await entrarGastos(s);
      else if (s.demo === "leads") await entrarLeads(s);
      else if (s.demo === "reporte") await entrarReporte(s);
      else if (s.demo === "citas") await entrarCitas(s);
      return saveSesion(s);
    }
    if (s.demo === "menu") {
      // Atajos por texto para que el demo arranque sin menú
      const t = m.texto.toLowerCase();
      if (m.tipo === "image" || /ticket|gasto|factura/.test(t)) { s.demo = "gastos"; await entrarGastos(s); if (m.tipo === "image") { const img = m.imagenId ? await wa.descargarMedia(m.imagenId) : null; await manejarGastos(s, m, img || undefined); } }
      else if (/cr[eé]dito|mejoravit|infonavit|lead/.test(t)) { s.demo = "leads"; await entrarLeads(s); }
      else if (/cita|limpieza|dentista|consultorio|agend/.test(t)) { s.demo = "citas"; await entrarCitas(s); await manejarCitas(s, m); }
      else if (/reporte|ventas/.test(t)) { s.demo = "reporte"; await entrarReporte(s); }
      else await menu(s);
      return saveSesion(s);
    }

    // Dentro de un demo
    if (s.demo === "gastos") {
      if (id) await botonGastos(s, id);
      else { const img = m.tipo === "image" && m.imagenId ? await wa.descargarMedia(m.imagenId) : null; await manejarGastos(s, m, img || undefined); }
    } else if (s.demo === "leads") {
      if (s.paso === "cerrado") await entrarLeads(s); else await manejarLeads(s, m);
    } else if (s.demo === "reporte") {
      if (id) await botonReporte(s, id); else await manejarReporte(s, m);
    } else if (s.demo === "citas") {
      if (id === "c_recordar_demo") await botonDemoRecordatorio(s);
      else if (id) await botonCitas(s, id);
      else await manejarCitas(s, m);
    }
  } catch (e) {
    warn("procesarMensaje", (e as Error).stack || e);
    await wa.texto(m.de, "Se me trabó algo. Escribe *menú* para empezar de nuevo.").catch(() => {});
  }
  saveSesion(s);
}
