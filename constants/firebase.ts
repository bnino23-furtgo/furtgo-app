import { Platform } from 'react-native';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  type Auth,
} from 'firebase/auth';
// @ts-ignore — nur im RN-Build von firebase/auth vorhanden, fehlt in den unified Types
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

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

// Persistente Login-Session: auf Native via AsyncStorage, im Web via IndexedDB/LocalStorage.
const persistence =
  Platform.OS === 'web'
    ? [indexedDBLocalPersistence, browserLocalPersistence]
    : getReactNativePersistence(AsyncStorage);

let auth: Auth;
try {
  auth = initializeAuth(app, { persistence });
} catch {
  auth = getAuth(app);
}
export { auth };
export const storage = getStorage(app);
export const functions = getFunctions(app, 'europe-west6');
