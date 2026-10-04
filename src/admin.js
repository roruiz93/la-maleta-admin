import {
  recordFailedAttempt, clearAttempts, getBlockStatus,
  getRemainingAttempts, startSessionTimer, logAdminAction,
  initConcurrencyCheck
} from "./admin-security.js";
import {
  loginUser, logoutUser, onAuthChange, resetPassword,
  getUserProfile, getAllUsers, createUser, deleteUserProfile,
  saveContent, listenContent,
  saveSettings, listenSettings, getSettings,
  getDestinos, saveDestino, deleteDestino, updateDestinoTextos,
  getExperiencias, saveExperiencia, deleteExperiencia,
  getPosts, getPost, savePost, deletePost,
  getConsultas, marcarLeida, uploadImage,
  uploadImageConId, replaceSiteImage, listenImages
} from "./firebase.js";
import { translations, langMeta, t, tf } from "./i18n.js";
import { WEB_DEFAULTS, WEB_DEFAULT_IMAGES } from "./web-defaults.js";
import { traducirLote, traducir } from "./traductor.js";

import { auth } from "./firebase-config";
const WEB_URL = import.meta.env.VITE_WEB_URL || "https://lamaleta.vercel.app";
const WEB_URL_LOCAL = import.meta.env.VITE_WEB_URL_LOCAL || WEB_URL;

// ─── Escape de datos externos ────────────────────────────
// Todo lo que viene de las consultas lo escribe cualquier visitante (o un
// script directo contra Firestore): nunca se inserta como HTML sin escapar.
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
// Argumento para un onclick="fn(...)": literal JS válido (JSON) y escapado para
// el atributo HTML (el navegador lo des-escapa antes de ejecutar el JS).
const jsArg = v => esc(JSON.stringify(String(v ?? "")));
const mailtoHref = email => "mailto:" + encodeURIComponent(String(email || "").trim());
const telHref    = tel => "tel:" + String(tel || "").replace(/[^\d+]/g, "");

// ─── Estado ───────────────────────────────────────────────
let CU = null, currentLang = localStorage.getItem("lm_lang") || "es", remoteContent = {};
let currentSection = "dashboard";

// ─── Auth ─────────────────────────────────────────────────
onAuthChange(async (fu) => {
  if (fu) {
    const p = await getUserProfile(fu.uid);
    if (!p) { console.log("No existe perfil en Firestore"); return logoutUser(); }
    if (!["editor","admin","superadmin"].includes(p.role)) { console.log("No tiene permisos"); return logoutUser(); }
    CU = { ...p, uid: fu.uid };
    showCMS();
  } else {
    CU = null;
    showLogin();
  }
});

window.doLogin = async function() {
  const email = document.getElementById("lu").value.trim();
  const pass  = document.getElementById("lp").value.trim();
  const btn   = document.getElementById("login-submit");
  const err   = document.getElementById("lerr");
  err.textContent = "";
  const block = getBlockStatus();
  if (block.blocked) { err.textContent = `Bloqueado ${block.remaining} min. por intentos fallidos.`; return; }
  if (!email || !pass) { err.textContent = "Ingresá email y contraseña"; return; }
  btn.textContent = "Ingresando..."; btn.disabled = true;
  try {
    await loginUser(email, pass);
    showCMS();
    clearAttempts();
  } catch (error) {
    console.log("ERROR FIREBASE:", error.code, error.message);
    err.textContent = "Email o contraseña incorrectos";
    btn.textContent = "Ingresar"; btn.disabled = false;
    recordFailedAttempt();
  }
};
window.doLogout = async () => { await logoutUser(); };

// Recuperar contraseña: el mensaje es el mismo exista o no la cuenta, para no
// revelar qué emails están registrados.
window.doResetPassword = async function() {
  const email = document.getElementById("lu").value.trim();
  const err = document.getElementById("lerr");
  const ok  = document.getElementById("lok");
  const btn = document.getElementById("login-forgot");
  err.textContent = ""; ok.textContent = "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = t('login-reset-need-email', currentLang); return; }
  btn.disabled = true;
  try {
    await resetPassword(email, currentLang);
    ok.textContent = t('login-reset-sent', currentLang);
  } catch (e) {
    if (e.code === "auth/too-many-requests") err.textContent = t('login-reset-too-many', currentLang);
    else if (e.code === "auth/invalid-email") err.textContent = t('login-reset-need-email', currentLang);
    else ok.textContent = t('login-reset-sent', currentLang);
  } finally {
    btn.disabled = false;
  }
};

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("cms-panel").style.display = "none";
 
  applyAdminTranslations(currentLang);
}
function showCMS() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("cms-panel").style.display = "flex";
  setupCMS();
  startSessionTimer(doLogout);
  initConcurrencyCheck(CU.uid, doLogout);
}

// ─── Setup ────────────────────────────────────────────────
function setupCMS() {
  const badge = document.getElementById("tb-badge");
  const roleLabel = CU.role==="superadmin"?"⚡ Super Admin":CU.role==="admin"?"🔑 Admin":"✏️ Editor";
  badge.textContent = `${CU.name} · ${roleLabel}`;
  badge.className = "tb-badge" + (CU.role==="superadmin"?" super":"");
  const isSA = CU.role === "superadmin";
  const canManageUsers = isSA || CU.role === "admin";
  document.getElementById("btn-users").style.display  = canManageUsers ? "inline-flex" : "none";
  document.getElementById("super-sep").style.display  = canManageUsers ? "block" : "none";

  buildLangSwitchers();
  applyAdminTranslations(currentLang);

  listenContent(d => { if (d) remoteContent = d; });
  showSection("dashboard");
}

// ─── Navegación ───────────────────────────────────────────
window.showSection = function(sec) {
  currentSection = sec;
  document.querySelectorAll(".sb-btn").forEach(b => b.classList.remove("active"));
  const btn = document.querySelector(`[data-sec="${sec}"]`);
  if (btn) btn.classList.add("active");
  const content = document.getElementById("section-content");
  const loaders = {
    dashboard:    renderDashboard,
    contenido:    renderContenido,
    destinos:     renderDestinos,
    experiencias: renderExperiencias,
    blog:         renderBlog,
    consultas:    renderConsultas,
    settings:     renderSettings,
    usuarios:     renderUsuarios,
  };
  content.innerHTML = `<div class="loading"><div class="spinner"></div>${t('loading', currentLang)}</div>`;
  if (loaders[sec]) loaders[sec]();
};

// ─── DASHBOARD ────────────────────────────────────────────
async function renderDashboard() {
  const [destinos, posts, consultas] = await Promise.all([
    getDestinos(), getPosts(false), getConsultas()
  ]);
  const noLeidas = consultas.filter(c => !c.leida).length;
  const translate = (key) => translations[currentLang]?.[key] || translations['es']?.[key] || key;

  document.getElementById("section-content").innerHTML = `
    <div class="sec-header"><h2>${translate('dash-title')}</h2><p>${translate('dash-summary')}</p></div>
    <div class="dash-grid">
      <div class="dash-card" onclick="showSection('destinos')">
        <div class="dash-icon">✈️</div><div class="dash-num">${destinos.length}</div><div class="dash-lbl">${translate('dash-destinos')}</div>
      </div>
      <div class="dash-card" onclick="showSection('blog')">
        <div class="dash-icon">📝</div><div class="dash-num">${posts.length}</div><div class="dash-lbl">${translate('dash-posts')}</div>
      </div>
      <div class="dash-card ${noLeidas>0?'dash-alert':''}" onclick="showSection('consultas')">
        <div class="dash-icon">💬</div><div class="dash-num">${noLeidas}</div><div class="dash-lbl">${translate('dash-consultas')} ${translate('dash-no-read')}</div>
      </div>
      <div class="dash-card" onclick="showSection('settings')">
        <div class="dash-icon">⚙️</div><div class="dash-num">—</div><div class="dash-lbl">${translate('dash-settings')}</div>
      </div>
    </div>
    <div class="sec-tip">${translate('tip-content')}</div>
    <div style="margin-top:32px;">
      <h3 style="font-family:'Playfair Display',serif;font-size:20px;margin-bottom:16px;">Últimas consultas</h3>
      ${consultas.slice(0,5).map(c=>`
        <div class="consulta-row ${c.leida?'':'consulta-nueva'}">
          <div class="cr-info">
            <strong>${esc(c.nombre)}</strong> · <span style="font-size:12px;color:#888">${esc(c.email)}</span>
            ${!c.leida?'<span class="badge-nueva">Nueva</span>':''}
          </div>
          <div class="cr-msg">${esc(String(c.mensaje||'').slice(0,80))}...</div>
          <div class="cr-fecha">${esc(formatFecha(c.fecha))}</div>
        </div>`).join("")}
      ${consultas.length>5?`<button class="btn-link" onclick="showSection('consultas')">Ver todas las consultas →</button>`:''}
    </div>`;
}

