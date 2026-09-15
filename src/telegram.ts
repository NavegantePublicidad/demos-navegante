// Telegram Bot API por fetch (sin librería). Lado del dueño / asesora.
import { cfg } from "./config.ts";
import { warn } from "./util.ts";

const api = (m: string) => `https://api.telegram.org/bot${cfg.telegram.token}/${m}`;

export const tg = {
  async enviar(chatId: string, texto: string, botones?: { texto: string; url?: string; data?: string }[][]) {
    if (!cfg.telegram.token || !chatId) return;
    const body: any = { chat_id: chatId, text: texto, parse_mode: "HTML", disable_web_page_preview: true };
    if (botones) body.reply_markup = { inline_keyboard: botones.map(f => f.map(b => b.url ? { text: b.texto, url: b.url } : { text: b.texto, callback_data: b.data || b.texto })) };
    let r = await fetch(api("sendMessage"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { // reintenta sin HTML por si el formato rompió
      delete body.parse_mode; body.text = texto.replace(/<[^>]+>/g, "");
      r = await fetch(api("sendMessage"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) warn("telegram sendMessage", r.status, await r.text());
    }
  },
  async responderCallback(id: string, texto?: string) {
    await fetch(api("answerCallbackQuery"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: id, text: texto }) });
  },
  async descargarFoto(fileId: string): Promise<{ base64: string; mime: string } | null> {
    const r = await fetch(api(`getFile?file_id=${fileId}`)); if (!r.ok) return null;
    const j: any = await r.json(); const path = j?.result?.file_path; if (!path) return null;
    const bin = await fetch(`https://api.telegram.org/file/bot${cfg.telegram.token}/${path}`); if (!bin.ok) return null;
    const buf = Buffer.from(await bin.arrayBuffer());
    return { base64: buf.toString("base64"), mime: path.endsWith(".png") ? "image/png" : "image/jpeg" };
  },
  async registrarWebhook(urlBase: string) {
    const r = await fetch(api("setWebhook"), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `${urlBase}/webhooks/telegram`, secret_token: cfg.telegram.secret, allowed_updates: ["message", "callback_query"] }) });
    return r.json();
  },
};

export const alDueno = (texto: string, botones?: { texto: string; url?: string; data?: string }[][]) => tg.enviar(cfg.telegram.chatDueno, texto, botones);
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
