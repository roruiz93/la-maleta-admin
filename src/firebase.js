import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  onSnapshot
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config";

// ─────────────────────────────
// INIT
// ─────────────────────────────
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ─────────────────────────────
// CLOUDINARY (IMÁGENES)
// ─────────────────────────────
const CLOUD_NAME = "dkfjglodj";
const UPLOAD_PRESET = "la-maleta-admin"; // tu preset

export async function uploadImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      body: formData
    }
  );

  const data = await res.json();

  // optimización automática
  return data.secure_url.replace("/upload/", "/upload/w_800,q_auto/");
}

// ─────────────────────────────
// AUTH
// ─────────────────────────────
export async function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export async function logoutUser() {
  return signOut(auth);
}
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─────────────────────────────
// USER PROFILES (Firestore)
// ─────────────────────────────
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
export async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function createUser(email, password, name, role) {
  // Se crea en una app secundaria y aislada para no pisar la sesión
  // del admin actual: createUserWithEmailAndPassword() inicia sesión
  // automáticamente como el usuario nuevo en la instancia de auth que use.
  const secondaryApp = initializeApp(firebaseConfig, `Secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);

    await setDoc(doc(db, "users", cred.user.uid), {
      email,
      name,
      role,
      createdAt: new Date().toISOString()
    });

    return cred.user;
  } finally {
    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);
  }
}
export async function deleteUserProfile(uid) {
  await deleteDoc(doc(db, "users", uid));
}

// ─────────────────────────────
// CONTENT (Firestore)
// ─────────────────────────────
export async function saveContent(contentObj) {
  await setDoc(doc(db, "site", "content"), {
    ...contentObj,
    updatedAt: new Date().toISOString()
  });
}
export async function loadContent() {
  const snap = await getDoc(doc(db, "site", "content"));
  return snap.exists() ? snap.data() : null;
}
export function listenContent(callback) {
  return onSnapshot(doc(db, "site", "content"), snap => {
    if (snap.exists()) callback(snap.data());
  });
}

// ─────────────────────────────
// COLORS (Firestore)
// ─────────────────────────────
export async function saveColors(colorsObj) {
  await setDoc(doc(db, "site", "colors"), {
    ...colorsObj,
    updatedAt: new Date().toISOString()
  });
}
export async function loadColors() {
  const snap = await getDoc(doc(db, "site", "colors"));
  return snap.exists() ? snap.data() : null;
}
export function listenColors(callback) {
  return onSnapshot(doc(db, "site", "colors"), snap => {
    if (snap.exists()) callback(snap.data());
  });
}

// ─────────────────────────────
// LANGUAGE (Firestore)
// ─────────────────────────────
export async function saveLanguage(lang) {
  await setDoc(doc(db, "site", "settings"), {
    defaultLang: lang,
    updatedAt: new Date().toISOString()
  });
}
export function listenLanguage(callback) {
  return onSnapshot(doc(db, "site", "settings"), snap => {
    if (snap.exists()) callback(snap.data());
  });
}

// ─────────────────────────────
// IMAGES (Firestore - URLs)
// ─────────────────────────────
export async function saveImageUrl(imageId, file) {
  const url = await uploadImage(file);

  const snap = await getDoc(doc(db, "site", "images"));
  const existing = snap.exists() ? snap.data() : {};

  await setDoc(doc(db, "site", "images"), {
    ...existing,
    [imageId]: url,
    updatedAt: new Date().toISOString()
  });

  return url;
}

export async function loadImages() {
  const snap = await getDoc(doc(db, "site", "images"));
  return snap.exists() ? snap.data() : null;
}
export function listenImages(callback) {
  return onSnapshot(doc(db, "site", "images"), snap => {
    if (snap.exists()) callback(snap.data());
  });
}

// ─────────────────────────────
// DESTINOS (Firestore)
// ─────────────────────────────
export async function getDestinos() {
  const snap = await getDocs(collection(db, "destinos"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

export async function getDestino(id) {
  const snap = await getDoc(doc(db, "destinos", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// 🔥 ESTE ES EL FIX
export async function saveDestino(id, data) {
  let imagenes = data.imagenes || [];

  // 🔥 subir archivos
  if (data.files && data.files.length > 0) {
    const uploaded = await Promise.all(
      data.files.map(async (file) => {
        const url = await uploadImage(file);
        console.log("📷 Imagen subida:", url);
        return url;
      })
    );

    imagenes = [...imagenes, ...uploaded];
  }

  // fallback
  if (imagenes.length === 0 && data.imagen) {
    imagenes = [data.imagen];
  }

  // ❌ eliminar files antes de guardar
  const { files, ...cleanData } = data;

  await setDoc(doc(db, "destinos", id), {
    ...cleanData,
    imagenes,
    imagen: imagenes[0] || "",
    updatedAt: new Date().toISOString()
  });
}


export async function deleteDestino(id) {
  await deleteDoc(doc(db, "destinos", id));
}

export function listenDestinos(callback) {
  return onSnapshot(collection(db, "destinos"), snap => {
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));

    console.log("🔥 DESTINOS:", items);
    callback(items);
  });
}
// ─────────────────────────────
// EXPERIENCIAS (Firestore)
// ─────────────────────────────
export async function getExperiencias() {
  const snap = await getDocs(collection(db, "experiencias"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
}
export async function saveExperiencia(id, data) {
  await setDoc(doc(db, "experiencias", id), {
    ...data,
    updatedAt: new Date().toISOString()
  });
}
export async function deleteExperiencia(id) {
  await deleteDoc(doc(db, "experiencias", id));
}
export function listenExperiencias(callback) {
  return onSnapshot(collection(db, "experiencias"), snap => {
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
    callback(items);
  });
}

// ─────────────────────────────
// BLOG POSTS (Firestore)
// ─────────────────────────────
export async function getPosts(soloPublicados = true) {
  const snap = await getDocs(collection(db, "posts"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => (soloPublicados ? p.publicado : true))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
export async function getPost(id) {
  const snap = await getDoc(doc(db, "posts", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export async function savePost(id, data) {
  await setDoc(doc(db, "posts", id), {
    ...data,
    updatedAt: new Date().toISOString()
  });
}
export async function deletePost(id) {
  await deleteDoc(doc(db, "posts", id));
}
export function listenPosts(callback) {
  return onSnapshot(collection(db, "posts"), snap => {
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.publicado)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    callback(items);
  });
}

// ─────────────────────────────
// CONSULTAS (Firestore)
// ─────────────────────────────
export async function saveConsulta(data) {
  const id = `consulta_${Date.now()}`;
  await setDoc(doc(db, "consultas", id), {
    ...data,
    leida: false,
    fecha: new Date().toISOString()
  });
  return id;
}
export async function getConsultas() {
  const snap = await getDocs(collection(db, "consultas"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}
export async function marcarLeida(id) {
  await setDoc(doc(db, "consultas", id), { leida: true }, { merge: true });
}

// ─────────────────────────────
// SETTINGS
// ─────────────────────────────
export async function getSettings() {
  const snap = await getDoc(doc(db, "site", "settings"));
  return snap.exists() ? snap.data() : {};
}
export async function saveSettings(data) {
  await setDoc(
    doc(db, "site", "settings"),
    { ...data, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}
export function listenSettings(callback) {
  return onSnapshot(doc(db, "site", "settings"), snap => {
    if (snap.exists()) callback(snap.data());
  });
}