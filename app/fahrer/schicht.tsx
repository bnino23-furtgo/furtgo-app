import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { collection, query, where, getDocs, orderBy, doc } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

type Modus = 'tag' | 'woche';

interface FahrtZeile {
  id: string;
  start: Date;
  ende: Date;
  dauerMin: number;
  preis: number;
  abhol: string;
  ziel: string;
}

interface OnlineEvent {
  timestamp: Date;
  istOnline: boolean;
}

interface TagMetrik {
  tag: Date;
  anzahl: number;
  umsatz: number;
  lenkzeitMin: number;
  arbeitszeitMin: number;
  geschaetzt: boolean;
  fahrten: FahrtZeile[];
}

const MAX_TAGE_ZURUECK = 28;

function toDate(ts: any): Date {
  if (!ts) return new Date(0);
  if (ts?.toDate) return ts.toDate();
  return new Date(ts);
}

function tagesStart(d: Date): Date {
  const k = new Date(d);
  k.setHours(0, 0, 0, 0);
  return k;
}

function tagesEnde(d: Date): Date {
  const k = new Date(d);
  k.setHours(23, 59, 59, 999);
  return k;
}

function addTage(d: Date, n: number): Date {
  const k = new Date(d);
  k.setDate(d.getDate() + n);
  return k;
}

function wochenStart(d: Date): Date {
  const k = tagesStart(d);
  const wochentag = (k.getDay() + 6) % 7; // 0 = Montag
  k.setDate(k.getDate() - wochentag);
  return k;
}

