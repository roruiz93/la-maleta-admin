// Genera src/web-defaults.js con los textos y fotos por defecto que muestra la
// web pública, para precargar la sección "Contenido del Sitio" del admin.
// Uso: npm run sync:web-texts  (espera la web en ../la-maleta-web)
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webDir = process.argv[2] || path.join(root, "..", "la-maleta-web");

// i18n-compat.js es un script de navegador que cuelga todo de window
const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: {} } };
vm.runInNewContext(fs.readFileSync(path.join(webDir, "src", "i18n-compat.js"), "utf8"), sandbox);
const { translations } = sandbox.window;

// Solo los campos que el admin permite editar
const adminSrc = fs.readFileSync(path.join(root, "src", "admin.js"), "utf8");
const bloque = adminSrc.slice(adminSrc.indexOf("const CONTENIDO_SECCIONES"), adminSrc.indexOf("const LANG_META_CMS"));
const campos = [...bloque.matchAll(/key:\s*"([^"]+)"[^}]*tipo:\s*"([^"]+)"/g)].map(m => ({ key: m[1], tipo: m[2] }));
const keys = campos.filter(c => c.tipo !== "foto").map(c => c.key);
const fotoKeys = campos.filter(c => c.tipo === "foto").map(c => c.key);

const out = {};
for (const lang of ["es", "ca", "en"]) {
  out[lang] = {};
  for (const k of keys) if (translations[lang]?.[k] !== undefined) out[lang][k] = translations[lang][k];
}

// Fotos por defecto: el src de cada <img data-img="..."> en las páginas de la web
const imagenes = {};
for (const pagina of fs.readdirSync(webDir).filter(n => n.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(webDir, pagina), "utf8");
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const id = tag.match(/data-img="([^"]+)"/)?.[1];
    const src = tag.match(/\ssrc="([^"]+)"/)?.[1];
    if (id && src && fotoKeys.includes(id)) imagenes[id] = src;
  }
}

fs.writeFileSync(path.join(root, "src", "web-defaults.js"),
  "// GENERADO por scripts/sync-web-texts.mjs — no editar a mano.\n" +
  "// Textos y fotos por defecto de la web pública (la-maleta-web).\n" +
  `export const WEB_DEFAULTS = ${JSON.stringify(out, null, 2)};\n\n` +
  `export const WEB_DEFAULT_IMAGES = ${JSON.stringify(imagenes, null, 2)};\n`);

console.log(`web-defaults.js: ${keys.length} textos (es ${Object.keys(out.es).length}, ca ${Object.keys(out.ca).length}, en ${Object.keys(out.en).length}), ${Object.keys(imagenes).length}/${fotoKeys.length} fotos`);
const faltan = keys.filter(k => out.es[k] === undefined);
if (faltan.length) console.log("Sin texto por defecto en la web:", faltan.join(", "));
const sinFoto = fotoKeys.filter(k => !imagenes[k]);
if (sinFoto.length) console.log("Sin foto por defecto en la web:", sinFoto.join(", "));