// ─── DESTINOS ─────────────────────────────────────────────
async function renderDestinos() {
  const items = await getDestinos();
  const pendientesTrad = items.filter(d => faltantes(valoresDestino(d)).length).length;
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>${t('destinos-title',currentLang)}</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${pendientesTrad ? `<button class="btn-secondary" onclick="abrirLoteTraduccion()">${tf('lote-btn',currentLang,{n:pendientesTrad})}</button>` : ''}
        <button class="btn-primary" onclick="abrirModalDestino()">${t('destinos-new',currentLang)}</button>
      </div>
    </div>
    <div class="items-list">
      ${items.length ? items.map(d=>`
        <div class="item-row">
          <img src="${esc(d.imagen||'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=100&q=60')}" class="item-thumb" alt="${esc(mlVal(d.nombre,currentLang))}">
          <div class="item-info">
            <strong>${esc(mlVal(d.nombre,currentLang))}</strong>
            <span>${esc(mlVal(d.categoria,currentLang))} · ${esc(mlVal(d.duracion,currentLang))} · ${Number(d.precio) > 0 ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(d.precio) : '—'}</span>
          </div>
          <div class="item-actions">
            <span class="badge-status ${d.activo!==false?'activo':'inactivo'}">${d.activo!==false?t('common-active',currentLang):t('common-hidden',currentLang)}</span>
            <button class="btn-edit" onclick="editarDestino(${jsArg(d.id)})">✏️ ${t('common-edit',currentLang)}</button>
            <button class="btn-del"  onclick="eliminarDestino(${jsArg(d.id)}, ${jsArg(mlVal(d.nombre,currentLang))})">🗑</button>
          </div>
        </div>`).join("") : `<div class="empty-state-admin">${t('destinos-empty',currentLang)}</div>`}
    </div>
    <div id="modal-destino" class="modal" style="display:none"></div>`;
}

window.abrirModalDestino = function(d={}) {
  const nombreEs = mlVal(d.nombre, 'es');
  const nombreEn = mlEdit(d.nombre, 'en');
  const nombreCa = mlEdit(d.nombre, 'ca');
  const cortaEs  = mlVal(d.descripcionCorta, 'es');
  const cortaEn  = mlEdit(d.descripcionCorta, 'en');
  const cortaCa  = mlEdit(d.descripcionCorta, 'ca');
  const descEs   = mlVal(d.descripcion, 'es');
  const descEn   = mlEdit(d.descripcion, 'en');
  const descCa   = mlEdit(d.descripcion, 'ca');
  const cat = { es: mlVal(d.categoria, 'es'), en: mlEdit(d.categoria, 'en'), ca: mlEdit(d.categoria, 'ca') };
  const dur = { es: mlVal(d.duracion, 'es'),  en: mlEdit(d.duracion, 'en'),  ca: mlEdit(d.duracion, 'ca') };
  const inc = Object.fromEntries(['es','en','ca'].map(l => [l, mlListEdit(d.incluye, l).join('\n')]));

  document.getElementById("modal-destino").style.display = "flex";
  document.getElementById("modal-destino").innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>${d.id?t('destinos-modal-edit',currentLang):t('destinos-modal-new',currentLang)}</h3>
        <button onclick="cerrarModal('modal-destino')">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row-admin">
          <div class="form-field"><label>${t('destinos-price',currentLang)}</label><input id="d-precio" type="number" value="${esc(d.precio||'')}" placeholder="1200"></div>
        </div>

        <div style="display:flex;gap:6px;margin:14px 0 10px;align-items:center;flex-wrap:wrap;">
          <button id="dest-tab-es" class="btn-tab active" onclick="destLang('es')">🇪🇸 Español</button>
          <button id="dest-tab-en" class="btn-tab"        onclick="destLang('en')">🇬🇧 English</button>
          <button id="dest-tab-ca" class="btn-tab"        onclick="destLang('ca')">🏴 Català</button>
          <button class="btn-upload" data-autotrad onclick="autoTraducirDest()" style="margin-left:auto">${t('common-auto-translate',currentLang)}</button>
          <button class="btn-upload" onclick="revisarTraducciones('dest')">${t('rev-open',currentLang)}</button>
        </div>

        <div id="dest-fields-es">
          <div class="form-field"><label>Nombre * (ES)</label><input id="d-nombre-es" value="${esc(nombreEs)}" placeholder="Ej: Noruega"></div>
          <div class="form-field"><label>Descripción corta (ES)</label><input id="d-descCorta-es" value="${esc(cortaEs)}" placeholder="Breve descripción para la tarjeta"></div>
          <div class="form-field"><label>Descripción completa (ES)</label><textarea id="d-desc-es" rows="4">${esc(descEs)}</textarea></div>
          <div class="form-field"><label>${t('common-category',currentLang)} (ES)</label><input id="d-cat-es" value="${esc(cat.es)}"></div>
          <div class="form-field"><label>${t('destinos-duration',currentLang)} (ES)</label><input id="d-dur-es" value="${esc(dur.es)}"></div>
          <div class="form-field"><label>${t('destinos-includes-label',currentLang)} (ES)</label><textarea id="d-incluye-es" rows="4">${esc(inc.es)}</textarea></div>
        </div>
        <div id="dest-fields-en" style="display:none">
          <div class="form-field"><label>Name (EN)</label><input id="d-nombre-en" value="${esc(nombreEn)}" placeholder="E.g.: Norway"></div>
          <div class="form-field"><label>Short description (EN)</label><input id="d-descCorta-en" value="${esc(cortaEn)}" placeholder="Brief description for the card"></div>
          <div class="form-field"><label>Full description (EN)</label><textarea id="d-desc-en" rows="4">${esc(descEn)}</textarea></div>
          <div class="form-field"><label>${t('common-category',currentLang)} (EN)</label><input id="d-cat-en" value="${esc(cat.en)}"></div>
          <div class="form-field"><label>${t('destinos-duration',currentLang)} (EN)</label><input id="d-dur-en" value="${esc(dur.en)}"></div>
          <div class="form-field"><label>${t('destinos-includes-label',currentLang)} (EN)</label><textarea id="d-incluye-en" rows="4">${esc(inc.en)}</textarea></div>
        </div>
        <div id="dest-fields-ca" style="display:none">
          <div class="form-field"><label>Nom (CA)</label><input id="d-nombre-ca" value="${esc(nombreCa)}" placeholder="Ex: Noruega"></div>
          <div class="form-field"><label>Descripció curta (CA)</label><input id="d-descCorta-ca" value="${esc(cortaCa)}" placeholder="Breu descripció per a la targeta"></div>
          <div class="form-field"><label>Descripció completa (CA)</label><textarea id="d-desc-ca" rows="4">${esc(descCa)}</textarea></div>
          <div class="form-field"><label>${t('common-category',currentLang)} (CA)</label><input id="d-cat-ca" value="${esc(cat.ca)}"></div>
          <div class="form-field"><label>${t('destinos-duration',currentLang)} (CA)</label><input id="d-dur-ca" value="${esc(dur.ca)}"></div>
          <div class="form-field"><label>${t('destinos-includes-label',currentLang)} (CA)</label><textarea id="d-incluye-ca" rows="4">${esc(inc.ca)}</textarea></div>
        </div>

        <div class="form-field">
          <label>${t('destinos-images-label',currentLang)}</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input type="file" id="d-img-file" multiple accept="image/*" style="display:none" onchange="subirImgDestino(event)">
            <button class="btn-upload" onclick="document.getElementById('d-img-file').click()">${t('destinos-upload-images',currentLang)}</button>
          </div>
          <div id="d-img-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            ${(d.imagenes&&d.imagenes.length>0) ? d.imagenes.map((img,index)=>`
              <div class="img-container" style="position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;cursor:pointer;">
                <img src="${esc(img)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;border:${d.imagen===img?'3px solid #b8924a':'none'}">
                <span style="position:absolute;top:2px;right:2px;background:red;color:white;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-weight:bold;cursor:pointer;font-size:11px;" onclick="removeImage(${index})">x</span>
                <span style="position:absolute;bottom:2px;left:2px;background:#b8924a;color:white;border-radius:4px;padding:2px 4px;font-size:9px;cursor:pointer;" onclick="setPrincipal(${index})">${t('destinos-principal-badge',currentLang)}</span>
              </div>`).join("")
            : (d.imagen ? `<div style="position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;"><img src="${esc(d.imagen)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></div>` : "")}
          </div>
        </div>
        <div class="form-row-admin">
          <div class="form-field"><label>${t('common-order',currentLang)}</label><input id="d-orden" type="number" value="${esc(d.orden||0)}"></div>
          <div class="form-field"><label>${t('common-status',currentLang)}</label>
            <select id="d-activo">
              <option value="true"  ${d.activo!==false?'selected':''}>${t('common-active',currentLang)}</option>
              <option value="false" ${d.activo===false?'selected':''}>${t('common-hidden',currentLang)}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="cerrarModal('modal-destino')">${t('common-cancel',currentLang)}</button>
          <button class="btn-primary" onclick="guardarDestino(${jsArg(d.id||'')})">${t('common-save',currentLang)}</button>
        </div>
        <div id="modal-msg" style="margin-top:10px;font-size:13px;"></div>
      </div>
    </div>`;
};

let imagenesArray = [];
let imagenPrincipal = null;

function renderImagenes() {
  const container = document.getElementById("d-img-preview");
  if (!container) return;
  container.innerHTML = "";
  const ordenadas = getImagenesOrdenadas();
  ordenadas.forEach((src) => {
    const div = document.createElement("div");
    div.style.cssText = `position:relative;width:100px;height:100px;margin:5px;border-radius:6px;overflow:hidden;cursor:pointer;border:${src===imagenPrincipal?"3px solid #b8924a":"2px solid transparent"};`;
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;";
    div.appendChild(img);
    const removeBtn = document.createElement("span");
    removeBtn.textContent = "×";
    removeBtn.style.cssText = "position:absolute;top:2px;right:2px;background:red;color:white;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-weight:bold;cursor:pointer;font-size:13px;";
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      imagenesArray = imagenesArray.filter(i => i !== src);
      if (imagenPrincipal === src) imagenPrincipal = imagenesArray[0] || null;
      renderImagenes();
    };
    div.appendChild(removeBtn);
    const badge = document.createElement("span");
    badge.textContent = (src === imagenPrincipal ? "✓ " : "") + t('destinos-principal-badge',currentLang);
    badge.style.cssText = `position:absolute;bottom:2px;left:2px;background:${src===imagenPrincipal?"#27ae60":"#b8924a"};color:white;border-radius:4px;padding:2px 5px;font-size:9px;cursor:pointer;`;
    badge.onclick = () => { imagenPrincipal = src; renderImagenes(); };
    div.appendChild(badge);
    container.appendChild(div);
  });
}

function getImagenesOrdenadas() {
  if (!imagenPrincipal) return [...imagenesArray];
  return [imagenPrincipal, ...imagenesArray.filter(i => i !== imagenPrincipal)];
}

window.subirImgDestino = async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  showToast(t('destinos-uploading-toast',currentLang), false);
  for (let file of files) {
    try {
      const url = await uploadImage(file);
      imagenesArray.push(url);
      if (!imagenPrincipal) imagenPrincipal = url;
      renderImagenes();
    } catch (err) { console.error(err); }
  }
  showToast(t('destinos-uploaded-toast',currentLang));
};

window.guardarDestino = async function(id) {
  const nombreEs = document.getElementById("d-nombre-es").value.trim();
  if (!nombreEs) { document.getElementById("modal-msg").textContent = t('destinos-name-required',currentLang); return; }
  const data = {
    nombre: {
      es: nombreEs,
      en: document.getElementById("d-nombre-en").value.trim(),
      ca: document.getElementById("d-nombre-ca").value.trim(),
    },
    descripcionCorta: {
      es: document.getElementById("d-descCorta-es").value.trim(),
      en: document.getElementById("d-descCorta-en").value.trim(),
      ca: document.getElementById("d-descCorta-ca").value.trim(),
    },
    descripcion: {
      es: document.getElementById("d-desc-es").value.trim(),
      en: document.getElementById("d-desc-en").value.trim(),
      ca: document.getElementById("d-desc-ca").value.trim(),
    },
    categoria: {
      es: document.getElementById("d-cat-es").value.trim(),
      en: document.getElementById("d-cat-en").value.trim(),
      ca: document.getElementById("d-cat-ca").value.trim(),
    },
    precio:           parseFloat(document.getElementById("d-precio").value) || 0,
    duracion: {
      es: document.getElementById("d-dur-es").value.trim(),
      en: document.getElementById("d-dur-en").value.trim(),
      ca: document.getElementById("d-dur-ca").value.trim(),
    },
    incluye: { es: lineas("d-incluye-es"), en: lineas("d-incluye-en"), ca: lineas("d-incluye-ca") },
    orden:            parseInt(document.getElementById("d-orden").value) || 0,
    activo:           document.getElementById("d-activo").value === "true",
    imagenes:         getImagenesOrdenadas(),
    imagen:           imagenPrincipal || imagenesArray[0] || "/img/default.jpg",
  };
  const newId = id || `destino_${Date.now()}`;
  try {
    await saveDestino(newId, data);
    cerrarModal("modal-destino");
    showToast(t('destinos-saved-toast',currentLang));
    renderDestinos();
  } catch (e) { document.getElementById("modal-msg").textContent = t('common-error',currentLang) + ": " + e.message; }
};

window.editarDestino = async function(id) {
  const d = (await getDestinos()).find(x => x.id === id);
  if (d) {
    abrirModalDestino(d);
    imagenesArray = [...(d.imagenes || [])];
    imagenPrincipal = d.imagen || null;
    renderImagenes();
  }
};

window.eliminarDestino = async function(id, nombre) {
  if (!confirm(tf('common-delete-confirm',currentLang,{name:nombre}))) return;
  await deleteDestino(id);
  showToast(t('destinos-deleted-toast',currentLang));
  renderDestinos();
};

// ─── EXPERIENCIAS ──────────────────────────────────────────
async function renderExperiencias() {
  const items = await getExperiencias();
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>${t('exp-title',currentLang)}</h2>
      <button class="btn-primary" onclick="abrirModalExp()">${t('exp-new',currentLang)}</button>
    </div>
    <div class="items-list">
      ${items.length ? items.map(e=>`
        <div class="item-row">
          <img src="${esc(e.imagen||'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=100&q=60')}" class="item-thumb" alt="${esc(mlVal(e.nombre,currentLang))}">
          <div class="item-info"><strong>${esc(mlVal(e.nombre,currentLang))}</strong><span>${esc(e.categoria||'')}</span></div>
          <div class="item-actions">
            <span class="badge-status ${e.activo!==false?'activo':'inactivo'}">${e.activo!==false?t('common-active',currentLang):t('common-hidden',currentLang)}</span>
            <button class="btn-edit" onclick="editarExp(${jsArg(e.id)})">✏️ ${t('common-edit',currentLang)}</button>
            <button class="btn-del"  onclick="eliminarExp(${jsArg(e.id)}, ${jsArg(mlVal(e.nombre,currentLang))})">🗑</button>
          </div>
        </div>`).join("") : `<div class="empty-state-admin">${t('exp-empty',currentLang)}</div>`}
    </div>
    <div id="modal-exp" class="modal" style="display:none"></div>`;
}

// Helper para leer campo multilingual o string plano (compatibilidad hacia atrás)
function mlVal(field, lang) {
  if (!field) return '';
  return typeof field === 'object' ? (field[lang] || field.es || '') : field;
}

// "incluye": lista en un solo idioma (formato viejo = español) o
// { es:[...], en:[...], ca:[...] }. Sin fallback, como mlEdit.
function mlListEdit(field, lang) {
  if (Array.isArray(field)) return lang === 'es' ? field : [];
  return field && Array.isArray(field[lang]) ? field[lang] : [];
}
const lineas = id => document.getElementById(id).value.split("\n").map(s => s.trim()).filter(Boolean);

// Igual que mlVal pero sin fallback a español — para precargar los campos
// de edición, así una traducción faltante se ve vacía en vez de mostrar
// el texto en español disfrazado de traducción.
function mlEdit(field, lang) {
  if (!field) return '';
  if (typeof field === 'object') return field[lang] || '';
  return lang === 'es' ? field : '';
}

window.expLang = function(lang) {
  ['es','en','ca'].forEach(l => {
    document.getElementById(`exp-tab-${l}`).classList.toggle('active', l === lang);
    document.getElementById(`exp-fields-${l}`).style.display = l === lang ? '' : 'none';
  });
};

window.destLang = function(lang) {
  ['es','en','ca'].forEach(l => {
    document.getElementById(`dest-tab-${l}`).classList.toggle('active', l === lang);
    document.getElementById(`dest-fields-${l}`).style.display = l === lang ? '' : 'none';
  });
};

window.postLang = function(lang) {
  ['es','en','ca'].forEach(l => {
    document.getElementById(`post-tab-${l}`).classList.toggle('active', l === lang);
    document.getElementById(`post-fields-${l}`).style.display = l === lang ? '' : 'none';
  });
};

// ─── Traducción automática + panel de revisión ───────────
// Cada formulario multi-idioma declara sus campos: `id` es el prefijo de los
// inputs (`${id}-es`, `${id}-en`, `${id}-ca`). `translate:false` = el campo
// se muestra en la revisión pero no se manda a traducir (ej: HTML del post).
const REVISION_CFG = {
  dest: {
    modal: 'modal-destino', msg: 'modal-msg', requiredKey: 'common-fill-name-first',
    fields: [
      { id: 'd-nombre',    label: 'rev-field-name' },
      { id: 'd-descCorta', label: 'rev-field-short' },
      { id: 'd-desc',      label: 'rev-field-desc', rows: 6 },
      { id: 'd-cat',       label: 'rev-field-category' },
      { id: 'd-dur',       label: 'rev-field-duration' },
      { id: 'd-incluye',   label: 'rev-field-includes', rows: 6 },
    ],
  },
  exp: {
    modal: 'modal-exp', msg: 'modal-exp-msg', requiredKey: 'common-fill-name-first',
    fields: [
      { id: 'e-nombre', label: 'rev-field-name' },
      { id: 'e-desc',   label: 'rev-field-desc', rows: 5 },
    ],
  },
  post: {
    modal: 'modal-post', msg: 'modal-post-msg', requiredKey: 'blog-fill-title-first',
    fields: [
      { id: 'p-titulo',    label: 'rev-field-title' },
      { id: 'p-resumen',   label: 'rev-field-summary', rows: 3 },
      { id: 'p-contenido', label: 'rev-field-content', rows: 8, translate: false },
    ],
  },
};

