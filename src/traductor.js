// ============================================================
//  Traductor del admin: Gemini (Firebase AI Logic) + MyMemory de respaldo
// ============================================================
// traducirLote() recibe varios textos y los traduce en una sola consulta a
// Gemini. Lo que Gemini no pueda (API no activada, cuota agotada, respuesta
// inválida) se traduce con MyMemory, texto por texto.
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import { app } from "./firebase.js";

// Alias que siempre apuntan a la versión vigente de Gemini (los modelos con número
// se retiran para proyectos nuevos). La capa gratuita tiene un cupo diario POR
// MODELO: si uno se agota o no está disponible, se pasa al siguiente.
// Flash Lite va primero: traduce bien y su cupo diario es mayor que el de Flash.
const MODELOS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
const MAX_CARACTERES_POR_CONSULTA = 12000;
const NOMBRES = { es: "español", ca: "catalán", en: "inglés británico" };

const INSTRUCCIONES = `Sos el traductor profesional de Viajes La Maleta, una agencia de viajes de Arenys de Munt (Barcelona) especializada en viajes en grupo.
Traducís textos de su web: destinos, qué incluye cada viaje, descripciones y textos institucionales.
Reglas:
- Traducí cada texto al idioma indicado en "destino". No agregues ni quites información.
- Mantené EXACTAMENTE la misma cantidad de líneas (saltos de línea "\\n") que el original, línea por línea.
- No traduzcas: nombres de hoteles y establecimientos, códigos de vuelo, horarios, fechas, precios, números, emojis ni etiquetas HTML (conservalas tal cual).
- Usá los nombres de lugares habituales en cada idioma (en catalán: Niça, Brussel·les, Anvers, Sant Sebastià; en inglés: Seville, Ghent, Antwerp).
- Vocabulario de turismo: en inglés "tour leader", "full board", "coach"; "viaje" es "trip" (nunca "ride").
- Tono cercano y profesional. Devolvé solo el JSON pedido.`;

const ESQUEMA = {
  type: "object",
  properties: {
    traducciones: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, texto: { type: "string" } },
        required: ["id", "texto"],
      },
    },
  },
  required: ["traducciones"],
};

let _ai = null;
let _modeloIdx = 0;
let _geminiApagado = false;   // p. ej. AI Logic no activado: no reintentar en esta sesión

function modelo() {
  if (!_ai) _ai = getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(_ai, {
    model: MODELOS[_modeloIdx],
    systemInstruction: INSTRUCCIONES,
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseJsonSchema: ESQUEMA },
  });
}

const lineas = t => String(t).split("\n").length;

// Parte los ítems en grupos que no pasen el máximo de caracteres por consulta
function agrupar(items) {
  const grupos = [];
  let actual = [], tam = 0;
  for (const it of items) {
    if (actual.length && tam + it.texto.length > MAX_CARACTERES_POR_CONSULTA) { grupos.push(actual); actual = []; tam = 0; }
    actual.push(it); tam += it.texto.length;
  }
  if (actual.length) grupos.push(actual);
  return grupos;
}

