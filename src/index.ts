// Servidor: webhooks de WhatsApp y Telegram, crons y endpoints de mantenimiento.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import cron from "node-cron";
import { cfg, faltantes } from "./config.ts";
import { extraerMensajes } from "./whatsapp.ts";
import { procesarMensaje } from "./router.ts";
import { tg, alDueno, esc } from "./telegram.ts";
import { enviarReporteDiario } from "./demos/reporte.ts";
import { recordatoriosDeManana } from "./demos/citas.ts";
import { leerTicket } from "./claude.ts";
import { agregarFila, asegurarPestanas, urlHoja } from "./google.ts";
import { hoyISO, log, warn, mxn } from "./util.ts";

const app = new Hono();

app.get("/", c => c.json({ ok: true, servicio: "demos-navegante", faltan: faltantes() }));

// ── WhatsApp (Meta Cloud API) ─────────────────────────────────────────────
app.get("/webhooks/whatsapp", c => {
  const q = c.req.query();
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === cfg.meta.verifyToken) return c.text(q["hub.challenge"] || "");
  return c.text("token inválido", 403);
});
app.post("/webhooks/whatsapp", async c => {
  const body = await c.req.json().catch(() => ({}));
  const msgs = extraerMensajes(body);
  // Responde 200 de inmediato y procesa aparte (Meta reintenta si tardas)
  for (const m of msgs) procesarMensaje(m).catch(e => warn("wa", e));
  return c.json({ ok: true });
});

// ── Telegram (lado del dueño): /id, /reporte, /hoja, foto de ticket ───────
app.post("/webhooks/telegram", async c => {
  if (cfg.telegram.secret && c.req.header("x-telegram-bot-api-secret-token") !== cfg.telegram.secret) return c.text("no", 401);
  const u: any = await c.req.json().catch(() => ({}));
  (async () => {
    if (u.callback_query) { await tg.responderCallback(u.callback_query.id, "Recibido"); return; }
    const m = u.message; if (!m) return;
    const chat = String(m.chat.id); const t: string = m.text || m.caption || "";
    if (/^\/id/.test(t)) return tg.enviar(chat, `Tu chat_id es <code>${chat}</code>. Pégalo en TELEGRAM_CHAT_ID_DUENO.`);
    if (chat !== cfg.telegram.chatDueno) return tg.enviar(chat, "Este bot es privado del dueño del negocio.");
    if (/^\/reporte/.test(t)) { await tg.enviar(chat, "Generando el reporte… ⏳"); await enviarReporteDiario(); return; }
    if (/^\/hoja/.test(t)) return tg.enviar(chat, `Hoja de datos: ${urlHoja()}`);
    if (/^\/recordatorios/.test(t)) { await recordatoriosDeManana(); return tg.enviar(chat, "Recordatorios de mañana revisados."); }
    if (m.photo?.length) { // ticket por Telegram (mismo demo 01, otro canal)
      const fileId = m.photo[m.photo.length - 1].file_id;
      const img = await tg.descargarFoto(fileId); if (!img) return tg.enviar(chat, "No pude descargar la foto.");
      const tk = await leerTicket({ imagen: img, texto: m.caption }).catch(() => null);
      if (!tk || !tk.total) return tg.enviar(chat, "No alcancé a leer el monto. ¿Otra foto más de cerca?");
      await agregarFila("gastos", [tk.fecha || hoyISO(), tk.proveedor, tk.categoria, tk.iva, tk.total, tk.deducible, "Telegram · foto", tk.confianza]);
      return tg.enviar(chat, `🧾 Registrado: <b>${esc(tk.proveedor)} · ${mxn(tk.total)}</b>\nIVA ${mxn(tk.iva)} · ${esc(tk.categoria)} · ${esc(tk.deducible)}`, [[{ texto: "Abrir hoja", url: urlHoja() }]]);
    }
    return tg.enviar(chat, "Comandos: /reporte · /hoja · /recordatorios · o mándame la foto de un ticket.");
  })().catch(e => warn("tg", e));
  return c.json({ ok: true });
});

// ── Mantenimiento (protegido con CRON_TOKEN) ──────────────────────────────
const auth = (c: any) => cfg.cronToken && c.req.header("authorization") === `Bearer ${cfg.cronToken}`;
app.post("/cron/reporte", async c => { if (!auth(c)) return c.text("no", 401); return c.json({ texto: await enviarReporteDiario() }); });
app.post("/cron/recordatorios", async c => { if (!auth(c)) return c.text("no", 401); await recordatoriosDeManana(); return c.json({ ok: true }); });
app.post("/setup/hoja", async c => { if (!auth(c)) return c.text("no", 401); return c.json({ pestanas_creadas: await asegurarPestanas(), url: urlHoja() }); });
app.post("/setup/telegram", async c => { if (!auth(c)) return c.text("no", 401); const base = c.req.query("base") || new URL(c.req.url).origin; return c.json(await tg.registrarWebhook(base.replace(/^http:/, "https:"))); });

// ── Crons internos (hora del negocio) ─────────────────────────────────────
cron.schedule("0 8 * * *", () => enviarReporteDiario().catch(e => warn("cron reporte", e)), { timezone: cfg.tz });
cron.schedule("0 10 * * *", () => recordatoriosDeManana().catch(e => warn("cron recordatorios", e)), { timezone: cfg.tz });

const faltan = faltantes();
if (faltan.length) warn("Faltan variables de entorno:", faltan.join(", "));
serve({ fetch: app.fetch, port: cfg.port }, () => {
  log(`demos-navegante escuchando en :${cfg.port} · modelo ${cfg.anthropic.model} · tz ${cfg.tz}`);
  if (!faltan.length) alDueno(`🟢 demos-navegante arrancó (${new Date().toLocaleString("es-MX", { timeZone: cfg.tz })})`).catch(() => {});
});
