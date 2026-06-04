import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { getFirestore } from 'firebase-admin/firestore';

const REGION = 'europe-west6';
const SUPPORT_EMAIL = 'support.furtgo@gmail.com';

// === Server-seitiger Mail-Versand (Security-Befund #4) ===
// Die `mail`-Collection ist via Rules fuer Clients gesperrt (create: if false).
// Mails werden ausschliesslich ueber diese Callables eingereiht — Empfaenger und
// Inhalt werden server-seitig bestimmt, der Client kann keinen beliebigen
// Empfaenger mehr waehlen (verhindert Phishing/Spam ueber support.furtgo@gmail.com).
// Das Admin-SDK umgeht die Rules, der Versand laeuft danach wie bisher ueber die
// Trigger-Email-Extension.

const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Reiht eine Mail im Trigger-Email-Format (`to`, `replyTo?`, `message`) ein. */
async function mailEinreihen(mail: Record<string, unknown>): Promise<void> {
  await getFirestore().collection('mail').add(mail);
}

/** Admin = Custom Claim `admin:true` ODER Firestore-Flag `nutzer/{uid}.istAdmin`. */
async function istAdmin(uid: string, token: Record<string, unknown> | undefined): Promise<boolean> {
  if (token?.admin === true) return true;
  const snap = await getFirestore().collection('nutzer').doc(uid).get();
  return snap.data()?.istAdmin === true;
}

const rahmen = (inhalt: string): string =>
  `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">${inhalt}</div>`;

// --- 1. Support-Anfrage (jeder eingeloggte Nutzer) → an den Support ---------
export const sendeSupportMail = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

  const thema = String(request.data?.thema ?? '').trim();
  const nachricht = String(request.data?.nachricht ?? '').trim();
  if (!thema || !nachricht) throw new HttpsError('invalid-argument', 'Thema und Nachricht erforderlich');
  if (thema.length > 200 || nachricht.length > 5000) throw new HttpsError('invalid-argument', 'Eingabe zu lang');

  const n = (await getFirestore().collection('nutzer').doc(uid).get()).data() ?? {};
  const userEmail = (request.auth?.token?.email as string | undefined) ?? (n.email as string | undefined) ?? '';
  const fullName = `${n.vorname ?? ''} ${n.nachname ?? ''}`.trim();
  const rolleText = n.istFahrer === true || n.rolle === 'fahrer' ? 'Fahrer' : 'Fahrgast';

  await mailEinreihen({
    to: [SUPPORT_EMAIL],
    ...(userEmail ? { replyTo: userEmail } : {}),
    message: {
      subject: `Support-Anfrage (${rolleText}): ${thema}`,
      html: rahmen(`
        <h2 style="margin:0 0 4px;">Furtgo</h2>
        <p style="color:#666;margin:0 0 20px;font-size:13px;">Support-Anfrage</p>
        <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Name</td><td style="text-align:right;font-size:14px;">${escapeHtml(fullName || '(kein Name)')}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">E-Mail</td><td style="text-align:right;font-size:14px;">${escapeHtml(userEmail || '–')}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Rolle</td><td style="text-align:right;font-size:14px;">${rolleText}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">UID</td><td style="text-align:right;font-size:12px;color:#999;">${uid}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Thema</td><td style="text-align:right;font-size:14px;">${escapeHtml(thema)}</td></tr>
        </table>
        <h3 style="margin:0 0 8px;font-size:15px;">Nachricht</h3>
        <div style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:14px;white-space:pre-wrap;">${escapeHtml(nachricht)}</div>`),
    },
  });
  return { ok: true };
});