async function consultarGemini(grupo) {
  const pedido = grupo.map(it => ({ id: it.id, origen: NOMBRES[it.origen], destino: NOMBRES[it.destino], texto: it.texto }));
  let reintentado = false;
  while (_modeloIdx < MODELOS.length) {
    try {
      const res = await modelo().generateContent(JSON.stringify({ textos: pedido }));
      const datos = JSON.parse(res.response.text());
      return new Map((datos.traducciones || []).map(t => [t.id, t.texto]));
    } catch (e) {
      const msg = String(e?.message || e);
      // API no activada / sin permiso: no insistir en esta sesión
      if (/PERMISSION_DENIED|SERVICE_DISABLED|has not been used|API_NOT_ENABLED|api-not-enabled/i.test(msg)) {
        _geminiApagado = true;
        break;
      }
      // Modelo retirado o con el cupo diario agotado: pasar al siguiente modelo
      if (/404|not found|is not supported|no longer available|429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        console.warn(`Gemini (${MODELOS[_modeloIdx]}) no disponible:`, msg);
        _modeloIdx++;
        reintentado = false;
        continue;
      }
      // Error pasajero de Google (INTERNAL / 500 / 503): un reintento
      if (!reintentado && /500|503|INTERNAL|UNAVAILABLE|overloaded/i.test(msg)) {
        reintentado = true;
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      console.warn("Gemini falló, se usa MyMemory:", msg);
      return null;
    }
  }
  if (_modeloIdx >= MODELOS.length) _geminiApagado = true;   // todos agotados por hoy
  console.warn("Gemini sin cupo o sin activar, se usa MyMemory");
  return null;
}

// ─── MyMemory (respaldo) ─────────────────────────────────
// Corta en ~500 bytes por pedido: se parte por párrafos y oraciones.
export async function traducirMyMemory(texto, destLang, srcLang = "es") {
  if (!texto) return "";
  const parrafos = texto.split("\n");
  const traducidos = await Promise.all(parrafos.map(async p => {
    if (!p.trim()) return p;
    const res = await Promise.all(partirTexto(p, 450).map(tz => traducirTrozo(tz, destLang, srcLang)));
    return res.join(" ");
  }));
  return traducidos.join("\n");
}

function partirTexto(texto, max) {
  if (texto.length <= max) return [texto];
  const oraciones = texto.match(/[^.!?]+[.!?]*\s*/g) || [texto];
  const trozos = [];
  let actual = "";
  for (const o of oraciones) {
    if ((actual + o).length > max && actual) { trozos.push(actual.trim()); actual = ""; }
    if (o.length > max) {
      for (const w of o.split(" ")) {
        if ((actual + w).length > max && actual) { trozos.push(actual.trim()); actual = ""; }
        actual += w + " ";
      }
    } else actual += o;
  }
  if (actual.trim()) trozos.push(actual.trim());
  return trozos;
}

async function traducirTrozo(texto, destLang, srcLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=${srcLang}|${destLang}`;
  const res = await fetch(url);
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.cuota = res.status === 429;
    throw e;
  }
  const json = await res.json();
  const out = json.responseData?.translatedText;
  // Cuando se agota la cuota MyMemory responde 200 pero con un aviso como "traducción"
  if (Number(json.responseStatus) !== 200 || !out || /MYMEMORY WARNING/i.test(out)) {
    const e = new Error(json.responseDetails || "Traducción no disponible");
    e.cuota = Number(json.responseStatus) === 429 || /QUOTA|LIMIT|MYMEMORY WARNING/i.test(`${json.responseDetails || ""} ${out || ""}`);
    throw e;
  }
  return out;
}

// ─── API principal ───────────────────────────────────────
// items: [{ id, texto, destino: 'en'|'ca'|'es', origen?: 'es' }]
// Devuelve Map id → { ok: true, texto, motor: 'gemini'|'mymemory' } | { ok: false, error, cuota }
export async function traducirLote(items) {
  const resultado = new Map();
  const pendientes = [];
  for (const it of items) {
    const origen = it.origen || "es";
    if (!String(it.texto || "").trim()) resultado.set(it.id, { ok: true, texto: "", motor: "vacío" });
    else pendientes.push({ ...it, origen });
  }

  let sinGemini = pendientes;
  if (!_geminiApagado && pendientes.length) {
    sinGemini = [];
    for (const grupo of agrupar(pendientes)) {
      const respuesta = _geminiApagado ? null : await consultarGemini(grupo);
      for (const it of grupo) {
        const t = respuesta?.get(it.id);
        // Se descarta una traducción vacía o que cambió la cantidad de líneas
        if (t && t.trim() && lineas(t) === lineas(it.texto)) resultado.set(it.id, { ok: true, texto: t, motor: "gemini" });
        else sinGemini.push(it);
      }
    }
  }

  await Promise.all(sinGemini.map(async it => {
    try {
      resultado.set(it.id, { ok: true, texto: await traducirMyMemory(it.texto, it.destino, it.origen), motor: "mymemory" });
    } catch (e) {
      resultado.set(it.id, { ok: false, error: e, cuota: !!e.cuota });
    }
  }));
  return resultado;
}

// Atajo para un solo texto (lanza error si no se pudo traducir)
export async function traducir(texto, destino, origen = "es") {
  const r = (await traducirLote([{ id: "t", texto, destino, origen }])).get("t");
  if (!r.ok) throw r.error;
  return r.texto;
}
