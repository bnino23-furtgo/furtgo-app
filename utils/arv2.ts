import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/constants/firebase';
import type { KoordType, OnlineEvent } from '@/types';

type OnlineGrund = NonNullable<OnlineEvent['grund']>;

export async function logOnlineEvent(
  uid: string,
  istOnline: boolean,
  standort: KoordType | null,
  grund: OnlineGrund = 'manuell',
): Promise<void> {
  try {
    await addDoc(collection(db, 'fahrer', uid, 'online_events'), {
      timestamp: serverTimestamp(),
      istOnline,
      standort: standort ?? null,
      grund,
    });
  } catch (e) {
    console.log('logOnlineEvent Fehler (ignoriert):', e);
  }
}
