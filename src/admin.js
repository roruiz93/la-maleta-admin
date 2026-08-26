import {
  recordFailedAttempt, clearAttempts, getBlockStatus,
  getRemainingAttempts, startSessionTimer, logAdminAction,
  initConcurrencyCheck
} from "./admin-security.js";
import {
  loginUser, logoutUser, onAuthChange,
  getUserProfile, getAllUsers, createUser, deleteUserProfile,
  saveContent, listenContent,
  saveColors, listenColors,
  saveSettings, listenSettings, getSettings,
  getDestinos, saveDestino, deleteDestino,
  getExperiencias, saveExperiencia, deleteExperiencia,
  getPosts, getPost, savePost, deletePost,
  getConsultas, marcarLeida, uploadImage
} from "./firebase.js";
import { translations, langMeta, t } from "./i18n.js";

import { auth } from "./firebase-config";
const WEB_URL = import.meta.env.VITE_WEB_URL || "https://lamaleta.vercel.app";
const WEB_URL_LOCAL = import.meta.env.VITE_WEB_URL_LOCAL || WEB_URL;

// ─── Estado ───────────────────────────────────────────────
let CU = null, currentLang = localStorage.getItem("lm_lang") || "es", remoteContent = {};
let currentSection = "dashboard";

// ─── Auth ─────────────────────────────────────────────────
onAuthChange(async (fu) => {
  if (fu) {
    const p = await getUserProfile(fu.uid);
    if (!p) { console.log("No existe perfil en Firestore"); return logoutUser(); }
    if (p.role !== "admin" && p.role !== "superadmin") { console.log("No tiene permisos"); return logoutUser(); }
    CU = { ...p, uid: fu.uid };
    showCMS();
  } else {
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

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("cms-panel").style.display = "none";
  // Aplicar traducciones también en la pantalla de login
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
  document.getElementById("btn-users").style.display  = isSA ? "inline-flex" : "none";
  document.getElementById("super-sep").style.display  = isSA ? "block" : "none";
  // Enlace de vista previa removido - ahora usamos iframe integrado
  buildLangSwitchers();
  applyAdminTranslations(currentLang);
  // FIX: listener centralizado de contenido — actualiza remoteContent global
  listenContent(d => { if (d) remoteContent = d; });
  listenColors(syncColorPickers);
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
            <strong>${c.nombre}</strong> · <span style="font-size:12px;color:#888">${c.email}</span>
            ${!c.leida?'<span class="badge-nueva">Nueva</span>':''}
          </div>
          <div class="cr-msg">${(c.mensaje||'').slice(0,80)}...</div>
          <div class="cr-fecha">${formatFecha(c.fecha)}</div>
        </div>`).join("")}
      ${consultas.length>5?`<button class="btn-link" onclick="showSection('consultas')">Ver todas las consultas →</button>`:''}
    </div>`;
}

// ─── DESTINOS ─────────────────────────────────────────────
async function renderDestinos() {
  const items = await getDestinos();
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>Destinos</h2>
      <button class="btn-primary" onclick="abrirModalDestino()">+ Nuevo destino</button>
    </div>
    <div class="items-list">
      ${items.length ? items.map(d=>`
        <div class="item-row">
          <img src="${d.imagen||'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=100&q=60'}" class="item-thumb" alt="${mlVal(d.nombre,'es')}">
          <div class="item-info">
            <strong>${mlVal(d.nombre,'es')}</strong>
            <span>${d.categoria||''} · ${d.duracion||''} · desde $${(d.precio||0).toLocaleString()}</span>
          </div>
          <div class="item-actions">
            <span class="badge-status ${d.activo!==false?'activo':'inactivo'}">${d.activo!==false?'Activo':'Oculto'}</span>
            <button class="btn-edit" onclick="editarDestino('${d.id}')">✏️ Editar</button>
            <button class="btn-del"  onclick="eliminarDestino('${d.id}','${mlVal(d.nombre,'es')}')">🗑</button>
          </div>
        </div>`).join("") : '<div class="empty-state-admin">No hay destinos. ¡Creá el primero!</div>'}
    </div>
    <div id="modal-destino" class="modal" style="display:none"></div>`;
}

window.abrirModalDestino = function(d={}) {
  const nombreEs = mlVal(d.nombre, 'es');
  const nombreEn = mlVal(d.nombre, 'en');
  const nombreCa = mlVal(d.nombre, 'ca');
  const cortaEs  = mlVal(d.descripcionCorta, 'es');
  const cortaEn  = mlVal(d.descripcionCorta, 'en');
  const cortaCa  = mlVal(d.descripcionCorta, 'ca');
  const descEs   = mlVal(d.descripcion, 'es');
  const descEn   = mlVal(d.descripcion, 'en');
  const descCa   = mlVal(d.descripcion, 'ca');

  document.getElementById("modal-destino").style.display = "flex";
  document.getElementById("modal-destino").innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>${d.id?'Editar':'Nuevo'} Destino</h3>
        <button onclick="cerrarModal('modal-destino')">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row-admin">
          <div class="form-field"><label>Categoría</label><input id="d-cat" value="${d.categoria||''}" placeholder="Ej: Europa"></div>
          <div class="form-field"><label>Precio (USD)</label><input id="d-precio" type="number" value="${d.precio||''}" placeholder="1200"></div>
          <div class="form-field"><label>Duración</label><input id="d-dur" value="${d.duracion||''}" placeholder="Ej: 7 días"></div>
        </div>

        <div style="display:flex;gap:6px;margin:14px 0 10px;align-items:center;flex-wrap:wrap;">
          <button id="dest-tab-es" class="btn-tab active" onclick="destLang('es')">🇪🇸 Español</button>
          <button id="dest-tab-en" class="btn-tab"        onclick="destLang('en')">🇬🇧 English</button>
          <button id="dest-tab-ca" class="btn-tab"        onclick="destLang('ca')">🏴 Català</button>
          <button class="btn-upload" onclick="autoTraducirDest()" style="margin-left:auto">🌐 Auto-traducir</button>
        </div>

        <div id="dest-fields-es">
          <div class="form-field"><label>Nombre * (ES)</label><input id="d-nombre-es" value="${nombreEs}" placeholder="Ej: Noruega"></div>
          <div class="form-field"><label>Descripción corta (ES)</label><input id="d-descCorta-es" value="${cortaEs}" placeholder="Breve descripción para la tarjeta"></div>
          <div class="form-field"><label>Descripción completa (ES)</label><textarea id="d-desc-es" rows="4">${descEs}</textarea></div>
        </div>
        <div id="dest-fields-en" style="display:none">
          <div class="form-field"><label>Name (EN)</label><input id="d-nombre-en" value="${nombreEn}" placeholder="E.g.: Norway"></div>
          <div class="form-field"><label>Short description (EN)</label><input id="d-descCorta-en" value="${cortaEn}" placeholder="Brief description for the card"></div>
          <div class="form-field"><label>Full description (EN)</label><textarea id="d-desc-en" rows="4">${descEn}</textarea></div>
        </div>
        <div id="dest-fields-ca" style="display:none">
          <div class="form-field"><label>Nom (CA)</label><input id="d-nombre-ca" value="${nombreCa}" placeholder="Ex: Noruega"></div>
          <div class="form-field"><label>Descripció curta (CA)</label><input id="d-descCorta-ca" value="${cortaCa}" placeholder="Breu descripció per a la targeta"></div>
          <div class="form-field"><label>Descripció completa (CA)</label><textarea id="d-desc-ca" rows="4">${descCa}</textarea></div>
        </div>

        <div class="form-field">
          <label>Imágenes del destino</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input type="file" id="d-img-file" multiple accept="image/*" style="display:none" onchange="subirImgDestino(event)">
            <button class="btn-upload" onclick="document.getElementById('d-img-file').click()">📷 Subir imágenes</button>
          </div>
          <div id="d-img-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            ${(d.imagenes&&d.imagenes.length>0) ? d.imagenes.map((img,index)=>`
              <div class="img-container" style="position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;cursor:pointer;">
                <img src="${img}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;border:${d.imagen===img?'3px solid #b8924a':'none'}">
                <span style="position:absolute;top:2px;right:2px;background:red;color:white;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-weight:bold;cursor:pointer;font-size:11px;" onclick="removeImage(${index})">x</span>
                <span style="position:absolute;bottom:2px;left:2px;background:#b8924a;color:white;border-radius:4px;padding:2px 4px;font-size:9px;cursor:pointer;" onclick="setPrincipal(${index})">Principal</span>
              </div>`).join("")
            : (d.imagen ? `<div style="position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;"><img src="${d.imagen}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></div>` : "")}
          </div>
        </div>
        <div class="form-field">
          <label>¿Qué incluye? (una por línea)</label>
          <textarea id="d-incluye" rows="4" placeholder="Vuelos internacionales&#10;Hotel 4 estrellas&#10;Traslados">${(d.incluye||[]).join('\n')}</textarea>
        </div>
        <div class="form-row-admin">
          <div class="form-field"><label>Orden</label><input id="d-orden" type="number" value="${d.orden||0}"></div>
          <div class="form-field"><label>Estado</label>
            <select id="d-activo">
              <option value="true"  ${d.activo!==false?'selected':''}>Activo (visible)</option>
              <option value="false" ${d.activo===false?'selected':''}>Oculto</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="cerrarModal('modal-destino')">Cancelar</button>
          <button class="btn-primary" onclick="guardarDestino('${d.id||''}')">💾 Guardar</button>
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
    badge.textContent = src === imagenPrincipal ? "✓ Principal" : "Principal";
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
  showToast("⏳ Subiendo imágenes...", false);
  for (let file of files) {
    try {
      const url = await uploadImage(file);
      imagenesArray.push(url);
      if (!imagenPrincipal) imagenPrincipal = url;
      renderImagenes();
    } catch (err) { console.error(err); }
  }
  showToast("📷 Imágenes subidas");
};

window.guardarDestino = async function(id) {
  const nombreEs = document.getElementById("d-nombre-es").value.trim();
  if (!nombreEs) { document.getElementById("modal-msg").textContent = "El nombre en español es requerido"; return; }
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
    categoria:        document.getElementById("d-cat").value.trim(),
    precio:           parseFloat(document.getElementById("d-precio").value) || 0,
    duracion:         document.getElementById("d-dur").value.trim(),
    incluye:          document.getElementById("d-incluye").value.split("\n").map(s=>s.trim()).filter(Boolean),
    orden:            parseInt(document.getElementById("d-orden").value) || 0,
    activo:           document.getElementById("d-activo").value === "true",
    imagenes:         getImagenesOrdenadas(),
    imagen:           imagenPrincipal || imagenesArray[0] || "/img/default.jpg",
  };
  const newId = id || `destino_${Date.now()}`;
  try {
    await saveDestino(newId, data);
    cerrarModal("modal-destino");
    showToast("✅ Destino guardado");
    renderDestinos();
  } catch (e) { document.getElementById("modal-msg").textContent = "Error: " + e.message; }
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
  if (!confirm(`¿Eliminar "${nombre}"?`)) return;
  await deleteDestino(id);
  showToast("🗑 Destino eliminado");
  renderDestinos();
};

// ─── EXPERIENCIAS ──────────────────────────────────────────
async function renderExperiencias() {
  const items = await getExperiencias();
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>Experiencias</h2>
      <button class="btn-primary" onclick="abrirModalExp()">+ Nueva experiencia</button>
    </div>
    <div class="items-list">
      ${items.length ? items.map(e=>`
        <div class="item-row">
          <img src="${e.imagen||'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=100&q=60'}" class="item-thumb" alt="${e.nombre}">
          <div class="item-info"><strong>${e.nombre}</strong><span>${e.categoria||''}</span></div>
          <div class="item-actions">
            <span class="badge-status ${e.activo!==false?'activo':'inactivo'}">${e.activo!==false?'Activo':'Oculto'}</span>
            <button class="btn-edit" onclick="editarExp('${e.id}')">✏️ Editar</button>
            <button class="btn-del"  onclick="eliminarExp('${e.id}','${e.nombre}')">🗑</button>
          </div>
        </div>`).join("") : '<div class="empty-state-admin">No hay experiencias. ¡Creá la primera!</div>'}
    </div>
    <div id="modal-exp" class="modal" style="display:none"></div>`;
}

// Helper para leer campo multilingual o string plano (compatibilidad hacia atrás)
function mlVal(field, lang) {
  if (!field) return '';
  return typeof field === 'object' ? (field[lang] || field.es || '') : field;
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

window.autoTraducirPost = async function() {
  const tituloEs  = document.getElementById("p-titulo-es").value.trim();
  const resumenEs = document.getElementById("p-resumen-es").value.trim();

  if (!tituloEs) {
    document.getElementById("modal-post-msg").textContent = "Completá primero el título en español.";
    return;
  }

  const btn = document.querySelector('[onclick="autoTraducirPost()"]');
  btn.textContent = "⏳ Traduciendo...";
  btn.disabled = true;
  document.getElementById("modal-post-msg").textContent = "";

  try {
    const [tituloEn, tituloCa, resumenEn, resumenCa] = await Promise.all([
      traducir(tituloEs,  'en'),
      traducir(tituloEs,  'ca'),
      traducir(resumenEs, 'en'),
      traducir(resumenEs, 'ca'),
    ]);

    document.getElementById("p-titulo-en").value  = tituloEn;
    document.getElementById("p-titulo-ca").value  = tituloCa;
    document.getElementById("p-resumen-en").value = resumenEn;
    document.getElementById("p-resumen-ca").value = resumenCa;

    showToast("✅ Título y resumen traducidos. El contenido traducilo manualmente.");
  } catch(err) {
    document.getElementById("modal-post-msg").textContent = "Error al traducir. Verificá tu conexión.";
  } finally {
    btn.textContent = "🌐 Auto-traducir";
    btn.disabled = false;
  }
};

window.autoTraducirDest = async function() {
  const nombreEs = document.getElementById("d-nombre-es").value.trim();
  const cortaEs  = document.getElementById("d-descCorta-es").value.trim();
  const descEs   = document.getElementById("d-desc-es").value.trim();

  if (!nombreEs) {
    document.getElementById("modal-msg").textContent = "Completá primero el nombre en español.";
    return;
  }

  const btn = document.querySelector('[onclick="autoTraducirDest()"]');
  btn.textContent = "⏳ Traduciendo...";
  btn.disabled = true;
  document.getElementById("modal-msg").textContent = "";

  try {
    const [nombreEn, nombreCa, cortaEn, cortaCa, descEn, descCa] = await Promise.all([
      traducir(nombreEs, 'en'),
      traducir(nombreEs, 'ca'),
      traducir(cortaEs,  'en'),
      traducir(cortaEs,  'ca'),
      traducir(descEs,   'en'),
      traducir(descEs,   'ca'),
    ]);

    document.getElementById("d-nombre-en").value   = nombreEn;
    document.getElementById("d-nombre-ca").value   = nombreCa;
    document.getElementById("d-descCorta-en").value = cortaEn;
    document.getElementById("d-descCorta-ca").value = cortaCa;
    document.getElementById("d-desc-en").value     = descEn;
    document.getElementById("d-desc-ca").value     = descCa;

    showToast("✅ Traducción completada");
  } catch(err) {
    document.getElementById("modal-msg").textContent = "Error al traducir. Verificá tu conexión.";
  } finally {
    btn.textContent = "🌐 Auto-traducir";
    btn.disabled = false;
  }
};

async function traducir(texto, destLang) {
  if (!texto) return '';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=es|${destLang}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.responseData?.translatedText || texto;
}

window.autoTraducirExp = async function() {
  const nombreEs = document.getElementById("e-nombre-es").value.trim();
  const descEs   = document.getElementById("e-desc-es").value.trim();

  if (!nombreEs) {
    document.getElementById("modal-exp-msg").textContent = "Completá primero el nombre en español.";
    return;
  }

  const btn = document.querySelector('[onclick="autoTraducirExp()"]');
  btn.textContent = "⏳ Traduciendo...";
  btn.disabled = true;
  document.getElementById("modal-exp-msg").textContent = "";

  try {
    const [nombreEn, nombreCa, descEn, descCa] = await Promise.all([
      traducir(nombreEs, 'en'),
      traducir(nombreEs, 'ca'),
      traducir(descEs,   'en'),
      traducir(descEs,   'ca'),
    ]);

    document.getElementById("e-nombre-en").value = nombreEn;
    document.getElementById("e-nombre-ca").value = nombreCa;
    document.getElementById("e-desc-en").value   = descEn;
    document.getElementById("e-desc-ca").value   = descCa;

    showToast("✅ Traducción completada");
  } catch(err) {
    document.getElementById("modal-exp-msg").textContent = "Error al traducir. Verificá tu conexión.";
  } finally {
    btn.textContent = "🌐 Auto-traducir";
    btn.disabled = false;
  }
};

window.abrirModalExp = function(e={}) {
  const nombreEs = mlVal(e.nombre, 'es');
  const nombreEn = mlVal(e.nombre, 'en');
  const nombreCa = mlVal(e.nombre, 'ca');
  const descEs   = mlVal(e.descripcion, 'es');
  const descEn   = mlVal(e.descripcion, 'en');
  const descCa   = mlVal(e.descripcion, 'ca');

  document.getElementById("modal-exp").style.display = "flex";
  document.getElementById("modal-exp").innerHTML = `
    <div class="modal-box">
      <div class="modal-header"><h3>${e.id?'Editar':'Nueva'} Experiencia</h3><button onclick="cerrarModal('modal-exp')">×</button></div>
      <div class="modal-body">

        <div class="form-field"><label>Categoría</label><input id="e-cat" value="${e.categoria||''}" placeholder="Ej: Aventura"></div>

        <div style="display:flex;gap:6px;margin:14px 0 10px;align-items:center;flex-wrap:wrap;">
          <button id="exp-tab-es" class="btn-tab active" onclick="expLang('es')">🇪🇸 Español</button>
          <button id="exp-tab-en" class="btn-tab"        onclick="expLang('en')">🇬🇧 English</button>
          <button id="exp-tab-ca" class="btn-tab"        onclick="expLang('ca')">🏴 Català</button>
          <button class="btn-upload" onclick="autoTraducirExp()" style="margin-left:auto">🌐 Auto-traducir</button>
        </div>

        <div id="exp-fields-es">
          <div class="form-field"><label>Nombre * (ES)</label><input id="e-nombre-es" value="${nombreEs}" placeholder="Ej: Trekking en Patagonia"></div>
          <div class="form-field"><label>Descripción (ES)</label><textarea id="e-desc-es" rows="3">${descEs}</textarea></div>
        </div>
        <div id="exp-fields-en" style="display:none">
          <div class="form-field"><label>Nombre (EN)</label><input id="e-nombre-en" value="${nombreEn}" placeholder="Ej: Patagonia Trekking"></div>
          <div class="form-field"><label>Description (EN)</label><textarea id="e-desc-en" rows="3">${descEn}</textarea></div>
        </div>
        <div id="exp-fields-ca" style="display:none">
          <div class="form-field"><label>Nom (CA)</label><input id="e-nombre-ca" value="${nombreCa}" placeholder="Ej: Trekking a la Patagònia"></div>
          <div class="form-field"><label>Descripció (CA)</label><textarea id="e-desc-ca" rows="3">${descCa}</textarea></div>
        </div>

        <div class="form-field" style="margin-top:12px">
          <label>Imagen</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="e-img" value="${e.imagen||''}" placeholder="URL de imagen" style="flex:1">
            <input type="file" id="e-img-file" accept="image/*" style="display:none" onchange="subirImgExp(event)">
            <button class="btn-upload" onclick="document.getElementById('e-img-file').click()">📷 Subir</button>
          </div>
        </div>
        <div class="form-row-admin">
          <div class="form-field"><label>Orden</label><input id="e-orden" type="number" value="${e.orden||0}"></div>
          <div class="form-field"><label>Estado</label>
            <select id="e-activo">
              <option value="true" ${e.activo!==false?'selected':''}>Activo</option>
              <option value="false" ${e.activo===false?'selected':''}>Oculto</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="cerrarModal('modal-exp')">Cancelar</button>
          <button class="btn-primary" onclick="guardarExp('${e.id||''}')">💾 Guardar</button>
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
  if(!nombreEs){ document.getElementById("modal-exp-msg").textContent="Nombre en español requerido"; return; }
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
    showToast("✅ Experiencia guardada");
    renderExperiencias();
  } catch(e) { document.getElementById("modal-exp-msg").textContent = "Error: " + e.message; }
};

