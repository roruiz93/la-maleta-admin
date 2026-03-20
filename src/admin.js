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
  getConsultas, marcarLeida,uploadImage 
} from "./firebase.js";
import { translations, langMeta } from "./i18n.js";
 
import { auth } from "./firebase-config";
const WEB_URL = import.meta.env.VITE_WEB_URL || "https://lamaleta.vercel.app";

// ─── Estado ───────────────────────────────────────────────
let CU = null, currentLang = localStorage.getItem("lm_lang") || "es", remoteContent = {};
let currentSection = "dashboard";

// ─── Auth ─────────────────────────────────────────────────
 onAuthChange(async (fu) => {
  if (fu) {
    const p = await getUserProfile(fu.uid);
    console.log(p)
    if (!p) {
      console.log("No existe perfil en Firestore");
      return logoutUser();
    }
    if (p.role !== "admin" && p.role !== "superadmin") {
      console.log("No tiene permisos");
      return logoutUser();
    }
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
  console.log(import.meta.env.VITE_FIREBASE_PROJECT_ID)
  console.log(email,pass)
  if (block.blocked) { err.textContent = `Bloqueado ${block.remaining} min. por intentos fallidos.`; return; }
  if (!email || !pass) { err.textContent = "Ingresá email y contraseña"; return; }
  btn.textContent = "Ingresando..."; btn.disabled = true;
  try {
    
    await loginUser(email, pass);
    showCMS();
    
    clearAttempts();
  }catch (error) {
  console.log("ERROR FIREBASE:", error.code)
  console.log("MENSAJE:", error.message)
}
};
window.doLogout = async () => { await logoutUser(); };

function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("cms-panel").style.display = "none";
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
  document.getElementById("preview-link").href = WEB_URL;
  buildLangSwitchers();
  listenContent(d => { if(d) remoteContent = d; });
  listenColors(syncColorPickers);
  showSection("dashboard");
}

// ─── Navegación de secciones ──────────────────────────────
window.showSection = function(sec) {
  currentSection = sec;
  document.querySelectorAll(".sb-btn").forEach(b => b.classList.remove("active"));
  const btn = document.querySelector(`[data-sec="${sec}"]`);
  if (btn) btn.classList.add("active");
  const content = document.getElementById("section-content");
  const loaders = {
    dashboard:    renderDashboard,
    destinos:     renderDestinos,
    experiencias: renderExperiencias,
    blog:         renderBlog,
    consultas:    renderConsultas,
    settings:     renderSettings,
    usuarios:     renderUsuarios,
  };
  content.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  if (loaders[sec]) loaders[sec]();
};

// ─── DASHBOARD ────────────────────────────────────────────
async function renderDashboard() {
  const [destinos, posts, consultas] = await Promise.all([
    getDestinos(), getPosts(false), getConsultas()
  ]);
  const noLeidas = consultas.filter(c => !c.leida).length;
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header"><h2>Dashboard</h2><p>Resumen del sitio</p></div>
    <div class="dash-grid">
      <div class="dash-card" onclick="showSection('destinos')">
        <div class="dash-icon">✈️</div>
        <div class="dash-num">${destinos.length}</div>
        <div class="dash-lbl">Destinos</div>
      </div>
      <div class="dash-card" onclick="showSection('blog')">
        <div class="dash-icon">📝</div>
        <div class="dash-num">${posts.length}</div>
        <div class="dash-lbl">Posts del Blog</div>
      </div>
      <div class="dash-card ${noLeidas>0?'dash-alert':''}" onclick="showSection('consultas')">
        <div class="dash-icon">💬</div>
        <div class="dash-num">${noLeidas}</div>
        <div class="dash-lbl">Consultas sin leer</div>
      </div>
      <div class="dash-card" onclick="showSection('settings')">
        <div class="dash-icon">⚙️</div>
        <div class="dash-num">—</div>
        <div class="dash-lbl">Configuración</div>
      </div>
    </div>
    <div class="sec-tip">💡 Tip: Usá el switcher de idioma arriba para editar el contenido en cada idioma por separado.</div>
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
          <img src="${d.imagen||'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=100&q=60'}" class="item-thumb" alt="${d.nombre}">
          <div class="item-info">
            <strong>${d.nombre}</strong>
            <span>${d.categoria||''} · ${d.duracion||''} · desde $${(d.precio||0).toLocaleString()}</span>
          </div>
          <div class="item-actions">
            <span class="badge-status ${d.activo!==false?'activo':'inactivo'}">${d.activo!==false?'Activo':'Oculto'}</span>
            <button class="btn-edit" onclick="editarDestino('${d.id}')">✏️ Editar</button>
            <button class="btn-del"  onclick="eliminarDestino('${d.id}','${d.nombre}')">🗑</button>
          </div>
        </div>`).join("") : '<div class="empty-state-admin">No hay destinos. ¡Creá el primero!</div>'}
    </div>
    <!-- Modal -->
    <div id="modal-destino" class="modal" style="display:none"></div>`;
}

window.abrirModalDestino = function(d={}) {
  document.getElementById("modal-destino").style.display = "flex";
  document.getElementById("modal-destino").innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>${d.id?'Editar':'Nuevo'} Destino</h3>
        <button onclick="cerrarModal('modal-destino')">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row-admin">
          <div class="form-field"><label>Nombre *</label><input id="d-nombre" value="${d.nombre||''}" placeholder="Ej: Noruega"></div>
          <div class="form-field"><label>Categoría</label><input id="d-cat" value="${d.categoria||''}" placeholder="Ej: Europa"></div>
        </div>
        <div class="form-row-admin">
          <div class="form-field"><label>Precio (USD)</label><input id="d-precio" type="number" value="${d.precio||''}" placeholder="1200"></div>
          <div class="form-field"><label>Duración</label><input id="d-dur" value="${d.duracion||''}" placeholder="Ej: 7 días"></div>
        </div>
        <div class="form-field"><label>Descripción corta (para la grilla)</label><input id="d-descCorta" value="${d.descripcionCorta||''}" placeholder="Breve descripción para la tarjeta"></div>
        <div class="form-field"><label>Descripción completa</label><textarea id="d-desc" rows="4" placeholder="Descripción detallada del destino...">${d.descripcion||''}</textarea></div>
        <div class="form-field">
          <label>Imagen principal</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="d-img" value="${d.imagen||''}" placeholder="URL de imagen o subí una" style="flex:1">
            <input type="file" id="d-img-file" accept="image/*" style="display:none" onchange="subirImgDestino(event,'d-img')">
            <button class="btn-upload" onclick="document.getElementById('d-img-file').click()">📷 Subir</button>
          </div>
          ${d.imagen?`<img src="${d.imagen}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-top:8px;" id="d-img-preview">`:``}
        </div>
        <div class="form-field">
          <label>¿Qué incluye? (una por línea)</label>
          <textarea id="d-incluye" rows="4" placeholder="Vuelos internacionales&#10;Hotel 4 estrellas&#10;Traslados&#10;Guía local">${(d.incluye||[]).join('\n')}</textarea>
        </div>
        <div class="form-row-admin">
          <div class="form-field"><label>Orden (número)</label><input id="d-orden" type="number" value="${d.orden||0}"></div>
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

window.editarDestino = async function(id) {
  const d = (await getDestinos()).find(x=>x.id===id);
  if(d) abrirModalDestino(d);
};

window.guardarDestino = async function(id) {
  const nombre = document.getElementById("d-nombre").value.trim();
  if(!nombre) { document.getElementById("modal-msg").textContent="El nombre es requerido"; return; }
  const data = {
    nombre,
    categoria:       document.getElementById("d-cat").value.trim(),
    precio:          parseFloat(document.getElementById("d-precio").value)||0,
    duracion:        document.getElementById("d-dur").value.trim(),
    descripcionCorta:document.getElementById("d-descCorta").value.trim(),
    descripcion:     document.getElementById("d-desc").value.trim(),
    imagen:          document.getElementById("d-img").value.trim(),
    incluye:         document.getElementById("d-incluye").value.split("\n").map(s=>s.trim()).filter(Boolean),
    orden:           parseInt(document.getElementById("d-orden").value)||0,
    activo:          document.getElementById("d-activo").value === "true",
  };
  const newId = id || `destino_${Date.now()}`;
  try {
    await saveDestino(newId, data);
    cerrarModal("modal-destino");
    showToast("✅ Destino guardado");
    renderDestinos();
  } catch(e) { document.getElementById("modal-msg").textContent = "Error: " + e.message; }
};

window.eliminarDestino = async function(id, nombre) {
  if(!confirm(`¿Eliminar "${nombre}"?`)) return;
  await deleteDestino(id);
  showToast("🗑 Destino eliminado");
  renderDestinos();
};

/*window.subirImgDestino = async function(e, inputId) {
  const file = e.target.files[0]; if(!file) return;
  showToast("📤 Subiendo imagen...", false);
  try {
    const url = await uploadImage(`destinos/${Date.now()}_${file.name}`, file);
    document.getElementById(inputId).value = url;
    const prev = document.getElementById("d-img-preview");
    if(prev) prev.src = url;
    showToast("📷 Imagen subida");
  } catch(err) { showToast("❌ Error al subir: " + err.message); }
};*/
window.subirImgDestino = async (e) => {
  const file = e.target.files[0];

  console.log("USER:", auth.currentUser);

  const extension = file.name.split('.').pop();
  const filePath = `destinos/${Date.now()}.${extension}`;

  console.log("PATH:", filePath);

  const url = await uploadImage(file);

  console.log("URL:", url);
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
          <div class="item-info">
            <strong>${e.nombre}</strong>
            <span>${e.categoria||''}</span>
          </div>
          <div class="item-actions">
            <span class="badge-status ${e.activo!==false?'activo':'inactivo'}">${e.activo!==false?'Activo':'Oculto'}</span>
            <button class="btn-edit" onclick="editarExp('${e.id}')">✏️ Editar</button>
            <button class="btn-del"  onclick="eliminarExp('${e.id}','${e.nombre}')">🗑</button>
          </div>
        </div>`).join("") : '<div class="empty-state-admin">No hay experiencias. ¡Creá la primera!</div>'}
    </div>
    <div id="modal-exp" class="modal" style="display:none"></div>`;
}

window.abrirModalExp = function(e={}) {
  document.getElementById("modal-exp").style.display = "flex";
  document.getElementById("modal-exp").innerHTML = `
    <div class="modal-box">
      <div class="modal-header"><h3>${e.id?'Editar':'Nueva'} Experiencia</h3><button onclick="cerrarModal('modal-exp')">×</button></div>
      <div class="modal-body">
        <div class="form-row-admin">
          <div class="form-field"><label>Nombre *</label><input id="e-nombre" value="${e.nombre||''}" placeholder="Ej: Trekking en Patagonia"></div>
          <div class="form-field"><label>Categoría / Tipo</label><input id="e-cat" value="${e.categoria||''}" placeholder="Ej: Aventura"></div>
        </div>
        <div class="form-field"><label>Descripción</label><textarea id="e-desc" rows="3">${e.descripcion||''}</textarea></div>
        <div class="form-field">
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
  const nombre = document.getElementById("e-nombre").value.trim();
  if(!nombre){ document.getElementById("modal-exp-msg").textContent="Nombre requerido"; return; }
  const data = {
    nombre,
    categoria: document.getElementById("e-cat").value.trim(),
    descripcion: document.getElementById("e-desc").value.trim(),
    imagen: document.getElementById("e-img").value.trim(),
    orden: parseInt(document.getElementById("e-orden").value)||0,
    activo: document.getElementById("e-activo").value === "true",
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
  const url = await uploadImage( file);
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
          <img src="${p.imagen||'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=100&q=60'}" class="item-thumb" alt="${p.titulo}">
          <div class="item-info">
            <strong>${p.titulo}</strong>
            <span>${p.categoria||''} · ${formatFecha(p.fecha)} · por ${p.autor||'—'}</span>
          </div>
          <div class="item-actions">
            <span class="badge-status ${p.publicado?'activo':'inactivo'}">${p.publicado?'Publicado':'Borrador'}</span>
            <button class="btn-edit" onclick="editarPost('${p.id}')">✏️ Editar</button>
            <button class="btn-del"  onclick="eliminarPost('${p.id}','${p.titulo}')">🗑</button>
          </div>
        </div>`).join("") : '<div class="empty-state-admin">No hay posts. ¡Escribí el primero!</div>'}
    </div>
    <div id="modal-post" class="modal" style="display:none"></div>`;
}

window.abrirModalPost = function(p={}) {
  document.getElementById("modal-post").style.display = "flex";
  document.getElementById("modal-post").innerHTML = `
    <div class="modal-box modal-wide">
      <div class="modal-header"><h3>${p.id?'Editar':'Nuevo'} Post</h3><button onclick="cerrarModal('modal-post')">×</button></div>
      <div class="modal-body">
        <div class="form-field"><label>Título *</label><input id="p-titulo" value="${p.titulo||''}" placeholder="Título del artículo"></div>
        <div class="form-row-admin">
          <div class="form-field"><label>Categoría</label><input id="p-cat" value="${p.categoria||''}" placeholder="Ej: Guías de viaje"></div>
          <div class="form-field"><label>Autor</label><input id="p-autor" value="${p.autor||CU.name}" placeholder="Nombre del autor"></div>
        </div>
        <div class="form-field"><label>Resumen / Extracto</label><textarea id="p-resumen" rows="2" placeholder="Breve descripción para la lista del blog...">${p.resumen||''}</textarea></div>
        <div class="form-field">
          <label>Imagen de portada</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="p-img" value="${p.imagen||''}" placeholder="URL de imagen" style="flex:1">
            <input type="file" id="p-img-file" accept="image/*" style="display:none" onchange="subirImgPost(event)">
            <button class="btn-upload" onclick="document.getElementById('p-img-file').click()">📷 Subir</button>
          </div>
        </div>
        <div class="form-field">
          <label>Contenido (HTML o texto)</label>
          <div class="editor-toolbar">
            <button type="button" onclick="formatText('bold')"><b>B</b></button>
            <button type="button" onclick="formatText('italic')"><i>I</i></button>
            <button type="button" onclick="insertTag('h2')">H2</button>
            <button type="button" onclick="insertTag('p')">¶</button>
          </div>
          <textarea id="p-contenido" rows="12" placeholder="<h2>Introducción</h2>\n<p>Texto del artículo...</p>">${p.contenido||''}</textarea>
        </div>
        <div class="form-row-admin">
          <div class="form-field"><label>Fecha</label><input id="p-fecha" type="date" value="${p.fecha ? p.fecha.slice(0,10) : new Date().toISOString().slice(0,10)}"></div>
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
  const p = await getPost(id);
  if(p) abrirModalPost(p);
};

