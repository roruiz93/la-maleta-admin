import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import dotenv from 'dotenv';
dotenv.config();

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL;
const SUPERADMIN_PASS = process.env.SUPERADMIN_PASS ;
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

async function createSuperadmin() {
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    
    const userCredential = await createUserWithEmailAndPassword(auth, SUPERADMIN_EMAIL, SUPERADMIN_PASS);
    const uid = userCredential.user.uid || 'Ch46CrwKUEUYY1NePwRrvx0LJaG3';
    
    await setDoc(doc(db, 'users', uid), {
      email: SUPERADMIN_EMAIL,
      name: 'Super Admin',
      role: 'superadmin',
      createdAt: new Date().toISOString()
    });
    
    console.log(`✅ Superadmin created!`);
    console.log(`Email: ${SUPERADMIN_EMAIL}`);
    console.log(`Password: ${SUPERADMIN_PASS}`);
    console.log(`UID: ${uid}`);
    console.log(`🔗 Login: http://localhost:5173`);
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      console.log('👤 Superadmin already exists. Reset password in Firebase Console.');
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

createSuperadmin();

