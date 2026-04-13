import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
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

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app);

let auth;
try {
  auth = initializeAuth(app, { persistence: inMemoryPersistence });
} catch {
  auth = getAuth(app);
}
export { auth };
export const storage = getStorage(app);
