import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { initializeAuth, getAuth, inMemoryPersistence } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyDYq8vHZTE7NCUCyt_Kc2olUg6NXHTVAiA',
  authDomain: 'meine-uber-app-a57aa.firebaseapp.com',
  projectId: 'meine-uber-app-a57aa',
  storageBucket: 'meine-uber-app-a57aa.firebasestorage.app',
  messagingSenderId: '522068044243',
  appId: '1:522068044243:web:50f7305d3c4c90c99e6726',
};

const istNeu = getApps().length === 0;
const app = istNeu ? initializeApp(firebaseConfig) : getApp();

// iOS Safari (PWA) killt WebSocket-Verbindungen — Long-Polling Fallback aktivieren
// damit onSnapshot-Listener auf iPhone zuverlässig funktionieren.
let dbInstance;
try {
  dbInstance = istNeu
    ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
    : getFirestore(app);
} catch {
  dbInstance = getFirestore(app);
}
export const db = dbInstance;

let auth;
try {
  auth = initializeAuth(app, { persistence: inMemoryPersistence });
} catch {
  auth = getAuth(app);
}
export { auth };
export const storage = getStorage(app);
