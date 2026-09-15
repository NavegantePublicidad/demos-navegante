// Google Sheets + Calendar con cuenta de servicio (sin OAuth interactivo).
import { google } from "googleapis";
import { cfg } from "./config.ts";
import { warn } from "./util.ts";

function credenciales() {
  let raw = cfg.google.saJson;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON vacío");
  if (!raw.trim().startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(raw);
}
const auth = new google.auth.GoogleAuth({
  credentials: cfg.google.saJson ? credenciales() : undefined,
  scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/calendar"],
});
const sheets = google.sheets({ version: "v4", auth });
const calendar = google.calendar({ version: "v3", auth });

export const PESTANAS = {
  gastos: ["Fecha", "Proveedor", "Categoría", "IVA", "Total", "Deducible", "Origen", "Confianza"],
  leads: ["Fecha", "Nombre", "Teléfono", "Infonavit activo", "Años empresa", "Puntos", "Interés", "Puntaje", "Nivel", "Origen"],
  ventas: ["Fecha", "Ventas", "Pedidos"],
  pendientes: ["Tipo", "Detalle", "Desde"],
  citas: ["Fecha", "Hora", "Nombre", "Teléfono", "Servicio", "Estado"],
};

export async function asegurarPestanas() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: cfg.google.sheetId });
  const existentes = new Set((meta.data.sheets || []).map(s => s.properties?.title));
  const faltan = Object.keys(PESTANAS).map(k => k[0].toUpperCase() + k.slice(1)).filter(t => !existentes.has(t));
  if (faltan.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: cfg.google.sheetId, requestBody: { requests: faltan.map(title => ({ addSheet: { properties: { title } } })) } });
    for (const t of faltan) await sheets.spreadsheets.values.update({ spreadsheetId: cfg.google.sheetId, range: `${t}!A1`, valueInputOption: "RAW", requestBody: { values: [(PESTANAS as any)[t.toLowerCase()]] } });
  }
  return faltan;
}

export async function agregarFila(pestana: keyof typeof PESTANAS, valores: (string | number)[]) {
  const title = pestana[0].toUpperCase() + pestana.slice(1);
  await sheets.spreadsheets.values.append({ spreadsheetId: cfg.google.sheetId, range: `${title}!A1`, valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [valores] } });
}

export async function leerPestana(pestana: keyof typeof PESTANAS): Promise<string[][]> {
  const title = pestana[0].toUpperCase() + pestana.slice(1);
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: cfg.google.sheetId, range: `${title}!A2:Z` });
    return (r.data.values as string[][]) || [];
  } catch (e) { warn("leerPestana", title, (e as Error).message); return []; }
}

export const urlHoja = () => `https://docs.google.com/spreadsheets/d/${cfg.google.sheetId}`;

// ── Calendar ─────────────────────────────────────────────────────────────
export type Hueco = { inicio: Date; fin: Date };

/** Huecos libres en horario de atención durante los próximos días hábiles */
export async function huecosLibres(dias = 5, duracionMin = 60, horas = [10, 11, 12, 16, 17]): Promise<Hueco[]> {
  const ahora = new Date();
  const fin = new Date(ahora.getTime() + (dias + 2) * 24 * 3600 * 1000);
  const r = await calendar.freebusy.query({ requestBody: { timeMin: ahora.toISOString(), timeMax: fin.toISOString(), timeZone: cfg.tz, items: [{ id: cfg.google.calendarId }] } });
  const ocupados = (r.data.calendars?.[cfg.google.calendarId]?.busy || []).map(b => ({ s: new Date(b.start!).getTime(), e: new Date(b.end!).getTime() }));
  const out: Hueco[] = [];
  for (let d = 0; d <= dias + 2 && out.length < 40; d++) {
    const dia = new Date(ahora.getTime() + d * 24 * 3600 * 1000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(dia);
    const dow = new Date(ymd + "T12:00:00Z").getUTCDay(); if (dow === 0 || dow === 6) continue;
    for (const h of horas) {
      const inicio = fechaLocal(ymd, h);
      if (inicio.getTime() < ahora.getTime() + 60 * 60 * 1000) continue;
      const finH = new Date(inicio.getTime() + duracionMin * 60000);
      const choca = ocupados.some(o => o.s < finH.getTime() && o.e > inicio.getTime());
      if (!choca) out.push({ inicio, fin: finH });
    }
  }
  return out;
}

/** Construye un Date para YYYY-MM-DD a la hora h en la zona del negocio (maneja el offset real) */
export function fechaLocal(ymd: string, h: number, m = 0): Date {
  const guess = new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: cfg.tz, hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "longOffset" }).formatToParts(guess);
  const off = parts.find(p => p.type === "timeZoneName")?.value || "GMT-06:00"; // "GMT-06:00"
  const mm = off.match(/GMT([+-])(\d{2}):(\d{2})/); const sign = mm?.[1] === "-" ? -1 : 1;
  const offMin = sign * (Number(mm?.[2] || 6) * 60 + Number(mm?.[3] || 0));
  return new Date(guess.getTime() - offMin * 60000);
}

export async function crearCita(o: { inicio: Date; fin: Date; nombre: string; servicio: string; telefono: string }) {
  const r = await calendar.events.insert({ calendarId: cfg.google.calendarId, requestBody: {
    summary: `${o.nombre} · ${o.servicio}`, description: `WhatsApp: ${o.telefono}\nAgendada por el asistente de ${cfg.negocio}`,
    start: { dateTime: o.inicio.toISOString(), timeZone: cfg.tz }, end: { dateTime: o.fin.toISOString(), timeZone: cfg.tz },
  } });
  return r.data.id!;
}
export async function marcarCita(eventId: string, prefijo: string) {
  try {
    const ev = await calendar.events.get({ calendarId: cfg.google.calendarId, eventId });
    const summary = (ev.data.summary || "").replace(/^(✅|❌|⏳) /, "");
    await calendar.events.patch({ calendarId: cfg.google.calendarId, eventId, requestBody: { summary: `${prefijo} ${summary}` } });
  } catch (e) { warn("marcarCita", (e as Error).message); }
}
export async function cancelarCita(eventId: string) {
  try { await calendar.events.delete({ calendarId: cfg.google.calendarId, eventId }); } catch (e) { warn("cancelarCita", (e as Error).message); }
}
