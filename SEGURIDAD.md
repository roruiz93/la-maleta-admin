# 🔐 Guía de Seguridad — Viajes La Maleta

## Capas de seguridad implementadas

---

## CAPA 1 — Firebase API Keys
Las API keys de Firebase son visibles en el código del frontend (esto es normal y esperado).
Lo que las protege son las **restricciones de dominio** que vos configurás en Google Console.

### Pasos obligatorios:
1. Ir a https://console.cloud.google.com
2. Seleccionar tu proyecto Firebase
3. APIs y servicios → Credenciales
4. Click en tu API Key
5. En "Restricciones de aplicación" → seleccionar **Sitios web HTTP**
6. Agregar los dominios autorizados:
   - `https://lamaleta.vercel.app/*`
   - `https://lamaleta.com/*` (cuando tengas el dominio)
   - `http://localhost:5173/*` (solo para desarrollo)
7. Guardar

Esto hace que tu API key **solo funcione desde tus dominios**.

---

## CAPA 2 — Código fuente ofuscado
Cuando hacés `npm run build`, Vite + Terser:
- ✅ Minifica todo el código (ilegible)
- ✅ Ofusca nombres de variables y funciones
- ✅ Elimina todos los `console.log`
- ✅ Elimina comentarios
- ✅ Genera nombres de archivos con hash aleatorio

**Importante:** Nadie puede evitar ver el código de un sitio web.
Lo que hacemos es hacerlo lo más difícil posible de leer y entender.

---

## CAPA 3 — Datos de clientes protegidos
Las reglas de Firestore (`firestore.rules`) garantizan:
- ✅ Las consultas solo las puede crear cualquiera (formulario público)
- ✅ Solo admins autenticados pueden **leer** las consultas
- ✅ Un visitante no puede leer las consultas de otro
- ✅ Validación de campos obligatoria (email < 200 chars, etc.)
- ✅ Límite de tamaño en documentos (anti DoS)
- ✅ Solo campos permitidos pueden ser escritos (whitelist)

---

## CAPA 4 — Panel admin protegido
El panel admin tiene:
- ✅ **Bloqueo por intentos:** 5 intentos fallidos → bloqueado 15 minutos
- ✅ **Timeout de sesión:** Expira automáticamente a las 8 horas
- ✅ **Detección de sesión concurrente:** Si otra persona abre el panel, el anterior es deslogueado
- ✅ **URL separada:** El admin está en una URL diferente al sitio público
- ✅ **No indexado:** `<meta name="robots" content="noindex">` para que Google no lo liste

### Configuración adicional recomendada en Firebase:
1. Firebase Console → Authentication → Settings
2. Activar **"Email enumeration protection"**
3. En Sign-in providers → Solo tener activo **Email/Password**

---

## CAPA 5 — Protección XSS y spam
Implementado en `src/security.js`:
- ✅ **Sanitización:** Todos los inputs escapan `< > " ' / =`
- ✅ **Honeypot:** Campo invisible que detecta bots automáticos
- ✅ **Rate limiting:** Máximo 3 consultas por minuto por navegador
- ✅ **Validación de email** con regex
- ✅ **Detección de spam** (links, palabras clave)
- ✅ **Límite de longitud** en todos los campos

---

## CAPA 6 — HTTPS y Headers de seguridad
Configurado en `vercel.json`:

| Header | Protege contra |
|--------|----------------|
| `Strict-Transport-Security` | Fuerza HTTPS siempre |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `X-XSS-Protection` | XSS básico en browsers viejos |
| `Content-Security-Policy` | Inyección de scripts externos |
| `Referrer-Policy` | Filtración de URLs privadas |
| `Permissions-Policy` | Acceso a cámara/micrófono/GPS |

---

## Checklist antes de ir a producción

- [ ] Restricciones de dominio en Google Console (CAPA 1)
- [ ] `npm run build` para generar código minificado (CAPA 2)
- [ ] Aplicar `firestore.rules` en Firebase Console (CAPA 3)
- [ ] Aplicar `storage.rules` en Firebase Console (CAPA 3)
- [ ] Activar Email enumeration protection en Firebase Auth (CAPA 4)
- [ ] Verificar que el dominio del admin NO está indexado en Google (CAPA 4)
- [ ] Deploy en Vercel (aplica automáticamente los headers del CAPA 6)
- [ ] Verificar HTTPS activo en Vercel (es automático)
- [ ] Agregar dominio real en Firebase Authorized Domains cuando lo tengas

---

## Lo que NO podemos evitar (limitaciones honestas)

❌ **Que alguien vea el HTML** — todo sitio web es público por naturaleza
❌ **Que alguien copie el diseño** — el CSS siempre es visible
❌ **Ataques DDoS masivos** — necesitarías Cloudflare para eso
❌ **Si alguien obtiene una contraseña de admin por phishing** — usar contraseñas fuertes

Lo que SÍ garantizamos es que los **datos de los clientes** (consultas, emails) 
son completamente privados y solo accesibles por admins autenticados.
