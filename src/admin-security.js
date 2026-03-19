// ============================================================
//  admin-security.js — Seguridad del panel de administración
//  Bloqueo por intentos, timeout de sesión, logging
// ============================================================

const MAX_ATTEMPTS   = 5;        // Intentos antes de bloquear
const BLOCK_MINUTES  = 15;       // Minutos bloqueado
const SESSION_HOURS  = 8;        // Horas antes de expirar la sesión
const STORAGE_KEY    = "lm_auth_meta";

// ─── Control de intentos fallidos ────────────────────────
function getAuthMeta() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch { return {}; }
}
function saveAuthMeta(data) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function recordFailedAttempt() {
  const meta = getAuthMeta();
  meta.attempts = (meta.attempts || 0) + 1;
  meta.lastAttempt = Date.now();
  if (meta.attempts >= MAX_ATTEMPTS) {
    meta.blockedUntil = Date.now() + BLOCK_MINUTES * 60 * 1000;
  }
  saveAuthMeta(meta);
  return meta.attempts;
}

export function clearAttempts() {
  const meta = getAuthMeta();
  delete meta.attempts;
  delete meta.blockedUntil;
  meta.loginAt = Date.now();
  saveAuthMeta(meta);
}

export function getBlockStatus() {
  const meta = getAuthMeta();
  if (!meta.blockedUntil) return { blocked: false };
  if (Date.now() < meta.blockedUntil) {
    const remaining = Math.ceil((meta.blockedUntil - Date.now()) / 60000);
    return { blocked: true, remaining, attempts: meta.attempts };
  }
  // Bloqueo expiró — resetear
  delete meta.blockedUntil;
  delete meta.attempts;
  saveAuthMeta(meta);
  return { blocked: false };
}

export function getRemainingAttempts() {
  const meta = getAuthMeta();
  return Math.max(0, MAX_ATTEMPTS - (meta.attempts || 0));
}

// ─── Timeout de sesión ────────────────────────────────────
export function checkSessionTimeout(logoutFn) {
  const meta = getAuthMeta();
  if (!meta.loginAt) return;
  const hoursElapsed = (Date.now() - meta.loginAt) / 3600000;
  if (hoursElapsed > SESSION_HOURS) {
    clearAuthMeta();
    logoutFn();
    alert("Tu sesión expiró por inactividad. Por favor ingresá de nuevo.");
  }
}

export function startSessionTimer(logoutFn) {
  // Revisar cada 5 minutos
  return setInterval(() => checkSessionTimeout(logoutFn), 5 * 60 * 1000);
}

function clearAuthMeta() {
  sessionStorage.removeItem(STORAGE_KEY);
}

// ─── Validación de contraseña segura ─────────────────────
export function validatePassword(pass) {
  const errors = [];
  if (pass.length < 8)            errors.push("Mínimo 8 caracteres");
  if (!/[A-Z]/.test(pass))        errors.push("Al menos una mayúscula");
  if (!/[a-z]/.test(pass))        errors.push("Al menos una minúscula");
  if (!/[0-9]/.test(pass))        errors.push("Al menos un número");
  return errors;
}

// ─── Detectar sesión concurrente sospechosa ───────────────
// Si se detecta el mismo usuario desde otra pestaña/dispositivo
export function initConcurrencyCheck(currentUid, logoutFn) {
  const key = `lm_session_${currentUid}`;
  const sessionId = Math.random().toString(36).slice(2);
  localStorage.setItem(key, sessionId);

  // Escuchar cambios (si otro tab/dispositivo pisa la sesión)
  window.addEventListener("storage", (e) => {
    if (e.key === key && e.newValue !== sessionId) {
      // Otra sesión tomó el control
      logoutFn();
      alert("Se detectó una sesión activa en otro dispositivo.");
    }
  });

  return sessionId;
}

// ─── Log de actividad admin ───────────────────────────────
export function logAdminAction(action, details = {}) {
  // En producción esto podría guardarse en Firestore
  // Por ahora solo registra en consola (que se elimina en build)
  console.info(`[Admin] ${new Date().toISOString()} — ${action}`, details);
}
