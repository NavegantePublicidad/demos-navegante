// Todas las llamadas a Claude pasan por aquí: tope diario, JSON estricto, visión.
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "./config.ts";
import { contarLlamadaClaude } from "./db.ts";
import { parsearJson, warn } from "./util.ts";

const client = new Anthropic({ apiKey: cfg.anthropic.key });

type Imagen = { base64: string; mime: string };

async function preguntar(system: string, user: string, imagen?: Imagen, maxTokens = 800): Promise<string> {
  if (!contarLlamadaClaude(cfg.anthropic.topeDiario)) { warn("tope diario de Claude alcanzado"); throw new Error("tope_diario"); }
  const content: any[] = [];
  if (imagen) content.push({ type: "image", source: { type: "base64", media_type: imagen.mime, data: imagen.base64 } });
  content.push({ type: "text", text: user });
  const r = await client.messages.create({ model: cfg.anthropic.model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] });
  return r.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

// ── Demo 01: leer ticket ─────────────────────────────────────────────────
export type Ticket = { proveedor: string; total: number; iva: number; fecha: string | null; categoria: string; deducible: string; confianza: number; nota?: string };
const CATEGORIAS = "Gasolina, Transporte, Alimentos, Papelería, Telefonía, Luz, Agua, Renta, Insumos, Mantenimiento, Publicidad, Software, Salud, Equipo, Otros";

export async function leerTicket(entrada: { imagen?: Imagen; texto?: string }): Promise<Ticket | null> {
  const system = `Eres el contador de un pequeño negocio en México. Lees tickets de compra (foto o texto) y devuelves SOLO un JSON, sin explicación:
{"proveedor": string, "total": number, "iva": number, "fecha": "YYYY-MM-DD" | null, "categoria": una de [${CATEGORIAS}], "deducible": string corto ("Deducible al 100 %", "Deducible con factura", "Deducible 8.5 % (consumo)", "Revisar con contador"), "confianza": 0-1, "nota": string opcional}
Reglas: si el ticket muestra IVA úsalo; si no, calcula iva = total - total/1.16 salvo transporte (Uber/taxi) o servicios exentos donde iva = 0. Montos en pesos, números sin símbolo. Si no puedes leer el total pon total: 0 y confianza baja. Nunca inventes proveedor: si no se ve, usa "Proveedor sin nombre".`;
  const user = entrada.imagen ? `Lee este ticket.${entrada.texto ? " Nota del dueño: " + entrada.texto : ""}` : `Registra este gasto que me dictó el dueño: "${entrada.texto}"`;
  const txt = await preguntar(system, user, entrada.imagen, 400);
  const j = parsearJson<Ticket>(txt); if (!j || typeof j.total !== "number") return null;
  j.iva = Number(j.iva) || 0; j.confianza = Number(j.confianza) || 0.5; return j;
}

// ── Demo 02: calificar lead ──────────────────────────────────────────────
export type TurnoLead = { respuesta: string; campos: { nombre?: string; infonavit_activo?: boolean; anios_empresa?: number; puntos?: number; interes?: string; telefono_alt?: string }; completo: boolean };
export async function turnoLead(historial: { rol: "cliente" | "bot"; texto: string }[], campos: Record<string, unknown>, negocio: string): Promise<TurnoLead | null> {
  const system = `Eres el asistente de WhatsApp de "${negocio}", asesoría de créditos Infonavit / Mejoravit en Monterrey. Tu trabajo: en una charla natural y breve (máximo 2 frases por turno, tono cálido, tuteo, sin emojis excesivos) obtener estos datos del prospecto:
nombre, infonavit_activo (¿cotiza actualmente?), anios_empresa (antigüedad en su empresa actual, en años; meses/12), puntos (puntos Infonavit; si no sabe, explícale que los ve en Mi Cuenta Infonavit y anota null), interes (para qué quiere el crédito).
Ya conoces: ${JSON.stringify(campos)}. Pregunta SOLO lo que falta, una cosa a la vez. Cuando tengas todo (o el prospecto no sabe los puntos y ya preguntaste una vez), marca completo=true y en respuesta despídete diciendo que ${cfg.asesora} revisará su caso y le escribe hoy. No prometas aprobación. Responde SOLO con JSON:
{"respuesta": string, "campos": {solo los campos nuevos o corregidos}, "completo": boolean}`;
  const conv = historial.map(h => `${h.rol === "cliente" ? "Prospecto" : "Tú"}: ${h.texto}`).join("\n");
  const txt = await preguntar(system, `Conversación hasta ahora:\n${conv}\n\nResponde el siguiente turno.`, undefined, 400);
  return parsearJson<TurnoLead>(txt);
}

// ── Demo 03: reporte diario ──────────────────────────────────────────────
export async function redactarReporte(datos: unknown, dueno: string, negocio: string): Promise<string> {
  const system = `Eres el asistente de operaciones de "${negocio}". Redactas el reporte de las 8 AM para ${dueno} en WhatsApp: español de México, directo, máximo 120 palabras, sin markdown (WhatsApp solo admite *negritas*). Estructura: saludo de una línea con un juicio honesto del día (bueno/parejo/flojo con el % vs semana pasada), luego VENTAS (monto, pedidos, ticket promedio, % vs mismo día semana pasada), GASTOS, MARGEN, y URGE HOY como lista con "•". Si no hay pendientes, dilo. Cierra preguntando si quiere el detalle de algo. No inventes datos que no estén en el JSON.`;
  return preguntar(system, `Datos:\n${JSON.stringify(datos, null, 1)}`, undefined, 500);
}
export async function responderSobreReporte(pregunta: string, datos: unknown, negocio: string): Promise<string> {
  const system = `Eres el asistente de operaciones de "${negocio}". El dueño te pregunta sobre el reporte de hoy. Responde en máximo 80 palabras, español de México, sin markdown salvo *negritas*, usando SOLO los datos del JSON. Si te pide algo que no está, dilo y ofrece lo que sí tienes (ventas, pedidos sin enviar, mensajes, inventario, gastos/margen).`;
  return preguntar(system, `Datos de hoy:\n${JSON.stringify(datos)}\n\nPregunta: ${pregunta}`, undefined, 300);
}

// ── Demo 04: entender la cita ────────────────────────────────────────────
export type IntencionCita = { intencion: "agendar" | "elegir" | "cancelar" | "otro"; servicio?: string; dia_preferido?: string; hora_preferida?: string; eleccion?: number; nombre?: string; respuesta?: string };
export async function interpretarCita(texto: string, contexto: { servicios: string[]; opciones?: string[]; paso: string }): Promise<IntencionCita | null> {
  const system = `Eres el recepcionista de un consultorio. Interpreta el mensaje del cliente y responde SOLO JSON:
{"intencion": "agendar"|"elegir"|"cancelar"|"otro", "servicio": uno de ${JSON.stringify(contexto.servicios)} o null, "dia_preferido": "lunes".."viernes"|"hoy"|"mañana"|null, "hora_preferida": "HH:MM"|null, "eleccion": índice (1-based) si elige una de las opciones ofrecidas o null, "nombre": string|null, "respuesta": frase corta y amable si intencion es "otro"}
Paso actual: ${contexto.paso}. ${contexto.opciones ? "Opciones ofrecidas: " + contexto.opciones.map((o, i) => `${i + 1}) ${o}`).join("; ") : ""}`;
  const txt = await preguntar(system, texto, undefined, 250);
  return parsearJson<IntencionCita>(txt);
}