window.guardarPost = async function(id) {
  const titulo = document.getElementById("p-titulo").value.trim();
  if(!titulo){ document.getElementById("modal-post-msg").textContent="Título requerido"; return; }
  const data = {
    titulo,
    categoria:  document.getElementById("p-cat").value.trim(),
    autor:      document.getElementById("p-autor").value.trim(),
    resumen:    document.getElementById("p-resumen").value.trim(),
    imagen:     document.getElementById("p-img").value.trim(),
    contenido:  document.getElementById("p-contenido").value.trim(),
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

window.formatText = function(cmd) {
  document.getElementById("p-contenido").focus();
  document.execCommand(cmd);
};
window.insertTag = function(tag) {
  const ta = document.getElementById("p-contenido");
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
  document.getElementById("section-content").innerHTML = `
    <div class="sec-header"><h2>Configuración del sitio</h2></div>
    <div class="settings-grid">

      <div class="settings-card">
        <div class="settings-card-title">📱 WhatsApp</div>
        <div class="form-field"><label>Número (sin + ni espacios)</label>
          <input id="s-wa" value="${s.whatsapp||''}" placeholder="5491112345678">
          <span class="field-hint">Formato: código país + área + número. Ej: 5491112345678</span>
        </div>
        <div class="form-field"><label>Mensaje por defecto</label>
          <input id="s-wa-msg" value="${s.whatsappMsg||'Hola, quisiera información sobre sus viajes'}" placeholder="Mensaje de bienvenida en WhatsApp">
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">📬 Datos de contacto</div>
        <div class="form-field"><label>Teléfono visible en el sitio</label><input id="s-tel" value="${s.tel||''}" placeholder="+54 9 11 0000-0000"></div>
        <div class="form-field"><label>Email visible en el sitio</label><input id="s-email" value="${s.email||''}" placeholder="info@lamaleta.com"></div>
        <div class="form-field"><label>Dirección</label><input id="s-addr" value="${s.addr||''}" placeholder="Buenos Aires, Argentina"></div>
        <div class="form-field"><label>Horario de atención</label><input id="s-hours" value="${s.hours||''}" placeholder="Lun–Vie 9:00–18:00"></div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">🎨 Colores del sitio</div>
        <div class="cp-row"><label>Dorado (acento)</label><input type="color" id="cp-gold"  value="${s.gold||'#b8924a'}" oninput="previewColor('--gold',this.value)"></div>
        <div class="cp-row"><label>Fondo general</label>  <input type="color" id="cp-bg"    value="${s.bg||'#f5f0eb'}" oninput="previewColor('--bg',this.value)"></div>
        <div class="cp-row"><label>Texto principal</label> <input type="color" id="cp-text"  value="${s.text||'#3a3028'}" oninput="previewColor('--text',this.value)"></div>
        <div class="cp-row"><label>Color oscuro</label>    <input type="color" id="cp-pri"   value="${s.primary||'#2c2416'}" oninput="previewColor('--primary',this.value)"></div>
        <div class="cp-row"><label>Fondo cards</label>     <input type="color" id="cp-card"  value="${s.cardBg||'#faf7f3'}" oninput="previewColor('--card-bg',this.value)"></div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">🌐 Idioma por defecto</div>
        <div class="form-field"><label>Idioma que ven los visitantes al entrar</label>
          <select id="s-lang">
            <option value="es" ${(s.defaultLang||'es')==='es'?'selected':''}>🇪🇸 Español</option>
            <option value="ca" ${s.defaultLang==='ca'?'selected':''}>🏴 Català</option>
            <option value="en" ${s.defaultLang==='en'?'selected':''}>🇬🇧 English</option>
          </select>
        </div>
      </div>

    </div>
    <div style="margin-top:24px;">
      <button class="btn-primary" onclick="guardarSettings()" style="padding:14px 32px;font-size:15px;">💾 Guardar toda la configuración</button>
    </div>
    <div id="settings-msg" style="margin-top:12px;font-size:14px;"></div>`;
}

window.previewColor = function(varName, val) {
  document.documentElement.style.setProperty(varName, val);
};

window.guardarSettings = async function() {
  const data = {
    whatsapp:    document.getElementById("s-wa").value.trim(),
    whatsappMsg: document.getElementById("s-wa-msg").value.trim(),
    tel:         document.getElementById("s-tel").value.trim(),
    email:       document.getElementById("s-email").value.trim(),
    addr:        document.getElementById("s-addr").value.trim(),
    hours:       document.getElementById("s-hours").value.trim(),
    defaultLang: document.getElementById("s-lang").value,
    gold:   document.getElementById("cp-gold").value,
    bg:     document.getElementById("cp-bg").value,
    text:   document.getElementById("cp-text").value,
    primary:document.getElementById("cp-pri").value,
    cardBg: document.getElementById("cp-card").value,
  };
  try {
    await saveSettings(data);
    document.getElementById("settings-msg").textContent = "✅ Configuración guardada correctamente";
    showToast("✅ Configuración guardada");
    setTimeout(()=>document.getElementById("settings-msg").textContent="", 3000);
  } catch(e) {
    document.getElementById("settings-msg").textContent = "❌ Error: " + e.message;
  }
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
          <select id="nu-r">
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
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

// ─── Idioma (switchers en top bar) ────────────────────────
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
  showToast(`🌐 Editando en ${langMeta[code].label}`);
};

// ─── Colores ──────────────────────────────────────────────
function syncColorPickers(data) {
  if(!data) return;
  const map = { gold:"cp-gold", bg:"cp-bg", text:"cp-text", primary:"cp-pri", cardBg:"cp-card" };
  Object.entries(map).forEach(([k,id])=>{ const el=document.getElementById(id); if(el&&data[k]) el.value=data[k]; });
}

// ─── Helpers ──────────────────────────────────────────────
window.cerrarModal = function(id) {
  const el = document.getElementById(id);
  if(el) el.style.display = "none";
};

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

// ─── CONTENIDO DEL SITIO ──────────────────────────────────
// Agregar botón en sidebar y función de edición
window.showSection_contenido = function() {
  showSection("contenido");
};

// Sobrescribir la función showSection para incluir "contenido"
const _originalShowSection = window.showSection;
window.showSection = function(sec) {
  if (sec === "contenido") {
    renderContenido();
    currentSection = sec;
    document.querySelectorAll(".sb-btn").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`[data-sec="contenido"]`);
    if (btn) btn.classList.add("active");
    return;
  }
  _originalShowSection(sec);
};

async function renderContenido() {
  // Cargar contenido actual desde Firebase
  let remoto = {};
  const { listenContent, saveContent, listenImages, uploadImage } = await import("./firebase.js");

  document.getElementById("section-content").innerHTML = `
    <div class="sec-header">
      <h2>Contenido del Sitio</h2>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:13px;color:#888">Editando en:</span>
        <div id="lang-tabs" style="display:flex;gap:6px;"></div>
      </div>
    </div>
    <div id="contenido-editor">
      <div class="loading"><div class="spinner"></div>Cargando contenido...</div>
    </div>`;

  // Construir pestañas de idioma
  const langMeta = { es: { flag:"🇪🇸", label:"Español" }, ca: { flag:"🏴", label:"Català" }, en: { flag:"🇬🇧", label:"English" } };
  let editLang = currentLang;

  function buildLangTabs() {
    document.getElementById("lang-tabs").innerHTML = Object.entries(langMeta).map(([code, m]) =>
      `<button class="lang-tab ${code===editLang?'active':''}" onclick="switchEditLang('${code}')">${m.flag} ${m.label}</button>`
    ).join("");
  }

  window.switchEditLang = function(code) {
    editLang = code;
    buildLangTabs();
    renderEditor();
  };

  // Escuchar cambios en tiempo real
  listenContent(data => {
    remoto = data || {};
    buildLangTabs();
    renderEditor();
  });

  function val(key) {
    return (remoto[editLang] || {})[key] || "";
  }

  function renderEditor() {
    const secciones = [
      {
        titulo: "🏠 Página de Inicio",
        campos: [
          { key: "hero-h1",   label: "Título principal del Hero",     tipo: "input" },
          { key: "hero-sub",  label: "Subtítulo del Hero",            tipo: "input" },
          { key: "hero-btn1", label: "Botón 1 Hero (\"Ver Destinos\")", tipo: "input" },
          { key: "hero-btn2", label: "Botón 2 Hero (\"Sobre Nosotros\")", tipo: "input" },
          { key: "dest-title",label: "Título sección Destinos",       tipo: "input" },
          { key: "d1-name",   label: "Destino 1 — Nombre",           tipo: "input" },
          { key: "d1-desc",   label: "Destino 1 — Descripción",      tipo: "input" },
          { key: "d2-name",   label: "Destino 2 — Nombre",           tipo: "input" },
          { key: "d2-desc",   label: "Destino 2 — Descripción",      tipo: "input" },
          { key: "d3-name",   label: "Destino 3 — Nombre",           tipo: "input" },
          { key: "d3-desc",   label: "Destino 3 — Descripción",      tipo: "input" },
          { key: "d4-name",   label: "Destino 4 — Nombre",           tipo: "input" },
          { key: "d4-desc",   label: "Destino 4 — Descripción",      tipo: "input" },
          { key: "ver-todos", label: "Botón \"Ver todos los viajes\"", tipo: "input" },
          { key: "pq-title",  label: "Título \"¿Por qué elegirnos?\"", tipo: "input" },
          { key: "pq1",       label: "Razón 1",                      tipo: "input" },
          { key: "pq2",       label: "Razón 2",                      tipo: "input" },
          { key: "pq3",       label: "Razón 3",                      tipo: "input" },
          { key: "pq4",       label: "Razón 4",                      tipo: "input" },
          { key: "test-title",label: "Título sección Testimonios",    tipo: "input" },
          { key: "t1-name",   label: "Testimonio 1 — Nombre",        tipo: "input" },
          { key: "t1-text",   label: "Testimonio 1 — Texto",         tipo: "textarea" },
          { key: "t2-name",   label: "Testimonio 2 — Nombre",        tipo: "input" },
          { key: "t2-text",   label: "Testimonio 2 — Texto",         tipo: "textarea" },
          { key: "t3-name",   label: "Testimonio 3 — Nombre",        tipo: "input" },
          { key: "t3-text",   label: "Testimonio 3 — Texto",         tipo: "textarea" },
          { key: "cta-h",     label: "CTA — Título",                  tipo: "input" },
          { key: "cta-p",     label: "CTA — Texto",                   tipo: "textarea" },
          { key: "cta-btn",   label: "CTA — Botón",                   tipo: "input" },
          { key: "footer-slogan", label: "Footer — Slogan",           tipo: "input" },
        ]
      },
      {
        titulo: "👥 Página Nosotros",
        campos: [
          { key: "nos-hero-h1", label: "Hero — Título",               tipo: "input" },
          { key: "nos-hero-p",  label: "Hero — Subtítulo",            tipo: "input" },
          { key: "nos-titulo",  label: "Título sección intro",        tipo: "input" },
          { key: "nos-p1",      label: "Párrafo 1",                   tipo: "textarea" },
          { key: "nos-p2",      label: "Párrafo 2",                   tipo: "textarea" },
          { key: "nos-p3",      label: "Párrafo 3",                   tipo: "textarea" },
          { key: "nos-btn",     label: "Botón Contacto",              tipo: "input" },
          { key: "stat1",       label: "Estadística 1 — Número",      tipo: "input" },
          { key: "stat1-lbl",   label: "Estadística 1 — Etiqueta",    tipo: "input" },
          { key: "stat2",       label: "Estadística 2 — Número",      tipo: "input" },
          { key: "stat2-lbl",   label: "Estadística 2 — Etiqueta",    tipo: "input" },
          { key: "stat3",       label: "Estadística 3 — Número",      tipo: "input" },
          { key: "stat3-lbl",   label: "Estadística 3 — Etiqueta",    tipo: "input" },
          { key: "stat4",       label: "Estadística 4 — Número",      tipo: "input" },
          { key: "stat4-lbl",   label: "Estadística 4 — Etiqueta",    tipo: "input" },
          { key: "valores-titulo", label: "Título sección Valores",   tipo: "input" },
          { key: "val1-titulo", label: "Valor 1 — Título",            tipo: "input" },
          { key: "val1-texto",  label: "Valor 1 — Texto",             tipo: "textarea" },
          { key: "val2-titulo", label: "Valor 2 — Título",            tipo: "input" },
          { key: "val2-texto",  label: "Valor 2 — Texto",             tipo: "textarea" },
          { key: "val3-titulo", label: "Valor 3 — Título",            tipo: "input" },
          { key: "val3-texto",  label: "Valor 3 — Texto",             tipo: "textarea" },
          { key: "val4-titulo", label: "Valor 4 — Título",            tipo: "input" },
          { key: "val4-texto",  label: "Valor 4 — Texto",             tipo: "textarea" },
          { key: "equipo-titulo", label: "Título sección Equipo",     tipo: "input" },
          { key: "e1-nombre",   label: "Miembro 1 — Nombre",          tipo: "input" },
          { key: "e1-rol",      label: "Miembro 1 — Rol",             tipo: "input" },
          { key: "e2-nombre",   label: "Miembro 2 — Nombre",          tipo: "input" },
          { key: "e2-rol",      label: "Miembro 2 — Rol",             tipo: "input" },
          { key: "e3-nombre",   label: "Miembro 3 — Nombre",          tipo: "input" },
          { key: "e3-rol",      label: "Miembro 3 — Rol",             tipo: "input" },
          { key: "e4-nombre",   label: "Miembro 4 — Nombre",          tipo: "input" },
          { key: "e4-rol",      label: "Miembro 4 — Rol",             tipo: "input" },
          { key: "nos-cta-h",   label: "CTA — Título",                tipo: "input" },
          { key: "nos-cta-p",   label: "CTA — Texto",                 tipo: "textarea" },
          { key: "nos-cta-btn", label: "CTA — Botón",                 tipo: "input" },
        ]
      },
      {
        titulo: "📬 Página Contacto",
        campos: [
          { key: "contacto-h1",      label: "Hero — Título",          tipo: "input" },
          { key: "contacto-sub",     label: "Hero — Subtítulo",       tipo: "input" },
          { key: "contacto-info-h",  label: "Título columna info",    tipo: "input" },
          { key: "contacto-info-p",  label: "Texto columna info",     tipo: "textarea" },
          { key: "wa-btn-txt",       label: "Texto botón WhatsApp",   tipo: "input" },
          { key: "form-titulo",      label: "Título formulario",      tipo: "input" },
          { key: "form-subtitulo",   label: "Subtítulo formulario",   tipo: "input" },
        ]
      },
      {
        titulo: "🧭 Navegación",
        campos: [
          { key: "logo",    label: "Logo — texto nombre",    tipo: "input" },
          { key: "nav1",    label: "Menú — Destinos",        tipo: "input" },
          { key: "nav2",    label: "Menú — Experiencias",    tipo: "input" },
          { key: "nav3",    label: "Menú — Nosotros",        tipo: "input" },
          { key: "nav4",    label: "Menú — Blog",            tipo: "input" },
          { key: "nav5",    label: "Menú — Contacto",        tipo: "input" },
          { key: "nav-cta", label: "Menú — Botón CTA",       tipo: "input" },
        ]
      }
    ];

    document.getElementById("contenido-editor").innerHTML = `
      <div style="display:flex;flex-direction:column;gap:24px;">
        ${secciones.map(sec => `
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
        <div style="position:sticky;bottom:0;background:var(--bg);padding:16px 0;border-top:1px solid var(--border);display:flex;gap:12px;align-items:center;">
          <button class="btn-primary" onclick="guardarContenido()" style="padding:13px 28px;font-size:14px;">
            💾 Guardar todo el contenido (${langMeta[editLang].flag} ${langMeta[editLang].label})
          </button>
          <span style="font-size:12px;color:#aaa">Los cambios se aplican al sitio en tiempo real</span>
        </div>
        <div id="contenido-msg" style="font-size:13px;margin-top:4px;"></div>
      </div>`;
  }

  window.guardarContenido = async function() {
    // Recolectar todos los campos del editor
    const langData = {};
    document.querySelectorAll("[id^='cf-']").forEach(el => {
      const key = el.id.replace("cf-", "");
      langData[key] = el.value || el.textContent;
    });

    // Merge con contenido existente en otros idiomas
    const updated = { ...remoto, [editLang]: { ...(remoto[editLang]||{}), ...langData } };

    try {
      await saveContent(updated);
      document.getElementById("contenido-msg").textContent = `✅ Contenido en ${langMeta[editLang].label} guardado`;
      showToast("✅ Contenido guardado");
      setTimeout(() => {
        const msg = document.getElementById("contenido-msg");
        if (msg) msg.textContent = "";
      }, 3000);
    } catch(e) {
      document.getElementById("contenido-msg").textContent = "❌ Error: " + e.message;
    }
  };
}
