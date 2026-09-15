// Lee las variables de entorno una sola vez y avisa claro si falta algo.
const env = (k: string, def = ""): string => (process.env[k] ?? def).trim();

export const cfg = {
  port: Number(env("PORT", "8080")),
  dbPath: env("DB_PATH", "./data/demos.sqlite"),
  tz: env("TZ", "America/Monterrey"),
  cronToken: env("CRON_TOKEN"),

  meta: {
    phoneId: env("META_PHONE_NUMBER_ID"),
    token: env("META_ACCESS_TOKEN"),
    verifyToken: env("META_VERIFY_TOKEN", "navegante-demos"),
    version: env("META_GRAPH_VERSION", "v21.0"),
    tplReporte: env("META_TEMPLATE_REPORTE"),
    tplRecordatorio: env("META_TEMPLATE_RECORDATORIO"),
  },
  telegram: {
    token: env("TELEGRAM_BOT_TOKEN"),
    secret: env("TELEGRAM_WEBHOOK_SECRET"),
    chatDueno: env("TELEGRAM_CHAT_ID_DUENO"),
  },
  ownerWhatsapp: env("OWNER_WHATSAPP"),
  anthropic: {
    key: env("ANTHROPIC_API_KEY"),
    model: env("CLAUDE_MODEL", "claude-sonnet-4-6"),
    topeDiario: Number(env("CLAUDE_TOPE_DIARIO", "300")),
  },
  google: {
    saJson: env("GOOGLE_SERVICE_ACCOUNT_JSON"),
    sheetId: env("GOOGLE_SHEET_ID"),
    calendarId: env("GOOGLE_CALENDAR_ID"),
  },
  negocio: env("NEGOCIO_NOMBRE", "Navegante Demo"),
  dueno: env("DUENO_NOMBRE", "Luis"),
  asesora: env("ASESORA_NOMBRE", "Frida"),
};

export function faltantes(): string[] {
  const req: [string, string][] = [
    ["META_PHONE_NUMBER_ID", cfg.meta.phoneId],
    ["META_ACCESS_TOKEN", cfg.meta.token],
    ["ANTHROPIC_API_KEY", cfg.anthropic.key],
    ["GOOGLE_SERVICE_ACCOUNT_JSON", cfg.google.saJson],
    ["GOOGLE_SHEET_ID", cfg.google.sheetId],
    ["GOOGLE_CALENDAR_ID", cfg.google.calendarId],
    ["TELEGRAM_BOT_TOKEN", cfg.telegram.token],
    ["TELEGRAM_CHAT_ID_DUENO", cfg.telegram.chatDueno],
  ];
  return req.filter(([, v]) => !v).map(([k]) => k);
}
