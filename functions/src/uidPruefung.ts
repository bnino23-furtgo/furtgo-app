import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

const REGION = 'europe-west6';

// Öffentlicher UID-Webservice des BFS (kein Login, max. 20 Anfragen/Min).
const UID_ENDPOINT = 'https://www.uid-wse.admin.ch/V5.0/PublicServices.svc';
const UID_ACTION = 'http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/GetByUID';

/** UID-Prüfziffer (Modulo-11) gemäss eCH-0097. Erwartet genau 9 Ziffern. */
function pruefzifferOk(ziffern: string): boolean {
  if (ziffern.length !== 9) return false;
  const gewichte = [5, 4, 3, 2, 7, 6, 5, 4];
  let summe = 0;
  for (let i = 0; i < 8; i++) summe += parseInt(ziffern[i], 10) * gewichte[i];
  const rest = summe % 11;
  const pruef = 11 - rest;
  if (pruef === 11) return parseInt(ziffern[8], 10) === 0; // Prüfziffer 0
  if (pruef === 10) return false; // ungültige Nummer (nie vergeben)
  return parseInt(ziffern[8], 10) === pruef;
}

/** Erster Tag-Inhalt aus dem XML (Tag kann xmlns-Attribute tragen). */
function tagWert(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

/**
 * Prüft eine Schweizer UID-Nummer live gegen das öffentliche UID-Register.
 * Gibt den offiziellen Firmennamen + Status zurück — ersetzt den manuellen
 * Handelsregister-/UID-Auszug. Beweist NICHT, dass der Antragsteller Inhaber ist.
 */
export const pruefeUid = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Login erforderlich');
  }

  const roh = String(request.data?.uid ?? '');
  const ziffern = roh.replace(/\D/g, ''); // CHE, Punkte, Bindestriche entfernen
  if (ziffern.length !== 9) {
    return { gefunden: false, fehler: 'Format ungültig — die UID hat 9 Ziffern (CHE-XXX.XXX.XXX).' };
  }
  if (!pruefzifferOk(ziffern)) {
    return { gefunden: false, fehler: 'Ungültige UID — die Prüfziffer stimmt nicht.' };
  }
  const formatiert = `CHE-${ziffern.slice(0, 3)}.${ziffern.slice(3, 6)}.${ziffern.slice(6, 9)}`;

  const envelope =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' xmlns:wsa="http://www.w3.org/2005/08/addressing"' +
    ' xmlns:uid="http://www.uid.admin.ch/xmlns/uid-wse"' +
    ' xmlns:ech="http://www.ech.ch/xmlns/eCH-0097/5">' +
    `<soapenv:Header><wsa:Action>${UID_ACTION}</wsa:Action><wsa:To>${UID_ENDPOINT}</wsa:To></soapenv:Header>` +
    '<soapenv:Body><uid:GetByUID><uid:uid>' +
    '<ech:uidOrganisationIdCategorie>CHE</ech:uidOrganisationIdCategorie>' +
    `<ech:uidOrganisationId>${ziffern}</ech:uidOrganisationId>` +
    '</uid:uid></uid:GetByUID></soapenv:Body></soapenv:Envelope>';

  let text: string;
  try {
    const resp = await fetch(UID_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${UID_ACTION}"`,
      },
      body: envelope,
    });
    text = await resp.text();
  } catch (e) {
    logger.error('UID-Webservice nicht erreichbar:', e);
    throw new HttpsError('unavailable', 'UID-Register nicht erreichbar. Bitte später erneut versuchen.');
  }

  // SOAP-Fault = UID nicht gefunden oder ungültig
  if (/:Fault>/.test(text)) {
    const detail = tagWert(text, 'errorDetail') ?? tagWert(text, 'faultstring') ?? 'UID nicht gefunden';
    logger.info(`UID ${formatiert} nicht gefunden: ${detail}`);
    return { gefunden: false, uid: formatiert, fehler: detail };
  }

  const name = tagWert(text, 'organisationName');
  if (!name) {
    return { gefunden: false, uid: formatiert, fehler: 'Keine öffentlichen Daten zu dieser UID gefunden.' };
  }
  const status = tagWert(text, 'uidregPublicStatus'); // 1 = aktiv
  return {
    gefunden: true,
    uid: formatiert,
    name,
    ort: tagWert(text, 'town'),
    status,
    aktiv: status === '1',
  };
});
