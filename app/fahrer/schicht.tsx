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

function formatDatum(d: Date, t: (k: string) => string): string {
  const heute = tagesStart(new Date());
  const gestern = new Date(heute);
  gestern.setDate(heute.getDate() - 1);
  const ziel = tagesStart(d);
  if (ziel.getTime() === heute.getTime()) return t('schicht.heute');
  if (ziel.getTime() === gestern.getTime()) return t('schicht.gestern');
  return d.toLocaleDateString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function Schicht() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [datum, setDatum] = useState<Date>(tagesStart(new Date()));
  const [fahrten, setFahrten] = useState<FahrtZeile[]>([]);
  const [onlineEvents, setOnlineEvents] = useState<OnlineEvent[]>([]);
  const [laden, setLaden] = useState(true);

  const heute = useMemo(() => tagesStart(new Date()), []);
  const aeltesterTag = useMemo(() => {
    const k = new Date(heute);
    k.setDate(heute.getDate() - MAX_TAGE_ZURUECK);
    return k;
  }, [heute]);

  const istHeute = datum.getTime() === heute.getTime();
  const istAeltester = datum.getTime() <= aeltesterTag.getTime();

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setLaden(true);

    const von = tagesStart(datum);
    const bis = tagesEnde(datum);

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
  }, [datum]);

  const summen = useMemo(() => {
    const lenkzeitMin = fahrten.reduce((s, f) => s + f.dauerMin, 0);
    const umsatz = fahrten.reduce((s, f) => s + f.preis, 0);

    let arbeitszeitMin = 0;
    let geschaetzt = false;
    const istHeute = tagesStart(datum).getTime() === tagesStart(new Date()).getTime();

    if (onlineEvents.length > 0) {
      // Echte Berechnung aus Online-Events
      const events: OnlineEvent[] = [...onlineEvents];
      if (!events[0].istOnline) {
        // Tag startete bereits online → virtueller Online-Event bei Tagesanfang
        events.unshift({ timestamp: tagesStart(datum), istOnline: true });
      }
      let aktuelleStart: Date | null = null;
      for (const ev of events) {
        if (ev.istOnline && !aktuelleStart) {
          aktuelleStart = ev.timestamp;
        } else if (!ev.istOnline && aktuelleStart) {
          arbeitszeitMin += Math.round((ev.timestamp.getTime() - aktuelleStart.getTime()) / 60000);
          aktuelleStart = null;
        }
      }
      if (aktuelleStart) {
        const ende = istHeute ? new Date() : tagesEnde(datum);
        arbeitszeitMin += Math.round((ende.getTime() - aktuelleStart.getTime()) / 60000);
      }
    } else if (fahrten.length > 0) {
      // Fallback: erste→letzte Fahrt, geschätzt
      const erste = fahrten[0].start;
      const letzte = fahrten[fahrten.length - 1].ende;
      arbeitszeitMin = Math.max(0, Math.round((letzte.getTime() - erste.getTime()) / 60000));
      geschaetzt = true;
    }

    return { lenkzeitMin, arbeitszeitMin, umsatz, anzahl: fahrten.length, geschaetzt };
  }, [fahrten, onlineEvents, datum]);

  const tagWechsel = (tage: number) => {
    const neu = new Date(datum);
    neu.setDate(datum.getDate() + tage);
    const neuStart = tagesStart(neu);
    if (neuStart > heute || neuStart < aeltesterTag) return;
    setDatum(neuStart);
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

        {/* Tag-Picker */}
        <View style={styles.tagPicker}>
          <TouchableOpacity
            style={[styles.tagPfeil, istAeltester && styles.tagPfeilInaktiv]}
            onPress={() => tagWechsel(-1)}
            disabled={istAeltester}
          >
            <Ionicons name="chevron-back" size={22} color={istAeltester ? '#555' : '#FFD700'} />
          </TouchableOpacity>
          <Text style={styles.tagText}>{formatDatum(datum, t)}</Text>
          <TouchableOpacity
            style={[styles.tagPfeil, istHeute && styles.tagPfeilInaktiv]}
            onPress={() => tagWechsel(1)}
            disabled={istHeute}
          >
            <Ionicons name="chevron-forward" size={22} color={istHeute ? '#555' : '#FFD700'} />
          </TouchableOpacity>
        </View>

        {laden ? (
          <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 32 }} />
        ) : (
          <>
            {/* Kennzahlen */}
            <View style={styles.kachelnRow}>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.anzahlFahrten')}</Text>
                <Text style={styles.kachelWert}>{summen.anzahl}</Text>
              </View>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.umsatz')}</Text>
                <Text style={styles.kachelWert}>CHF {summen.umsatz.toFixed(2)}</Text>
              </View>
            </View>
            <View style={styles.kachelnRow}>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>{t('schicht.lenkzeit')}</Text>
                <Text style={styles.kachelWert}>{formatDauer(summen.lenkzeitMin)}</Text>
              </View>
              <View style={styles.kachel}>
                <Text style={styles.kachelLabel}>
                  {t('schicht.arbeitszeit')}
                  {summen.geschaetzt && <Text style={styles.kachelHinweis}> {t('schicht.geschaetzt')}</Text>}
                </Text>
                <Text style={styles.kachelWert}>{formatDauer(summen.arbeitszeitMin)}</Text>
              </View>
            </View>

            {/* Fahrten-Liste */}
            {fahrten.length === 0 ? (
              <Text style={styles.leer}>{t('schicht.keineFahrten')}</Text>
            ) : (
              <View style={styles.liste}>
                <Text style={styles.listeTitel}>{t('schicht.fahrten')}</Text>
                {fahrten.map((f) => (
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
  tagPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tagPfeil: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  tagPfeilInaktiv: { opacity: 0.4 },
  tagText: { color: '#fff', fontSize: 16, fontWeight: '600' },
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
});