const REV_LANGS = ['es', 'en', 'ca'];

window.autoTraducirDest = () => autoTraducir('dest');
window.autoTraducirExp  = () => autoTraducir('exp');
window.autoTraducirPost = () => autoTraducir('post');
window.revisarTraducciones = (tipo) => abrirRevision(revisionFormulario(tipo));

async function autoTraducir(tipo) {
  const cfg = REVISION_CFG[tipo];
  const msg = document.getElementById(cfg.msg);
  const origen = cfg.fields.map(f => ({ f, text: document.getElementById(`${f.id}-es`).value.trim() }));

  if (!origen[0].text) { msg.textContent = t(cfg.requiredKey, currentLang); return; }

  const btn = document.querySelector(`#${cfg.modal} [data-autotrad]`);
  btn.textContent = t('common-translating', currentLang);
  btn.disabled = true;
  msg.textContent = "";

  const auto = new Set(), fallos = new Set();
  // Todos los campos y los dos idiomas en una sola consulta al traductor
  const items = origen
    .filter(({ f, text }) => f.translate !== false && text)
    .flatMap(({ f, text }) => ['en', 'ca'].map(lang => ({ id: `${f.id}-${lang}`, texto: text, destino: lang })));
  const res = await traducirLote(items);
  items.forEach(({ id }) => {
    const r = res.get(id);
    // Si falla, no se pisa lo que hubiera: el campo queda como estaba y se marca en la revisión
    if (r.ok) { document.getElementById(id).value = r.texto; auto.add(id); }
    else fallos.add(id);
  });

  btn.textContent = t('common-auto-translate', currentLang);
  btn.disabled = false;

  if (fallos.size && !auto.size) msg.textContent = t('common-translate-error', currentLang);
  else showToast(t(fallos.size ? 'rev-some-failed' : 'common-translated-toast', currentLang));

  abrirRevision(revisionFormulario(tipo), { auto, fallos });
}

// Revisión de un modal (destino/experiencia/post): lee y escribe sus inputs
function revisionFormulario(tipo) {
  const cfg = REVISION_CFG[tipo];
  const escribir = vals => cfg.fields.forEach(f => REV_LANGS.forEach(l => {
    document.getElementById(`${f.id}-${l}`).value = vals[f.id][l];
  }));
  return {
    origen: 'es',
    fields: cfg.fields.map(f => ({ ...f, label: t(f.label, currentLang) })),
    leer: (id, l) => document.getElementById(`${id}-${l}`).value,
    acciones: [
      { label: t('rev-apply', currentLang), cls: 'btn-secondary', run: vals => {
        escribir(vals); showToast(t('rev-applied-toast', currentLang));
      } },
      { label: t('rev-apply-save', currentLang), cls: 'btn-primary', run: vals => {
        escribir(vals); document.querySelector(`#${cfg.modal} .modal-footer .btn-primary`).click();
      } },
    ],
  };
}

// rev = { origen, fields:[{id,label,rows?,translate?}], leer(id,lang), acciones:[{label,cls,run(vals)}] }
let _revActual = null;

function abrirRevision(rev, { auto = new Set(), fallos = new Set() } = {}) {
  _revActual = rev;
  let overlay = document.getElementById('modal-revision');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-revision';
    overlay.className = 'modal modal-revision';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal-box modal-rev">
      <div class="modal-header">
        <h3>${t('rev-title', currentLang)}</h3>
        <button onclick="cerrarModal('modal-revision')">×</button>
      </div>
      <div class="modal-body">
        <p class="rev-desc">${t('rev-desc', currentLang)}</p>
        <div class="rev-grid rev-head">
          ${REV_LANGS.map(l => `<div class="rev-lang">${langMeta[l].flag} ${langMeta[l].label}${l === rev.origen ? ` <span class="rev-origen">${t('rev-source', currentLang)}</span>` : ''}</div>`).join('')}
        </div>
        ${rev.fields.map(f => `
          <div class="rev-field">
            <div class="rev-field-label">${f.label}${f.translate === false ? ` <span class="rev-manual">${t('rev-manual', currentLang)}</span>` : ''}</div>
            <div class="rev-grid">
              ${REV_LANGS.map(l => `
                <div class="rev-cell" data-lang="${l}" ${l === rev.origen ? 'data-origen' : ''}>
                  <span class="rev-cell-lang">${langMeta[l].flag} ${l.toUpperCase()}</span>
                  ${f.rows
                    ? `<textarea id="rv-${f.id}-${l}" rows="${f.rows}"></textarea>`
                    : `<input id="rv-${f.id}-${l}" type="text">`}
                  <div class="rev-note" id="rvn-${f.id}-${l}"></div>
                </div>`).join('')}
            </div>
          </div>`).join('')}
        <div class="modal-footer">
          <button class="btn-secondary" onclick="cerrarModal('modal-revision')">${t('common-cancel', currentLang)}</button>
          ${rev.acciones.map((a, i) => `<button class="${a.cls}" onclick="accionRevision(${i})">${a.label}</button>`).join('')}
        </div>
      </div>
    </div>`;

  // Valores por JS (no por template) para no tener que escapar comillas/HTML
  rev.fields.forEach(f => REV_LANGS.forEach(l => {
    const id = `${f.id}-${l}`;
    const input = document.getElementById(`rv-${id}`);
    input.value = rev.leer(f.id, l);
    input.dataset.auto = auto.has(id) ? '1' : '';
    input.dataset.fallo = fallos.has(id) ? '1' : '';
    input.addEventListener('input', () => {
      input.dataset.auto = '';
      input.dataset.fallo = '';
      marcarCeldas(f, rev.origen);
    });
  }));
  rev.fields.forEach(f => marcarCeldas(f, rev.origen));

  overlay.style.display = 'flex';
}

function marcarCeldas(f, origen) {
  const src = document.getElementById(`rv-${f.id}-${origen}`).value.trim();
  REV_LANGS.filter(l => l !== origen).forEach(l => {
    const input = document.getElementById(`rv-${f.id}-${l}`);
    const note  = document.getElementById(`rvn-${f.id}-${l}`);
    const val   = input.value.trim();
    let estado = '', texto = '';
    if (input.dataset.fallo) { estado = 'warn'; texto = t('rev-failed', currentLang); }
    else if (!val && src) { estado = 'empty'; texto = t('rev-empty', currentLang); }
    // Mismo texto que el original en algo de más de una palabra: probablemente no se tradujo
    else if (val && val === src && /\s/.test(val)) { estado = 'warn'; texto = t('rev-same', currentLang); }
    else if (input.dataset.auto) { estado = 'auto'; texto = t('rev-auto', currentLang); }
    input.closest('.rev-cell').dataset.estado = estado;
    note.textContent = texto;
  });
}

window.accionRevision = async function(i) {
  const rev = _revActual;
  const vals = {};
  rev.fields.forEach(f => {
    vals[f.id] = {};
    REV_LANGS.forEach(l => { vals[f.id][l] = document.getElementById(`rv-${f.id}-${l}`).value; });
  });
  // Si la acción falla (ej: error al guardar) el panel queda abierto con lo revisado
  try {
    await rev.acciones[i].run(vals);
    cerrarModal('modal-revision');
  } catch (e) {
    showToast("❌ " + t('common-error', currentLang) + ": " + e.message);
  }
};

// ─── Traducir destinos pendientes (por lotes) ────────────
// Traduce del español a EN/CA solo los campos que faltan, destino por destino.
// Si se agota la cuota diaria del traductor, se detiene: lo que falta se
// retoma otro día con el mismo botón. Nada se guarda sin que el usuario lo pida,
// y al guardar solo se actualizan los campos de texto (merge).
const LOTE_CAMPOS = [
  { id: 'nombre',           label: 'rev-field-name' },
  { id: 'descripcionCorta', label: 'rev-field-short' },
  { id: 'descripcion',      label: 'rev-field-desc', rows: 6 },
  { id: 'categoria',        label: 'rev-field-category' },
  { id: 'duracion',         label: 'rev-field-duration' },
  { id: 'incluye',          label: 'rev-field-includes', rows: 6, lista: true },
];
let _lote = [];   // [{ d, valores: {campo:{es,en,ca}}, auto:Set, fallos:Set, estado }]

function valoresDestino(d) {
  const v = {};
  LOTE_CAMPOS.forEach(c => {
    v[c.id] = {};
    REV_LANGS.forEach(l => {
      v[c.id][l] = c.lista ? mlListEdit(d[c.id], l).join("\n") : (l === 'es' ? mlVal(d[c.id], 'es') : mlEdit(d[c.id], l));
    });
  });
  return v;
}

function faltantes(v) {
  const out = [];
  LOTE_CAMPOS.forEach(c => ['en', 'ca'].forEach(l => {
    if (v[c.id].es.trim() && !v[c.id][l].trim()) out.push([c.id, l]);
  }));
  return out;
}

window.abrirLoteTraduccion = async function() {
  let modal = document.getElementById("modal-lote");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-lote";
    modal.className = "modal";
    document.body.appendChild(modal);
  }
  const items = await getDestinos();
  _lote = items
    .map(d => ({ d, valores: valoresDestino(d), auto: new Set(), fallos: new Set(), estado: 'pendiente' }))
    .filter(x => faltantes(x.valores).length);

  modal.innerHTML = `
    <div class="modal-box modal-wide">
      <div class="modal-header">
        <h3>${t('lote-title', currentLang)}</h3>
        <button onclick="cerrarModal('modal-lote')">×</button>
      </div>
      <div class="modal-body">
        ${_lote.length ? `
          <p class="rev-desc">${tf('lote-desc', currentLang, { n: _lote.length })}</p>
          <div class="lote-acciones">
            <button class="btn-primary" id="lote-start" onclick="iniciarLote()">${t('lote-start', currentLang)}</button>
            <button class="btn-secondary" id="lote-save-all" onclick="guardarLoteTodos()" disabled>${t('lote-save-all', currentLang)}</button>
            <span id="lote-status" class="lote-status"></span>
          </div>
          <div class="lote-lista">${_lote.map((x, i) => `
            <div class="lote-row" id="lote-row-${i}">
              <span class="lote-nombre">${esc(mlVal(x.d.nombre, 'es'))}</span>
              <span class="lote-estado" id="lote-estado-${i}">${t('lote-st-pendiente', currentLang)}</span>
              <button class="btn-upload" id="lote-rev-${i}" onclick="revisarLote(${i})" disabled>${t('lote-review', currentLang)}</button>
            </div>`).join("")}
          </div>`
        : `<div class="empty-state-admin">${t('lote-none', currentLang)}</div>`}
      </div>
    </div>`;
  modal.style.display = "flex";
};

function estadoLote(i, key, clase = "") {
  const el = document.getElementById(`lote-estado-${i}`);
  if (el) { el.textContent = t(key, currentLang); el.dataset.estado = clase; }
}

window.iniciarLote = async function() {
  const start = document.getElementById("lote-start");
  const status = document.getElementById("lote-status");
  start.disabled = true;
  let cuota = false;

  for (let i = 0; i < _lote.length && !cuota; i++) {
    const x = _lote[i];
    if (x.estado !== 'pendiente') continue;
    status.textContent = tf('lote-progress', currentLang, { i: i + 1, n: _lote.length });
    estadoLote(i, 'lote-st-traduciendo');
    // Todos los campos faltantes del destino en una sola consulta; destinos de a uno
    const items = faltantes(x.valores).map(([campo, l]) => ({ id: `lote-${campo}-${l}`, campo, l, texto: x.valores[campo].es, destino: l }));
    const res = await traducirLote(items);
    items.forEach(({ id, campo, l }) => {
      const r = res.get(id);
      if (r.ok) { x.valores[campo][l] = r.texto; x.auto.add(id); }
      else { x.fallos.add(id); if (r.cuota) cuota = true; }
    });
    if (x.auto.size) {
      x.estado = 'traducido';
      estadoLote(i, x.fallos.size ? 'lote-st-parcial' : 'lote-st-traducido', x.fallos.size ? 'warn' : 'ok');
      document.getElementById(`lote-rev-${i}`).disabled = false;
    } else {
      estadoLote(i, cuota ? 'lote-st-pendiente' : 'lote-st-fallo', 'warn');
    }
  }

  const traducidos = _lote.filter(x => x.estado === 'traducido').length;
  status.textContent = cuota ? t('lote-quota', currentLang) : tf('lote-done', currentLang, { n: traducidos });
  status.dataset.estado = cuota ? 'warn' : 'ok';
  document.getElementById("lote-save-all").disabled = !traducidos;
  start.disabled = !cuota;
};

async function guardarLoteItem(x, vals) {
  const data = {};
  LOTE_CAMPOS.forEach(c => {
    data[c.id] = {};
    REV_LANGS.forEach(l => {
      const v = (vals[`lote-${c.id}`] || x.valores[c.id])[l] || "";
      data[c.id][l] = c.lista ? v.split("\n").map(s => s.trim()).filter(Boolean) : v.trim();
    });
  });
  await updateDestinoTextos(x.d.id, data);
  x.estado = 'guardado';
}

window.revisarLote = function(i) {
  const x = _lote[i];
  abrirRevision({
    origen: 'es',
    fields: LOTE_CAMPOS.map(c => ({ id: `lote-${c.id}`, label: t(c.label, currentLang), rows: c.rows })),
    leer: (id, l) => x.valores[id.slice(5)][l],
    acciones: [{
      label: t('lote-save-one', currentLang), cls: 'btn-primary',
      run: async vals => {
        await guardarLoteItem(x, vals);
        LOTE_CAMPOS.forEach(c => REV_LANGS.forEach(l => { x.valores[c.id][l] = vals[`lote-${c.id}`][l]; }));
        estadoLote(i, 'lote-st-guardado', 'ok');
        document.getElementById(`lote-rev-${i}`).disabled = true;
        showToast(t('lote-saved-toast', currentLang));
      },
    }],
  }, { auto: new Set([...x.auto]), fallos: new Set([...x.fallos]) });
};

window.guardarLoteTodos = async function() {
  const pendientes = _lote.map((x, i) => [x, i]).filter(([x]) => x.estado === 'traducido');
  if (!pendientes.length || !confirm(tf('lote-save-all-confirm', currentLang, { n: pendientes.length }))) return;
  const btn = document.getElementById("lote-save-all");
  btn.disabled = true;
  for (const [x, i] of pendientes) {
    try {
      await guardarLoteItem(x, {});
      estadoLote(i, 'lote-st-guardado', 'ok');
      document.getElementById(`lote-rev-${i}`).disabled = true;
    } catch (e) {
      estadoLote(i, 'lote-st-fallo', 'warn');
    }
  }
  showToast(t('lote-saved-toast', currentLang));
  renderDestinos();
};

window.abrirModalExp = function(e={}) {
  const nombreEs = mlVal(e.nombre, 'es');
  const nombreEn = mlEdit(e.nombre, 'en');
  const nombreCa = mlEdit(e.nombre, 'ca');
  const descEs   = mlVal(e.descripcion, 'es');
  const descEn   = mlEdit(e.descripcion, 'en');
  const descCa   = mlEdit(e.descripcion, 'ca');

  document.getElementById("modal-exp").style.display = "flex";
  document.getElementById("modal-exp").innerHTML = `
    <div class="modal-box">
      <div class="modal-header"><h3>${e.id?t('exp-modal-edit',currentLang):t('exp-modal-new',currentLang)}</h3><button onclick="cerrarModal('modal-exp')">×</button></div>
      <div class="modal-body">

        <div class="form-field"><label>${t('common-category',currentLang)}</label><input id="e-cat" value="${esc(e.categoria||'')}" placeholder="Ej: Aventura"></div>

        <div style="display:flex;gap:6px;margin:14px 0 10px;align-items:center;flex-wrap:wrap;">
          <button id="exp-tab-es" class="btn-tab active" onclick="expLang('es')">🇪🇸 Español</button>
          <button id="exp-tab-en" class="btn-tab"        onclick="expLang('en')">🇬🇧 English</button>
          <button id="exp-tab-ca" class="btn-tab"        onclick="expLang('ca')">🏴 Català</button>
          <button class="btn-upload" data-autotrad onclick="autoTraducirExp()" style="margin-left:auto">${t('common-auto-translate',currentLang)}</button>
          <button class="btn-upload" onclick="revisarTraducciones('exp')">${t('rev-open',currentLang)}</button>
        </div>

        <div id="exp-fields-es">
          <div class="form-field"><label>Nombre * (ES)</label><input id="e-nombre-es" value="${esc(nombreEs)}" placeholder="Ej: Trekking en Patagonia"></div>
          <div class="form-field"><label>Descripción (ES)</label><textarea id="e-desc-es" rows="3">${esc(descEs)}</textarea></div>
        </div>
        <div id="exp-fields-en" style="display:none">
          <div class="form-field"><label>Nombre (EN)</label><input id="e-nombre-en" value="${esc(nombreEn)}" placeholder="Ej: Patagonia Trekking"></div>
          <div class="form-field"><label>Description (EN)</label><textarea id="e-desc-en" rows="3">${esc(descEn)}</textarea></div>
        </div>
        <div id="exp-fields-ca" style="display:none">
          <div class="form-field"><label>Nom (CA)</label><input id="e-nombre-ca" value="${esc(nombreCa)}" placeholder="Ej: Trekking a la Patagònia"></div>
          <div class="form-field"><label>Descripció (CA)</label><textarea id="e-desc-ca" rows="3">${esc(descCa)}</textarea></div>
        </div>

        <div class="form-field" style="margin-top:12px">
          <label>${t('common-image',currentLang)}</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="e-img" value="${esc(e.imagen||'')}" placeholder="URL de imagen" style="flex:1">
            <input type="file" id="e-img-file" accept="image/*" style="display:none" onchange="subirImgExp(event)">
            <button class="btn-upload" onclick="document.getElementById('e-img-file').click()">${t('exp-upload',currentLang)}</button>
          </div>
        </div>
        <div class="form-row-admin">
          <div class="form-field"><label>${t('common-order',currentLang)}</label><input id="e-orden" type="number" value="${esc(e.orden||0)}"></div>
          <div class="form-field"><label>${t('common-status',currentLang)}</label>
            <select id="e-activo">
              <option value="true" ${e.activo!==false?'selected':''}>${t('common-active',currentLang)}</option>
              <option value="false" ${e.activo===false?'selected':''}>${t('common-hidden',currentLang)}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="cerrarModal('modal-exp')">${t('common-cancel',currentLang)}</button>
          <button class="btn-primary" onclick="guardarExp(${jsArg(e.id||'')})">${t('common-save',currentLang)}</button>
        </div>
        <div id="modal-exp-msg" style="margin-top:10px;font-size:13px;"></div>
      </div>
    </div>`;
};

window.editarExp = async function(id) {
  const items = await getExperiencias();
  const e = items.find(x=>x.id===id);
  if(e) abrirModalExp(e);
};

window.guardarExp = async function(id) {
  const nombreEs = document.getElementById("e-nombre-es").value.trim();
  if(!nombreEs){ document.getElementById("modal-exp-msg").textContent=t('exp-name-required',currentLang); return; }
  const data = {
    nombre: {
      es: nombreEs,
      en: document.getElementById("e-nombre-en").value.trim(),
      ca: document.getElementById("e-nombre-ca").value.trim(),
    },
    descripcion: {
      es: document.getElementById("e-desc-es").value.trim(),
      en: document.getElementById("e-desc-en").value.trim(),
      ca: document.getElementById("e-desc-ca").value.trim(),
    },
    categoria:   document.getElementById("e-cat").value.trim(),
    imagen:      document.getElementById("e-img").value.trim(),
    orden:       parseInt(document.getElementById("e-orden").value)||0,
    activo:      document.getElementById("e-activo").value === "true",
  };
  const newId = id || `exp_${Date.now()}`;
  try {
    await saveExperiencia(newId, data);
    cerrarModal("modal-exp");
    showToast(t('exp-saved-toast',currentLang));
    renderExperiencias();
  } catch(e) { document.getElementById("modal-exp-msg").textContent = t('common-error',currentLang) + ": " + e.message; }
};

window.subirImgExp = async function(e) {
  const file = e.target.files[0]; if(!file) return;
  const url = await uploadImage(file);
  document.getElementById("e-img").value = url;
  showToast(t('exp-image-uploaded-toast',currentLang));
};

window.eliminarExp = async function(id, nombre) {
  if(!confirm(tf('common-delete-confirm',currentLang,{name:nombre}))) return;
  await deleteExperiencia(id);
  showToast(t('exp-deleted-toast',currentLang)); renderExperiencias();
};

// ─── BLOG ─────────────────────────────────────────────────
async function renderBlog() {
  const posts = await getPosts(false);
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>${t('blog-title',currentLang)}</h2>
      <button class="btn-primary" onclick="abrirModalPost()">${t('blog-new',currentLang)}</button>
    </div>
    <div class="items-list">
      ${posts.length ? posts.map(p=>`
        <div class="item-row">
          <img src="${esc(p.imagen||'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=100&q=60')}" class="item-thumb" alt="${esc(mlVal(p.titulo,currentLang))}">
          <div class="item-info">
            <strong>${esc(mlVal(p.titulo,currentLang))}</strong>
            <span>${esc(p.categoria||'')} · ${formatFecha(p.fecha)} · ${t('blog-by',currentLang)} ${esc(p.autor||'—')}</span>
          </div>
          <div class="item-actions">
            <span class="badge-status ${p.publicado?'activo':'inactivo'}">${p.publicado?t('blog-published',currentLang):t('blog-draft',currentLang)}</span>
            <button class="btn-edit" onclick="editarPost(${jsArg(p.id)})">✏️ ${t('common-edit',currentLang)}</button>
            <button class="btn-del"  onclick="eliminarPost(${jsArg(p.id)}, ${jsArg(mlVal(p.titulo,currentLang))})">🗑</button>
          </div>
        </div>`).join("") : `<div class="empty-state-admin">${t('blog-empty',currentLang)}</div>`}
    </div>
    <div id="modal-post" class="modal" style="display:none"></div>`;
}

