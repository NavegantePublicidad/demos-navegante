// SQLite nativo de Node (sin compilar nada). Guarda sesiones por teléfono,
// citas y el contador diario de llamadas a Claude.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cfg } from "./config.ts";

mkdirSync(dirname(cfg.dbPath), { recursive: true });
export const db = new DatabaseSync(cfg.dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS sesiones (
  telefono TEXT PRIMARY KEY,
  demo TEXT NOT NULL DEFAULT 'menu',
  paso TEXT NOT NULL DEFAULT '',
  datos TEXT NOT NULL DEFAULT '{}',
  nombre TEXT,
  ultimo_msg_cliente INTEGER NOT NULL DEFAULT 0,
  actualizado INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS citas (
  event_id TEXT PRIMARY KEY,
  telefono TEXT NOT NULL,
  nombre TEXT,
  servicio TEXT,
  inicio TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  recordatorio_enviado INTEGER NOT NULL DEFAULT 0,
  creado INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS uso_claude (dia TEXT PRIMARY KEY, llamadas INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mensajes_vistos (id TEXT PRIMARY KEY, visto INTEGER NOT NULL);
`);

export type Sesion = {
  telefono: string;
  demo: "menu" | "gastos" | "leads" | "reporte" | "citas";
  paso: string;
  datos: Record<string, any>;
  nombre: string | null;
  ultimo_msg_cliente: number;
};

export function getSesion(telefono: string): Sesion {
  const row = db.prepare("SELECT * FROM sesiones WHERE telefono = ?").get(telefono) as any;
  if (!row) return { telefono, demo: "menu", paso: "", datos: {}, nombre: null, ultimo_msg_cliente: 0 };
  return { ...row, datos: JSON.parse(row.datos || "{}") };
}

export function saveSesion(s: Sesion) {
  db.prepare(`INSERT INTO sesiones (telefono, demo, paso, datos, nombre, ultimo_msg_cliente, actualizado)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telefono) DO UPDATE SET demo=excluded.demo, paso=excluded.paso, datos=excluded.datos,
      nombre=excluded.nombre, ultimo_msg_cliente=excluded.ultimo_msg_cliente, actualizado=excluded.actualizado`)
    .run(s.telefono, s.demo, s.paso, JSON.stringify(s.datos), s.nombre, s.ultimo_msg_cliente, Date.now());
}

export function tocarCliente(telefono: string) {
  const s = getSesion(telefono);
  s.ultimo_msg_cliente = Date.now();
  saveSesion(s);
}

/** ¿El cliente nos escribió en las últimas 24 h? (ventana de WhatsApp para texto libre) */
export function enVentana24h(telefono: string): boolean {
  const s = getSesion(telefono);
  return Date.now() - s.ultimo_msg_cliente < 24 * 3600 * 1000;
}

export function mensajeYaVisto(id: string): boolean {
  const r = db.prepare("SELECT 1 FROM mensajes_vistos WHERE id = ?").get(id);
  if (r) return true;
  db.prepare("INSERT INTO mensajes_vistos (id, visto) VALUES (?, ?)").run(id, Date.now());
  db.prepare("DELETE FROM mensajes_vistos WHERE visto < ?").run(Date.now() - 3 * 24 * 3600 * 1000);
  return false;
}

export function contarLlamadaClaude(tope: number): boolean {
  const dia = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO uso_claude (dia, llamadas) VALUES (?, 0) ON CONFLICT(dia) DO NOTHING").run(dia);
  const r = db.prepare("SELECT llamadas FROM uso_claude WHERE dia = ?").get(dia) as any;
  if (r.llamadas >= tope) return false;
  db.prepare("UPDATE uso_claude SET llamadas = llamadas + 1 WHERE dia = ?").run(dia);
  return true;
}