window.subirImgExp = async function(e) {
  const file = e.target.files[0]; if(!file) return;
  const url = await uploadImage(file);
  document.getElementById("e-img").value = url;
  showToast("📷 Imagen subida");
};

window.eliminarExp = async function(id, nombre) {
  if(!confirm(`¿Eliminar "${nombre}"?`)) return;
  await deleteExperiencia(id);
  showToast("🗑 Eliminada"); renderExperiencias();
};

// ─── BLOG ─────────────────────────────────────────────────
async function renderBlog() {
  const posts = await getPosts(false);
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>Blog</h2>
      <button class="btn-primary" onclick="abrirModalPost()">+ Nuevo post</button>
    </div>
    <div class="items-list">
      ${posts.length ? posts.map(p=>`
        <div class="item-row">
          <img src="${p.imagen||'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=100&q=60'}" class="item-thumb" alt="${mlVal(p.titulo,'es')}">
          <div class="item-info">
            <strong>${mlVal(p.titulo,'es')}</strong>
            <span>${p.categoria||''} · ${formatFecha(p.fecha)} · por ${p.autor||'—'}</span>
          </div>
          <div class="item-actions">
            <span class="badge-status ${p.publicado?'activo':'inactivo'}">${p.publicado?'Publicado':'Borrador'}</span>
            <button class="btn-edit" onclick="editarPost('${p.id}')">✏️ Editar</button>
            <button class="btn-del"  onclick="eliminarPost('${p.id}','${mlVal(p.titulo,'es')}')">🗑</button>
          </div>
        </div>`).join("") : '<div class="empty-state-admin">No hay posts. ¡Escribí el primero!</div>'}
    </div>
    <div id="modal-post" class="modal" style="display:none"></div>`;
}

window.abrirModalPost = function(p={}) {
  const tituloEs   = mlVal(p.titulo,   'es');
  const tituloEn   = mlVal(p.titulo,   'en');
  const tituloCa   = mlVal(p.titulo,   'ca');
  const resumenEs  = mlVal(p.resumen,  'es');
  const resumenEn  = mlVal(p.resumen,  'en');
  const resumenCa  = mlVal(p.resumen,  'ca');
  const contenidoEs = mlVal(p.contenido, 'es');
  const contenidoEn = mlVal(p.contenido, 'en');
  const contenidoCa = mlVal(p.contenido, 'ca');

  document.getElementById("modal-post").style.display = "flex";
  document.getElementById("modal-post").innerHTML = `
    <div class="modal-box modal-wide">
      <div class="modal-header"><h3>${p.id?'Editar':'Nuevo'} Post</h3><button onclick="cerrarModal('modal-post')">×</button></div>
      <div class="modal-body">
        <div class="form-row-admin">
          <div class="form-field"><label>Categoría</label><input id="p-cat" value="${p.categoria||''}" placeholder="Ej: Guías de viaje"></div>
          <div class="form-field"><label>Autor</label><input id="p-autor" value="${p.autor||CU.name}" placeholder="Nombre del autor"></div>
        </div>
        <div class="form-field">
          <label>Imagen de portada</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="p-img" value="${p.imagen||''}" placeholder="URL de imagen" style="flex:1">
            <input type="file" id="p-img-file" accept="image/*" style="display:none" onchange="subirImgPost(event)">
            <button class="btn-upload" onclick="document.getElementById('p-img-file').click()">📷 Subir</button>
          </div>
        </div>

        <div style="display:flex;gap:6px;margin:14px 0 10px;align-items:center;flex-wrap:wrap;">
          <button id="post-tab-es" class="btn-tab active" onclick="postLang('es')">🇪🇸 Español</button>
          <button id="post-tab-en" class="btn-tab"        onclick="postLang('en')">🇬🇧 English</button>
          <button id="post-tab-ca" class="btn-tab"        onclick="postLang('ca')">🏴 Català</button>
          <button class="btn-upload" onclick="autoTraducirPost()" style="margin-left:auto">🌐 Auto-traducir</button>
        </div>

        <div id="post-fields-es">
          <div class="form-field"><label>Título * (ES)</label><input id="p-titulo-es" value="${tituloEs}" placeholder="Título del artículo"></div>
          <div class="form-field"><label>Resumen (ES)</label><textarea id="p-resumen-es" rows="2">${resumenEs}</textarea></div>
          <div class="form-field">
            <label>Contenido (ES)</label>
            <div class="editor-toolbar">
              <button type="button" onclick="formatText('bold','p-contenido-es')"><b>B</b></button>
              <button type="button" onclick="formatText('italic','p-contenido-es')"><i>I</i></button>
              <button type="button" onclick="insertTag('h2','p-contenido-es')">H2</button>
              <button type="button" onclick="insertTag('p','p-contenido-es')">¶</button>
            </div>
            <textarea id="p-contenido-es" rows="10">${contenidoEs}</textarea>
          </div>
        </div>
        <div id="post-fields-en" style="display:none">
          <div class="form-field"><label>Title (EN)</label><input id="p-titulo-en" value="${tituloEn}" placeholder="Article title"></div>
          <div class="form-field"><label>Summary (EN)</label><textarea id="p-resumen-en" rows="2">${resumenEn}</textarea></div>
          <div class="form-field">
            <label>Content (EN)</label>
            <div class="editor-toolbar">
              <button type="button" onclick="formatText('bold','p-contenido-en')"><b>B</b></button>
              <button type="button" onclick="formatText('italic','p-contenido-en')"><i>I</i></button>
              <button type="button" onclick="insertTag('h2','p-contenido-en')">H2</button>
              <button type="button" onclick="insertTag('p','p-contenido-en')">¶</button>
            </div>
            <textarea id="p-contenido-en" rows="10">${contenidoEn}</textarea>
          </div>
        </div>
        <div id="post-fields-ca" style="display:none">
          <div class="form-field"><label>Títol (CA)</label><input id="p-titulo-ca" value="${tituloCa}" placeholder="Títol de l'article"></div>
          <div class="form-field"><label>Resum (CA)</label><textarea id="p-resumen-ca" rows="2">${resumenCa}</textarea></div>
          <div class="form-field">
            <label>Contingut (CA)</label>
            <div class="editor-toolbar">
              <button type="button" onclick="formatText('bold','p-contenido-ca')"><b>B</b></button>
              <button type="button" onclick="formatText('italic','p-contenido-ca')"><i>I</i></button>
              <button type="button" onclick="insertTag('h2','p-contenido-ca')">H2</button>
              <button type="button" onclick="insertTag('p','p-contenido-ca')">¶</button>
            </div>
            <textarea id="p-contenido-ca" rows="10">${contenidoCa}</textarea>
          </div>
        </div>

        <div class="form-row-admin" style="margin-top:12px">
          <div class="form-field"><label>Fecha</label><input id="p-fecha" type="date" value="${p.fecha?p.fecha.slice(0,10):new Date().toISOString().slice(0,10)}"></div>
          <div class="form-field"><label>Estado</label>
            <select id="p-pub">
              <option value="true"  ${p.publicado?'selected':''}>Publicado</option>
              <option value="false" ${!p.publicado?'selected':''}>Borrador</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="cerrarModal('modal-post')">Cancelar</button>
          <button class="btn-primary" onclick="guardarPost('${p.id||''}')">💾 Guardar</button>
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
  if(!tituloEs){ document.getElementById("modal-post-msg").textContent="Título en español requerido"; return; }
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
    showToast("✅ Post guardado");
    renderBlog();
  } catch(e) { document.getElementById("modal-post-msg").textContent = "Error: " + e.message; }
};

