/**
 * ARV-2 Feature-Flag Setup
 *
 * Setzt config/features.arv2Enabled = true und fügt die übergebene UID
 * in arv2TestFahrerIds ein. Nutzt merge, andere Felder am Doc bleiben.
 *
 * Usage:
 *   node scripts/setup-arv2-flag.js show
 *   node scripts/setup-arv2-flag.js add <uid>
 *   node scripts/setup-arv2-flag.js remove <uid>
 *   node scripts/setup-arv2-flag.js disable
 */

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const serviceAccount = require(path.join(__dirname, '..', 'service-account.json', 'meine-uber-app-a57aa-firebase-adminsdk-fbsvc-c90062b960.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const ref = db.doc('config/features');

async function main() {
  const [mode, uid] = process.argv.slice(2);

  if (!mode || !['show', 'add', 'remove', 'disable'].includes(mode)) {
    console.error('Usage: node scripts/setup-arv2-flag.js <show|add|remove|disable> [uid]');
    process.exit(1);
  }

  const snapVor = await ref.get();
  const dataVor = snapVor.exists ? snapVor.data() : null;
  console.log('VORHER:', dataVor ? JSON.stringify(dataVor, null, 2) : '(Doc existiert nicht)');
  console.log('');

  if (mode === 'show') return;

  if (mode === 'disable') {
    await ref.set({ arv2Enabled: false }, { merge: true });
    console.log('arv2Enabled = false gesetzt.');
  } else {
    if (!uid) {
      console.error('uid erforderlich für add/remove');
      process.exit(1);
    }
    const aktuelleIds = Array.isArray(dataVor?.arv2TestFahrerIds) ? dataVor.arv2TestFahrerIds : [];
    let neueIds;
    if (mode === 'add') {
      neueIds = aktuelleIds.includes(uid) ? aktuelleIds : [...aktuelleIds, uid];
    } else {
      neueIds = aktuelleIds.filter((x) => x !== uid);
    }
    await ref.set(
      {
        arv2Enabled: true,
        arv2TestFahrerIds: neueIds,
        arv2Laender: Array.isArray(dataVor?.arv2Laender) ? dataVor.arv2Laender : ['CH'],
      },
      { merge: true }
    );
    console.log(`UID ${mode === 'add' ? 'hinzugefügt' : 'entfernt'}: ${uid}`);
  }

  const after = (await ref.get()).data();
  console.log('');
  console.log('NACHHER:', JSON.stringify(after, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FEHLER:', err);
    process.exit(1);
  });
