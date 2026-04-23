import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();

const REGION = 'europe-west6';

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
