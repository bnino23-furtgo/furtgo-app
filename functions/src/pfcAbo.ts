import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createRechnung, GMAIL_APP_PASSWORD } from './rechnung';

const PFC_AUTH_KEY = defineSecret('PFC_AUTH_KEY');
const PFC_SPACE_ID = 95927;
const PFC_USER_ID = 170065;
const REGION = 'europe-west6';

const ABO_PRICE_CHF = 60.0;
const ABO_INTERVAL_DAYS = 30;
const ABO_CURRENCY = 'CHF';
const ABO_RETRY_MAX = 3;
const ABO_RETRY_DELAY_DAYS = 2;

const PFC_API_HOST = 'https://checkout.postfinance.ch';
const PFC_API_PREFIX = '/api';
const PFC_API_V2_PREFIX = '/api/v2.0';

interface PfcTransaction {
  id: number;
  state: string;
  token?: { id: number };
  customerId?: string;
  metaData?: Record<string, string>;
}

const webhookPublicKeyCache = new Map<string, string>();

async function sendAboPush(uid: string, title: string, body: string): Promise<void> {
  const snap = await getFirestore().collection('fahrer').doc(uid).get();
  const pushToken = snap.data()?.pushToken as string | undefined;
  if (!pushToken) {
    logger.info(`Kein Push-Token fuer Fahrer ${uid} — Push ausgelassen`);
    return;
  }

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        priority: 'high',
        channelId: 'abo',
        title,
        body,
        data: { typ: 'abo' },
      }),
    });
    const result = await res.json();
    logger.info(`Abo-Push an Fahrer ${uid}:`, result);
  } catch (e) {
    logger.error(`Abo-Push Fehler fuer Fahrer ${uid}:`, e);
  }
}