window.abrirModalPost = function(p={}) {
  const tituloEs   = mlVal(p.titulo,   'es');
  const tituloEn   = mlEdit(p.titulo,   'en');
  const tituloCa   = mlEdit(p.titulo,   'ca');
  const resumenEs  = mlVal(p.resumen,  'es');
  const resumenEn  = mlEdit(p.resumen,  'en');
  const resumenCa  = mlEdit(p.resumen,  'ca');
  const contenidoEs = mlVal(p.contenido, 'es');
  const contenidoEn = mlEdit(p.contenido, 'en');
  const contenidoCa = mlEdit(p.contenido, 'ca');

  document.getElementById("modal-post").style.display = "flex";
  document.getElementById("modal-post").innerHTML = `
    <div class="modal-box modal-wide">
      <div class="modal-header"><h3>${p.id?t('blog-modal-edit',currentLang):t('blog-modal-new',currentLang)}</h3><button onclick="cerrarModal('modal-post')">×</button></div>
      <div class="modal-body">
        <div class="form-row-admin">
          <div class="form-field"><label>${t('common-category',currentLang)}</label><input id="p-cat" value="${esc(p.categoria||'')}" placeholder="Ej: Guías de viaje"></div>
          <div class="form-field"><label>${t('blog-author',currentLang)}</label><input id="p-autor" value="${esc(p.autor||CU.name)}" placeholder="Nombre del autor"></div>
        </div>
        <div class="form-field">
          <label>${t('blog-cover-image',currentLang)}</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="p-img" value="${esc(p.imagen||'')}" placeholder="URL de imagen" style="flex:1">
            <input type="file" id="p-img-file" accept="image/*" style="display:none" onchange="subirImgPost(event)">
            <button class="btn-upload" onclick="document.getElementById('p-img-file').click()">${t('exp-upload',currentLang)}</button>
          </div>
        </div>

        <div style="display:flex;gap:6px;margin:14px 0 10px;align-items:center;flex-wrap:wrap;">
          <button id="post-tab-es" class="btn-tab active" onclick="postLang('es')">🇪🇸 Español</button>
          <button id="post-tab-en" class="btn-tab"        onclick="postLang('en')">🇬🇧 English</button>
          <button id="post-tab-ca" class="btn-tab"        onclick="postLang('ca')">🏴 Català</button>
          <button class="btn-upload" data-autotrad onclick="autoTraducirPost()" style="margin-left:auto">${t('common-auto-translate',currentLang)}</button>
          <button class="btn-upload" onclick="revisarTraducciones('post')">${t('rev-open',currentLang)}</button>
        </div>

        <div id="post-fields-es">
          <div class="form-field"><label>Título * (ES)</label><input id="p-titulo-es" value="${esc(tituloEs)}" placeholder="Título del artículo"></div>
          <div class="form-field"><label>Resumen (ES)</label><textarea id="p-resumen-es" rows="2">${esc(resumenEs)}</textarea></div>
          <div class="form-field">
            <label>Contenido (ES)</label>
            <div class="editor-toolbar">
              <button type="button" onclick="formatText('bold','p-contenido-es')"><b>B</b></button>
              <button type="button" onclick="formatText('italic','p-contenido-es')"><i>I</i></button>
              <button type="button" onclick="insertTag('h2','p-contenido-es')">H2</button>
              <button type="button" onclick="insertTag('p','p-contenido-es')">¶</button>
            </div>
            <textarea id="p-contenido-es" rows="10">${esc(contenidoEs)}</textarea>
          </div>
        </div>
        <div id="post-fields-en" style="display:none">
          <div class="form-field"><label>Title (EN)</label><input id="p-titulo-en" value="${esc(tituloEn)}" placeholder="Article title"></div>
          <div class="form-field"><label>Summary (EN)</label><textarea id="p-resumen-en" rows="2">${esc(resumenEn)}</textarea></div>
          <div class="form-field">
            <label>Content (EN)</label>
            <div class="editor-toolbar">
              <button type="button" onclick="formatText('bold','p-contenido-en')"><b>B</b></button>
              <button type="button" onclick="formatText('italic','p-contenido-en')"><i>I</i></button>
              <button type="button" onclick="insertTag('h2','p-contenido-en')">H2</button>
              <button type="button" onclick="insertTag('p','p-contenido-en')">¶</button>
            </div>
            <textarea id="p-contenido-en" rows="10">${esc(contenidoEn)}</textarea>
          </div>
        </div>
        <div id="post-fields-ca" style="display:none">
          <div class="form-field"><label>Títol (CA)</label><input id="p-titulo-ca" value="${esc(tituloCa)}" placeholder="Títol de l'article"></div>
          <div class="form-field"><label>Resum (CA)</label><textarea id="p-resumen-ca" rows="2">${esc(resumenCa)}</textarea></div>
          <div class="form-field">
            <label>Contingut (CA)</label>
            <div class="editor-toolbar">
              <button type="button" onclick="formatText('bold','p-contenido-ca')"><b>B</b></button>
              <button type="button" onclick="formatText('italic','p-contenido-ca')"><i>I</i></button>
              <button type="button" onclick="insertTag('h2','p-contenido-ca')">H2</button>
              <button type="button" onclick="insertTag('p','p-contenido-ca')">¶</button>
            </div>
            <textarea id="p-contenido-ca" rows="10">${esc(contenidoCa)}</textarea>
          </div>
        </div>

        <div class="form-row-admin" style="margin-top:12px">
          <div class="form-field"><label>${t('blog-date',currentLang)}</label><input id="p-fecha" type="date" value="${esc(p.fecha?p.fecha.slice(0,10):new Date().toISOString().slice(0,10))}"></div>
          <div class="form-field"><label>${t('common-status',currentLang)}</label>
            <select id="p-pub">
              <option value="true"  ${p.publicado?'selected':''}>${t('blog-published',currentLang)}</option>
              <option value="false" ${!p.publicado?'selected':''}>${t('blog-draft',currentLang)}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="cerrarModal('modal-post')">${t('common-cancel',currentLang)}</button>
          <button class="btn-primary" onclick="guardarPost(${jsArg(p.id||'')})">${t('common-save',currentLang)}</button>
        </div>
        <div id="modal-post-msg" style="margin-top:10px;font-size:13px;"></div>
      </div>
    </div>`;
};