window.subirImgPost = async function(e) {
  const file = e.target.files[0]; if(!file) return;
  const url = await uploadImage(file);
  document.getElementById("p-img").value = url;
  showToast("📷 Imagen subida");
};

window.eliminarPost = async function(id, titulo) {
  if(!confirm(`¿Eliminar "${titulo}"?`)) return;
  await deletePost(id);
  showToast("🗑 Post eliminado"); renderBlog();
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
      <h2>Consultas</h2>
      <span style="font-size:13px;color:#888">${consultas.filter(c=>!c.leida).length} sin leer de ${consultas.length} total</span>
    </div>
    <div class="items-list">
      ${consultas.length ? consultas.map(c=>`
        <div class="consulta-card ${c.leida?'':'consulta-nueva-card'}" id="c-${c.id}">
          <div class="cc-header">
            <div>
              <strong>${c.nombre}</strong>
              ${!c.leida?'<span class="badge-nueva">Nueva</span>':''}
              <span class="cc-tipo">${c.tipo||c.origen||'consulta'}</span>
            </div>
            <span class="cc-fecha">${formatFecha(c.fecha)}</span>
          </div>
          <div class="cc-contact">
            📧 <a href="mailto:${c.email}">${c.email}</a>
            ${c.tel?`· 📱 <a href="tel:${c.tel}">${c.tel}</a>`:''}
            ${c.destino?`· ✈️ ${c.destino}`:''}
          </div>
          <div class="cc-msg">${c.mensaje||''}</div>
          <div class="cc-actions">
            <a href="mailto:${c.email}?subject=Re: Tu consulta en Viajes La Maleta" class="btn-reply">✉️ Responder por email</a>
            ${!c.leida?`<button class="btn-secondary" onclick="marcarLeido('${c.id}')">✓ Marcar como leída</button>`:'<span style="font-size:12px;color:#aaa">✓ Leída</span>'}
          </div>
        </div>`).join("") : '<div class="empty-state-admin">No hay consultas todavía.</div>'}
    </div>`;
}

window.marcarLeido = async function(id) {
  await marcarLeida(id);
  const el = document.getElementById(`c-${id}`);
  if(el) { el.classList.remove("consulta-nueva-card"); el.querySelector(".badge-nueva")?.remove(); }
  showToast("✓ Marcada como leída");
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
          <input id="s-wa" value="${s.whatsapp||''}" placeholder="5491112345678">
          <span class="field-hint">Formato: código país + área + número. Ej: 5491112345678</span>
        </div>
        <div class="form-field"><label>${translate('settings-whatsapp-msg')}</label>
          <input id="s-wa-msg" value="${s.whatsappMsg||'Hola, quisiera información sobre sus viajes'}">
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-contact')}</div>
        <div class="form-field"><label>${translate('settings-phone')}</label><input id="s-tel" value="${s.tel||''}" placeholder="+54 9 11 0000-0000"></div>
        <div class="form-field"><label>${translate('settings-email')}</label><input id="s-email" value="${s.email||''}" placeholder="info@lamaleta.com"></div>
        <div class="form-field"><label>${translate('settings-address')}</label><input id="s-addr" value="${s.addr||''}" placeholder="Buenos Aires, Argentina"></div>
        <div class="form-field"><label>${translate('settings-hours')}</label><input id="s-hours" value="${s.hours||''}" placeholder="Lun–Vie 9:00–18:00"></div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">${translate('settings-colors')}</div>
        <div class="cp-row"><label>${translate('settings-color-gold')}</label><input type="color" id="cp-gold"  value="${s.gold||'#b8924a'}" oninput="previewColor('--gold',this.value)"></div>
        <div class="cp-row"><label>${translate('settings-color-bg')}</label>  <input type="color" id="cp-bg"    value="${s.bg||'#f5f0eb'}" oninput="previewColor('--bg',this.value)"></div>
        <div class="cp-row"><label>${translate('settings-color-text')}</label> <input type="color" id="cp-text"  value="${s.text||'#3a3028'}" oninput="previewColor('--text',this.value)"></div>
        <div class="cp-row"><label>${translate('settings-color-primary')}</label>    <input type="color" id="cp-pri"   value="${s.primary||'#2c2416'}" oninput="previewColor('--primary',this.value)"></div>
        <div class="cp-row"><label>${translate('settings-color-card')}</label>     <input type="color" id="cp-card"  value="${s.cardBg||'#faf7f3'}" oninput="previewColor('--card-bg',this.value)"></div>
        <button class="btn-secondary" onclick="resetColoresDefault()" style="margin-top:10px;font-size:13px;padding:7px 16px;">↺ Restaurar colores por defecto</button>
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
              ${s.logoUrl ? `<img src="${s.logoUrl}" alt="Logo actual" style="max-width:100px; margin-top:8px;">` : `<span style="color:#666; font-size:13px;">${translate('settings-no-logo')}</span>`}
            </div>
          </div>
        </div>
        <div class="form-field">
          <label>${translate('settings-hero')}</label>
          <div class="image-upload-container">
            <button class="btn-upload" onclick="uploadHeroImage()">${translate('settings-upload-hero')}</button>
            <input type="file" id="hero-input" accept="image/*" style="display:none" onchange="handleHeroUpload(this)">
            <div class="current-image" id="current-hero">
              ${s.heroImageUrl ? `<img src="${s.heroImageUrl}" alt="Hero actual" style="max-width:200px; margin-top:8px;">` : `<span style="color:#666; font-size:13px;">${translate('settings-default-hero')}</span>`}
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
          <button onclick="showServerHelp()" style="background:#17a2b8; color:white; border:none; padding:6px 12px; border-radius:4px; font-size:12px; margin-left:8px; cursor:pointer;">❓ Ayuda servidor</button>
        </div>
      </div>
      <iframe id="preview-iframe" style="width:100%; height:600px; border:none; background:#f8f9fa;"></iframe>
    </div>`;

  // Cargar automáticamente la vista previa al abrir configuración
  setTimeout(() => {
    loadCurrentWebsite();
  }, 500);
}

