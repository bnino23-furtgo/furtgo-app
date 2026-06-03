import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const REGION = 'europe-west6';

// Bootstrap fuer Storage-Sicherheit (#5): Storage-Rules koennen Firestore nicht lesen,
// darum laeuft der Admin-Lesezugriff auf ausweis/dokumente ueber den Custom Claim
// request.auth.token.admin. Diese Callable setzt den Claim anhand des bereits in
// Firestore gepflegten Flags nutzer/{uid}.istAdmin == true.
//
// Einmalig vom eingeloggten Admin aufrufen; danach Token erneuern (getIdToken(true))
// oder neu einloggen, damit der Claim im Token landet.
export const setAdminClaim = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

  const snap = await getFirestore().collection('nutzer').doc(uid).get();
  if (snap.data()?.istAdmin !== true) {
    throw new HttpsError('permission-denied', 'Kein Admin');
  }

  await getAuth().setCustomUserClaims(uid, { admin: true });
  return { ok: true };
});
