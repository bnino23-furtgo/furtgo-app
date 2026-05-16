# PostFinance Checkout — Telefon-Spickzettel

**Hotline:** 058 448 14 24
**Mein Merchant / Space:** 95927
**Mein Use Case:** Monatliches Fahrer-Abo (SaaS) für Furtgo (Taxi-App). Zahlungs-Link auf furtgo.ch. Webhook an Firebase Cloud Function. Keine Shop-Software, kein Hostpoint Shop.

---

## 1. Produkt & Preise

**1.1** Welches Produkt brauche ich für monatliche Abos — **Checkout Flex** oder **Checkout All-in-One**?

> Antwort: ___________________________________________

**1.2** Was kostet das pro Monat (Grundgebühr) und pro Transaktion?

> Antwort: ___________________________________________

**1.3** Gibt es eine Mindestlaufzeit oder Kündigungsfrist?

> Antwort: ___________________________________________

---

## 2. Subscription / Abo-Funktion

**2.1** Kann ich im PostFinance Checkout Backend ein **monatliches Abo** einrichten — direkt, **ohne** WordPress / WooCommerce / Shop dazwischen?

> Antwort: ___________________________________________

**2.2** Speichert PostFinance Checkout die Karten-/Zahlungsmittel-Daten und belastet sie jeden Monat **automatisch**?

> Antwort: ___________________________________________

**2.3** Welche Zahlungsmittel werden im Abo unterstützt? (Speziell: **TWINT, PostFinance Card, Visa/Mastercard**)

> Antwort: ___________________________________________

---

## 3. Identifikation (welcher Fahrer hat bezahlt?)

**3.1** Kann ich beim **Payment Link** einen Custom-Parameter mitschicken (z.B. `fahrer_uid=abc123`), der im Webhook zurückkommt?

> Antwort: ___________________________________________

**3.2** Falls nein: Reicht die Email-Adresse des Fahrers als Identifikation?

> Antwort: ___________________________________________

---

## 4. Webhook → Firebase Cloud Function

**4.1** Wo im Backend trage ich die **Webhook-URL** ein?

> Antwort: ___________________________________________

**4.2** Welche **Events** kann ich abonnieren?
- Zahlung erfolgreich (`payment_succeeded`)
- Zahlung fehlgeschlagen (`payment_failed`)
- Abo gekündigt (`subscription_cancelled`)
- Andere?

> Antwort: ___________________________________________

**4.3** Wie ist die **Webhook-Signatur** gesichert? (HMAC? Secret? IP-Whitelist?)

> Antwort: ___________________________________________

**4.4** Gibt es **Test-Webhooks**, damit ich die Cloud Function entwickeln kann ohne echte Zahlung?

> Antwort: ___________________________________________

---

## 5. Zahlungsausfall

**5.1** Was passiert bei **abgelehnter Karte** (zu wenig Guthaben, abgelaufen)?

> Antwort: ___________________________________________

**5.2** Wird automatisch **mehrmals retried**? Wenn ja, wie oft und in welchem Abstand?

> Antwort: ___________________________________________

**5.3** Wird der Fahrer **automatisch per Email** informiert, oder muss ich das selber machen?

> Antwort: ___________________________________________

---

## 6. Kündigung & Self-Service

**6.1** Kann der **Fahrer selber kündigen** (z.B. via PostFinance Checkout Customer Portal)?

> Antwort: ___________________________________________

**6.2** Kann der Fahrer seine **Zahlungsmittel selber wechseln** (neue Karte hinterlegen)?

> Antwort: ___________________________________________

**6.3** Falls nein: Muss ich das alles selber implementieren in Furtgo?

> Antwort: ___________________________________________

---

## 7. Rechnungen & Buchhaltung

**7.1** Stellt PostFinance Checkout dem Fahrer **automatisch eine MwSt-konforme Rechnung** (PDF)?

> Antwort: ___________________________________________

**7.2** Bekomme **ich** monatlich eine Auszahlung mit Übersicht aller Abos?

> Antwort: ___________________________________________

**7.3** Wie lange dauert die **Auszahlung** auf mein PostFinance-Geschäftskonto?

> Antwort: ___________________________________________

---

## 8. Test-Konto

**8.1** Mein Test-Konto (Space 95927) ist gratis — bis wann?

> Antwort: ___________________________________________

**8.2** Wann muss ich auf **Live-Modus** umstellen, und welche Schritte sind nötig?

> Antwort: ___________________________________________

---

## 9. Internationale Fahrer (CH/AT/Dubai)

**9.1** Funktioniert das Abo auch für Fahrer aus **Österreich** und **Dubai**?

> Antwort: ___________________________________________

**9.2** In welchen Währungen kann ich abrechnen? (CHF, EUR, AED?)

> Antwort: ___________________________________________

---

## 10. Dokumentation & Support

**10.1** Wo finde ich die **API-Dokumentation** für Webhooks und Payment Links?

> Antwort: ___________________________________________

**10.2** Gibt es einen **technischen Support** für Entwickler-Fragen, oder nur Vertrieb?

> Antwort: ___________________________________________

---

## Notizen / sonstige Erkenntnisse

```




```