// --- 2. Verifikations-Entscheid (nur Admin) → an den Fahrer -----------------
export const sendeVerifikationsMail = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');
  if (!(await istAdmin(uid, request.auth?.token))) throw new HttpsError('permission-denied', 'Kein Admin');

  const fahrerId = String(request.data?.fahrerId ?? '').trim();
  const status = String(request.data?.status ?? '').trim();
  if (!fahrerId) throw new HttpsError('invalid-argument', 'fahrerId erforderlich');
  if (status !== 'genehmigt' && status !== 'abgelehnt') {
    throw new HttpsError('invalid-argument', 'status muss genehmigt oder abgelehnt sein');
  }

  const f = (await getFirestore().collection('fahrer').doc(fahrerId).get()).data();
  const email = (f?.fahrerEmail as string | undefined) ?? undefined;
  if (!email) return { ok: false, grund: 'Keine Fahrer-E-Mail hinterlegt' };
  const anrede = escapeHtml((f?.fahrerName as string | undefined) ?? (f?.name as string | undefined) ?? 'Fahrer');

  const istGenehmigt = status === 'genehmigt';
  const betreff = istGenehmigt
    ? 'Furtgo — Du bist freigeschaltet ✓'
    : 'Furtgo — Deine Dokumente wurden abgelehnt';
  const html = istGenehmigt
    ? rahmen(`
        <h2 style="margin:0 0 4px;">Furtgo</h2>
        <p style="color:#666;margin:0 0 20px;font-size:13px;">Verifikations-Bestätigung</p>
        <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
        <h3 style="margin:0 0 12px;color:#16a34a;">Willkommen an Bord, ${anrede}!</h3>
        <p style="font-size:14px;line-height:1.6;">Deine Dokumente wurden geprüft und freigegeben. Du kannst jetzt online gehen und Fahrten annehmen.</p>
        <p style="font-size:14px;line-height:1.6;"><b>Nächster Schritt:</b> Abo aktivieren (CHF 60/Monat), dann im Fahrer-Dashboard den Online-Schalter umlegen.</p>
        <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
        <p style="color:#666;font-size:12px;text-align:center;">Bei Fragen: support.furtgo@gmail.com</p>`)
    : rahmen(`
        <h2 style="margin:0 0 4px;">Furtgo</h2>
        <p style="color:#666;margin:0 0 20px;font-size:13px;">Dokumenten-Prüfung</p>
        <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
        <h3 style="margin:0 0 12px;color:#dc2626;">Hallo ${anrede},</h3>
        <p style="font-size:14px;line-height:1.6;">Leider konnten wir deine eingereichten Dokumente nicht freigeben.</p>
        <p style="font-size:14px;line-height:1.6;">Du kannst die Unterlagen jederzeit neu einreichen. Öffne dazu die Furtgo-App → Profil → Verifikation.</p>
        <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
        <p style="color:#666;font-size:12px;text-align:center;">Bei Fragen: support.furtgo@gmail.com</p>`);

  await mailEinreihen({ to: [email], message: { subject: betreff, html } });
  return { ok: true };
});

// --- 3. AGB-Update-Massenmail (nur Admin) → an alle Nutzer ------------------
export const sendeAgbUpdateMail = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');
  if (!(await istAdmin(uid, request.auth?.token))) throw new HttpsError('permission-denied', 'Kein Admin');

  const db = getFirestore();
  const snap = await db.collection('nutzer').get();
  const empfaenger = snap.docs
    .map((d) => d.data())
    .filter((n) => typeof n.email === 'string' && n.email);

  let erfolg = 0;
  // Firestore-Batch: max. 500 Schreibvorgaenge pro Batch.
  for (let i = 0; i < empfaenger.length; i += 450) {
    const batch = db.batch();
    for (const n of empfaenger.slice(i, i + 450)) {
      const name = escapeHtml(`${n.vorname ?? ''} ${n.nachname ?? ''}`.trim() || 'Furtgo-Nutzer');
      const html = rahmen(`
        <h2 style="margin:0 0 4px;font-size:20px;">Furtgo</h2>
        <p style="color:#666;margin:0 0 20px;font-size:11px;">Wichtige Information</p>
        <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
        <p style="font-size:13px;line-height:1.6;">Hallo ${name},</p>
        <p style="font-size:13px;line-height:1.6;">
          wir haben unsere <strong>Allgemeinen Geschäftsbedingungen</strong> und die
          <strong>Datenschutzerklärung</strong> aktualisiert (Stand 30. Mai 2026).
        </p>
        <p style="font-size:13px;line-height:1.6;">Die wichtigste Änderung:</p>
        <ul style="font-size:13px;line-height:1.6;">
          <li>Die Zahlungsabwicklung für das Fahrer-Abonnement erfolgt neu über <strong>Stripe</strong> statt über PostFinance Checkout. Für dich ändert sich am Ablauf nichts &ndash; das Abo kostet weiterhin CHF 60 pro Monat und kann jederzeit in der App gekündigt werden.</li>
        </ul>
        <p style="text-align:center;margin:24px 0;">
          <a href="https://furtgo.ch/legal.html" style="background:#FFD700;color:#000;padding:11px 26px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;font-size:14px;">Legal-Seite öffnen</a>
        </p>
        <p style="font-size:12px;color:#666;line-height:1.6;">
          Wenn du Furtgo weiter nutzt, gelten die neuen AGB als angenommen. Bei Fragen melde dich gerne bei
          <a href="mailto:support.furtgo@gmail.com">support.furtgo@gmail.com</a>.
        </p>
        <p style="font-size:13px;line-height:1.6;margin-top:20px;">
          Bis bald auf der Strasse,<br>
          Dein Furtgo-Team
        </p>`);
      batch.set(db.collection('mail').doc(), {
        to: [n.email],
        message: { subject: 'Furtgo: AGB und Datenschutz aktualisiert', html },
      });
      erfolg++;
    }
    await batch.commit();
  }

  logger.info(`AGB-Update-Mail: ${erfolg} Mails eingereiht`);
  return { ok: true, erfolg };
});