window.previewColor = function(varName, val) { document.documentElement.style.setProperty(varName, val); };

window.resetColoresDefault = function() {
  const defaults = { 'cp-gold': '#b8924a', 'cp-bg': '#f5f0eb', 'cp-text': '#3a3028', 'cp-pri': '#2c2416', 'cp-card': '#faf7f3' };
  const varMap   = { 'cp-gold': '--gold',  'cp-bg': '--bg',    'cp-text': '--text',  'cp-pri': '--primary', 'cp-card': '--card-bg' };
  Object.entries(defaults).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; previewColor(varMap[id], val); }
  });
};

window.guardarSettings = async function() {
  const currentSettings = await getSettings();
  const data = {
    whatsapp:    document.getElementById("s-wa").value.trim(),
    whatsappMsg: document.getElementById("s-wa-msg").value.trim(),
    tel:         document.getElementById("s-tel").value.trim(),
    email:       document.getElementById("s-email").value.trim(),
    addr:        document.getElementById("s-addr").value.trim(),
    hours:       document.getElementById("s-hours").value.trim(),
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
  const users = await getAllUsers();
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header"><h2>Usuarios</h2></div>
    <table class="ut">
      <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th>Acción</th></tr></thead>
      <tbody>
        ${users.map(u=>`
          <tr>
            <td>${u.email}</td>
            <td><strong>${u.name}</strong></td>
            <td><span class="${u.role==='superadmin'?'badge-s':u.role==='admin'?'badge-a':'badge-e'}">${u.role}</span></td>
            <td>${u.role==='superadmin'?'—':`<button class="del-btn" onclick="delUser('${u.id}')">Eliminar</button>`}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    <div style="margin-top:32px;">
      <div class="settings-card-title">➕ Crear nuevo usuario</div>
      <div class="um-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div class="form-field"><label>Email</label><input type="email" id="nu-e" placeholder="nuevo@email.com"></div>
        <div class="form-field"><label>Nombre</label><input type="text" id="nu-n" placeholder="Nombre Apellido"></div>
        <div class="form-field"><label>Contraseña</label><input type="password" id="nu-p" placeholder="Mín. 8 caracteres"></div>
        <div class="form-field"><label>Rol</label>
          <select id="nu-r"><option value="editor">Editor</option><option value="admin">Admin</option></select>
        </div>
      </div>
      <button class="btn-primary" onclick="addUser()" style="margin-top:12px;">Crear Usuario</button>
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
  if(!email||!name||!pass){ errEl.textContent="Completá todos los campos"; return; }
  if(pass.length<8){ errEl.textContent="La contraseña debe tener al menos 8 caracteres"; return; }
  try {
    await createUser(email, pass, name, role);
    showToast(`👤 Usuario "${name}" creado`);
    renderUsuarios();
  } catch(e) {
    errEl.textContent = "Error: " + (e.code==="auth/email-already-in-use"?"Ese email ya está registrado":e.message);
  }
};

window.delUser = async function(uid) {
  if(!confirm("¿Eliminar este usuario?")) return;
  await deleteUserProfile(uid);
  showToast("🗑 Usuario eliminado"); renderUsuarios();
};

// ─── Idioma topbar ────────────────────────────────────────
function buildLangSwitchers() {
  const wrap = document.getElementById("lang-switcher-admin");
  if(wrap) wrap.innerHTML = Object.entries(langMeta).map(([code,meta])=>`
    <button class="lang-btn-admin ${code===currentLang?'active':''}" onclick="switchLang('${code}')">${meta.flag} ${meta.label}</button>
  `).join("");
}
window.switchLang = function(code) {
  currentLang = code;
  localStorage.setItem("lm_lang", code);
  buildLangSwitchers();
  applyAdminTranslations(code);
  // Si el editor de contenido está abierto, sincronizar
  if (currentSection === "contenido" && typeof window._syncContenidoLang === "function") {
    window._syncContenidoLang(code);
  }
  showToast(`🌐 Editando en ${langMeta[code].label}`);
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
  if (currentSection === 'settings') {
    renderSettings();
  } else if (currentSection === 'dashboard') {
    renderDashboard();
  }
}

// ─── Colores ──────────────────────────────────────────────
function syncColorPickers(data) {
  if(!data) return;
  const map = { gold:"cp-gold", bg:"cp-bg", text:"cp-text", primary:"cp-pri", cardBg:"cp-card" };
  Object.entries(map).forEach(([k,id])=>{ const el=document.getElementById(id); if(el&&data[k]) el.value=data[k]; });
}

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
    titulo: "🏠 Página de Inicio",
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
    titulo: "👥 Página Nosotros",
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
      { key: "e1-nombre",      label: "Miembro 1 — Nombre",                tipo: "input"    },
      { key: "e1-rol",         label: "Miembro 1 — Rol",                   tipo: "input"    },
      { key: "e2-nombre",      label: "Miembro 2 — Nombre",                tipo: "input"    },
      { key: "e2-rol",         label: "Miembro 2 — Rol",                   tipo: "input"    },
      { key: "e3-nombre",      label: "Miembro 3 — Nombre",                tipo: "input"    },
      { key: "e3-rol",         label: "Miembro 3 — Rol",                   tipo: "input"    },
      { key: "e4-nombre",      label: "Miembro 4 — Nombre",                tipo: "input"    },
      { key: "e4-rol",         label: "Miembro 4 — Rol",                   tipo: "input"    },
      { key: "nos-cta-h",      label: "CTA — Título",                      tipo: "input"    },
      { key: "nos-cta-p",      label: "CTA — Texto",                       tipo: "textarea" },
      { key: "nos-cta-btn",    label: "CTA — Botón",                       tipo: "input"    },
    ]
  },
  {
    titulo: "📬 Página Contacto",
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
    titulo: "🧭 Navegación",
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

// ── Traducción: LibreTranslate ─────────────────────────────
async function translateBatch(keyValueObj, sourceLang, targetLang) {
  const entries = Object.entries(keyValueObj).filter(([, v]) => v && v.trim());
  if (!entries.length) return {};

  try {
    const results = {};
    for (const [key, text] of entries) {
      const r = await fetch("https://libretranslate.com/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source: sourceLang === "ca" ? "es" : sourceLang, target: targetLang === "ca" ? "es" : targetLang, format: "text" })
      });
      const d = await r.json();
      results[key] = d.translatedText || text;
    }
    return results;
  } catch (err) {
    console.error("LibreTranslate failed:", err);
    return {};
  }
}

// ── Estado centralizado del contenido (un solo listener) ──
let _remotoCMS = {};
let _cmsListenerActive = false;

async function renderContenido() {
  // FIX 1: usar currentLang global del topbar como punto de partida
  let editLang = currentLang;

  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>Contenido del Sitio</h2>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:13px;color:#888">Editando en:</span>
        <div id="lang-tabs-contenido" style="display:flex;gap:6px;"></div>
      </div>
    </div>
    <div id="contenido-editor">
      <div class="loading"><div class="spinner"></div>Cargando contenido...</div>
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
  window._switchEditLang = function(code) {
    editLang = code;
    // Sincronizar también el switcher del topbar
    currentLang = code;
    localStorage.setItem("lm_lang", code);
    buildLangSwitchers();
    _renderEditorContenido();
  };

  function val(key) {
    return (_remotoCMS[editLang] || {})[key] || "";
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
            <div style="color:#e2c97e;font-weight:700;font-size:14px;margin-bottom:3px;">✨ Auto-traducción con IA</div>
            <div style="color:#8892b0;font-size:12px;">
              Guardá en <strong style="color:#ccd6f6">${LANG_META_CMS[editLang].flag} ${LANG_META_CMS[editLang].label}</strong>
              y traducí automáticamente a los otros 2 idiomas
            </div>
          </div>
          <button id="btn-traducir-ia" onclick="window._traducirConIA()"
            style="background:linear-gradient(135deg,#e2c97e,#c9a227);color:#1a1a2e;border:none;
            border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;">
            🌐 Traducir a los otros idiomas
          </button>
          <div id="traduccion-status" style="font-size:12px;color:#8892b0;min-width:160px;"></div>
        </div>

        <!-- Campos por sección -->
        ${CONTENIDO_SECCIONES.map(sec => `
          <div class="contenido-sec">
            <div class="contenido-sec-title">${sec.titulo}</div>
            <div class="contenido-campos">
              ${sec.campos.map(c => `
                <div class="form-field">
                  <label>${c.label}</label>
                  ${c.tipo === "textarea"
                    ? `<textarea id="cf-${c.key}" rows="2">${val(c.key)}</textarea>`
                    : `<input id="cf-${c.key}" type="text" value="${(val(c.key)||'').replace(/"/g,'&quot;')}">`
                  }
                </div>`).join("")}
            </div>
          </div>`).join("")}

        <!-- Footer sticky -->
        <div style="position:sticky;bottom:0;background:var(--bg,#f5f0eb);padding:16px 0;
          border-top:1px solid var(--border,#e0d9d0);display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button class="btn-primary" onclick="window._guardarContenidoCMS()" style="padding:13px 28px;font-size:14px;">
            💾 Guardar (${LANG_META_CMS[editLang].flag} ${LANG_META_CMS[editLang].label})
          </button>
          <span style="font-size:12px;color:#aaa">Los cambios se aplican al sitio en tiempo real</span>
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
      if (msg) msg.textContent = `✅ Guardado en ${LANG_META_CMS[editLang].label}`;
      showToast(`✅ Guardado (${LANG_META_CMS[editLang].flag} ${LANG_META_CMS[editLang].label})`);
      setTimeout(() => { const m = document.getElementById("contenido-msg"); if(m) m.textContent=""; }, 3000);
    } catch(e) {
      const msg = document.getElementById("contenido-msg");
      if (msg) msg.textContent = "❌ Error: " + e.message;
    }
  };

  // ── Traducir con IA ─────────────────────────────────────
  window._traducirConIA = async function() {
    const btn    = document.getElementById("btn-traducir-ia");
    const status = document.getElementById("traduccion-status");
    if (!btn || !status) return;

    // 1. Guardar idioma actual primero
    const currentData = _collectFields();
    btn.disabled = true; btn.textContent = "⏳ Guardando...";

    try {
      const saved = { ..._remotoCMS, [editLang]: { ...(_remotoCMS[editLang]||{}), ...currentData } };
      await saveContent(saved);
      _remotoCMS = saved;
    } catch(e) {
      status.style.color = "#e74c3c";
      status.textContent = "❌ Error al guardar";
      btn.disabled = false; btn.textContent = "🌐 Traducir a los otros idiomas";
      return;
    }

    // 2. Traducir a los otros 2 idiomas
    const otherLangs = Object.keys(LANG_META_CMS).filter(l => l !== editLang);
    let finalContent = { ..._remotoCMS };
    let allOk = true;

    for (const targetLang of otherLangs) {
      btn.textContent = `⏳ Traduciendo a ${LANG_META_CMS[targetLang].label}...`;
      status.style.color = "#8892b0";
      status.textContent = `Procesando ${Object.keys(currentData).length} campos...`;
      try {
        const translated = await translateBatch(currentData, editLang, targetLang);
        if (!Object.keys(translated).length) throw new Error("Sin resultados");
        finalContent[targetLang] = { ...(_remotoCMS[targetLang]||{}), ...translated };
        status.textContent = `✅ ${LANG_META_CMS[targetLang].flag} listo`;
      } catch(err) {
        allOk = false;
        status.style.color = "#e74c3c";
        status.textContent = `⚠️ Error en ${LANG_META_CMS[targetLang].label}`;
        console.error(err);
      }
    }

    // 3. Guardar todo
    try {
      await saveContent(finalContent);
      _remotoCMS = finalContent;
      if (allOk) {
        showToast("🌐 Traducción completa — ES, CA y EN actualizados");
        status.style.color = "#27ae60";
        status.textContent = "✅ Todos los idiomas actualizados";
      } else {
        showToast("⚠️ Traducción parcial — revisá la consola");
      }
    } catch(e) {
      status.style.color = "#e74c3c";
      status.textContent = "❌ Error guardando: " + e.message;
    }

    btn.disabled = false; btn.textContent = "🌐 Traducir a los otros idiomas";
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
      `<img src="${url}" alt="Logo actual" style="max-width:100px; margin-top:8px;">`;

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
      `<img src="${url}" alt="Hero actual" style="max-width:200px; margin-top:8px;">`;

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

    // Cargar la página sin timestamp para mostrar el estado actual
    iframe.src = previewUrl;

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
      const separator = previewUrl.includes('?') ? '&' : '?';
      iframe.src = `${previewUrl}${separator}_refresh=${timestamp}&_nocache=${Math.random()}`;
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

// Función para mostrar ayuda del servidor
window.showServerHelp = function() {
  const helpText = `
🌐 CONFIGURACIÓN DEL SERVIDOR LOCAL

Para que funcione la vista previa necesitas levantar un servidor local:

📋 INSTRUCCIONES RÁPIDAS:

1️⃣ Abre la terminal/cmd
2️⃣ Navega al directorio:
   cd /c/Users/Ususario/OneDrive/Documentos/proyectos/la-maleta-web

3️⃣ Levanta servidor con Python:
   python -m http.server 5173

4️⃣ Verifica que funcione:
   Abre: http://localhost:5173

📝 Opciones alternativas:
• live-server --port=5173 (con Node.js)
• php -S localhost:5173 (con PHP)

Una vez que tengas el servidor corriendo, haz clic en "🔄 Actualizar" para ver la vista previa.

ℹ️ El archivo SERVER-SETUP.md tiene instrucciones completas.
  `;

  alert(helpText);
};