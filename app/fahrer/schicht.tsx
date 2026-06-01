import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  doc,
  setDoc,
  documentId,
} from 'firebase/firestore';
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

interface PauseEintrag {
  start: Date;
  ende: Date;
  dauerMin: number;
}

interface TagMetrik {
  tag: Date;
  anzahl: number;
  umsatz: number;
  lenkzeitMin: number;
  arbeitszeitMin: number;
  pauseMin: number;
  pausen: PauseEintrag[];
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

/** Lokaler Datums-Key "YYYY-MM-DD" — Doc-ID-Bestandteil für schichten/{uid}_{datum}. */
function datumKey(d: Date): string {
  const j = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${j}-${m}-${t}`;
}

function num2(n: number): string {
  return String(n).padStart(2, '0');
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
  pausenMap: Record<string, PauseEintrag[]>,
  jetzt: Date
): TagMetrik {
  const von = tagesStart(tag);
  const bis = tagesEnde(tag);
  const fahrten = alleFahrten.filter((f) => f.start >= von && f.start <= bis);
  const events = alleEvents.filter((e) => e.timestamp >= von && e.timestamp <= bis);
  const pausen = pausenMap[datumKey(von)] ?? [];
  const pauseMin = pausen.reduce((s, p) => s + p.dauerMin, 0);

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

  // Pausen sind keine Arbeitszeit → von der Arbeitszeit abziehen (nie unter 0).
  const arbeitszeitNetto = Math.max(0, arbeitszeitMin - pauseMin);

  return {
    tag: von,
    anzahl: fahrten.length,
    umsatz,
    lenkzeitMin,
    arbeitszeitMin: arbeitszeitNetto,
    pauseMin,
    pausen,
    geschaetzt,
    fahrten,
  };
}

function ZeitStepper({
  label,
  stunde,
  minute,
  setStunde,
  setMinute,
}: {
  label: string;
  stunde: number;
  minute: number;
  setStunde: (n: number) => void;
  setMinute: (n: number) => void;
}) {
  return (
    <View style={styles.zeitWahl}>
      <Text style={styles.zeitWahlLabel}>{label}</Text>
      <View style={styles.zeitWahlRow}>
        <View style={styles.zeitSpalte}>
          <TouchableOpacity style={styles.zeitBtn} onPress={() => setStunde((stunde + 1) % 24)}>
            <Ionicons name="chevron-up" size={22} color="#FFD700" />
          </TouchableOpacity>
          <Text style={styles.zeitWert}>{num2(stunde)}</Text>
          <TouchableOpacity style={styles.zeitBtn} onPress={() => setStunde((stunde + 23) % 24)}>
            <Ionicons name="chevron-down" size={22} color="#FFD700" />
          </TouchableOpacity>
        </View>
        <Text style={styles.zeitDoppel}>:</Text>
        <View style={styles.zeitSpalte}>
          <TouchableOpacity style={styles.zeitBtn} onPress={() => setMinute((minute + 5) % 60)}>
            <Ionicons name="chevron-up" size={22} color="#FFD700" />
          </TouchableOpacity>
          <Text style={styles.zeitWert}>{num2(minute)}</Text>
          <TouchableOpacity style={styles.zeitBtn} onPress={() => setMinute((minute + 55) % 60)}>
            <Ionicons name="chevron-down" size={22} color="#FFD700" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function Schicht() {
  const { t, i18n } = useTranslation();
  const loc = i18n.language || 'de';
  const insets = useSafeAreaInsets();
  const [modus, setModus] = useState<Modus>('tag');
  const [datum, setDatum] = useState<Date>(tagesStart(new Date()));
  const [fahrten, setFahrten] = useState<FahrtZeile[]>([]);
  const [onlineEvents, setOnlineEvents] = useState<OnlineEvent[]>([]);
  const [pausenMap, setPausenMap] = useState<Record<string, PauseEintrag[]>>({});
  const [laden, setLaden] = useState(true);

  // Pause-Eingabe-Modal
  const [modalOffen, setModalOffen] = useState(false);
  const [startH, setStartH] = useState(12);
  const [startM, setStartM] = useState(0);
  const [endeH, setEndeH] = useState(12);
  const [endeM, setEndeM] = useState(30);

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
    // Range über die Doc-ID `{uid}_{YYYY-MM-DD}` — der uid-Präfix grenzt auf den
    // eigenen Fahrer ein, das Datum sortiert lexikalisch = chronologisch.
    // Vermeidet einen Composite-Index (fahrerId== + datum-Range).
    const schichtenQ = query(
      collection(db, 'schichten'),
      where(documentId(), '>=', `${uid}_${datumKey(von)}`),
      where(documentId(), '<=', `${uid}_${datumKey(bis)}`)
    );

    Promise.all([getDocs(fahrtenQ), getDocs(eventsQ), getDocs(schichtenQ)])
      .then(([fSnap, eSnap, sSnap]) => {
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

        const map: Record<string, PauseEintrag[]> = {};
        sSnap.docs.forEach((d) => {
          const data = d.data();
          const key = data.datum ?? d.id.substring(uid.length + 1);
          const arr = Array.isArray(data.pausen) ? data.pausen : [];
          map[key] = arr
            .map((p: any) => {
              const start = toDate(p.start);
              const ende = toDate(p.ende);
              return {
                start,
                ende,
                dauerMin:
                  typeof p.dauerMin === 'number'
                    ? p.dauerMin
                    : Math.max(0, Math.round((ende.getTime() - start.getTime()) / 60000)),
              };
            })
            .sort((a: PauseEintrag, b: PauseEintrag) => a.start.getTime() - b.start.getTime());
        });
        setPausenMap(map);
      })
      .catch((e) => console.log('Schicht laden Fehler (ignoriert):', e))
      .finally(() => setLaden(false));
  }, [bereich]);

  // Tagesansicht: genau ein Tag
  const tagMetrik = useMemo(
    () => metrikenFuer(datum, fahrten, onlineEvents, pausenMap, new Date()),
    [datum, fahrten, onlineEvents, pausenMap]
  );

  // Wochenansicht: 7 Tage + Summe
  const wochenTage = useMemo(() => {
    const jetzt = new Date();
    return Array.from({ length: 7 }, (_, i) =>
      metrikenFuer(addTage(wochenAnfang, i), fahrten, onlineEvents, pausenMap, jetzt)
    );
  }, [wochenAnfang, fahrten, onlineEvents, pausenMap]);

  const wochenSumme = useMemo(() => {
    return wochenTage.reduce(
      (acc, d) => ({
        anzahl: acc.anzahl + d.anzahl,
        umsatz: acc.umsatz + d.umsatz,
        lenkzeitMin: acc.lenkzeitMin + d.lenkzeitMin,
        arbeitszeitMin: acc.arbeitszeitMin + d.arbeitszeitMin,
        pauseMin: acc.pauseMin + d.pauseMin,
      }),
      { anzahl: 0, umsatz: 0, lenkzeitMin: 0, arbeitszeitMin: 0, pauseMin: 0 }
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

  // Schreibt die Pausen-Liste des aktiven Tages nach schichten/{uid}_{datum}
  const pausenSchreiben = async (key: string, liste: PauseEintrag[]) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const sortiert = [...liste].sort((a, b) => a.start.getTime() - b.start.getTime());
    const total = sortiert.reduce((s, p) => s + p.dauerMin, 0);
    const ref = doc(db, 'schichten', `${uid}_${key}`);
    try {
      await setDoc(
        ref,
        { fahrerId: uid, datum: key, pausen: sortiert, pauseMinTotal: total },
        { merge: true }
      );
      setPausenMap((prev) => ({ ...prev, [key]: sortiert }));
    } catch (e) {
      console.log('Pause speichern Fehler:', e);
      Alert.alert(t('schicht.pauseSpeichernFehler'));
    }
  };

  const pauseModalOeffnen = () => {
    const n = new Date();
    setStartH(n.getHours());
    setStartM(n.getMinutes() - (n.getMinutes() % 5));
    const e = new Date(n.getTime() + 30 * 60000);
    setEndeH(e.getHours());
    setEndeM(e.getMinutes() - (e.getMinutes() % 5));
    setModalOffen(true);
  };

  const pauseBestaetigen = () => {
    const start = new Date(datum);
    start.setHours(startH, startM, 0, 0);
    const ende = new Date(datum);
    ende.setHours(endeH, endeM, 0, 0);
    if (ende.getTime() <= start.getTime()) {
      Alert.alert(t('schicht.pauseUngueltig'));
      return;
    }
    const key = datumKey(datum);
    const neuePause: PauseEintrag = {
      start,
      ende,
      dauerMin: Math.max(0, Math.round((ende.getTime() - start.getTime()) / 60000)),
    };
    setModalOffen(false);
    pausenSchreiben(key, [...(pausenMap[key] ?? []), neuePause]);
  };

  const pauseLoeschenBestaetigen = (index: number) => {
    Alert.alert(t('schicht.pauseLoeschen'), '', [
      { text: t('schicht.abbrechen'), style: 'cancel' },
      {
        text: t('schicht.pauseLoeschen'),
        style: 'destructive',
        onPress: () => {
          const key = datumKey(datum);
          const rest = (pausenMap[key] ?? []).filter((_, i) => i !== index);
          pausenSchreiben(key, rest);
        },
      },
    ]);
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

            {/* Pausen */}
            <View style={styles.liste}>
              <View style={styles.pausenHeader}>
                <Text style={styles.listeTitel}>
                  {t('schicht.pausen')}
                  {tagMetrik.pauseMin > 0 ? ` · ${formatDauer(tagMetrik.pauseMin)}` : ''}
                </Text>
                <TouchableOpacity style={styles.pauseAddBtn} onPress={pauseModalOeffnen}>
                  <Ionicons name="add" size={18} color="#000" />
                  <Text style={styles.pauseAddText}>{t('schicht.pause')}</Text>
                </TouchableOpacity>
              </View>
              {tagMetrik.pausen.length === 0 ? (
                <Text style={styles.pausenLeer}>{t('schicht.keinePausen')}</Text>
              ) : (
                tagMetrik.pausen.map((p, i) => (
                  <View key={i} style={styles.pauseEintrag}>
                    <Ionicons name="pause-circle-outline" size={20} color="#FFD700" />
                    <Text style={styles.pauseZeit}>
                      {formatUhr(p.start)} – {formatUhr(p.ende)}
                    </Text>
                    <Text style={styles.pauseDauer}>{formatDauer(p.dauerMin)}</Text>
                    <TouchableOpacity
                      style={styles.pauseDel}
                      onPress={() => pauseLoeschenBestaetigen(i)}
                    >
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
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

      {/* Pause-Eingabe */}
      <Modal
        visible={modalOffen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOffen(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalKarte}>
            <Text style={styles.modalTitel}>{t('schicht.pauseHinzufuegen')}</Text>
            <Text style={styles.modalDatum}>{formatDatum(datum, loc, t)}</Text>
            <View style={styles.zeitRow}>
              <ZeitStepper
                label={t('schicht.pauseStart')}
                stunde={startH}
                minute={startM}
                setStunde={setStartH}
                setMinute={setStartM}
              />
              <ZeitStepper
                label={t('schicht.pauseEnde')}
                stunde={endeH}
                minute={endeM}
                setStunde={setEndeH}
                setMinute={setEndeM}
              />
            </View>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAbbr]}
                onPress={() => setModalOffen(false)}
              >
                <Text style={styles.modalBtnAbbrText}>{t('schicht.abbrechen')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSave]}
                onPress={pauseBestaetigen}
              >
                <Text style={styles.modalBtnSaveText}>{t('schicht.speichern')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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

  // Pausen
  pausenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pauseAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFD700',
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pauseAddText: { color: '#000', fontSize: 13, fontWeight: '700' },
  pausenLeer: { color: '#9ca3af', fontSize: 13, paddingVertical: 6 },
  pauseEintrag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 10,
  },
  pauseZeit: { color: '#e5e7eb', fontSize: 14, fontWeight: '600', flex: 1 },
  pauseDauer: { color: '#9ca3af', fontSize: 12 },
  pauseDel: { padding: 4 },

  // Pause-Modal
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalKarte: {
    width: '100%',
    backgroundColor: '#16213e',
    borderRadius: 18,
    padding: 20,
  },
  modalTitel: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  modalDatum: { color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 2, marginBottom: 18 },
  zeitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 22 },
  zeitWahl: { alignItems: 'center' },
  zeitWahlLabel: { color: '#9ca3af', fontSize: 12, marginBottom: 8 },
  zeitWahlRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zeitSpalte: { alignItems: 'center' },
  zeitBtn: { padding: 4 },
  zeitWert: { color: '#FFD700', fontSize: 28, fontWeight: 'bold', minWidth: 44, textAlign: 'center' },
  zeitDoppel: { color: '#FFD700', fontSize: 28, fontWeight: 'bold', marginHorizontal: 2 },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  modalBtnAbbr: { backgroundColor: '#1a1a2e' },
  modalBtnAbbrText: { color: '#9ca3af', fontSize: 15, fontWeight: '600' },
  modalBtnSave: { backgroundColor: '#FFD700' },
  modalBtnSaveText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
