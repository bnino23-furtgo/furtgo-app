# Furtgo — Go-to-Market Plan

## Phase 1: Rechtliches & Zulassungen

Das ist das **grösste Hindernis** und muss zuerst gelöst werden:

- **Personenbeförderungsbewilligung**: In der Schweiz braucht jeder Fahrer eine kantonale Bewilligung. Die Regeln sind **kantonal unterschiedlich** (Zürich ≠ Bern ≠ Basel)
- **Betriebsbewilligung für die Plattform**: Du als Vermittler brauchst möglicherweise eine eigene Bewilligung (je nach Kanton)
- **Versicherung**: Fahrer brauchen eine Berufshaftpflichtversicherung für Personenbeförderung — private Autoversicherung reicht nicht
- **Datenschutz (DSG)**: Standortdaten sind besonders sensibel. Du brauchst eine saubere Datenschutzerklärung nach neuem Schweizer DSG (seit Sept. 2023)
- **AGB**: Professionelle AGB für Fahrer UND Fahrgäste

**Hindernis**: Ohne das ist die App illegal. Ein Anwalt für Transportrecht kostet, aber ist Pflicht.

### Betriebsbewilligung für Vermittlungsplattformen — Details

**Was ist das?**
Wer eine App betreibt, die Fahrer und Fahrgäste zusammenbringt, gilt als Vermittler von Personentransport. Der Kanton will sicherstellen, dass nur bewilligte Fahrer vermittelt werden und Sicherheitsstandards eingehalten werden. Ohne Bewilligung drohen Bussen, App-Verbot oder Strafverfahren.

**Kosten (kantonal unterschiedlich):**
- Zürich: ca. CHF 500–2'000 (seit 2021 eigenes Taxigesetz für Vermittlungsplattformen)
- Andere Kantone: ähnliche Gebühren, manche haben noch keine klare Regelung (Grauzone)
- Anwaltskosten für Beratung/Anträge: ca. CHF 1'000–3'000

**Hintergrund:**
Uber und Bolt mussten in der Schweiz jahrelang kämpfen um legal zu operieren. Zürich, Genf und Basel haben jeweils eigene Regeln. In kleineren Kantonen ist es teils noch unklar, ob eine App-Vermittlung gleich behandelt wird wie ein Taxiunternehmen.

**Wichtig: Abo-Modell ≠ keine Bewilligung**
Das Furtgo-Modell (Fahrer zahlt nur Abo, Fahrgast bezahlt Fahrer direkt) vereinfacht die finanzielle Seite (kein FINMA-Thema). Aber die transportrechtliche Seite bleibt: Du vermittelst Personenbeförderung, und dafür kann eine Bewilligung nötig sein — unabhängig vom Geldfluss. Es kann aber sein, dass der Kanton es lockerer sieht wenn:
- Du dich als reine "Technologie-Plattform" positionierst
- Fahrer selbständig sind und ihre eigenen Bewilligungen haben
- Du nur die App stellst, nicht den Transport organisierst

**Erste Schritte (ein Anruf kann tausende Franken Anwaltskosten sparen):**
1. Beim Strassenverkehrsamt deines Kantons anrufen und genau so fragen: "Ich betreibe eine App wo selbständige Fahrer sich registrieren und Fahrgäste sie buchen können. Ich vermittle nur, kassiere kein Fahrgeld. Brauche ich eine Bewilligung?"
2. Falls unklar: 30-Minuten-Erstgespräch bei einem Anwalt für Transportrecht (oft gratis oder CHF 100–200)
3. Im eigenen Kanton starten — dort die Regeln zuerst klären

---

## Phase 2: App Store Ready

- **Apple App Store** (TestFlight → Review → Launch)
- **Google Play Store** (APK/AAB hochladen)
- Store-Listing: Screenshots, Beschreibung DE/FR/IT
- App muss stabil laufen, keine Crashes

**Hindernis**: Apple Review ist streng — besonders bei Zahlungs-Apps und Location-Tracking. Rechne mit 1-3 Ablehnungen bevor es durchgeht.

---

## Phase 3: Zahlungssystem

- **Geschäftsmodell**: Fahrer zahlen monatliches Abo (CHF 30/Monat) für die Nutzung der App. Fahrgast bezahlt den Fahrer direkt (bar oder Twint). Kein Geldfluss über die Plattform.
- **Stripe** statt SumUp für Abo-Zahlung (steht schon auf der Liste)
- **FINMA ist kein Thema** — da kein Geld zwischen Fahrgast und Fahrer über die Plattform fliesst, bist du kein Zahlungsvermittler, sondern verkaufst ein Software-Abo
- **Steuern/Buchhaltung**: MwSt-Pflicht ab CHF 100'000 Umsatz

**Vorteil**: Dieses Modell ist rechtlich viel einfacher als bei Uber/Bolt, wo die Plattform das Geld vom Fahrgast einzieht und an den Fahrer weiterleitet.

---

## Phase 4: Fahrer gewinnen (Henne-Ei-Problem)

Das ist das **zweitgrösste Hindernis**: Ohne Fahrer keine Fahrgäste, ohne Fahrgäste keine Fahrer.