window.editarPost = async function(id) {
  const p = await getPost(id); if(p) abrirModalPost(p);
};

window.guardarPost = async function(id) {
  const tituloEs = document.getElementById("p-titulo-es").value.trim();
  if(!tituloEs){ document.getElementById("modal-post-msg").textContent=t('blog-title-required',currentLang); return; }
  const data = {
    titulo: {
      es: tituloEs,
      en: document.getElementById("p-titulo-en").value.trim(),
      ca: document.getElementById("p-titulo-ca").value.trim(),
    },
    resumen: {
      es: document.getElementById("p-resumen-es").value.trim(),
      en: document.getElementById("p-resumen-en").value.trim(),
      ca: document.getElementById("p-resumen-ca").value.trim(),
    },
    contenido: {
      es: document.getElementById("p-contenido-es").value.trim(),
      en: document.getElementById("p-contenido-en").value.trim(),
      ca: document.getElementById("p-contenido-ca").value.trim(),
    },
    categoria:  document.getElementById("p-cat").value.trim(),
    autor:      document.getElementById("p-autor").value.trim(),
    imagen:     document.getElementById("p-img").value.trim(),
    fecha:      document.getElementById("p-fecha").value,
    publicado:  document.getElementById("p-pub").value === "true",
  };
  const newId = id || `post_${Date.now()}`;
  try {
    await savePost(newId, data);
    cerrarModal("modal-post");
    showToast(t('blog-saved-toast',currentLang));
    renderBlog();
  } catch(e) { document.getElementById("modal-post-msg").textContent = t('common-error',currentLang) + ": " + e.message; }
};

window.subirImgPost = async function(e) {
  const file = e.target.files[0]; if(!file) return;
  const url = await uploadImage(file);
  document.getElementById("p-img").value = url;
  showToast(t('blog-image-uploaded-toast',currentLang));
};

window.eliminarPost = async function(id, titulo) {
  if(!confirm(tf('common-delete-confirm',currentLang,{name:titulo}))) return;
  await deletePost(id);
  showToast(t('blog-deleted-toast',currentLang)); renderBlog();
};

window.formatText = function(cmd, taId='p-contenido-es') { document.getElementById(taId).focus(); document.execCommand(cmd); };
window.insertTag = function(tag, taId='p-contenido-es') {
  const ta = document.getElementById(taId);
  const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
  const ins = sel ? `<${tag}>${sel}</${tag}>` : `<${tag}></${tag}>`;
  const start = ta.selectionStart;
  ta.value = ta.value.slice(0,start) + ins + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = start + ins.length;
};

// ─── CONSULTAS ────────────────────────────────────────────
async function renderConsultas() {
  const consultas = await getConsultas();
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>${t('consultas-title',currentLang)}</h2>
      <span style="font-size:13px;color:#888">${tf('consultas-unread-of-total',currentLang,{unread:consultas.filter(c=>!c.leida).length,total:consultas.length})}</span>
    </div>
    <div class="items-list">
      ${consultas.length ? consultas.map(c=>`
        <div class="consulta-card ${c.leida?'':'consulta-nueva-card'}" id="c-${esc(c.id)}">
          <div class="cc-header">
            <div>
              <strong>${esc(c.nombre)}</strong>
              ${!c.leida?`<span class="badge-nueva">${t('consultas-new-badge',currentLang)}</span>`:''}
              <span class="cc-tipo">${esc(c.tipo||c.origen||t('consultas-default-type',currentLang))}</span>
            </div>
            <span class="cc-fecha">${esc(formatFecha(c.fecha))}</span>
          </div>
          <div class="cc-contact">
            📧 <a href="${esc(mailtoHref(c.email))}">${esc(c.email)}</a>
            ${c.tel?`· 📱 <a href="${esc(telHref(c.tel))}">${esc(c.tel)}</a>`:''}
            ${c.destino?`· ✈️ ${esc(c.destino)}`:''}
          </div>
          ${c.asunto?`<div class="cc-asunto"><strong>${esc(c.asunto)}</strong></div>`:''}
          <div class="cc-msg">${esc(c.mensaje)}</div>
          <div class="cc-actions">
            <a href="${esc(mailtoHref(c.email) + '?subject=' + encodeURIComponent('Re: Tu consulta en Viajes La Maleta'))}" class="btn-reply">${t('consultas-reply',currentLang)}</a>
            ${!c.leida?`<button class="btn-secondary" data-id="${esc(c.id)}" onclick="marcarLeido(this.dataset.id)">${t('consultas-mark-read',currentLang)}</button>`:`<span style="font-size:12px;color:#aaa">${t('consultas-read',currentLang)}</span>`}
          </div>
        </div>`).join("") : `<div class="empty-state-admin">${t('consultas-empty',currentLang)}</div>`}
    </div>`;
}

window.marcarLeido = async function(id) {
  await marcarLeida(id);
  const el = document.getElementById("c-" + id);
  if(el) { el.classList.remove("consulta-nueva-card"); el.querySelector(".badge-nueva")?.remove(); }
  showToast(t('consultas-marked-toast',currentLang));
};

// ─── SETTINGS ─────────────────────────────────────────────
async function renderSettings() {
  const s = await getSettings();
  const translate = (key) => translations[currentLang]?.[key] || translations['es']?.[key] || key;

  document.getElementById("section-content").innerHTML = `
    <div class="sec-header"><h2>${translate('settings-title')}</h2></div>
    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-whatsapp')}</div>
        <div class="form-field"><label>${translate('settings-whatsapp-number')}</label>
          <input id="s-wa" value="${esc(s.whatsapp||'')}" placeholder="34606715917" inputmode="tel">
          <span class="field-hint">${translate('settings-whatsapp-hint')}</span>
        </div>
        <div class="form-field"><label>${translate('settings-whatsapp-msg')}</label>
          <input id="s-wa-msg" value="${esc(s.whatsappMsg||'Hola, quisiera información sobre sus viajes')}">
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-social')}</div>
        <div class="form-field"><label>${translate('settings-instagram')}</label>
          <input id="s-instagram" value="${esc(s.instagram||'')}" placeholder="https://www.instagram.com/viajeslamaleta">
        </div>
        <div class="form-field"><label>${translate('settings-facebook')}</label>
          <input id="s-facebook" value="${esc(s.facebook||'')}" placeholder="https://www.facebook.com/viajeslamaleta">
          <span class="field-hint">${translate('settings-social-hint')}</span>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-contact')}</div>
        <div class="form-field"><label>${translate('settings-phone')}</label><input id="s-tel" value="${esc(s.tel||'')}" placeholder="+34 606 715 917"></div>
        <div class="form-field"><label>${translate('settings-email')}</label><input id="s-email" value="${esc(s.email||'')}" placeholder="info@lamaleta.com"></div>
        <div class="form-field"><label>${translate('settings-address')}</label><input id="s-addr" value="${esc(s.addr||'')}" placeholder="Rambla Sant Martí, 62 · Arenys de Munt"></div>
        <div class="form-field">
          <label>${translate('settings-hours')}</label>
          <div class="horario-idiomas">
            ${['es','ca','en'].map(l => `
              <div class="horario-fila">
                <span class="horario-lang">${langMeta[l].flag} ${l.toUpperCase()}</span>
                <input id="s-hours-${l}" value="${esc(horarioIdioma(s.hours, l))}" placeholder="${l === 'es' ? 'Lunes a viernes · 9:30–14:00 h' : ''}">
              </div>`).join('')}
            <button type="button" class="btn-upload" id="btn-traducir-horario" onclick="traducirHorario()">${t('settings-hours-translate', currentLang)}</button>
          </div>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-colors')}</div>
        <div class="cp-row"><label>${translate('settings-color-gold')}</label><input type="color" id="cp-gold"  value="${esc(s.gold||'#b8924a')}" oninput="previewColor()"></div>
        <div class="cp-row"><label>${translate('settings-color-bg')}</label>  <input type="color" id="cp-bg"    value="${esc(s.bg||'#f5f0eb')}" oninput="previewColor()"></div>
        <div class="cp-row"><label>${translate('settings-color-text')}</label> <input type="color" id="cp-text"  value="${esc(s.text||'#3a3028')}" oninput="previewColor()"></div>
        <div class="cp-row"><label>${translate('settings-color-primary')}</label>    <input type="color" id="cp-pri"   value="${esc(s.primary||'#2c2416')}" oninput="previewColor()"></div>
        <div class="cp-row"><label>${translate('settings-color-card')}</label>     <input type="color" id="cp-card"  value="${esc(s.cardBg||'#faf7f3')}" oninput="previewColor()"></div>
        <button class="btn-secondary" onclick="resetColoresDefault()" style="margin-top:10px;font-size:13px;padding:7px 16px;">${translate('settings-reset-colors')}</button>
        <div class="cp-hint">${translate('settings-colors-hint')}</div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-lang')}</div>
        <div class="form-field"><label>${translate('settings-lang-desc')}</label>
          <select id="s-lang">
            <option value="es" ${(s.defaultLang||'es')==='es'?'selected':''}>🇪🇸 Español</option>
            <option value="ca" ${s.defaultLang==='ca'?'selected':''}>🏴 Català</option>
            <option value="en" ${s.defaultLang==='en'?'selected':''}>🇬🇧 English</option>
          </select>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-images')}</div>
        <div class="form-field">
          <label>${translate('settings-logo')}</label>
          <div class="image-upload-container">
            <button class="btn-upload" onclick="uploadLogo()">${translate('settings-upload-logo')}</button>
            <input type="file" id="logo-input" accept="image/*" style="display:none" onchange="handleLogoUpload(this)">
            <div class="current-image" id="current-logo">
              ${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="Logo actual" style="max-width:100px; margin-top:8px;">` : `<span style="color:#666; font-size:13px;">${translate('settings-no-logo')}</span>`}
            </div>
          </div>
        </div>
        <div class="form-field">
          <label>${translate('settings-hero')}</label>
          <div class="image-upload-container">
            <button class="btn-upload" onclick="uploadHeroImage()">${translate('settings-upload-hero')}</button>
            <input type="file" id="hero-input" accept="image/*" style="display:none" onchange="handleHeroUpload(this)">
            <div class="current-image" id="current-hero">
              ${s.heroImageUrl ? `<img src="${esc(s.heroImageUrl)}" alt="Hero actual" style="max-width:200px; margin-top:8px;">` : `<span style="color:#666; font-size:13px;">${translate('settings-default-hero')}</span>`}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div style="margin-top:24px;">
      <button class="btn-primary" onclick="guardarSettings()" style="padding:14px 32px;font-size:15px;">${translate('settings-save')}</button>
      <button class="btn-secondary" onclick="togglePreview()" style="padding:14px 32px;font-size:15px;margin-left:12px;" id="toggle-preview-btn">${translate('settings-preview')}</button>
    </div>
    <div id="settings-msg" style="margin-top:12px;font-size:14px;"></div>

    <!-- Vista previa del sitio web -->
    <div id="preview-container" style="display:block; margin-top:32px; border:1px solid #ddd; border-radius:8px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
      <div style="background:#f8f9fa; padding:12px; border-bottom:1px solid #ddd; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:bold; color:#666; font-size:14px;">${translate('preview-title')}</span>
        <div>
          <button onclick="refreshPreview()" class="btn-preview">${translate('preview-refresh')}</button>
          <button onclick="togglePreview()" class="btn-close">${translate('preview-close')}</button>
        </div>
      </div>
      <iframe id="preview-iframe" style="width:100%; height:600px; border:none; background:#f8f9fa;"></iframe>
    </div>`;

  // Cargar automáticamente la vista previa al abrir configuración
  setTimeout(() => {
    loadCurrentWebsite();
  }, 500);
}

// Los colores se previsualizan en el iframe de la web (?preview=1), no en el
// panel: el admin usa variables CSS con los mismos nombres y se "pintaba" él.
function coloresDelFormulario() {
  const map = { gold: "cp-gold", bg: "cp-bg", text: "cp-text", primary: "cp-pri", cardBg: "cp-card" };
  const out = {};
  Object.entries(map).forEach(([k, id]) => { const el = document.getElementById(id); if (el) out[k] = el.value; });
  return out;
}

function enviarColoresPreview() {
  const iframe = document.getElementById("preview-iframe");
  if (!iframe || !iframe.contentWindow) return;
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  iframe.contentWindow.postMessage(
    { type: "lm-preview-colors", colors: coloresDelFormulario() },
    new URL(isLocal ? WEB_URL_LOCAL : WEB_URL).origin
  );
}

// Cuando la web del iframe termina de cargar pide los datos: mandarle los colores actuales
window.addEventListener("message", e => {
  const iframe = document.getElementById("preview-iframe");
  if (iframe && e.source === iframe.contentWindow && e.data?.type === "lm-preview-ready") enviarColoresPreview();
});

window.previewColor = function() {
  // Si la vista previa está cerrada, abrirla para que se vea el cambio
  const container = document.getElementById("preview-container");
  if (container && container.style.display === "none") togglePreview();
  else enviarColoresPreview();
};

window.resetColoresDefault = function() {
  const defaults = { 'cp-gold': '#b8924a', 'cp-bg': '#f5f0eb', 'cp-text': '#3a3028', 'cp-pri': '#2c2416', 'cp-card': '#faf7f3' };
  Object.entries(defaults).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  previewColor();
};

// Horario: texto (formato viejo, en español) o { es, ca, en }
function horarioIdioma(h, lang) {
  if (!h) return "";
  if (typeof h === "object") return h[lang] || "";
  return lang === "es" ? h : "";
}

// Completa catalán e inglés desde el español (quedan editables antes de guardar)
window.traducirHorario = async function() {
  const es = document.getElementById("s-hours-es").value.trim();
  if (!es) return;
  const btn = document.getElementById("btn-traducir-horario");
  btn.disabled = true;
  btn.textContent = t('common-translating', currentLang);
  try {
    const [ca, en] = await Promise.all([traducir(es, 'ca'), traducir(es, 'en')]);
    document.getElementById("s-hours-ca").value = ca;
    document.getElementById("s-hours-en").value = en;
    showToast(t('settings-hours-translated', currentLang));
  } catch (e) {
    showToast(t(e.cuota ? 'translate-quota' : 'common-translate-error', currentLang));
  } finally {
    btn.disabled = false;
    btn.textContent = t('settings-hours-translate', currentLang);
  }
};

// WhatsApp (wa.me) necesita el número internacional solo con dígitos.
// Un número español sin prefijo (9 dígitos, empieza por 6-9) se completa con 34.
function normalizarWhatsapp(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9 && /^[6-9]/.test(d)) d = "34" + d;
  return d;
}

