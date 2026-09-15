// Meta WhatsApp Cloud API — envío de texto, botones, listas y descarga de imágenes.
import { cfg } from "./config.ts";
import { log, warn } from "./util.ts";

const base = () => `https://graph.facebook.com/${cfg.meta.version}`;
const headers = () => ({ Authorization: `Bearer ${cfg.meta.token}`, "Content-Type": "application/json" });

async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; code?: number; error?: string }> {
  const r = await fetch(`${base()}/${cfg.meta.phoneId}/messages`, {
    method: "POST", headers: headers(), body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (r.ok) return { ok: true };
  const j: any = await r.json().catch(() => ({}));
  const code = j?.error?.code; const msg = j?.error?.message || r.statusText;
  warn("WhatsApp envío falló", code, msg);
  return { ok: false, code, error: msg };
}

export type Boton = { id: string; titulo: string };

export const wa = {
  texto: (to: string, body: string) => post({ to, type: "text", text: { body, preview_url: false } }),

  /** Hasta 3 botones, títulos ≤ 20 caracteres */
  botones: (to: string, body: string, botones: Boton[], footer?: string) => post({
    to, type: "interactive",
    interactive: {
      type: "button", body: { text: body }, ...(footer ? { footer: { text: footer } } : {}),
      action: { buttons: botones.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.titulo.slice(0, 20) } })) },
    },
  }),

  /** Lista de hasta 10 opciones */
  lista: (to: string, body: string, titulo: string, filas: { id: string; titulo: string; desc?: string }[]) => post({
    to, type: "interactive",
    interactive: {
      type: "list", body: { text: body },
      action: { button: titulo.slice(0, 20), sections: [{ title: "Opciones", rows: filas.slice(0, 10).map(f => ({ id: f.id, title: f.titulo.slice(0, 24), description: (f.desc || "").slice(0, 72) })) }] },
    },
  }),

  /** Plantilla aprobada (para hablar fuera de la ventana de 24 h) */
  plantilla: (to: string, nombre: string, params: string[] = [], lang = "es_MX") => post({
    to, type: "template",
    template: { name: nombre, language: { code: lang }, components: params.length ? [{ type: "body", parameters: params.map(p => ({ type: "text", text: p })) }] : [] },
  }),

  marcarLeido: (messageId: string) => post({ status: "read", message_id: messageId }),

  /** Descarga una imagen recibida (media id → url → bytes) */
  async descargarMedia(mediaId: string): Promise<{ base64: string; mime: string } | null> {
    const meta = await fetch(`${base()}/${mediaId}`, { headers: headers() });
    if (!meta.ok) { warn("media meta", meta.status); return null; }
    const j: any = await meta.json();
    const bin = await fetch(j.url, { headers: { Authorization: `Bearer ${cfg.meta.token}` } });
    if (!bin.ok) { warn("media bin", bin.status); return null; }
    const buf = Buffer.from(await bin.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) { warn("imagen muy grande", buf.length); return null; }
    return { base64: buf.toString("base64"), mime: j.mime_type || "image/jpeg" };
  },
};

/** Manda texto; si estamos fuera de la ventana de 24 h y hay plantilla, usa la plantilla. */
export async function enviarConRespaldo(to: string, body: string, plantilla?: string, params: string[] = []) {
  const r = await wa.texto(to, body);
  if (r.ok) return r;
  if (r.code === 131047 && plantilla) { log("fuera de ventana 24h → plantilla", plantilla); return wa.plantilla(to, plantilla, params); }
  return r;
}

/** Normaliza el payload del webhook a un mensaje sencillo */
export type MensajeWA = {
  id: string; de: string; nombre: string; tipo: "text" | "image" | "interactive" | "otro";
  texto: string; imagenId?: string; botonId?: string; ts: number;
};
export function extraerMensajes(body: any): MensajeWA[] {
  const out: MensajeWA[] = [];
  for (const entry of body?.entry ?? []) for (const ch of entry?.changes ?? []) {
    const v = ch?.value; if (!v?.messages) continue;
    const nombre = v?.contacts?.[0]?.profile?.name || "";
    for (const m of v.messages) {
      const base = { id: m.id, de: m.from, nombre, ts: Number(m.timestamp) * 1000 };
      if (m.type === "text") out.push({ ...base, tipo: "text", texto: m.text?.body || "" });
      else if (m.type === "image") out.push({ ...base, tipo: "image", texto: m.image?.caption || "", imagenId: m.image?.id });
      else if (m.type === "interactive") {
        const r = m.interactive?.button_reply || m.interactive?.list_reply;
        out.push({ ...base, tipo: "interactive", texto: r?.title || "", botonId: r?.id });
      } else out.push({ ...base, tipo: "otro", texto: "" });
    }
  }
  return out;
}
