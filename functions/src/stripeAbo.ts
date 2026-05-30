import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import Stripe from 'stripe';
import { createRechnung, GMAIL_APP_PASSWORD } from './rechnung';

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const REGION = 'europe-west6';

const ABO_PRICE_CHF = 60.0;
const ABO_PRICE_CENTS = 6000;
const ABO_INTERVAL_DAYS = 30;
const ABO_CURRENCY = 'chf';
const ABO_RETRY_MAX = 3;
const ABO_RETRY_DELAY_DAYS = 2;

const ZAHLUNGSART_LABEL = 'Stripe';
const SUCCESS_URL = 'https://furtgo.ch/abo-erfolgreich.html';
const CANCEL_URL = 'https://furtgo.ch/abo-fehlgeschlagen.html';

function getStripe(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY.value());
}

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

async function handleStripeRecurringFailure(uid: string, reason: string, paymentRef?: string): Promise<void> {
  const fahrerRef = getFirestore().collection('fahrer').doc(uid);
  const snap = await fahrerRef.get();
  const aboData = snap.data()?.abo as { retryCount?: number; lastFailedPaymentRef?: string } | undefined;

  if (paymentRef && aboData?.lastFailedPaymentRef === paymentRef) {
    logger.info(`handleStripeRecurringFailure: ${paymentRef} fuer Fahrer ${uid} bereits verarbeitet — uebersprungen`);
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
          ...(paymentRef ? { lastFailedPaymentRef: paymentRef } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    logger.warn(`Stripe-Abo deaktiviert fuer Fahrer ${uid} nach ${ABO_RETRY_MAX} Versuchen — Grund: ${reason}`);
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
        ...(paymentRef ? { lastFailedPaymentRef: paymentRef } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
  logger.warn(`Stripe-Charge Versuch ${nextRetry}/${ABO_RETRY_MAX} fuer Fahrer ${uid}, naechster Versuch ${nextChargeAt.toDate().toISOString()} — Grund: ${reason}`);
  await sendAboPush(
    uid,
    'Zahlung fehlgeschlagen',
    `Versuch ${nextRetry}/${ABO_RETRY_MAX}. Neuer Versuch in ${ABO_RETRY_DELAY_DAYS} Tagen. Bitte Karte/Konto prüfen.`,
  );
}

async function getOrCreateStripeCustomer(stripe: Stripe, uid: string): Promise<string> {
  const fahrerRef = getFirestore().collection('fahrer').doc(uid);
  const snap = await fahrerRef.get();
  const existing = snap.data()?.abo?.stripeCustomerId as string | undefined;
  if (existing) return existing;

  let email: string | undefined;
  let displayName: string | undefined;
  try {
    const user = await getAuth().getUser(uid);
    email = user.email ?? undefined;
    displayName = user.displayName ?? undefined;
  } catch (e) {
    logger.warn(`Auth-Lookup fehlgeschlagen fuer ${uid}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const customer = await stripe.customers.create({
    email,
    name: displayName,
    metadata: { fahrer_uid: uid },
  });

  await fahrerRef.set(
    { abo: { stripeCustomerId: customer.id, updatedAt: FieldValue.serverTimestamp() } },
    { merge: true },
  );

  return customer.id;
}

export const createStripeAboSession = onCall(
  { region: REGION, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login erforderlich');

    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(stripe, uid);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: ABO_CURRENCY,
            product_data: { name: 'Furtgo Fahrer-Abo (1 Monat)' },
            unit_amount: ABO_PRICE_CENTS,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: { fahrer_uid: uid, typ: 'erstregistrierung' },
      },
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      metadata: { fahrer_uid: uid },
      locale: 'de',
    });

    if (!session.url) {
      throw new HttpsError('internal', 'Stripe Checkout Session ohne URL');
    }

    await getFirestore().collection('fahrer').doc(uid).set(
      {
        abo: {
          provider: 'stripe',
          pendingSessionId: session.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );

    logger.info(`Stripe Checkout Session erstellt fuer Fahrer ${uid}: ${session.id}`);
    return { paymentUrl: session.url, transactionId: session.id };
  },
);

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
  const fahrerUid = session.metadata?.fahrer_uid;
  if (!fahrerUid) {
    logger.warn(`checkout.session.completed ohne fahrer_uid: ${session.id}`);
    return;
  }
  if (typeof session.payment_intent !== 'string') {
    logger.warn(`checkout.session.completed ohne payment_intent: ${session.id}`);
    return;
  }

  const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
  const paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  const nextChargeAt = Timestamp.fromMillis(Date.now() + ABO_INTERVAL_DAYS * 86400 * 1000);

  await getFirestore().collection('fahrer').doc(fahrerUid).set(
    {
      abo: {
        provider: 'stripe',
        status: 'aktiv',
        stripeCustomerId: customerId,
        stripePaymentMethodId: paymentMethodId,
        lastChargeId: pi.id,
        lastChargeAt: FieldValue.serverTimestamp(),
        nextChargeAt,
        retryCount: 0,
        lastRetryReason: FieldValue.delete(),
        pendingSessionId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  logger.info(`Stripe-Abo aktiviert fuer Fahrer ${fahrerUid}, naechste Belastung ${nextChargeAt.toDate().toISOString()}`);

  try {
    await createRechnung({
      fahrerUid,
      paymentRef: pi.id,
      zahlungsArt: ZAHLUNGSART_LABEL,
      betrag: ABO_PRICE_CHF,
      gmailPassword: GMAIL_APP_PASSWORD.value(),
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error(`Rechnungs-Erstellung fehlgeschlagen fuer Fahrer ${fahrerUid}: ${errMsg}`);
  }
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
  const fahrerUid = pi.metadata?.fahrer_uid;
  if (!fahrerUid) {
    logger.info(`payment_intent.succeeded ohne fahrer_uid: ${pi.id}`);
    return;
  }
  const isRecurring = pi.metadata?.typ === 'recurring';
  if (!isRecurring) {
    logger.info(`payment_intent.succeeded fuer Erstregistrierung ${pi.id} — wird von checkout.session.completed verarbeitet`);
    return;
  }

  const nextChargeAt = Timestamp.fromMillis(Date.now() + ABO_INTERVAL_DAYS * 86400 * 1000);
  await getFirestore().collection('fahrer').doc(fahrerUid).set(
    {
      abo: {
        status: 'aktiv',
        lastChargeId: pi.id,
        lastChargeAt: FieldValue.serverTimestamp(),
        nextChargeAt,
        retryCount: 0,
        lastRetryReason: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  logger.info(`Recurring-Charge erfolgreich fuer Fahrer ${fahrerUid}, naechste Belastung ${nextChargeAt.toDate().toISOString()}`);

  try {
    await createRechnung({
      fahrerUid,
      paymentRef: pi.id,
      zahlungsArt: ZAHLUNGSART_LABEL,
      betrag: ABO_PRICE_CHF,
      gmailPassword: GMAIL_APP_PASSWORD.value(),
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error(`Rechnungs-Erstellung fehlgeschlagen fuer Fahrer ${fahrerUid}: ${errMsg}`);
  }
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
  const fahrerUid = pi.metadata?.fahrer_uid;
  if (!fahrerUid) {
    logger.warn(`payment_intent.payment_failed ohne fahrer_uid: ${pi.id}`);
    return;
  }
  const isRecurring = pi.metadata?.typ === 'recurring';
  const reason = pi.last_payment_error?.message ?? pi.last_payment_error?.code ?? 'unknown';

  if (isRecurring) {
    await handleStripeRecurringFailure(fahrerUid, `${pi.id}: ${reason}`, pi.id);
  } else {
    await getFirestore().collection('fahrer').doc(fahrerUid).set(
      {
        abo: {
          status: 'fehlgeschlagen',
          lastFailedPaymentRef: pi.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    logger.warn(`Erstregistrierung fehlgeschlagen fuer Fahrer ${fahrerUid}, pi=${pi.id}: ${reason}`);
  }
}

export const stripeWebhook = onRequest(
  { region: REGION, secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, GMAIL_APP_PASSWORD], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const sig = req.header('stripe-signature');
    if (!sig) {
      logger.warn('Stripe Webhook ohne stripe-signature Header');
      res.status(401).send('Missing signature');
      return;
    }

    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody || rawBody.length === 0) {
      logger.error('Stripe Webhook ohne rawBody');
      res.status(400).send('Missing raw body');
      return;
    }

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET.value());
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(`Stripe Signaturpruefung fehlgeschlagen: ${errMsg}`);
      res.status(401).send('Invalid signature');
      return;
    }

    const eventRef = getFirestore().collection('webhook_events').doc(`stripe_${event.id}`);
    try {
      await eventRef.create({
        eventType: event.type,
        receivedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      const code = (e as { code?: number | string }).code;
      if (code === 6 || code === 'already-exists') {
        logger.info(`Stripe Event ${event.id} bereits verarbeitet — ignoriere Retry`);
        res.status(200).send('Already processed');
        return;
      }
      throw e;
    }

    logger.info(`Stripe Webhook empfangen: ${event.type} (${event.id})`);

    try {
      if (event.type === 'checkout.session.completed') {
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
      } else if (event.type === 'payment_intent.succeeded') {
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
      } else if (event.type === 'payment_intent.payment_failed') {
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
      } else {
        logger.info(`Stripe Event ${event.type} wird ignoriert`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(`Stripe Webhook Handler Fehler (${event.type}): ${errMsg}`);
      res.status(500).send('Handler error');
      return;
    }

    res.status(200).send('OK');
  },
);

export const chargeStripeMonthlySubscriptions = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'Europe/Zurich',
    region: REGION,
    secrets: [STRIPE_SECRET_KEY],
  },
  async () => {
    const now = Timestamp.now();
    const due = await getFirestore()
      .collection('fahrer')
      .where('abo.provider', '==', 'stripe')
      .where('abo.status', '==', 'aktiv')
      .where('abo.nextChargeAt', '<=', now)
      .get();

    logger.info(`Faellige Stripe-Abos: ${due.size}`);
    if (due.empty) return;

    const stripe = getStripe();

    for (const doc of due.docs) {
      const uid = doc.id;
      const aboData = doc.data().abo as {
        stripeCustomerId?: string;
        stripePaymentMethodId?: string;
      } | undefined;
      const customerId = aboData?.stripeCustomerId;
      const paymentMethodId = aboData?.stripePaymentMethodId;
      if (!customerId || !paymentMethodId) {
        logger.warn(`Fahrer ${uid} fehlt stripeCustomerId/PaymentMethodId — ueberspringe`);
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
        const pi = await stripe.paymentIntents.create({
          amount: ABO_PRICE_CENTS,
          currency: ABO_CURRENCY,
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: { fahrer_uid: uid, typ: 'recurring' },
        });
        logger.info(`Stripe Recurring-Charge erstellt fuer Fahrer ${uid}, pi=${pi.id} (status=${pi.status})`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const piId = (e as { payment_intent?: { id?: string } }).payment_intent?.id;
        logger.error(`Stripe Recurring-Charge fehlgeschlagen fuer Fahrer ${uid}: ${errMsg}`);
        await handleStripeRecurringFailure(uid, `cron exception: ${errMsg}`, piId);
      }
    }
  },
);