// Instagram/Facebook: acepta el enlace del perfil o solo el usuario (@usuario).
// Devuelve "" si está vacío y null si no es un enlace válido de esa red.
const REDES_DOMINIO = { instagram: "instagram.com", facebook: "facebook.com" };
function normalizarRed(red, raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  const dominio = REDES_DOMINIO[red];
  if (/^[@\w.-]+$/.test(v) && !v.includes(dominio)) return `https://www.${dominio}/${v.replace(/^@/, "")}`;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase().replace(/^(www|m|web)\./, "");
    if (host !== dominio || u.pathname.length < 2) return null;
    // En Instagram lo que sigue al "?" es seguimiento (igsh); Facebook lo usa en profile.php?id=
    return `https://www.${dominio}${u.pathname}${red === "facebook" ? u.search : ""}`;
  } catch (e) { return null; }
}

window.guardarSettings = async function() {
  const currentSettings = await getSettings();
  const redes = {};
  for (const red of Object.keys(REDES_DOMINIO)) {
    redes[red] = normalizarRed(red, document.getElementById("s-" + red).value);
    if (redes[red] === null) {
      const msg = t('settings-social-invalid', currentLang).replace('{red}', red === 'instagram' ? 'Instagram' : 'Facebook');
      document.getElementById("settings-msg").textContent = "❌ " + msg;
      showToast(msg);
      return;
    }
  }
  const data = {
    instagram:   redes.instagram,
    facebook:    redes.facebook,
    whatsapp:    normalizarWhatsapp(document.getElementById("s-wa").value),
    whatsappMsg: document.getElementById("s-wa-msg").value.trim(),
    tel:         document.getElementById("s-tel").value.trim(),
    email:       document.getElementById("s-email").value.trim(),
    addr:        document.getElementById("s-addr").value.trim(),
    hours: {
      es: document.getElementById("s-hours-es").value.trim(),
      ca: document.getElementById("s-hours-ca").value.trim(),
      en: document.getElementById("s-hours-en").value.trim(),
    },
    defaultLang: document.getElementById("s-lang").value,
    gold:    document.getElementById("cp-gold").value,
    bg:      document.getElementById("cp-bg").value,
    text:    document.getElementById("cp-text").value,
    primary: document.getElementById("cp-pri").value,
    cardBg:  document.getElementById("cp-card").value,
    // Mantener las URLs de imágenes si existen
    logoUrl: currentSettings.logoUrl || null,
    heroImageUrl: currentSettings.heroImageUrl || null,
  };
  try {
    await saveSettings(data);
    document.getElementById("settings-msg").textContent = t('msg-config-saved', currentLang);
    showToast(t('msg-config-saved', currentLang));
    setTimeout(()=>document.getElementById("settings-msg").textContent="", 3000);
  } catch(e) { document.getElementById("settings-msg").textContent = "❌ Error: " + e.message; }
};

// ─── USUARIOS ─────────────────────────────────────────────
async function renderUsuarios() {
  const isSuperAdmin = CU.role === "superadmin";
  const users = await getAllUsers(isSuperAdmin ? undefined : "editor");
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header"><h2>${t('usuarios-title',currentLang)}</h2></div>
    <table class="ut">
      <thead><tr><th>${t('usuarios-th-email',currentLang)}</th><th>${t('usuarios-th-name',currentLang)}</th><th>${t('usuarios-th-role',currentLang)}</th><th>${t('usuarios-th-action',currentLang)}</th></tr></thead>
      <tbody>
        ${users.map(u=>`
          <tr>
            <td>${esc(u.email)}</td>
            <td><strong>${esc(u.name)}</strong></td>
            <td><span class="${u.role==='superadmin'?'badge-s':u.role==='admin'?'badge-a':'badge-e'}">${esc(u.role)}</span></td>
            <td>${isSuperAdmin && u.role!=='superadmin' ? `<button class="del-btn" onclick="delUser(${jsArg(u.id)})">${t('usuarios-delete-btn',currentLang)}</button>` : '—'}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    <div style="margin-top:32px;">
      <div class="settings-card-title">${t('usuarios-create-title',currentLang)}</div>
      <div class="um-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div class="form-field"><label>${t('usuarios-th-email',currentLang)}</label><input type="email" id="nu-e" placeholder="nuevo@email.com"></div>
        <div class="form-field"><label>${t('usuarios-th-name',currentLang)}</label><input type="text" id="nu-n" placeholder="Nombre Apellido"></div>
        <div class="form-field"><label>${t('usuarios-field-password',currentLang)}</label><input type="password" id="nu-p" placeholder="${t('usuarios-password-hint',currentLang)}"></div>
        <div class="form-field"><label>${t('usuarios-th-role',currentLang)}</label>
          ${isSuperAdmin
            ? `<select id="nu-r"><option value="editor">Editor</option><option value="admin">Admin</option></select>`
            : `<select id="nu-r" disabled><option value="editor" selected>Editor</option></select>`}
        </div>
      </div>
      <button class="btn-primary" onclick="addUser()" style="margin-top:12px;">${t('usuarios-create-btn',currentLang)}</button>
      <div id="um-err" style="color:#c0392b;font-size:13px;margin-top:8px;"></div>
    </div>`;
}

window.addUser = async function() {
  const email = document.getElementById("nu-e").value.trim();
  const name  = document.getElementById("nu-n").value.trim();
  const pass  = document.getElementById("nu-p").value.trim();
  const role  = document.getElementById("nu-r").value;
  const errEl = document.getElementById("um-err");
  errEl.textContent = "";
  if(!email||!name||!pass){ errEl.textContent=t('usuarios-fill-all',currentLang); return; }
  if(pass.length<8){ errEl.textContent=t('usuarios-password-min',currentLang); return; }
  try {
    await createUser(email, pass, name, role);
    showToast(tf('usuarios-created-toast',currentLang,{name}));
    renderUsuarios();
  } catch(e) {
    errEl.textContent = t('common-error',currentLang) + ": " + (e.code==="auth/email-already-in-use"?t('usuarios-email-in-use',currentLang):e.message);
  }
};

window.delUser = async function(uid) {
  if(!confirm(t('usuarios-delete-confirm',currentLang))) return;
  await deleteUserProfile(uid);
  showToast(t('usuarios-deleted-toast',currentLang)); renderUsuarios();
};

// ─── Idioma topbar ────────────────────────────────────────
function buildLangSwitchers() {
  const wrap = document.getElementById("lang-switcher-admin");
  if(wrap) wrap.innerHTML = Object.entries(langMeta).map(([code,meta])=>`
    <button class="lang-btn-admin ${code===currentLang?'active':''}" onclick="switchLang('${code}')">${meta.flag} ${meta.label}</button>
  `).join("");
}
window.switchLang = function(code) {
  // En Contenido, cambiar de idioma re-renderiza el editor: avisar si hay cambios sin guardar
  if (currentSection === "contenido" && typeof window._confirmarCambioIdiomaCMS === "function"
      && !window._confirmarCambioIdiomaCMS(code)) return;
  currentLang = code;
  localStorage.setItem("lm_lang", code);
  buildLangSwitchers();
  applyAdminTranslations(code);
  // Si el editor de contenido está abierto, sincronizar
  if (currentSection === "contenido" && typeof window._syncContenidoLang === "function") {
    window._syncContenidoLang(code);
  }
  showToast(tf('toast-editing-in', code, { lang: langMeta[code].label }));
};

// Aplicar traducciones al admin
function applyAdminTranslations(lang) {
  const t = (key) => translations[lang]?.[key] || translations['es']?.[key] || key;

  // Actualizar elementos con data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'email' || el.type === 'password')) {
      el.placeholder = t(key);
    } else {
      el.textContent = t(key);
    }
  });

  // Re-render la sección actual para aplicar traducciones
  const rerenders = {
    dashboard:    renderDashboard,
    destinos:     renderDestinos,
    experiencias: renderExperiencias,
    blog:         renderBlog,
    consultas:    renderConsultas,
    settings:     renderSettings,
    usuarios:     renderUsuarios,
  };
  // Sin sesión (pantalla de login) no hay sección que redibujar: evitaría leer datos protegidos
  if (CU && rerenders[currentSection]) rerenders[currentSection]();
}

// ─── Colores ──────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────
window.cerrarModal = function(id) { const el=document.getElementById(id); if(el) el.style.display="none"; };

function formatFecha(f) {
  if(!f) return '';
  try { return new Date(f).toLocaleDateString('es-AR',{day:'numeric',month:'short',year:'numeric'}); } catch(e){ return f; }
}

let toastTimer = null;
function showToast(msg, autoHide=true) {
  const t = document.getElementById("toast");
  if(!t) return;
  t.textContent = msg; t.classList.add("show");
  if(toastTimer) clearTimeout(toastTimer);
  if(autoHide) toastTimer = setTimeout(()=>t.classList.remove("show"), 3000);
}

// ══════════════════════════════════════════════════════════
// ─── CONTENIDO DEL SITIO — versión corregida ──────────────
// ══════════════════════════════════════════════════════════