async function handleRecurringFailure(uid: string, reason: string, txId?: number): Promise<void> {
  const fahrerRef = getFirestore().collection('fahrer').doc(uid);
  const snap = await fahrerRef.get();
  const aboData = snap.data()?.abo as { retryCount?: number; lastFailedTxId?: number } | undefined;

  if (txId && aboData?.lastFailedTxId === txId) {
    logger.info(`handleRecurringFailure: tx ${txId} fuer Fahrer ${uid} bereits verarbeitet — uebersprungen`);
    return;
  }

  const currentRetry = aboData?.retryCount ?? 0;
  const nextRetry = currentRetry + 1;

  if (nextRetry > ABO_RETRY_MAX) {
    await fahrerRef.set(
      {
        abo: {
          status: 'fehlgeschlagen',
          retryCount: 0,
          ...(txId ? { lastFailedTxId: txId } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    logger.warn(`Abo deaktiviert fuer Fahrer ${uid} nach ${ABO_RETRY_MAX} fehlgeschlagenen Versuchen — Grund: ${reason}`);
    await sendAboPush(
      uid,
      'Furtgo-Abo deaktiviert',
      `Nach ${ABO_RETRY_MAX} erfolglosen Zahlungsversuchen wurde dein Abo deaktiviert. Bitte erneut starten.`,
    );
    return;
  }

  const nextChargeAt = Timestamp.fromMillis(Date.now() + ABO_RETRY_DELAY_DAYS * 86400 * 1000);
  await fahrerRef.set(
    {
      abo: {
        status: 'aktiv',
        retryCount: nextRetry,
        nextChargeAt,
        lastRetryReason: reason,
        ...(txId ? { lastFailedTxId: txId } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
  logger.warn(`Abo-Belastung Versuch ${nextRetry}/${ABO_RETRY_MAX} fuer Fahrer ${uid}, naechster Versuch ${nextChargeAt.toDate().toISOString()} — Grund: ${reason}`);
  await sendAboPush(
    uid,
    'Zahlung fehlgeschlagen',
    `Versuch ${nextRetry}/${ABO_RETRY_MAX}. Neuer Versuch in ${ABO_RETRY_DELAY_DAYS} Tagen. Bitte Karte/Konto prüfen.`,
  );
}

async function pfcSign(method: string, fullPath: string, authKey: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const version = '1';
  const message = `${version}|${PFC_USER_ID}|${timestamp}|${method}|${fullPath}`;

  const keyBuf = Buffer.from(authKey, 'base64');
  const { createHmac } = await import('node:crypto');
  const mac = createHmac('sha512', keyBuf).update(message).digest('base64');

  return {
    'x-mac-version': version,
    'x-mac-userid': String(PFC_USER_ID),
    'x-mac-timestamp': timestamp,
    'x-mac-value': mac,
    'Content-Type': 'application/json;charset=utf-8',
    Accept: 'application/json',
  };
}

async function pfcJwtBearer(method: string, path: string, query: string, authKey: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const requestPath = `${PFC_API_V2_PREFIX}${path}${query ? `?${query}` : ''}`;

  const header = { alg: 'HS256', typ: 'JWT', ver: 1 };
  const payload = {
    sub: String(PFC_USER_ID),
    iat: issuedAt,
    requestPath,
    requestMethod: method,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyBuf = Buffer.from(authKey, 'base64');
  const { createHmac } = await import('node:crypto');
  const sig = createHmac('sha256', keyBuf).update(signingInput).digest('base64url');

  return `${signingInput}.${sig}`;
}

async function pfcRequestV2<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body: unknown,
  authKey: string,
  responseType: 'json' | 'text' = 'text',
): Promise<T> {
  const token = await pfcJwtBearer(method, endpoint, '', authKey);
  const url = `${PFC_API_HOST}${PFC_API_V2_PREFIX}${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: '*/*',
  };
  if (body) {
    headers['Content-Type'] = 'application/json;charset=utf-8';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PFC v2 ${method} ${endpoint} failed: ${res.status} ${text}`);
  }
  if (responseType === 'text') {
    return (await res.text()) as unknown as T;
  }
  return (await res.json()) as T;
}

async function fetchWebhookPublicKey(keyId: string, authKey: string): Promise<string> {
  const cached = webhookPublicKeyCache.get(keyId);
  if (cached) return cached;

  const raw = await pfcRequestV2<string>(
    'GET',
    `/webhooks/encryption-keys/${encodeURIComponent(keyId)}`,
    null,
    authKey,
    'text',
  );

  let pubKeyBase64: string;
  try {
    const parsed = JSON.parse(raw);
    pubKeyBase64 = parsed.publicKey ?? parsed.key ?? '';
    if (!pubKeyBase64) throw new Error('No publicKey field in response');
  } catch {
    pubKeyBase64 = raw;
  }

  pubKeyBase64 = pubKeyBase64
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');

  const pem = `-----BEGIN PUBLIC KEY-----\n${pubKeyBase64}\n-----END PUBLIC KEY-----\n`;
  webhookPublicKeyCache.set(keyId, pem);
  return pem;
}

function parseSignatureHeader(headerValue: string): { algorithm: string; keyId: string; signature: string } | null {
  const parts: Record<string, string> = {};
  for (const segment of headerValue.split(',')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    const key = segment.slice(0, idx).trim();
    const val = segment.slice(idx + 1).trim();
    parts[key] = val;
  }
  if (!parts.algorithm || !parts.keyId || !parts.signature) return null;
  return parts as { algorithm: string; keyId: string; signature: string };
}

async function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, authKey: string): Promise<boolean> {
  const parts = parseSignatureHeader(signatureHeader);
  if (!parts) {
    logger.warn('x-signature Header konnte nicht geparsed werden', { signatureHeader });
    return false;
  }
  if (parts.algorithm !== 'SHA256withECDSA') {
    logger.warn(`Unbekannter Signatur-Algorithmus: ${parts.algorithm}`);
    return false;
  }

  const pem = await fetchWebhookPublicKey(parts.keyId, authKey);
  const sigBuf = Buffer.from(parts.signature, 'base64');

  const { verify } = await import('node:crypto');
  return verify('sha256', rawBody, { key: pem, dsaEncoding: 'der' }, sigBuf);
}

async function pfcRequest<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body: unknown,
  authKey: string,
  responseType: 'json' | 'text' = 'json',
): Promise<T> {
  const fullPath = `${PFC_API_PREFIX}${endpoint}`;
  const headers = await pfcSign(method, fullPath, authKey);
  const url = `${PFC_API_HOST}${fullPath}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PFC ${method} ${endpoint} failed: ${res.status} ${text}`);
  }
  if (responseType === 'text') {
    return (await res.text()) as unknown as T;
  }
  return (await res.json()) as T;
}

export const createAboPaymentPage = onCall(
  { region: REGION, secrets: [PFC_AUTH_KEY] },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

    const authKey = PFC_AUTH_KEY.value();

    const transactionBody = {
      currency: ABO_CURRENCY,
      customerId: uid,
      tokenizationMode: 'FORCE_CREATION_WITH_ONE_CLICK_PAYMENT',
      autoConfirmationEnabled: true,
      successUrl: 'https://furtgo.ch/abo-erfolgreich.html',
      failedUrl: 'https://furtgo.ch/abo-fehlgeschlagen.html',
      lineItems: [
        {
          uniqueId: 'furtgo-abo',
          name: 'Furtgo Fahrer-Abo (1 Monat)',
          quantity: 1,
          amountIncludingTax: ABO_PRICE_CHF,
          type: 'PRODUCT',
        },
      ],
      metaData: {
        fahrer_uid: uid,
        typ: 'erstregistrierung',
      },
    };

    const tx = await pfcRequest<PfcTransaction>(
      'POST',
      `/transaction/create?spaceId=${PFC_SPACE_ID}`,
      transactionBody,
      authKey,
    );

    const pageUrl = await pfcRequest<string>(
      'GET',
      `/transaction-payment-page/payment-page-url?spaceId=${PFC_SPACE_ID}&id=${tx.id}`,
      null,
      authKey,
      'text',
    );

    await getFirestore().collection('fahrer').doc(uid).set(
      {
        abo: {
          pendingTransactionId: tx.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );

    logger.info(`Payment Page erstellt fuer Fahrer ${uid}: tx=${tx.id}`);
    return { paymentUrl: pageUrl, transactionId: tx.id };
  },
);

export const pfcWebhook = onRequest(
  { region: REGION, secrets: [PFC_AUTH_KEY, GMAIL_APP_PASSWORD], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const authKey = PFC_AUTH_KEY.value();

    const signatureHeader = req.header('x-signature');
    if (!signatureHeader) {
      logger.warn('Webhook ohne x-signature Header — Listener nicht auf v2?');
      res.status(401).send('Missing signature');
      return;
    }

    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody || rawBody.length === 0) {
      logger.error('Webhook ohne rawBody — Konfiguration prüfen');
      res.status(400).send('Missing raw body');
      return;
    }

    let signatureValid = false;
    try {
      signatureValid = await verifyWebhookSignature(rawBody, signatureHeader, authKey);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(`Signaturprüfung fehlgeschlagen: ${errMsg}`);
    }

    if (!signatureValid) {
      logger.warn('Ungültige Webhook-Signatur — Anfrage abgewiesen', { signatureHeader });
      res.status(401).send('Invalid signature');
      return;
    }

    const event = req.body as { entityId?: number; listenerEntityTechnicalName?: string; state?: string };
    const txId = event.entityId;
    if (!txId) {
      logger.warn('Webhook ohne entityId', { body: req.body });
      res.status(400).send('Missing entityId');
      return;
    }

    logger.info('PFC Webhook empfangen (Signatur OK)', event);
    const tx = await pfcRequest<PfcTransaction>(
      'GET',
      `/transaction/read?spaceId=${PFC_SPACE_ID}&id=${txId}`,
      null,
      authKey,
    );

    const eventId = `${txId}_${tx.state}`;
    const eventRef = getFirestore().collection('webhook_events').doc(eventId);
    try {
      await eventRef.create({
        txId,
        state: tx.state,
        receivedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      const code = (e as { code?: number | string }).code;
      if (code === 6 || code === 'already-exists') {
        logger.info(`Webhook event ${eventId} bereits verarbeitet — ignoriere Retry`);
        res.status(200).send('Already processed');
        return;
      }
      throw e;
    }

    const fahrerUid = tx.metaData?.fahrer_uid ?? tx.customerId;
    if (!fahrerUid) {
      logger.warn(`Keine fahrer_uid in Transaktion ${txId}`);
      res.status(200).send('No fahrer_uid');
      return;
    }

    const fahrerRef = getFirestore().collection('fahrer').doc(fahrerUid);

    if (tx.state === 'FULFILL') {
      const tokenId = tx.token?.id ?? null;
      const nextChargeAt = Timestamp.fromMillis(Date.now() + ABO_INTERVAL_DAYS * 86400 * 1000);
      await fahrerRef.set(
        {
          abo: {
            status: 'aktiv',
            pfcTokenId: tokenId,
            lastChargeId: txId,
            lastChargeAt: FieldValue.serverTimestamp(),
            nextChargeAt,
            retryCount: 0,
            lastRetryReason: FieldValue.delete(),
            pendingTransactionId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
      logger.info(`Abo aktiviert fuer Fahrer ${fahrerUid}, naechste Belastung ${nextChargeAt.toDate().toISOString()}`);

      try {
        await createRechnung({
          fahrerUid,
          paymentRef: String(txId),
          zahlungsArt: 'PostFinance Checkout',
          betrag: ABO_PRICE_CHF,
          gmailPassword: GMAIL_APP_PASSWORD.value(),
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`Rechnungs-Erstellung fehlgeschlagen fuer Fahrer ${fahrerUid}: ${errMsg}`);
      }
    } else if (tx.state === 'FAILED' || tx.state === 'DECLINE') {
      const isRecurring = tx.metaData?.typ === 'recurring';
      if (isRecurring) {
        await handleRecurringFailure(fahrerUid, `tx ${txId} state ${tx.state}`, txId);
      } else {
        await fahrerRef.set(
          {
            abo: {
              status: 'fehlgeschlagen',
              lastFailedTxId: txId,
              updatedAt: FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        );
        logger.warn(`Erstregistrierung fehlgeschlagen fuer Fahrer ${fahrerUid}, tx=${txId}`);
      }
    } else {
      logger.info(`Tx ${txId} im Zustand ${tx.state} — ignoriere`);
    }

    res.status(200).send('OK');
  },
);

export const chargeMonthlySubscriptions = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Europe/Zurich',
    region: REGION,
    secrets: [PFC_AUTH_KEY],
  },
  async () => {
    const now = Timestamp.now();
    const due = await getFirestore()
      .collection('fahrer')
      .where('abo.status', '==', 'aktiv')
      .where('abo.nextChargeAt', '<=', now)
      .get();

    logger.info(`Faellige Abos: ${due.size}`);
    if (due.empty) return;

    const authKey = PFC_AUTH_KEY.value();

    for (const doc of due.docs) {
      const uid = doc.id;
      const aboData = doc.data().abo as { pfcTokenId?: number; provider?: string } | undefined;
      if (aboData?.provider === 'stripe') {
        logger.info(`Fahrer ${uid} läuft auf Stripe — PFC-Cron überspringt`);
        continue;
      }
      const tokenId = aboData?.pfcTokenId;
      if (!tokenId) {
        logger.warn(`Fahrer ${uid} hat keinen pfcTokenId — ueberspringe`);
        continue;
      }

      const softLockUntil = Timestamp.fromMillis(Date.now() + 86400 * 1000);
      await getFirestore().collection('fahrer').doc(uid).set(
        {
          abo: {
            nextChargeAt: softLockUntil,
            lastChargeAttemptAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );

      try {
        const tx = await pfcRequest<PfcTransaction>(
          'POST',
          `/transaction/create?spaceId=${PFC_SPACE_ID}`,
          {
            currency: ABO_CURRENCY,
            customerId: uid,
            token: { id: tokenId },
            autoConfirmationEnabled: true,
            lineItems: [
              {
                uniqueId: 'furtgo-abo',
                name: 'Furtgo Fahrer-Abo (1 Monat)',
                quantity: 1,
                amountIncludingTax: ABO_PRICE_CHF,
                type: 'PRODUCT',
              },
            ],
            metaData: { fahrer_uid: uid, typ: 'recurring' },
          },
          authKey,
        );

        await pfcRequest(
          'POST',
          `/transaction/processWithoutUserInteraction?spaceId=${PFC_SPACE_ID}&id=${tx.id}`,
          null,
          authKey,
        );

        logger.info(`Recurring-Charge erstellt fuer Fahrer ${uid}, tx=${tx.id}`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`Recurring-Charge fehlgeschlagen fuer Fahrer ${uid}: ${errMsg}`);
        await handleRecurringFailure(uid, `cron exception: ${errMsg}`);
      }
    }
  },
);

export const cancelAbo = onCall(
  { region: REGION },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

    const fahrerRef = getFirestore().collection('fahrer').doc(uid);
    const snap = await fahrerRef.get();
    const aboData = snap.data()?.abo as { status?: string; nextChargeAt?: Timestamp } | undefined;

    if (!aboData || aboData.status !== 'aktiv') {
      throw new HttpsError('failed-precondition', 'Kein aktives Abo zum Kündigen');
    }

    await fahrerRef.set(
      {
        abo: {
          status: 'gekuendigt',
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );

    logger.info(`Abo gekuendigt fuer Fahrer ${uid}, Zugang bis ${aboData.nextChargeAt?.toDate().toISOString()}`);
    return { success: true, accessUntil: aboData.nextChargeAt?.toMillis() ?? null };
  },
);

export const reactivateAbo = onCall(
  { region: REGION },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

    const fahrerRef = getFirestore().collection('fahrer').doc(uid);
    const snap = await fahrerRef.get();
    const aboData = snap.data()?.abo as { status?: string; nextChargeAt?: Timestamp; pfcTokenId?: number; stripePaymentMethodId?: string } | undefined;

    if (!aboData || aboData.status !== 'gekuendigt') {
      throw new HttpsError('failed-precondition', 'Kein gekündigtes Abo zum Reaktivieren');
    }

    const nextChargeMs = aboData.nextChargeAt?.toMillis() ?? 0;
    if (nextChargeMs <= Date.now()) {
      throw new HttpsError('failed-precondition', 'Bezahlte Periode ist abgelaufen — bitte neues Abo abschliessen');
    }

    if (!aboData.pfcTokenId && !aboData.stripePaymentMethodId) {
      throw new HttpsError('failed-precondition', 'Kein gespeichertes Zahlungsmittel — bitte neues Abo abschliessen');
    }

    await fahrerRef.set(
      {
        abo: {
          status: 'aktiv',
          cancelledAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );

    logger.info(`Abo reaktiviert fuer Fahrer ${uid}`);
    return { success: true };
  },
);