// --- 4. Dokumente eingereicht (eingeloggter Fahrer) → an den Support --------
export const sendeDokumenteEingereichtMail = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

  // Liest das soeben vom Client geschriebene Fahrer-Dokument — der Server
  // vertraut nur diesen persistierten Daten, nicht dem Callable-Payload.
  const f = (await getFirestore().collection('fahrer').doc(uid).get()).data();
  if (!f) throw new HttpsError('failed-precondition', 'Kein Fahrer-Dokument gefunden');
  const d = (f.dokumente as Record<string, unknown> | undefined) ?? {};
  const v = (f.fahrzeug as Record<string, unknown> | undefined) ?? {};

  const name = escapeHtml((f.fahrerName as string | undefined) ?? 'Fahrer');
  const eingereichtAm = typeof d.eingereichtAm === 'number'
    ? new Date(d.eingereichtAm).toLocaleString('de-CH')
    : new Date().toLocaleString('de-CH');

  await mailEinreihen({
    to: [SUPPORT_EMAIL],
    message: {
      subject: `Neue Dokumente eingereicht — ${name}`,
      html: rahmen(`
        <h2 style="margin:0 0 4px;">Furtgo</h2>
        <p style="color:#666;margin:0 0 20px;font-size:13px;">Admin-Benachrichtigung</p>
        <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
        <h3 style="margin:0 0 12px;">Neue Dokumente eingereicht</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Fahrer</td><td style="text-align:right;font-size:14px;">${name}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">E-Mail</td><td style="text-align:right;font-size:14px;">${escapeHtml((f.fahrerEmail as string) ?? '–')}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">UID-Nummer</td><td style="text-align:right;font-size:14px;">${escapeHtml((d.uidNummer as string) ?? '–')}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Firma (UID-Register)</td><td style="text-align:right;font-size:14px;">${escapeHtml((d.firmenName as string) ?? '–')}${d.uidAktiv ? ' ✓ aktiv' : ' (nicht aktiv)'}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Fahrzeug</td><td style="text-align:right;font-size:14px;">${escapeHtml((v.marke as string) ?? '–')} (${escapeHtml((v.jahrgang as string) ?? '–')}, ${escapeHtml((v.farbe as string) ?? '–')})</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Schildnummer</td><td style="text-align:right;font-size:14px;">${escapeHtml((v.schildnummer as string) ?? '–')}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Strafregister sauber</td><td style="text-align:right;font-size:14px;">${d.strafregisterSauber ? 'Ja' : 'Nein (Einträge vorhanden)'}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#333;">Eingereicht am</td><td style="text-align:right;font-size:14px;">${eingereichtAm}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
        <p style="color:#666;font-size:13px;text-align:center;">Bitte im Admin-Panel prüfen und freigeben oder ablehnen.</p>`),
    },
  });
  return { ok: true };
});

// --- 5. Fahrt-Quittung (zugewiesener Fahrer) → an den Fahrgast --------------
export const sendeQuittungMail = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

  const fahrtId = String(request.data?.fahrtId ?? '').trim();
  if (!fahrtId) throw new HttpsError('invalid-argument', 'fahrtId erforderlich');

  const fahrt = (await getFirestore().collection('fahrten').doc(fahrtId).get()).data();
  if (!fahrt) throw new HttpsError('not-found', 'Fahrt nicht gefunden');
  // Nur der an dieser Fahrt beteiligte Fahrer darf die Quittung ausloesen.
  if (fahrt.zugewiesenerFahrerId !== uid && fahrt.fahrerId !== uid) {
    throw new HttpsError('permission-denied', 'Du bist nicht der Fahrer dieser Fahrt');
  }

  const fahrgastEmail = fahrt.fahrgastEmail as string | undefined;
  if (!fahrgastEmail) return { ok: false, grund: 'Fahrgast hat keine E-Mail' };

  const fahrerNachname = escapeHtml(
    ((await getFirestore().collection('nutzer').doc(uid).get()).data()?.nachname as string | undefined) ?? 'Fahrer'
  );
  const preis = typeof fahrt.preis === 'number' ? fahrt.preis : 0;
  const abholort = (fahrt.abholort as Record<string, unknown> | undefined)?.adresse;
  const zielort = (fahrt.zielort as Record<string, unknown> | undefined)?.adresse;
  const datumText = new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  await mailEinreihen({
    to: [fahrgastEmail],
    message: {
      subject: `Ihre Furtgo Quittung — CHF ${preis.toFixed(2)}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
          <h2 style="text-align:center;margin:0 0 4px;">Furtgo</h2>
          <p style="text-align:center;color:#666;margin:0 0 20px;font-size:13px;">Fahrtenquittung</p>
          <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Datum</td><td style="text-align:right;font-size:14px;">${datumText}</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Von</td><td style="text-align:right;font-size:14px;">${escapeHtml(abholort ?? '–')}</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Nach</td><td style="text-align:right;font-size:14px;">${escapeHtml(zielort ?? '–')}</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Fahrer</td><td style="text-align:right;font-size:14px;">${fahrerNachname}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:18px;font-weight:bold;">Gesamtbetrag</td><td style="text-align:right;font-size:18px;font-weight:bold;">CHF ${preis.toFixed(2)}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
          <p style="color:#999;font-size:11px;">Fahrt-ID: ${escapeHtml(fahrtId)}</p>
          <p style="color:#666;font-size:12px;text-align:center;margin-top:16px;">Vielen Dank für Ihre Fahrt mit Furtgo.<br>Bei Fragen: support.furtgo@gmail.com</p>
        </div>`,
    },
  });
  return { ok: true };
});