// Secciones y campos definidos fuera de la función (no se recrean en cada render)
const CONTENIDO_SECCIONES = [
  {
    titulo: "🏠 Página de Inicio", tituloKey: "cms-sec-home", pagina: "index.html",
    campos: [
      { key: "hero-h1",       label: "Título principal del Hero",           tipo: "input"    },
      { key: "hero-sub",      label: "Subtítulo del Hero",                  tipo: "input"    },
      { key: "hero-btn1",     label: "Botón 1 Hero",                        tipo: "input"    },
      { key: "hero-btn2",     label: "Botón 2 Hero",                        tipo: "input"    },
      { key: "dest-title",    label: "Título sección Destinos",             tipo: "input"    },
      { key: "d1-name",       label: "Destino 1 — Nombre",                 tipo: "input"    },
      { key: "d1-desc",       label: "Destino 1 — Descripción",            tipo: "input"    },
      { key: "d2-name",       label: "Destino 2 — Nombre",                 tipo: "input"    },
      { key: "d2-desc",       label: "Destino 2 — Descripción",            tipo: "input"    },
      { key: "d3-name",       label: "Destino 3 — Nombre",                 tipo: "input"    },
      { key: "d3-desc",       label: "Destino 3 — Descripción",            tipo: "input"    },
      { key: "d4-name",       label: "Destino 4 — Nombre",                 tipo: "input"    },
      { key: "d4-desc",       label: "Destino 4 — Descripción",            tipo: "input"    },
      { key: "ver-todos",     label: "Botón \"Ver todos los viajes\"",      tipo: "input"    },
      { key: "pq-title",      label: "Título \"¿Por qué elegirnos?\"",     tipo: "input"    },
      { key: "pq1",           label: "Razón 1",                            tipo: "input"    },
      { key: "pq2",           label: "Razón 2",                            tipo: "input"    },
      { key: "pq3",           label: "Razón 3",                            tipo: "input"    },
      { key: "pq4",           label: "Razón 4",                            tipo: "input"    },
      { key: "test-title",    label: "Título sección Testimonios",          tipo: "input"    },
      { key: "t1-name",       label: "Testimonio 1 — Nombre",              tipo: "input"    },
      { key: "t1-text",       label: "Testimonio 1 — Texto",               tipo: "textarea" },
      { key: "t2-name",       label: "Testimonio 2 — Nombre",              tipo: "input"    },
      { key: "t2-text",       label: "Testimonio 2 — Texto",               tipo: "textarea" },
      { key: "t3-name",       label: "Testimonio 3 — Nombre",              tipo: "input"    },
      { key: "t3-text",       label: "Testimonio 3 — Texto",               tipo: "textarea" },
      { key: "cta-h",         label: "CTA — Título",                       tipo: "input"    },
      { key: "cta-p",         label: "CTA — Texto",                        tipo: "textarea" },
      { key: "cta-btn",       label: "CTA — Botón",                        tipo: "input"    },
      { key: "footer-slogan", label: "Footer — Slogan",                    tipo: "input"    },
    ]
  },
  {
    titulo: "👥 Página Nosotros", tituloKey: "cms-sec-about", pagina: "nosotros.html",
    campos: [
      { key: "nos-hero-h1",    label: "Hero — Título",                     tipo: "input"    },
      { key: "nos-hero-p",     label: "Hero — Subtítulo",                  tipo: "input"    },
      { key: "nos-titulo",     label: "Título sección intro",              tipo: "input"    },
      { key: "nos-p1",         label: "Párrafo 1",                         tipo: "textarea" },
      { key: "nos-p2",         label: "Párrafo 2",                         tipo: "textarea" },
      { key: "nos-p3",         label: "Párrafo 3",                         tipo: "textarea" },
      { key: "nos-btn",        label: "Botón Contacto",                    tipo: "input"    },
      { key: "stat1",          label: "Estadística 1 — Número",            tipo: "input"    },
      { key: "stat1-lbl",      label: "Estadística 1 — Etiqueta",          tipo: "input"    },
      { key: "stat2",          label: "Estadística 2 — Número",            tipo: "input"    },
      { key: "stat2-lbl",      label: "Estadística 2 — Etiqueta",          tipo: "input"    },
      { key: "stat3",          label: "Estadística 3 — Número",            tipo: "input"    },
      { key: "stat3-lbl",      label: "Estadística 3 — Etiqueta",          tipo: "input"    },
      { key: "stat4",          label: "Estadística 4 — Número",            tipo: "input"    },
      { key: "stat4-lbl",      label: "Estadística 4 — Etiqueta",          tipo: "input"    },
      { key: "valores-titulo", label: "Título sección Valores",            tipo: "input"    },
      { key: "val1-titulo",    label: "Valor 1 — Título",                  tipo: "input"    },
      { key: "val1-texto",     label: "Valor 1 — Texto",                   tipo: "textarea" },
      { key: "val2-titulo",    label: "Valor 2 — Título",                  tipo: "input"    },
      { key: "val2-texto",     label: "Valor 2 — Texto",                   tipo: "textarea" },
      { key: "val3-titulo",    label: "Valor 3 — Título",                  tipo: "input"    },
      { key: "val3-texto",     label: "Valor 3 — Texto",                   tipo: "textarea" },
      { key: "val4-titulo",    label: "Valor 4 — Título",                  tipo: "input"    },
      { key: "val4-texto",     label: "Valor 4 — Texto",                   tipo: "textarea" },
      { key: "equipo-titulo",  label: "Título sección Equipo",             tipo: "input"    },
      { key: "e1-img",       label: "Miembro 1 — Foto",                 tipo: "foto"     },
      { key: "e1-nombre",      label: "Miembro 1 — Nombre",                tipo: "input"    },
      { key: "e1-rol",         label: "Miembro 1 — Rol",                   tipo: "input"    },
      { key: "e2-img",       label: "Miembro 2 — Foto",                 tipo: "foto"     },
      { key: "e2-nombre",      label: "Miembro 2 — Nombre",                tipo: "input"    },
      { key: "e2-rol",         label: "Miembro 2 — Rol",                   tipo: "input"    },
      { key: "e3-img",       label: "Miembro 3 — Foto",                 tipo: "foto"     },
      { key: "e3-nombre",      label: "Miembro 3 — Nombre",                tipo: "input"    },
      { key: "e3-rol",         label: "Miembro 3 — Rol",                   tipo: "input"    },
      { key: "nos-cta-h",      label: "CTA — Título",                      tipo: "input"    },
      { key: "nos-cta-p",      label: "CTA — Texto",                       tipo: "textarea" },
      { key: "nos-cta-btn",    label: "CTA — Botón",                       tipo: "input"    },
    ]
  },
  {
    titulo: "📬 Página Contacto", tituloKey: "cms-sec-contact", pagina: "contacto.html",
    campos: [
      { key: "contacto-h1",     label: "Hero — Título",                    tipo: "input"    },
      { key: "contacto-sub",    label: "Hero — Subtítulo",                 tipo: "input"    },
      { key: "contacto-info-h", label: "Título columna info",              tipo: "input"    },
      { key: "contacto-info-p", label: "Texto columna info",               tipo: "textarea" },
      { key: "wa-btn-txt",      label: "Texto botón WhatsApp",             tipo: "input"    },
      { key: "form-titulo",     label: "Título formulario",                tipo: "input"    },
      { key: "form-subtitulo",  label: "Subtítulo formulario",             tipo: "input"    },
    ]
  },
  {
    titulo: "🧭 Navegación", tituloKey: "cms-sec-nav", pagina: "index.html",
    campos: [
      { key: "logo",    label: "Logo — texto",       tipo: "input" },
      { key: "nav1",    label: "Menú — Destinos",    tipo: "input" },
      { key: "nav2",    label: "Menú — Experiencias",tipo: "input" },
      { key: "nav3",    label: "Menú — Nosotros",    tipo: "input" },
      { key: "nav4",    label: "Menú — Blog",        tipo: "input" },
      { key: "nav5",    label: "Menú — Contacto",    tipo: "input" },
      { key: "nav-cta", label: "Menú — Botón CTA",   tipo: "input" },
    ]
  }
];

const LANG_META_CMS = {
  es: { flag: "🇪🇸", label: "Español",  code: "es" },
  ca: { flag: "🏴",  label: "Català",   code: "ca" },
  en: { flag: "🇬🇧", label: "English",  code: "en" },
};

// ── Estado centralizado del contenido (un solo listener) ──
let _remotoCMS = {};
let _cmsListenerActive = false;

// ── Fotos del sitio (site/images): una por clave, la nueva reemplaza a la vieja ──
let _imagenesSitio = {};
let _imgListenerActive = false;

function fotoSitioUrl(key) {
  return _imagenesSitio[key] || WEB_DEFAULT_IMAGES[key] || "";
}

function fotoCampoHTML(key) {
  return `
    <div class="foto-sitio">
      <img id="foto-${key}" src="${esc(fotoSitioUrl(key))}" alt="">
      <div class="foto-sitio-acciones">
        <input type="file" id="file-${key}" accept="image/*" style="display:none" onchange="window._subirFotoSitio('${key}', this)">
        <button type="button" class="btn-upload" id="btn-foto-${key}" onclick="document.getElementById('file-${key}').click()">${t('cms-photo-change', currentLang)}</button>
        <span class="foto-sitio-hint">${t('cms-photo-hint', currentLang)}</span>
      </div>
    </div>`;
}

window._subirFotoSitio = async function(key, input) {
  const file = input.files && input.files[0];
  input.value = "";  // permite volver a elegir el mismo archivo
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast(t('msg-invalid-image', currentLang)); return; }
  if (file.size > 5 * 1024 * 1024) { showToast(t('msg-image-too-big', currentLang) + " 5MB"); return; }

  const btn = document.getElementById(`btn-foto-${key}`);
  btn.disabled = true;
  btn.textContent = t('cms-photo-uploading', currentLang);
  try {
    const { url, publicId } = await uploadImageConId(file);
    // Cuadrada y centrada en la cara, igual para todo el equipo
    const urlFinal = url.replace("/upload/", "/upload/c_fill,g_face,w_400,h_400,q_auto,f_auto/");
    await replaceSiteImage(key, urlFinal, publicId);
    _imagenesSitio[key] = urlFinal;
    const img = document.getElementById(`foto-${key}`);
    if (img) img.src = urlFinal;
    showToast(t('cms-photo-updated', currentLang));
  } catch (e) {
    showToast("❌ " + t('common-error', currentLang) + ": " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('cms-photo-change', currentLang);
  }
};


