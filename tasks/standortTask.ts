import * as TaskManager from 'expo-task-manager';
import { doc, updateDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '@/constants/firebase';
import { berechneKm } from '@/utils/distanz';
import { KoordType } from '@/types';

// Stufe C — Background-Online: Hält den Fahrer auch dann online, wenn die App
// im Hintergrund ist (z. B. Bubble-Modus). Ein location-Foreground-Service hält
// den JS-Headless-Task am Leben; er schreibt standort + lastSeen direkt nach
// Firestore — unabhängig davon, ob der React-State-Heartbeat gedrosselt wird.

export const STANDORT_TASK = 'furtgo-standort-update';
// Wird beim Online-Schalten gesetzt, beim Offline-Schalten gelöscht. Der Headless-
// Task hat keinen React-State und liest die UID von hier.
export const ONLINE_UID_KEY = 'furtgo_online_uid';

// Lebt nur solange der JS-Kontext geladen ist. Reicht, um stationäres Schreiben
// (Fahrer parkiert/wartet) auf reines lastSeen zu reduzieren — wie der alte
// Foreground-Heartbeat.
let letzterGeschriebenerStandort: KoordType | null = null;

TaskManager.defineTask(STANDORT_TASK, async ({ data, error }: any) => {
  if (error) {
    console.log('Standort-Task Fehler:', error);
    return;
  }
  const locations = data?.locations;
  const loc = locations?.[locations.length - 1];
  if (!loc) return;

  try {
    const uid = await AsyncStorage.getItem(ONLINE_UID_KEY);
    if (!uid) return; // nicht (mehr) online → nichts schreiben

    const coords: KoordType = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    };
    const bewegungM = letzterGeschriebenerStandort
      ? berechneKm(letzterGeschriebenerStandort, coords) * 1000
      : Infinity;

    if (bewegungM < 30) {
      // Stationär: nur lastSeen — spart Akku + Firestore-Writes
      await updateDoc(doc(db, 'fahrer', uid), { lastSeen: Date.now() });
    } else {
      await updateDoc(doc(db, 'fahrer', uid), { standort: coords, lastSeen: Date.now() });
      letzterGeschriebenerStandort = coords;
    }
  } catch (e) {
    console.log('Standort-Task Schreibfehler (ignoriert):', e);
  }
});