**Strategie**:
- Starte in **einer Stadt** (z.B. deine Heimatstadt)
- Erste 10-20 Fahrer persönlich rekrutieren
- **Abo die ersten 3 Monate gratis** als Anreiz
- Fahrer die bereits bei Uber/Bolt fahren ansprechen — die haben schon die Bewilligungen
- Facebook-Gruppen, Taxi-Stammtische, Fahrerschulen

---

## Phase 5: Fahrgäste gewinnen

- **Instagram/TikTok** Werbung
- Erster Fahrt gratis oder CHF 5 Gutschein
- Flyer an Bahnhöfen, Clubs, Spitälern
- Google Ads auf "Taxi [Stadtname]"
- Mundpropaganda / Empfehlungsprogramm (Fahrgast wirbt Fahrgast)

---

## Phase 6: Skalieren

- Stadt für Stadt ausrollen
- Evtl. weitere Kantone (neue Bewilligungen nötig!)
- Features wie geplante Fahrten, Firmenkonten, etc.

---

## Technische Hindernisse

### 1. Firebase Kosten bei Wachstum (grösstes Risiko)
Aktuell ist Firebase günstig weil wenig Nutzer. Aber:
- onSnapshot Listener zählt als Lese-Vorgang bei jeder Änderung
- 100 Fahrer online + 500 Fahrgäste = tausende Reads pro Minute
- Standort-Updates alle 10 Sekunden pro Fahrer = 8'640 Writes pro Fahrer pro Tag
- Firebase Free Tier: 50'000 Reads/Tag — mit 50 aktiven Nutzern schon aufgebraucht
- Danach: kann schnell CHF 100–500/Monat werden

### 2. Standort-Tracking im Hintergrund
- Aktuell funktioniert GPS nur wenn App im Vordergrund ist
- Fahrer wechseln zwischen Apps (WhatsApp, Waze, Google Maps) → kein Standort-Update, keine Anfragen
- Expo Go unterstützt kein Background Location — nativer Build nötig
- Background Location auf iOS ist extrem streng (Apple lehnt Apps ab die es missbrauchen)

### 3. Push Notifications (richtig)
- Aktuell keine echten Push Notifications (nur in Expo Go)
- Wenn Fahrer die App schliesst → bekommt keine Anfragen
- Firebase Cloud Messaging (FCM) + nativer Build nötig
- Ohne das: Fahrer muss App immer offen haben

### 4. Skalierung der Fahrer-Suche
- Aktuell: alle Fahrer aus Firestore laden und lokal nach 10km filtern
- Bei 1'000 Fahrern: 1'000 Dokumente laden nur um 5 in der Nähe zu finden
- Lösung: GeoFirestore oder Geohash-basierte Queries

### 5. Nativer Build (weg von Expo Go)
- Expo Go ist nicht für Produktion gedacht
- Jedes native Modul (Stripe, Background Location, Push) braucht neuen Build
- iOS Build braucht Mac oder EAS Cloud Build (kostet)

### 6. Gleichzeitige Fahrten / Race Conditions
- Zwei Fahrgäste bestellen gleichzeitig → beide bekommen gleichen Fahrer
- Aktuell kein Lock-Mechanismus
- Lösung: Firestore Transactions für Fahrer-Zuweisung

### 7. Offline-Verhalten
- Fahrer im Tunnel = kein Internet = App hängt
- Fahrgast verliert Verbindung während Fahrt
- Firebase Offline-Persistence hilft teilweise

### Technische Priorität vor Go-Live

| Problem | Wann relevant | Aufwand |
|---|---|---|
| Background Location | Sofort beim Go-Live | Hoch |
| Push Notifications | Sofort beim Go-Live | Mittel |
| Nativer Build | Sofort beim Go-Live | Mittel |
| Race Conditions | Ab 10+ gleichzeitige Nutzer | Mittel |
| Firebase Kosten | Ab 100+ aktive Nutzer | Hoch |
| Geo-Query Skalierung | Ab 500+ Fahrer | Mittel |
| Offline-Verhalten | Immer, nicht kritisch am Anfang | Niedrig |

---

## Die grössten Hindernisse zusammengefasst (Business)

| Hindernis | Schwierigkeit | Lösung |
|---|---|---|
| Kantonale Bewilligungen | Sehr hoch | Anwalt, pro Kanton einzeln |
| Henne-Ei (Fahrer↔Fahrgäste) | Hoch | Klein starten, 1 Stadt |
| Konkurrenz (Uber, Bolt) | Hoch | Nische: günstiger, lokaler, persönlicher |
| Apple/Google Review | Mittel | Zeit einplanen, sauber bauen |
| Zahlungsabwicklung | Niedrig | Nur Abo-Zahlung via Stripe, kein Geldfluss über Plattform |
| Server-Kosten bei Wachstum | Mittel | Firebase skaliert, aber wird teuer |
| Vertrauen aufbauen | Mittel | Bewertungen, Verifizierung, Support |

---

## USP (Unique Selling Point) vs. Uber/Bolt

Warum soll jemand Furtgo statt Uber nehmen?

Mögliche Antworten:
- Günstiger (niedrigere Provision → günstigere Preise)
- Schweizer App, lokaler Support auf Deutsch
- Fahrer verdienen mehr (tiefere Plattform-Gebühr)
- Persönlicher, Community-Fokus