async function renderContenido() {
  // FIX 1: usar currentLang global del topbar como punto de partida
  let editLang = currentLang;

  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>${t('cms-title', currentLang)}</h2>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:13px;color:#888">${t('cms-editing-in', currentLang)}</span>
        <div id="lang-tabs-contenido" style="display:flex;gap:6px;"></div>
      </div>
    </div>
    <div id="contenido-editor">
      <div class="loading"><div class="spinner"></div>${t('cms-loading', currentLang)}</div>
    </div>`;

  // FIX 2: listener único — no re-registrar si ya está activo
  if (!_cmsListenerActive) {
    _cmsListenerActive = true;
    listenContent(data => {
      _remotoCMS = data || {};
      if (document.getElementById("contenido-editor")) _renderEditorContenido();
    });
  } else {
    // Ya hay listener activo, renderizar con datos en memoria
    _renderEditorContenido();
  }

  // Fotos: solo se actualizan las miniaturas, sin re-renderizar (no pisa textos sin guardar)
  if (!_imgListenerActive) {
    _imgListenerActive = true;
    listenImages(data => {
      _imagenesSitio = data || {};
      Object.keys(WEB_DEFAULT_IMAGES).forEach(key => {
        const img = document.getElementById("foto-" + key);
        if (img) img.src = fotoSitioUrl(key);
      });
    });
  }

  // FIX 3: sincronización con switcher del topbar
  window._syncContenidoLang = function(code) {
    editLang = code;
    _renderEditorContenido();
  };

  function buildLangTabs() {
    const container = document.getElementById("lang-tabs-contenido");
    if (!container) return;
    container.innerHTML = Object.entries(LANG_META_CMS).map(([code, m]) =>
      `<button class="lang-tab ${code===editLang?'active':''}"
        onclick="window._switchEditLang('${code}')"
       >${m.flag} ${m.label}</button>`
    ).join("");
  }

  // FIX 4: exponer en window para que el onclick del botón lo encuentre
  window._contenidoTieneCambios = function() {
    if (!document.getElementById("contenido-editor")) return false;
    const actuales = _collectFields();
    return Object.keys(actuales).some(k => actuales[k] !== valLang(editLang, k));
  };

  function confirmarCambioIdioma(code) {
    if (code === editLang || !window._contenidoTieneCambios()) return true;
    return confirm(tf('cms-unsaved-confirm', currentLang, { lang: LANG_META_CMS[editLang].label }));
  }
  window._confirmarCambioIdiomaCMS = confirmarCambioIdioma;

  window._switchEditLang = function(code) {
    if (!confirmarCambioIdioma(code)) return;
    editLang = code;
    // Sincronizar también el switcher del topbar
    currentLang = code;
    localStorage.setItem("lm_lang", code);
    buildLangSwitchers();
    _renderEditorContenido();
  };

  // Lo guardado en Firestore; si está vacío, el texto que hoy muestra la web
  function val(key) {
    return (_remotoCMS[editLang] || {})[key] || WEB_DEFAULTS[editLang]?.[key] || "";
  }

  function _renderEditorContenido() {
    buildLangTabs();
    const editor = document.getElementById("contenido-editor");
    if (!editor) return;

    editor.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:24px;">

        <!-- Barra de auto-traducción -->
        <div style="
          background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
          border-radius:12px;padding:16px 20px;
          display:flex;align-items:center;gap:16px;flex-wrap:wrap;
          box-shadow:0 4px 20px rgba(0,0,0,.15);
        ">
          <div style="flex:1;min-width:200px;">
            <div style="color:#e2c97e;font-weight:700;font-size:14px;margin-bottom:3px;">${t('cms-tr-title',currentLang)}</div>
            <div style="color:#8892b0;font-size:12px;">
              ${tf('cms-tr-desc',currentLang,{lang:`<strong style="color:#ccd6f6">${LANG_META_CMS[editLang].flag} ${LANG_META_CMS[editLang].label}</strong>`})}
            </div>
          </div>
          <button id="btn-traducir-ia" onclick="window._traducirConIA()"
            style="background:linear-gradient(135deg,#e2c97e,#c9a227);color:#1a1a2e;border:none;
            border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;">
            ${t('cms-tr-btn',currentLang)}
          </button>
          <button onclick="window._revisarContenido()"
            style="background:transparent;color:#e2c97e;border:1px solid #e2c97e;
            border-radius:8px;padding:10px 16px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;">
            ${t('rev-open',currentLang)}
          </button>
          <div id="traduccion-status" style="font-size:12px;color:#8892b0;min-width:160px;"></div>
        </div>

        <!-- Campos por sección -->
        ${CONTENIDO_SECCIONES.map(sec => `
          <div class="contenido-sec">
            <div class="contenido-sec-title">${t(sec.tituloKey, currentLang)}</div>
            <div class="contenido-campos">
              ${sec.campos.map(c => `
                <div class="form-field">
                  <label>${c.label}</label>
                  ${c.tipo === "foto" ? fotoCampoHTML(c.key) : c.tipo === "textarea"
                    ? `<textarea id="cf-${c.key}" rows="2">${esc(val(c.key))}</textarea>`
                    : `<input id="cf-${c.key}" type="text" value="${esc(val(c.key)||'')}">`
                  }
                </div>`).join("")}
            </div>
          </div>`).join("")}

        <!-- Footer sticky -->
        <div style="position:sticky;bottom:0;background:var(--bg,#f5f0eb);padding:16px 0;
          border-top:1px solid var(--border,#e0d9d0);display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button class="btn-primary" onclick="window._guardarContenidoCMS()" style="padding:13px 28px;font-size:14px;">
            ${tf('cms-save', currentLang, { lang: `${LANG_META_CMS[editLang].flag} ${LANG_META_CMS[editLang].label}` })}
          </button>
          <button class="btn-secondary" onclick="window._previewContenido()" style="padding:13px 22px;font-size:14px;">
            ${t('cms-preview', currentLang)}
          </button>
          <span style="font-size:12px;color:#aaa">${t('cms-save-hint', currentLang)}</span>
        </div>
        <div id="contenido-msg" style="font-size:13px;"></div>
      </div>`;
  }

  // ── Recolectar campos del DOM ────────────────────────────
  function _collectFields() {
    const result = {};
    document.querySelectorAll("[id^='cf-']").forEach(el => {
      result[el.id.replace("cf-", "")] = el.value;
    });
    return result;
  }

  // ── Guardar ─────────────────────────────────────────────
  window._guardarContenidoCMS = async function() {
    const langData = _collectFields();
    const updated  = { ..._remotoCMS, [editLang]: { ...(_remotoCMS[editLang]||{}), ...langData } };
    try {
      await saveContent(updated);
      _remotoCMS = updated;
      const msg = document.getElementById("contenido-msg");
      if (msg) msg.textContent = tf('cms-saved', currentLang, { lang: LANG_META_CMS[editLang].label });
      showToast(tf('cms-saved', currentLang, { lang: `${LANG_META_CMS[editLang].flag} ${LANG_META_CMS[editLang].label}` }));
      setTimeout(() => { const m = document.getElementById("contenido-msg"); if(m) m.textContent=""; }, 3000);
    } catch(e) {
      const msg = document.getElementById("contenido-msg");
      if (msg) msg.textContent = "❌ " + t('common-error', currentLang) + ": " + e.message;
    }
  };

  // ── Vista previa sin guardar ────────────────────────────
  // Abre la página de la web en un iframe (?preview=1) y le manda por
  // postMessage los textos del editor. La web solo los muestra, no guarda nada.
  let _previewPagina = "index.html";

  function webBaseUrl() {
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    return (isLocal ? WEB_URL_LOCAL : WEB_URL).replace(/\/+$/, "");
  }

  function enviarPreview() {
    const iframe = document.getElementById("cms-preview-iframe");
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "lm-preview", lang: editLang, texts: _collectFields() },
      new URL(webBaseUrl()).origin
    );
  }

  // Un solo listener global; apunta siempre al editor abierto más reciente
  window._enviarPreviewCMS = enviarPreview;
  if (!window._previewListenerCMS) {
    window._previewListenerCMS = true;
    window.addEventListener("message", e => {
      const iframe = document.getElementById("cms-preview-iframe");
      if (iframe && e.source === iframe.contentWindow && e.data?.type === "lm-preview-ready") window._enviarPreviewCMS();
    });
  }

  window._previewPaginaCMS = function(pagina) {
    _previewPagina = pagina;
    document.querySelectorAll("#modal-cms-preview .btn-tab").forEach(b =>
      b.classList.toggle("active", b.dataset.pagina === pagina));
    document.getElementById("cms-preview-iframe").src = `${webBaseUrl()}/${pagina}?preview=1`;
  };

  window._previewContenido = function() {
    // Abrir la página de la sección que se está editando
    const activo = document.activeElement?.closest?.(".contenido-sec");
    const idx = activo ? [...document.querySelectorAll(".contenido-sec")].indexOf(activo) : -1;
    if (idx >= 0) _previewPagina = CONTENIDO_SECCIONES[idx].pagina;

    let modal = document.getElementById("modal-cms-preview");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "modal-cms-preview";
      modal.className = "modal";
      document.body.appendChild(modal);
    }
    const paginas = [["index.html", "cms-page-home"], ["nosotros.html", "cms-page-about"], ["contacto.html", "cms-page-contact"]];
    modal.innerHTML = `
      <div class="modal-box modal-preview-cms">
        <div class="modal-header">
          <h3>${tf('cms-preview-title', currentLang, { lang: `${LANG_META_CMS[editLang].flag} ${LANG_META_CMS[editLang].label}` })}</h3>
          <button onclick="cerrarModal('modal-cms-preview')">×</button>
        </div>
        <div class="modal-body">
          <div class="cms-preview-bar">
            ${paginas.map(([p, key]) => `<button class="btn-tab" data-pagina="${p}" onclick="window._previewPaginaCMS('${p}')">${t(key, currentLang)}</button>`).join("")}
            <span class="cms-preview-note">${t('cms-preview-note', currentLang)}</span>
          </div>
          <iframe id="cms-preview-iframe" title="Vista previa"></iframe>
        </div>
      </div>`;
    modal.style.display = "flex";
    window._previewPaginaCMS(_previewPagina);
  };

  // ── Traducir con revisión ───────────────────────────────
  // Texto de un idioma: lo guardado o, si está vacío, lo que hoy muestra la web
  function valLang(lang, key) {
    return (_remotoCMS[lang] || {})[key] || WEB_DEFAULTS[lang]?.[key] || "";
  }

  const CMS_CAMPOS = CONTENIDO_SECCIONES.flatMap(sec => sec.campos
    .filter(c => c.tipo !== "foto")
    .map(c => ({ ...c, seccion: t(sec.tituloKey, currentLang) })));

  // `actuales` = lo que hay en el editor del idioma activo (con cambios sin guardar)
  function revisionContenido(keys, actuales, traducidos = {}) {
    return {
      origen: editLang,
      fields: CMS_CAMPOS.filter(c => keys.includes(c.key)).map(c => ({
        id: `cms-${c.key}`,
        label: `${c.seccion} · ${c.label}`,
        rows: c.tipo === "textarea" ? 3 : 0,
      })),
      leer: (id, l) => {
        const key = id.slice(4);
        if (l === editLang) return actuales[key];
        return traducidos[key]?.[l] ?? valLang(l, key);
      },
      acciones: [{
        label: t('rev-save-all', currentLang), cls: 'btn-primary',
        run: async vals => {
          const updated = { ..._remotoCMS };
          REV_LANGS.forEach(l => { updated[l] = { ...(_remotoCMS[l] || {}) }; });
          // También los demás campos editados en el idioma activo, como hace "Guardar"
          Object.assign(updated[editLang], actuales);
          Object.entries(vals).forEach(([id, porLang]) =>
            REV_LANGS.forEach(l => { updated[l][id.slice(4)] = porLang[l]; }));
          await saveContent(updated);
          _remotoCMS = updated;
          _renderEditorContenido();
          showToast(t('cms-saved-all', currentLang));
        },
      }],
    };
  }

  window._revisarContenido = function() {
    abrirRevision(revisionContenido(CMS_CAMPOS.map(c => c.key), _collectFields()));
  };

  // Traduce solo los campos cambiados en el idioma activo; el resto ya tiene
  // su versión en cada idioma (así no se gasta la cuota diaria de MyMemory).
  window._traducirConIA = async function() {
    const btn    = document.getElementById("btn-traducir-ia");
    const status = document.getElementById("traduccion-status");
    if (!btn || !status) return;

    const actuales  = _collectFields();
    const cambiados = Object.keys(actuales).filter(k => actuales[k].trim() && actuales[k] !== valLang(editLang, k));
    if (!cambiados.length) {
      status.style.color = "#e2c97e";
      status.textContent = tf('cms-tr-none', currentLang, { lang: LANG_META_CMS[editLang].label });
      return;
    }

    btn.disabled = true;
    btn.textContent = t('common-translating', currentLang);
    status.textContent = "";

    const otros = REV_LANGS.filter(l => l !== editLang);
    const auto = new Set(), fallos = new Set(), traducidos = {};
    const items = [];
    cambiados.forEach(key => otros.forEach(l => {
      const texto = actuales[key];
      traducidos[key] = traducidos[key] || {};
      // Números y similares ("+500", "98%") se copian tal cual
      if (!/\p{L}/u.test(texto)) { traducidos[key][l] = texto; return; }
      // Los <br> de la web viajan como saltos de línea para que el traductor no los rompa
      items.push({ id: `cms-${key}-${l}`, key, l, texto: texto.replace(/<br\s*\/?>/gi, "\n"), destino: l, origen: editLang });
    }));
    const res = await traducirLote(items);
    items.forEach(({ id, key, l }) => {
      const r = res.get(id);
      if (r.ok) { traducidos[key][l] = r.texto.replace(/\n/g, "<br>"); auto.add(id); }
      else fallos.add(id);
    });

    btn.disabled = false;
    btn.textContent = t('cms-tr-btn', currentLang);
    if (fallos.size) {
      status.style.color = "#e74c3c";
      status.textContent = t('rev-some-failed', currentLang);
    }

    abrirRevision(revisionContenido(cambiados, actuales, traducidos), { auto, fallos });
  };

  // Primer render con datos actuales
  _renderEditorContenido();
}

// ─── FUNCIONES PARA IMÁGENES ─────────────────────────────────
window.uploadLogo = function() {
  document.getElementById("logo-input").click();
};

window.uploadHeroImage = function() {
  document.getElementById("hero-input").click();
};

window.handleLogoUpload = async function(input) {
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  if (!file.type.startsWith('image/')) {
    showToast(t('msg-invalid-image', currentLang));
    return;
  }

  // Verificar tamaño (max 2MB)
  if (file.size > 2 * 1024 * 1024) {
    showToast(t('msg-image-too-big', currentLang) + " 2MB");
    return;
  }

  try {
    showToast(t('msg-uploading-logo', currentLang));
    const url = await uploadImage(file, `logos/logo_${Date.now()}`);

    // Actualizar configuración
    const currentSettings = await getSettings();
    await saveSettings({...currentSettings, logoUrl: url});

    // Actualizar vista
    document.getElementById("current-logo").innerHTML =
      `<img src="${esc(url)}" alt="Logo actual" style="max-width:100px; margin-top:8px;">`;

    showToast(t('msg-logo-updated', currentLang));

    // Actualizar vista previa con delay para que Firebase sincronice
    setTimeout(() => {
      refreshPreview();
    }, 2000);

  } catch (error) {
    console.error("Error subiendo logo:", error);
    showToast("❌ Error: " + error.message);
  }
};

window.handleHeroUpload = async function(input) {
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  if (!file.type.startsWith('image/')) {
    showToast(t('msg-invalid-image', currentLang));
    return;
  }

  // Verificar tamaño (max 5MB para hero)
  if (file.size > 5 * 1024 * 1024) {
    showToast(t('msg-image-too-big', currentLang) + " 5MB");
    return;
  }

  try {
    showToast(t('msg-uploading-hero', currentLang));
    const url = await uploadImage(file, `hero/hero_${Date.now()}`);

    // Actualizar configuración
    const currentSettings = await getSettings();
    await saveSettings({...currentSettings, heroImageUrl: url});

    // Actualizar vista
    document.getElementById("current-hero").innerHTML =
      `<img src="${esc(url)}" alt="Hero actual" style="max-width:200px; margin-top:8px;">`;

    showToast(t('msg-hero-updated', currentLang));

    // Actualizar vista previa con delay para que Firebase sincronice
    setTimeout(() => {
      refreshPreview();
    }, 2000);

  } catch (error) {
    console.error("Error subiendo imagen hero:", error);
    showToast("❌ Error: " + error.message);
  }
};

// ─── FUNCIONES PARA VISTA PREVIA ─────────────────────────────
window.togglePreview = function() {
  const container = document.getElementById("preview-container");
  const btn = document.getElementById("toggle-preview-btn");

  if (container.style.display === "none") {
    container.style.display = "block";
    if (btn) btn.textContent = t('preview-hide', currentLang);
    // Cargar inmediatamente el sitio web actual
    loadCurrentWebsite();
  } else {
    container.style.display = "none";
    if (btn) btn.textContent = t('preview-show', currentLang);
  }
};

window.loadCurrentWebsite = function() {
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    // Usar URL local si estamos en desarrollo, o la URL de producción
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const previewUrl = isLocal ? WEB_URL_LOCAL : WEB_URL;

    // ?preview=1: la web acepta colores sin guardar enviados desde acá
    iframe.src = `${previewUrl.replace(/\/+$/, "")}/?preview=1`;

    // Mostrar mensaje de carga
    showToast(t('msg-preview-loading', currentLang));

    // Manejo de errores para desarrollo local
    if (isLocal) {
      iframe.onerror = () => {
        showToast("❌ Error: No se puede conectar al servidor local. ¿Está ejecutándose en " + WEB_URL_LOCAL + "?");
      };
    }
  }
};

window.refreshPreview = function() {
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    // Usar URL local si estamos en desarrollo, o la URL de producción
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const previewUrl = isLocal ? WEB_URL_LOCAL : WEB_URL;

    // Forzar recarga completa limpiando el src primero
    iframe.src = 'about:blank';

    setTimeout(() => {
      // Agregar timestamp para forzar recarga completa
      const timestamp = Date.now();
      iframe.src = `${previewUrl.replace(/\/+$/, "")}/?preview=1&_refresh=${timestamp}&_nocache=${Math.random()}`;
    }, 100);

    showToast(t('msg-preview-updating', currentLang));

    // Manejo de errores para desarrollo local
    if (isLocal) {
      iframe.onerror = () => {
        showToast("❌ Error: No se puede conectar al servidor local. ¿Está ejecutándose en " + WEB_URL_LOCAL + "?");
      };
    }
  }
};
