import { cfg } from "./config.ts";

export const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
export const warn = (...a: unknown[]) => console.warn(new Date().toISOString(), "⚠️", ...a);

export const mxn = (n: number) =>
  "$" + (Math.round(n * 100) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const mxn0 = (n: number) => "$" + Math.round(n).toLocaleString("es-MX");

/** Fecha/hora en la zona del negocio */
export function ahora(): Date { return new Date(); }
export function fmtFecha(d: Date, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: cfg.tz, ...opts }).format(d);
}
export function fmtHora(d: Date) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: cfg.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
export function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function ayerISO(): string {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Extrae el primer objeto JSON de un texto (Claude a veces envuelve en ```json) */
export function parsearJson<T = any>(txt: string): T | null {
  const limpio = txt.replace(/```json|```/g, "").trim();
  try { return JSON.parse(limpio) as T; } catch {}
  const m = limpio.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as T; } catch {} }
  return null;
}

export const primerNombre = (s: string | null | undefined) => (s || "").trim().split(/\s+/)[0] || "";
export const capitalizar = (s: string) => s.replace(/\b\p{L}/gu, c => c.toUpperCase());
