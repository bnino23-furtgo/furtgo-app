import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();

export { createAboPaymentPage, pfcWebhook, chargeMonthlySubscriptions, cancelAbo, reactivateAbo } from './pfcAbo';
export { createStripeAboSession, stripeWebhook, chargeStripeMonthlySubscriptions } from './stripeAbo';
export { pruefeUid } from './uidPruefung';
export { setAdminClaim } from './adminClaim';
export {
  sendeSupportMail,
  sendeVerifikationsMail,
  sendeAgbUpdateMail,
  sendeDokumenteEingereichtMail,
  sendeQuittungMail,
} from './mailVersand';

const REGION = 'europe-west6';

async function sendeFahrerPush(fahrerId: string, fahrtId: string, fahrtData: Record<string, unknown>): Promise<void> {
  const fahrerSnap = await getFirestore().collection('fahrer').doc(fahrerId).get();
  const fahrerData = fahrerSnap.data();
  if (!fahrerData?.online) {
    logger.info(`Fahrer ${fahrerId} ist offline — kein Push`);
    return;
  }
  const lastSeen = typeof fahrerData.lastSeen === 'number' ? fahrerData.lastSeen : 0;
  // 3min Toleranz: im Bubble-Modus drosselt Android JS, lastSeen-Updates fallen aus.
  // FCM-Push kommt durch Doze hindurch, also Fahrer kann trotzdem reagieren.
  if (Date.now() - lastSeen > 180000) {
    logger.info(`Fahrer ${fahrerId} lastSeen veraltet — kein Push`);
    return;
  }
  const pushToken = fahrerData.pushToken as string | undefined;
  if (!pushToken) {
    logger.warn(`Kein Push-Token fuer Fahrer ${fahrerId}`);
    return;
  }

  const ziel = (fahrtData.zielort as Record<string, unknown> | undefined)?.adresse;
  const zielText = typeof ziel === 'string' ? ziel : 'Unbekannt';

  const message = {
    to: pushToken,
    sound: 'default',
    priority: 'high',
    channelId: 'fahrtanfragen_v3',
    title: '🔔 Neue Fahrtanfrage!',
    body: `Ziel: ${zielText}`,
    data: { fahrtId },
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    const result = await response.json();
    logger.info(`Push an Fahrer ${fahrerId} fuer Fahrt ${fahrtId}:`, result);
  } catch (e) {
    logger.error(`Push-Fehler fuer Fahrer ${fahrerId}:`, e);
  }
}

export const onFahrtZugewiesen = onDocumentUpdated(
  { document: 'fahrten/{fahrtId}', region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const neuerFahrer = after.zugewiesenerFahrerId as string | undefined;
    const alterFahrer = before.zugewiesenerFahrerId as string | undefined;
    if (!neuerFahrer || neuerFahrer === alterFahrer) return;
    await sendeFahrerPush(neuerFahrer, event.params.fahrtId, after);
  }
);

export const onFahrtErstellt = onDocumentCreated(
  { document: 'fahrten/{fahrtId}', region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const fahrerId = data.zugewiesenerFahrerId as string | undefined;
    if (!fahrerId) return;
    await sendeFahrerPush(fahrerId, event.params.fahrtId, data);
  }
);

export const onFahrtenUpdate = onDocumentUpdated(
  { document: 'fahrten/{fahrtId}', region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const aenderungen = diffFields(before, after);
    if (Object.keys(aenderungen).length === 0) return;
    await getFirestore()
      .collection('fahrten').doc(event.params.fahrtId)
      .collection('changes').add({
        timestamp: FieldValue.serverTimestamp(),
        userId: (after.letzteAenderungVon as string) ?? 'system',
        aenderungen,
      });
  }
);

export const onSchichtenUpdate = onDocumentUpdated(
  { document: 'schichten/{schichtId}', region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const aenderungen = diffFields(before, after);
    if (Object.keys(aenderungen).length === 0) return;
    await getFirestore()
      .collection('schichten').doc(event.params.schichtId)
      .collection('changes').add({
        timestamp: FieldValue.serverTimestamp(),
        userId: (after.letzteAenderungVon as string) ?? 'system',
        aenderungen,
      });
  }
);

// ARV-2: protokolliert Online/Offline-Wechsel als Events fuer Arbeitszeit-Berechnung
export const onFahrerOnlineChange = onDocumentUpdated(
  { document: 'fahrer/{uid}', region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.online === after.online) return;
    const eintrag: Record<string, unknown> = {
      timestamp: FieldValue.serverTimestamp(),
      istOnline: !!after.online,
      grund: 'manuell',
    };
    const standort = after.standort as Record<string, unknown> | undefined;
    if (standort && typeof standort.latitude === 'number' && typeof standort.longitude === 'number') {
      eintrag.standort = { latitude: standort.latitude, longitude: standort.longitude };
    }
    await getFirestore()
      .collection('fahrer').doc(event.params.uid)
      .collection('online_events').add(eintrag);
  }
);

function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { alt: unknown; neu: unknown }> {
  const changes: Record<string, { alt: unknown; neu: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (!equal(before[k], after[k])) {
      changes[k] = { alt: before[k] ?? null, neu: after[k] ?? null };
    }
  }
  return changes;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