function formatDauer(min: number): string {
  if (min <= 0) return '0 min';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function formatUhr(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDatum(d: Date, loc: string, t: (k: string) => string): string {
  const heute = tagesStart(new Date());
  const gestern = addTage(heute, -1);
  const ziel = tagesStart(d);
  if (ziel.getTime() === heute.getTime()) return t('schicht.heute');
  if (ziel.getTime() === gestern.getTime()) return t('schicht.gestern');
  return d.toLocaleDateString(loc, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatWochentag(d: Date, loc: string): string {
  return d.toLocaleDateString(loc, { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function formatWochenLabel(von: Date, loc: string): string {
  const bis = addTage(von, 6);
  const v = von.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' });
  const b = bis.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${v} – ${b}`;
}

/** Berechnet Kennzahlen für genau einen Tag aus den geladenen Roh-Daten. */
function metrikenFuer(
  tag: Date,
  alleFahrten: FahrtZeile[],
  alleEvents: OnlineEvent[],
  jetzt: Date
): TagMetrik {
  const von = tagesStart(tag);
  const bis = tagesEnde(tag);
  const fahrten = alleFahrten.filter((f) => f.start >= von && f.start <= bis);
  const events = alleEvents.filter((e) => e.timestamp >= von && e.timestamp <= bis);

  const lenkzeitMin = fahrten.reduce((s, f) => s + f.dauerMin, 0);
  const umsatz = fahrten.reduce((s, f) => s + f.preis, 0);
  const istHeute = von.getTime() === tagesStart(jetzt).getTime();

  let arbeitszeitMin = 0;
  let geschaetzt = false;

  if (events.length > 0) {
    // Echte Berechnung aus Online-Events
    const evs: OnlineEvent[] = [...events];
    if (!evs[0].istOnline) {
      // Tag startete bereits online → virtueller Online-Event bei Tagesanfang
      evs.unshift({ timestamp: von, istOnline: true });
    }
    let aktuelleStart: Date | null = null;
    for (const ev of evs) {
      if (ev.istOnline && !aktuelleStart) {
        aktuelleStart = ev.timestamp;
      } else if (!ev.istOnline && aktuelleStart) {
        arbeitszeitMin += Math.round((ev.timestamp.getTime() - aktuelleStart.getTime()) / 60000);
        aktuelleStart = null;
      }
    }
    if (aktuelleStart) {
      const ende = istHeute ? jetzt : bis;
      arbeitszeitMin += Math.round((ende.getTime() - aktuelleStart.getTime()) / 60000);
    }
  } else if (fahrten.length > 0) {
    // Fallback: erste→letzte Fahrt, geschätzt
    const erste = fahrten[0].start;
    const letzte = fahrten[fahrten.length - 1].ende;
    arbeitszeitMin = Math.max(0, Math.round((letzte.getTime() - erste.getTime()) / 60000));
    geschaetzt = true;
  }

  return { tag: von, anzahl: fahrten.length, umsatz, lenkzeitMin, arbeitszeitMin, geschaetzt, fahrten };
}

export default function Schicht() {
  const { t, i18n } = useTranslation();
  const loc = i18n.language || 'de';
  const insets = useSafeAreaInsets();
  const [modus, setModus] = useState<Modus>('tag');
  const [datum, setDatum] = useState<Date>(tagesStart(new Date()));
  const [fahrten, setFahrten] = useState<FahrtZeile[]>([]);
  const [onlineEvents, setOnlineEvents] = useState<OnlineEvent[]>([]);
  const [laden, setLaden] = useState(true);

  const heute = useMemo(() => tagesStart(new Date()), []);
  const aeltesterTag = useMemo(() => addTage(heute, -MAX_TAGE_ZURUECK), [heute]);

  const istHeute = datum.getTime() === heute.getTime();
  const istAeltester = datum.getTime() <= aeltesterTag.getTime();

  // Aktiver Zeitbereich (Tag oder ganze Woche)
  const bereich = useMemo(() => {
    if (modus === 'woche') {
      const von = wochenStart(datum);
      return { von, bis: tagesEnde(addTage(von, 6)) };
    }
    return { von: tagesStart(datum), bis: tagesEnde(datum) };
  }, [modus, datum]);

  const wochenAnfang = useMemo(() => wochenStart(datum), [datum]);
  const istAktuelleWoche = wochenAnfang.getTime() === wochenStart(heute).getTime();
  const istAeltesteWoche = wochenAnfang.getTime() <= wochenStart(aeltesterTag).getTime();

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setLaden(true);

    const { von, bis } = bereich;

    const fahrtenQ = query(collection(db, 'fahrten'), where('fahrerId', '==', uid));
    const eventsQ = query(
      collection(doc(db, 'fahrer', uid), 'online_events'),
      where('timestamp', '>=', von),
      where('timestamp', '<=', bis),
      orderBy('timestamp', 'asc')
    );

    Promise.all([getDocs(fahrtenQ), getDocs(eventsQ)])
      .then(([fSnap, eSnap]) => {
        const liste: FahrtZeile[] = fSnap.docs
          .filter((d) => d.data().status === 'abgeschlossen')
          .map((d) => {
            const data = d.data();
            const start = data.startZeit ? toDate(data.startZeit) : toDate(data.erstelltAm);
            const ende = data.endZeit ? toDate(data.endZeit) : start;
            const dauerMs = ende.getTime() - start.getTime();
            return {
              id: d.id,
              start,
              ende,
              dauerMin: Math.max(0, Math.round(dauerMs / 60000)),
              preis: typeof data.preis === 'number' ? data.preis : 0,
              abhol: data.abholort?.adresse ?? '–',
              ziel: data.zielort?.adresse ?? '–',
            };
          })
          .filter((f) => f.start >= von && f.start <= bis)
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        setFahrten(liste);

        const events: OnlineEvent[] = eSnap.docs.map((d) => ({
          timestamp: toDate(d.data().timestamp),
          istOnline: !!d.data().istOnline,
        }));
        setOnlineEvents(events);
      })
      .catch((e) => console.log('Schicht laden Fehler (ignoriert):', e))
      .finally(() => setLaden(false));
  }, [bereich]);

  // Tagesansicht: genau ein Tag
  const tagMetrik = useMemo(
    () => metrikenFuer(datum, fahrten, onlineEvents, new Date()),
    [datum, fahrten, onlineEvents]
  );

  // Wochenansicht: 7 Tage + Summe
  const wochenTage = useMemo(() => {
    const jetzt = new Date();
    return Array.from({ length: 7 }, (_, i) =>
      metrikenFuer(addTage(wochenAnfang, i), fahrten, onlineEvents, jetzt)
    );
  }, [wochenAnfang, fahrten, onlineEvents]);

  const wochenSumme = useMemo(() => {
    return wochenTage.reduce(
      (acc, d) => ({
        anzahl: acc.anzahl + d.anzahl,
        umsatz: acc.umsatz + d.umsatz,
        lenkzeitMin: acc.lenkzeitMin + d.lenkzeitMin,
        arbeitszeitMin: acc.arbeitszeitMin + d.arbeitszeitMin,
      }),
      { anzahl: 0, umsatz: 0, lenkzeitMin: 0, arbeitszeitMin: 0 }
    );
  }, [wochenTage]);

  const tagWechsel = (tage: number) => {
    const neu = tagesStart(addTage(datum, tage));
    if (neu > heute || neu < aeltesterTag) return;
    setDatum(neu);
  };

  const wochenWechsel = (wochen: number) => {
    const neu = wochenStart(addTage(wochenAnfang, wochen * 7));
    if (neu > wochenStart(heute) || neu < wochenStart(aeltesterTag)) return;
    setDatum(neu);
  };

  const zeigeTag = (tag: Date) => {
    setDatum(tagesStart(tag));
    setModus('tag');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Topbar */}
      <View style={styles.topbar}>
        <TouchableOpacity style={styles.zurueck} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topTitel}>{t('schicht.titel')}</Text>
        <View style={styles.zurueck} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerIcon}>⚠️</Text>
          <Text style={styles.disclaimerText}>{t('schicht.disclaimer')}</Text>
        </View>

        {/* Tag/Woche-Umschalter */}
        <View style={styles.modusToggle}>
          {(['tag', 'woche'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modusBtn, modus === m && styles.modusBtnAktiv]}
              onPress={() => setModus(m)}
            >
              <Text style={[styles.modusBtnText, modus === m && styles.modusBtnTextAktiv]}>
                {t(`schicht.${m}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Picker (Tag oder Woche) */}
        {modus === 'tag' ? (
          <View style={styles.picker}>
            <TouchableOpacity
              style={[styles.pickerPfeil, istAeltester && styles.pickerPfeilInaktiv]}
              onPress={() => tagWechsel(-1)}
              disabled={istAeltester}
            >
              <Ionicons name="chevron-back" size={22} color={istAeltester ? '#555' : '#FFD700'} />
            </TouchableOpacity>
            <Text style={styles.pickerText}>{formatDatum(datum, loc, t)}</Text>
            <TouchableOpacity
              style={[styles.pickerPfeil, istHeute && styles.pickerPfeilInaktiv]}
              onPress={() => tagWechsel(1)}
              disabled={istHeute}
            >
              <Ionicons name="chevron-forward" size={22} color={istHeute ? '#555' : '#FFD700'} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.picker}>
            <TouchableOpacity
              style={[styles.pickerPfeil, istAeltesteWoche && styles.pickerPfeilInaktiv]}
              onPress={() => wochenWechsel(-1)}
              disabled={istAeltesteWoche}
            >
              <Ionicons name="chevron-back" size={22} color={istAeltesteWoche ? '#555' : '#FFD700'} />
            </TouchableOpacity>
            <Text style={styles.pickerText}>{formatWochenLabel(wochenAnfang, loc)}</Text>
            <TouchableOpacity
              style={[styles.pickerPfeil, istAktuelleWoche && styles.pickerPfeilInaktiv]}
              onPress={() => wochenWechsel(1)}
              disabled={istAktuelleWoche}
            >
              <Ionicons name="chevron-forward" size={22} color={istAktuelleWoche ? '#555' : '#FFD700'} />
            </TouchableOpacity>
          </View>
        )}

        {laden ? (
          <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 32 }} />
        ) : modus === 'tag' ? (
          <>
            {/* Kennzahlen Tag */}
            <View style={styles.kachelnRow}>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.anzahlFahrten')}</Text>
                <Text style={styles.kachelWert}>{tagMetrik.anzahl}</Text>
              </View>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.umsatz')}</Text>
                <Text style={styles.kachelWert}>CHF {tagMetrik.umsatz.toFixed(2)}</Text>
              </View>
            </View>
            <View style={styles.kachelnRow}>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.lenkzeit')}</Text>
                <Text style={styles.kachelWert}>{formatDauer(tagMetrik.lenkzeitMin)}</Text>
              </View>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>
                  {t('schicht.arbeitszeit')}
                  {tagMetrik.geschaetzt && <Text style={styles.kachelHinweis}> {t('schicht.geschaetzt')}</Text>}
                </Text>
                <Text style={styles.kachelWert}>{formatDauer(tagMetrik.arbeitszeitMin)}</Text>
              </View>
            </View>

            {/* Fahrten-Liste */}
            {tagMetrik.fahrten.length === 0 ? (
              <Text style={styles.leer}>{t('schicht.keineFahrten')}</Text>
            ) : (
              <View style={styles.liste}>
                <Text style={styles.listeTitel}>{t('schicht.fahrten')}</Text>
                {tagMetrik.fahrten.map((f) => (
                  <View key={f.id} style={styles.eintrag}>
                    <View style={styles.eintragZeit}>
                      <Text style={styles.eintragUhr}>{formatUhr(f.start)}</Text>
                      <Text style={styles.eintragDauer}>{formatDauer(f.dauerMin)}</Text>
                    </View>
                    <View style={styles.eintragInfo}>
                      <Text style={styles.eintragRoute} numberOfLines={1}>
                        📍 {f.abhol}
                      </Text>
                      <Text style={styles.eintragRoute} numberOfLines={1}>
                        🏁 {f.ziel}
                      </Text>
                    </View>
                    <Text style={styles.eintragPreis}>CHF {f.preis.toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            {/* Wochen-Total */}
            <Text style={styles.totalTitel}>{t('schicht.wochenTotal')}</Text>
            <View style={styles.kachelnRow}>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.anzahlFahrten')}</Text>
                <Text style={styles.kachelWert}>{wochenSumme.anzahl}</Text>
              </View>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.umsatz')}</Text>
                <Text style={styles.kachelWert}>CHF {wochenSumme.umsatz.toFixed(2)}</Text>
              </View>
            </View>
            <View style={styles.kachelnRow}>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.lenkzeit')}</Text>
                <Text style={styles.kachelWert}>{formatDauer(wochenSumme.lenkzeitMin)}</Text>
              </View>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.arbeitszeit')}</Text>
                <Text style={styles.kachelWert}>{formatDauer(wochenSumme.arbeitszeitMin)}</Text>
              </View>
            </View>

            {/* 7 Tageszeilen */}
            {wochenSumme.anzahl === 0 ? (
              <Text style={styles.leer}>{t('schicht.keineWoche')}</Text>
            ) : (
              <View style={styles.liste}>
                {wochenTage.map((d) => {
                  const leer = d.anzahl === 0;
                  const inZukunft = d.tag.getTime() > heute.getTime();
                  return (
                    <TouchableOpacity
                      key={d.tag.getTime()}
                      style={[styles.tagZeile, leer && styles.tagZeileLeer]}
                      onPress={() => !inZukunft && zeigeTag(d.tag)}
                      disabled={inZukunft}
                    >
                      <Text style={styles.tagZeileTag}>{formatWochentag(d.tag, loc)}</Text>
                      <View style={styles.tagZeileWerte}>
                        <Text style={styles.tagZeileFahrten}>
                          {d.anzahl} {t('schicht.anzahlFahrten')}
                        </Text>
                        <Text style={styles.tagZeileZeit}>{formatDauer(d.arbeitszeitMin)}</Text>
                      </View>
                      <Text style={styles.tagZeilePreis}>CHF {d.umsatz.toFixed(2)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  zurueck: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitel: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scroll: { paddingHorizontal: 16 },
  disclaimer: {
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  disclaimerIcon: { fontSize: 20 },
  disclaimerText: { flex: 1, fontSize: 12, color: '#78350f', lineHeight: 17 },

  modusToggle: {
    flexDirection: 'row',
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 4,
    gap: 4,
    marginBottom: 12,
  },
  modusBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  modusBtnAktiv: { backgroundColor: '#FFD700' },
  modusBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  modusBtnTextAktiv: { color: '#000' },

  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  pickerPfeil: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pickerPfeilInaktiv: { opacity: 0.4 },
  pickerText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  kachelnRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  kachel: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 10,
  },
  kachelLabel: { color: '#9ca3af', fontSize: 10, marginBottom: 3 },
  kachelHinweis: { fontSize: 8, color: '#6b7280', fontStyle: 'italic' },
  kachelWert: { color: '#FFD700', fontSize: 16, fontWeight: 'bold' },

  totalTitel: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 4 },

  leer: { color: '#9ca3af', textAlign: 'center', marginTop: 24, fontSize: 14 },
  liste: { marginTop: 8 },
  listeTitel: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 8 },

  eintrag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  eintragZeit: { alignItems: 'center', minWidth: 56 },
  eintragUhr: { color: '#FFD700', fontSize: 14, fontWeight: 'bold' },
  eintragDauer: { color: '#9ca3af', fontSize: 10, marginTop: 2 },
  eintragInfo: { flex: 1 },
  eintragRoute: { color: '#e5e7eb', fontSize: 12, marginBottom: 2 },
  eintragPreis: { color: '#FFD700', fontSize: 14, fontWeight: 'bold' },

  tagZeile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 10,
  },
  tagZeileLeer: { opacity: 0.5 },
  tagZeileTag: { color: '#fff', fontSize: 13, fontWeight: '600', minWidth: 92 },
  tagZeileWerte: { flex: 1 },
  tagZeileFahrten: { color: '#e5e7eb', fontSize: 12 },
  tagZeileZeit: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  tagZeilePreis: { color: '#FFD700', fontSize: 14, fontWeight: 'bold' },
});
