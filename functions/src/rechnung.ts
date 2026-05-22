import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';

export const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');

const ABSENDER_EMAIL = 'support.furtgo@gmail.com';
const STORAGE_BUCKET = 'meine-uber-app-a57aa.firebasestorage.app';
const FIRMA = {
  name: 'Bajic Mobility Solutions',
  marke: 'Furtgo',
  telefon: '078 315 75 16',
  email: 'support.furtgo@gmail.com',
  uid: 'CHE-133.189.152',
  website: 'furtgo.ch',
};

interface FahrerInfo {
  name?: string;
  email?: string;
  adresse?: string;
  plz?: string;
  ort?: string;
}

async function nextRechnungsNr(): Promise<string> {
  const jahr = new Date().getFullYear();
  const counterRef = getFirestore().collection('meta').doc(`rechnungs_counter_${jahr}`);
  const neueNr = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const aktuell = (snap.data()?.counter as number | undefined) ?? 0;
    const neu = aktuell + 1;
    tx.set(counterRef, { counter: neu, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return neu;
  });
  return `FRT-${jahr}-${String(neueNr).padStart(4, '0')}`;
}

function formatChf(betrag: number): string {
  return betrag.toFixed(2).replace('.', '.');
}

function generateRechnungPDF(params: {
  rechnungsNr: string;
  datum: Date;
  periode: string;
  fahrer: FahrerInfo;
  betrag: number;
  pfcTxId: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(10).fillColor('#666').text(FIRMA.name, 50, 50);
    doc.text(FIRMA.marke);
    doc.text(`Tel. ${FIRMA.telefon}`);
    doc.text(FIRMA.email);
    doc.text(FIRMA.website);
    doc.text(FIRMA.uid);

    doc.fontSize(20).fillColor('#000').text('Rechnung', 50, 50, { align: 'right' });
    doc.fontSize(10).fillColor('#666');
    doc.text(`Nr. ${params.rechnungsNr}`, { align: 'right' });
    doc.text(`Datum: ${params.datum.toLocaleDateString('de-CH')}`, { align: 'right' });

    doc.moveDown(4);
    doc.fillColor('#000').fontSize(11).text('Rechnungsempfänger:');
    doc.fontSize(10).fillColor('#333');
    if (params.fahrer.name) doc.text(params.fahrer.name);
    if (params.fahrer.adresse) doc.text(params.fahrer.adresse);
    if (params.fahrer.plz || params.fahrer.ort) doc.text(`${params.fahrer.plz ?? ''} ${params.fahrer.ort ?? ''}`.trim());
    if (params.fahrer.email) doc.text(params.fahrer.email);

    doc.moveDown(2);
    doc.fillColor('#000').fontSize(11).text(`Leistungsperiode: ${params.periode}`);
    doc.moveDown(1);

    const tableTop = doc.y;
    doc.fontSize(10).fillColor('#000');
    doc.text('Beschreibung', 50, tableTop);
    doc.text('Betrag', 450, tableTop, { width: 100, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

    const rowY = tableTop + 25;
    doc.fillColor('#333');
    doc.text('Furtgo Fahrer-Abo (1 Monat)', 50, rowY);
    doc.text(`CHF ${formatChf(params.betrag)}`, 450, rowY, { width: 100, align: 'right' });

    doc.moveTo(50, rowY + 25).lineTo(550, rowY + 25).strokeColor('#ccc').stroke();
    doc.fillColor('#000').fontSize(11);
    doc.text('Total', 50, rowY + 35);
    doc.text(`CHF ${formatChf(params.betrag)}`, 450, rowY + 35, { width: 100, align: 'right' });

    const footerStartY = rowY + 80;
    const FULL_WIDTH = 500;
    doc.fontSize(9).fillColor('#666');
    doc.text('Nicht MwSt-pflichtig — keine MwSt ausgewiesen (Art. 10 Abs. 2 MWSTG).', 50, footerStartY, { width: FULL_WIDTH });
    doc.text(`Bereits bezahlt via PostFinance Checkout (Transaktion #${params.pfcTxId}).`, 50, footerStartY + 18, { width: FULL_WIDTH });
    doc.text('Vielen Dank für deine Treue. Bei Fragen erreichst du uns unter support.furtgo@gmail.com.', 50, footerStartY + 36, { width: FULL_WIDTH });

    doc.end();
  });
}

async function sendRechnungEmail(params: {
  toEmail: string;
  toName: string;
  rechnungsNr: string;
  pdfBuffer: Buffer;
  gmailPassword: string;
}): Promise<void> {
  const cleanPass = params.gmailPassword.replace(/\s/g, '');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: ABSENDER_EMAIL,
      pass: cleanPass,
    },
  });

  await transporter.sendMail({
    from: `"Furtgo" <${ABSENDER_EMAIL}>`,
    to: params.toEmail,
    subject: `Furtgo Rechnung ${params.rechnungsNr}`,
    text: `Hallo ${params.toName},\n\nim Anhang findest du deine Rechnung ${params.rechnungsNr} für dein Furtgo Fahrer-Abo.\n\nDie Zahlung ist bereits via PostFinance Checkout verbucht.\n\nGute Fahrt!\nFurtgo`,
    attachments: [
      {
        filename: `${params.rechnungsNr}.pdf`,
        content: params.pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

export async function createRechnung(params: {
  fahrerUid: string;
  pfcTxId: number;
  betrag: number;
  gmailPassword: string;
}): Promise<void> {
  const existing = await getFirestore()
    .collection('fahrer').doc(params.fahrerUid)
    .collection('rechnungen')
    .where('pfcTxId', '==', params.pfcTxId)
    .limit(1)
    .get();
  if (!existing.empty) {
    const existingNr = existing.docs[0].id;
    logger.info(`createRechnung: Rechnung ${existingNr} fuer pfcTxId=${params.pfcTxId} existiert bereits — uebersprungen`);
    return;
  }

  const fahrerSnap = await getFirestore().collection('fahrer').doc(params.fahrerUid).get();
  const fahrerData = fahrerSnap.data();
  if (!fahrerData) {
    logger.warn(`createRechnung: Fahrer ${params.fahrerUid} nicht gefunden`);
    return;
  }

  let email: string | null = null;
  let authDisplayName: string | null = null;
  try {
    const user = await getAuth().getUser(params.fahrerUid);
    email = user.email ?? null;
    authDisplayName = user.displayName ?? null;
  } catch (e) {
    logger.warn(`createRechnung: Auth-Lookup fehlgeschlagen fuer ${params.fahrerUid}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!email) {
    logger.warn(`createRechnung: Keine E-Mail fuer Fahrer ${params.fahrerUid} — Rechnung wird nur in Firestore gespeichert`);
  }

  const vorname = (fahrerData.name as string | undefined) ?? '';
  const nachname = (fahrerData.nachname as string | undefined) ?? '';
  const vollerName = `${vorname} ${nachname}`.trim() || authDisplayName || 'Fahrer';

  const rechnungsNr = await nextRechnungsNr();
  const datum = new Date();
  const periodeStart = datum;
  const periodeEnde = new Date(datum.getTime() + 30 * 86400 * 1000);
  const periode = `${periodeStart.toLocaleDateString('de-CH')} – ${periodeEnde.toLocaleDateString('de-CH')}`;

  const fahrerInfo: FahrerInfo = {
    name: vollerName,
    email: email ?? undefined,
    adresse: fahrerData.adresse as string | undefined,
    plz: fahrerData.plz as string | undefined,
    ort: fahrerData.ort as string | undefined,
  };

  const pdfBuffer = await generateRechnungPDF({
    rechnungsNr,
    datum,
    periode,
    fahrer: fahrerInfo,
    betrag: params.betrag,
    pfcTxId: params.pfcTxId,
  });

  const storagePath = `rechnungen/${params.fahrerUid}/${rechnungsNr}.pdf`;
  let downloadUrl: string | null = null;
  try {
    const { randomUUID } = await import('node:crypto');
    const downloadToken = randomUUID();
    await getStorage().bucket(STORAGE_BUCKET).file(storagePath).save(pdfBuffer, {
      contentType: 'application/pdf',
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          fahrerUid: params.fahrerUid,
          rechnungsNr,
          pfcTxId: String(params.pfcTxId),
        },
      },
    });
    downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
    logger.info(`Rechnung ${rechnungsNr} in Storage gespeichert: ${storagePath}`);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error(`Storage-Upload fehlgeschlagen fuer Rechnung ${rechnungsNr}: ${errMsg}`);
  }

  await getFirestore()
    .collection('fahrer').doc(params.fahrerUid)
    .collection('rechnungen').doc(rechnungsNr)
    .set({
      rechnungsNr,
      datum: FieldValue.serverTimestamp(),
      periode,
      betrag: params.betrag,
      pfcTxId: params.pfcTxId,
      email: email ?? null,
      pdfSize: pdfBuffer.length,
      storagePath,
      downloadUrl,
    });

  if (email) {
    try {
      await sendRechnungEmail({
        toEmail: email,
        toName: fahrerInfo.name ?? 'Fahrer',
        rechnungsNr,
        pdfBuffer,
        gmailPassword: params.gmailPassword,
      });
      logger.info(`Rechnung ${rechnungsNr} per E-Mail an ${email} gesendet`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(`E-Mail-Versand fehlgeschlagen fuer Rechnung ${rechnungsNr}: ${errMsg}`);
    }
  } else {
    logger.info(`Rechnung ${rechnungsNr} ohne E-Mail-Versand erstellt (keine Fahrer-Mail)`);
  }
}
