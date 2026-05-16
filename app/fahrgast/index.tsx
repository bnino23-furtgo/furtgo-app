import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { collection, addDoc, serverTimestamp, getDoc, getDocs, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import MapComponent from '@/components/MapComponent';
import AdressSuche from '@/components/AdressSuche';
import { KoordType, OrtType } from '@/types';
import { berechneKm } from '@/utils/distanz';
import { useTranslation } from 'react-i18next';
import { applyLanguageForRole } from '@/i18n';

type Kategorie = 'furtgo_mini' | 'furtgo_plus' | 'furtgo_limu' | 'frei';

const TARIFE = {
  furtgo_mini: { grundpreis: 3.50, proKm: 2.20, label: 'Furtgo Mini', farbe: '#FFD700' },
  furtgo_plus: { grundpreis: 5.00, proKm: 2.80, label: 'Furtgo Plus', farbe: '#60a5fa' },
  furtgo_limu: { grundpreis: 8.00, proKm: 6.00, label: 'Furtgo Limu', farbe: '#a855f7' },
};

type AngebotInfo = {
  furtgo_mini: { verfuegbar: boolean; preis: number };
  furtgo_plus: { verfuegbar: boolean; preis: number };
  furtgo_limu: { verfuegbar: boolean; preis: number };
  frei: { verfuegbar: boolean; preis: number; fahrerId: string | null };
};

export default function FahrgastHaupt() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [standort, setStandort] = useState<KoordType | null>(null);
  const [abholOrt, setAbholOrt] = useState<OrtType | null>(null);
  const [zielOrt, setZielOrt] = useState<OrtType | null>(null);
  const [laden, setLaden] = useState(false);
  const [zielSchluessel, setZielSchluessel] = useState(0);
  const [abholSchluessel, setAbholSchluessel] = useState(0);
  const [kategorie, setKategorie] = useState<Kategorie>('furtgo_mini');
  const [angebote, setAngebote] = useState<AngebotInfo | null>(null);
  const [pruefen, setPruefen] = useState(false);

  useEffect(() => {
    applyLanguageForRole('fahrgast');
  }, []);

  const sosAnrufen = () => {
    Linking.openURL('tel:117');
  };

  // Reverse Geocoding: GPS-Koordinaten → echte Adresse
  const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=de&addressdetails=1`,
        { headers: { Accept: 'application/json', 'User-Agent': 'Furtgo/1.0' } }
      );
      const data = await res.json();
      const a = data.address || {};
      const strasse = a.road || a.pedestrian || a.footway || '';
      const nr = a.house_number || '';
      const ort = a.city || a.town || a.village || a.municipality || '';
      const plz = a.postcode || '';
      const strasseNr = nr ? `${strasse} ${nr}` : strasse;
      const ortPlz = plz ? `${plz} ${ort}` : ort;
      return [strasseNr, ortPlz].filter(Boolean).join(', ') || t('fahrgast.meinStandort');
    } catch {
      return t('fahrgast.meinStandort');
    }
  };

  useFocusEffect(
    useCallback(() => {
      setZielOrt(null);
      setAngebote(null);
      setZielSchluessel((k) => k + 1);
    }, [])
  );

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('fahrgast.berechtigungFehlt'), t('fahrgast.standortErforderlich'));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const koord = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setStandort(koord);
      const adresse = await reverseGeocode(koord.latitude, koord.longitude);
      setAbholOrt({ ...koord, adresse });
      setAbholSchluessel((k) => k + 1);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-Update: abonniert online-Fahrer, berechnet Angebote bei jeder Änderung neu
  useEffect(() => {
    const startOrt = abholOrt ?? (standort ? { ...standort, adresse: 'Mein Standort' } : null);
    if (!startOrt || !zielOrt) {
      setAngebote(null);
      setPruefen(false);
      return;
    }

    setPruefen(true);
    let ersteAntwort = true;

    const unsub = onSnapshot(
      query(collection(db, 'fahrer'), where('online', '==', true)),
      (fahrerSnap) => {
        const km = berechneKm(startOrt, zielOrt);
        const jetzt = Date.now();

        let hatMini = false;
        let hatPlus = false;
        let hatLimu = false;
        let freiBesterPreis = 0;
        let freiBesterFahrerId: string | null = null;
        let freiBesterDist = Infinity;

        fahrerSnap.forEach((d) => {
          const data = d.data();
          const lastSeen = typeof data.lastSeen === 'number' ? data.lastSeen : 0;
          // 3min Toleranz: Android drosselt JS im Background (zb wenn Bubble läuft),
          // dadurch fallen lastSeen-Updates aus. FCM-Push erreicht den Fahrer trotzdem.
          if (jetzt - lastSeen > 180000) {
            updateDoc(doc(db, 'fahrer', d.id), { online: false }).catch(() => {});
            return;
          }
          if (!data.standort?.latitude) return;
          const dist = berechneKm(startOrt, data.standort);
          if (dist > 15) return;

          let fahrerAngebote: string[] = [];
          if (Array.isArray(data.angebote) && data.angebote.length > 0) {
            fahrerAngebote = data.angebote;
          } else {
            fahrerAngebote = ['furtgo_mini'];
          }

          if (fahrerAngebote.includes('furtgo_mini')) hatMini = true;
          if (fahrerAngebote.includes('furtgo_plus')) hatPlus = true;
          if (fahrerAngebote.includes('furtgo_limu')) hatLimu = true;
          if (fahrerAngebote.includes('frei')) {
            const freiProKm = typeof data.freiProKm === 'number' ? data.freiProKm : (typeof data.eigenProKm === 'number' ? data.eigenProKm : 2.20);
            const freiGrundpreis = typeof data.freiGrundpreis === 'number' ? data.freiGrundpreis : 5.00;
            const freiPreis = Math.round((freiGrundpreis + km * freiProKm) * 100) / 100;
            if (dist < freiBesterDist) {
              freiBesterPreis = freiPreis;
              freiBesterFahrerId = d.id;
              freiBesterDist = dist;
            }
          }
        });

        const preisMini = Math.round((TARIFE.furtgo_mini.grundpreis + km * TARIFE.furtgo_mini.proKm) * 100) / 100;
        const preisPlus = Math.round((TARIFE.furtgo_plus.grundpreis + km * TARIFE.furtgo_plus.proKm) * 100) / 100;
        const preisLimu = Math.round((TARIFE.furtgo_limu.grundpreis + km * TARIFE.furtgo_limu.proKm) * 100) / 100;

        const hatFrei = freiBesterFahrerId !== null;

        setAngebote({
          furtgo_mini: { verfuegbar: hatMini, preis: preisMini },
          furtgo_plus: { verfuegbar: hatPlus, preis: preisPlus },
          furtgo_limu: { verfuegbar: hatLimu, preis: preisLimu },
          frei: { verfuegbar: hatFrei, preis: freiBesterPreis, fahrerId: freiBesterFahrerId },
        });

        // Auto-select nur beim ersten Snapshot, damit live-Updates die Auswahl nicht überschreiben
        if (ersteAntwort) {
          if (hatMini) setKategorie('furtgo_mini');
          else if (hatPlus) setKategorie('furtgo_plus');
          else if (hatLimu) setKategorie('furtgo_limu');
          else if (hatFrei) setKategorie('frei');
          ersteAntwort = false;
          setPruefen(false);
        }
      },
      (e) => {
        console.error('Fahrer-Listener Fehler:', e);
        setPruefen(false);
      }
    );

    return () => unsub();
  }, [abholOrt, zielOrt, standort]);

  const gpsZuruecksetzen = async () => {
    if (standort) {
      const adresse = await reverseGeocode(standort.latitude, standort.longitude);
      setAbholOrt({ ...standort, adresse });
      setAbholSchluessel((k) => k + 1);
    }
  };

  const onAbholAuswaehlen = (ort: OrtType) => {
    setAbholOrt(ort);
  };

  const onZielAuswaehlen = (ort: OrtType) => {
    setZielOrt(ort);
  };

  const fahrerAnfordern = async () => {
    const startOrt = abholOrt ?? (standort ? { ...standort, adresse: abholOrt?.adresse ?? 'Mein Standort' } : null);
    if (!startOrt || !zielOrt || !angebote) return;
    const user = auth.currentUser;
    if (!user) return;

    const info = angebote[kategorie];
    if (!info.verfuegbar) {
      Alert.alert(t('fahrgast.nichtVerfuegbar'), t('fahrgast.nichtVerfuegbarText'));
      return;
    }

    setLaden(true);
    try {
      // Fahrer nochmal suchen (könnte sich geändert haben)
      const fahrerSnap = await getDocs(
        query(collection(db, 'fahrer'), where('online', '==', true))
      );

      let naechsterFahrerId: string | null = null;
      let kleinsteDistanz = Infinity;
      const jetzt = Date.now();

      fahrerSnap.forEach((d) => {
        const data = d.data();
        const lastSeen = typeof data.lastSeen === 'number' ? data.lastSeen : 0;
        if (jetzt - lastSeen > 180000) {
          updateDoc(doc(db, 'fahrer', d.id), { online: false }).catch(() => {});
          return;
        }
        if (!data.standort?.latitude) return;
        const dist = berechneKm(startOrt, data.standort);
        if (dist > 15) return;

        // Angebote lesen
        let fahrerAngebote: string[] = [];
        if (Array.isArray(data.angebote) && data.angebote.length > 0) {
          fahrerAngebote = data.angebote;
        } else {
          fahrerAngebote = ['furtgo_mini'];
        }

        if (!fahrerAngebote.includes(kategorie)) return;

        if (dist < kleinsteDistanz) {
          kleinsteDistanz = dist;
          naechsterFahrerId = d.id;
        }
      });

      if (!naechsterFahrerId) {
        Alert.alert(t('fahrgast.keinFahrer'), t('fahrgast.keinFahrerText'));
        setLaden(false);
        return;
      }

      const endPreis = info.preis;

      let fahrgastVorname: string | null = null;
      try {
        const nutzerSnap = await getDoc(doc(db, 'nutzer', user.uid));
        const vn = nutzerSnap.data()?.vorname;
        if (typeof vn === 'string' && vn.trim()) fahrgastVorname = vn.trim();
      } catch {}
      if (!fahrgastVorname) {
        fahrgastVorname = (user.displayName ?? '').trim().split(/\s+/)[0] || null;
      }
      const docRef = await addDoc(collection(db, 'fahrten'), {
        fahrgastId: user.uid,
        fahrgastEmail: user.email ?? null,
        fahrgastVorname,
        fahrerId: null,
        abholort: startOrt,
        zielort: zielOrt,
        preis: endPreis,
        kategorie,
        status: 'wartend',
        zugewiesenerFahrerId: naechsterFahrerId,
        abgelehntVon: [],
        erstelltAm: serverTimestamp(),
      });
      router.push(`/fahrgast/suchen?fahrtId=${docRef.id}` as any);
    } catch (e) {
      console.error(e);
      Alert.alert(t('allgemein.fehler'), t('fahrgast.fahrtFehler'));
    } finally {
      setLaden(false);
    }
  };

  const gewaehlterPreis = angebote?.[kategorie]?.preis ?? null;
  const gewaehlteVerfuegbar = angebote?.[kategorie]?.verfuegbar ?? false;

  return (
    <View style={styles.container}>
      <MapComponent standort={standort} zielOrt={zielOrt} />

      {/* Top-Leiste */}
      <View style={styles.topLeiste}>
        <TouchableOpacity style={styles.topBtn} onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={styles.topBtnText}>{'‹'}</Text>
        </TouchableOpacity>
        <View style={styles.topRechts}>
          <TouchableOpacity style={styles.topBtn} onPress={() => router.push('/verlauf?rolle=fahrgast' as any)}>
            <Text style={styles.topBtnText}>{'📋'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={() => router.push('/profil?rolle=fahrgast' as any)}>
            <Text style={styles.topBtnText}>{'👤'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitel}>{t('fahrgast.wohin')}</Text>

        {/* Abholort */}
        <View style={styles.abholRow}>
          <View style={styles.abholFeld}>
            <AdressSuche
              key={`abholort-${abholSchluessel}`}
              placeholder={t('fahrgast.abholort')}
              onAuswahl={onAbholAuswaehlen}
              onClear={() => setAbholOrt(null)}
              initialWert={abholOrt?.adresse ?? t('fahrgast.meinStandort')}
            />
          </View>
          <TouchableOpacity style={styles.gpsButton} onPress={gpsZuruecksetzen}>
            <Text style={styles.gpsText}>{'📍'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.trennlinie} />

        {/* Ziel */}
        <AdressSuche
          key={`ziel-${zielSchluessel}`}
          placeholder={t('fahrgast.zielEingeben')}
          onAuswahl={onZielAuswaehlen}
          onClear={() => setZielOrt(null)}
        />

        {/* Laden-Indikator */}
        {pruefen && (
          <View style={styles.pruefenRow}>
            <ActivityIndicator size="small" color="#aaa" />
            <Text style={styles.pruefenText}>{t('fahrgast.fahrerSuchen')}</Text>
          </View>
        )}

        {/* Angebote anzeigen */}
        {angebote && !pruefen && (
          <View style={styles.angeboteContainer}>
            {/* Furtgo Mini */}
            <TouchableOpacity
              style={[
                styles.angebotKarte,
                !angebote.furtgo_mini.verfuegbar && styles.angebotNichtVerfuegbar,
                kategorie === 'furtgo_mini' && angebote.furtgo_mini.verfuegbar && styles.angebotAktivMini,
              ]}
              onPress={() => angebote.furtgo_mini.verfuegbar && setKategorie('furtgo_mini')}
              disabled={!angebote.furtgo_mini.verfuegbar}
            >
              <View style={styles.angebotLinks}>
                <Text style={[styles.angebotLabel, !angebote.furtgo_mini.verfuegbar && styles.angebotLabelGrau]}>
                  {t('tarife.furtgoMini')}
                </Text>
                <Text style={styles.angebotSub}>3.50 + 2.20/km</Text>
              </View>
              {angebote.furtgo_mini.verfuegbar ? (
                <Text style={styles.angebotPreis}>CHF {angebote.furtgo_mini.preis.toFixed(2)}</Text>
              ) : (
                <Text style={styles.angebotNichtText}>{t('tarife.nichtVerfuegbar')}</Text>
              )}
            </TouchableOpacity>

            {/* Furtgo Plus */}
            <TouchableOpacity
              style={[
                styles.angebotKarte,
                !angebote.furtgo_plus.verfuegbar && styles.angebotNichtVerfuegbar,
                kategorie === 'furtgo_plus' && angebote.furtgo_plus.verfuegbar && styles.angebotAktivPlus,
              ]}
              onPress={() => angebote.furtgo_plus.verfuegbar && setKategorie('furtgo_plus')}
              disabled={!angebote.furtgo_plus.verfuegbar}
            >
              <View style={styles.angebotLinks}>
                <Text style={[styles.angebotLabel, !angebote.furtgo_plus.verfuegbar && styles.angebotLabelGrau]}>
                  {t('tarife.furtgoPlus')}
                </Text>
                <Text style={styles.angebotSub}>5.00 + 2.80/km</Text>
              </View>
              {angebote.furtgo_plus.verfuegbar ? (
                <Text style={styles.angebotPreis}>CHF {angebote.furtgo_plus.preis.toFixed(2)}</Text>
              ) : (
                <Text style={styles.angebotNichtText}>{t('tarife.nichtVerfuegbar')}</Text>
              )}
            </TouchableOpacity>

            {/* Furtgo Limu */}
            <TouchableOpacity
              style={[
                styles.angebotKarte,
                !angebote.furtgo_limu.verfuegbar && styles.angebotNichtVerfuegbar,
                kategorie === 'furtgo_limu' && angebote.furtgo_limu.verfuegbar && styles.angebotAktivLimu,
              ]}
              onPress={() => angebote.furtgo_limu.verfuegbar && setKategorie('furtgo_limu')}
              disabled={!angebote.furtgo_limu.verfuegbar}
            >
              <View style={styles.angebotLinks}>
                <Text style={[styles.angebotLabel, !angebote.furtgo_limu.verfuegbar && styles.angebotLabelGrau]}>
                  {t('tarife.furtgoLimu')}
                </Text>
                <Text style={styles.angebotSub}>8.00 + 6.00/km</Text>
              </View>
              {angebote.furtgo_limu.verfuegbar ? (
                <Text style={styles.angebotPreis}>CHF {angebote.furtgo_limu.preis.toFixed(2)}</Text>
              ) : (
                <Text style={styles.angebotNichtText}>{t('tarife.nichtVerfuegbar')}</Text>
              )}
            </TouchableOpacity>

            {/* Frei wählbar */}
            <TouchableOpacity
              style={[
                styles.angebotKarte,
                !angebote.frei.verfuegbar && styles.angebotNichtVerfuegbar,
                kategorie === 'frei' && angebote.frei.verfuegbar && styles.angebotAktivFrei,
              ]}
              onPress={() => angebote.frei.verfuegbar && setKategorie('frei')}
              disabled={!angebote.frei.verfuegbar}
            >
              <View style={styles.angebotLinks}>
                <Text style={[styles.angebotLabel, !angebote.frei.verfuegbar && styles.angebotLabelGrau]}>
                  {t('tarife.frei')}
                </Text>
                <Text style={styles.angebotSub}>{t('fahrgast.fahrerPreis')}</Text>
              </View>
              {angebote.frei.verfuegbar ? (
                <Text style={styles.angebotPreis}>CHF {angebote.frei.preis.toFixed(2)}</Text>
              ) : (
                <Text style={styles.angebotNichtText}>{t('tarife.nichtVerfuegbar')}</Text>
              )}
            </TouchableOpacity>

            {/* Keine Angebote */}
            {!angebote.furtgo_mini.verfuegbar && !angebote.furtgo_plus.verfuegbar && !angebote.furtgo_limu.verfuegbar && !angebote.frei.verfuegbar && (
              <Text style={styles.keineAngeboteText}>{t('fahrgast.keinFahrerNaehe')}</Text>
            )}
          </View>
        )}

        {/* Bestell-Button */}
        {angebote && gewaehlteVerfuegbar && !pruefen && (
          <TouchableOpacity
            style={[
              styles.button,
              {
                backgroundColor:
                  kategorie === 'furtgo_mini' ? '#FFD700'
                    : kategorie === 'furtgo_plus' ? '#60a5fa'
                    : kategorie === 'furtgo_limu' ? '#a855f7'
                    : '#4ade80',
              },
              laden && styles.buttonDisabled,
            ]}
            onPress={fahrerAnfordern}
            disabled={laden}
          >
            {laden ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>
                {kategorie === 'frei' ? t('tarife.frei') : TARIFE[kategorie as keyof typeof TARIFE]?.label ?? t('tarife.furtgoMini')} — CHF {gewaehlterPreis?.toFixed(2)} {t('fahrgast.anfordern')}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {!standort && (
          <View style={styles.standortLaden}>
            <ActivityIndicator size="small" color="#aaa" />
            <Text style={styles.standortText}>{t('fahrgast.standortErmitteln')}</Text>
          </View>
        )}
      </View>

      {/* SOS */}
      <TouchableOpacity style={[styles.sosBtn, { bottom: insets.bottom + 16 }]} onPress={sosAnrufen}>
        <Text style={styles.sosBtnText}>{'🆘'}</Text>
        <Text style={styles.sosBtnLabel}>SOS</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topLeiste: {
    position: 'absolute',
    top: 44,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 1100,
  },
  topRechts: {
    flexDirection: 'row',
    gap: 10,
  },
  topBtn: {
    backgroundColor: '#fff',
    borderRadius: 50,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  topBtnText: { fontSize: 18, fontWeight: '900', color: '#111', lineHeight: 20 },
  panel: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 1000,
  },
  panelTitel: { fontSize: 13, fontWeight: 'bold', marginBottom: 6, color: '#111' },
  abholRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  abholFeld: { flex: 1 },
  gpsButton: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsText: { fontSize: 15 },
  trennlinie: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 5,
    marginLeft: 12,
  },

  // Prüfen
  pruefenRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  pruefenText: { fontSize: 11, color: '#aaa' },

  // Angebote
  angeboteContainer: { gap: 5, marginTop: 8 },
  angebotKarte: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: '#eee',
  },
  angebotAktivMini: { borderColor: '#FFD700', backgroundColor: '#fffbeb' },
  angebotAktivPlus: { borderColor: '#60a5fa', backgroundColor: '#eff6ff' },
  angebotAktivLimu: { borderColor: '#a855f7', backgroundColor: '#faf5ff' },
  angebotAktivFrei: { borderColor: '#4ade80', backgroundColor: '#f0fdf4' },
  angebotNichtVerfuegbar: { opacity: 0.45 },
  angebotLinks: {},
  angebotLabel: { fontSize: 12, fontWeight: 'bold', color: '#111' },
  angebotLabelGrau: { color: '#999' },
  angebotSub: { fontSize: 10, color: '#aaa', marginTop: 1 },
  angebotPreis: { fontSize: 14, fontWeight: 'bold', color: '#111' },
  angebotNichtText: { fontSize: 11, color: '#bbb', fontStyle: 'italic' },
  keineAngeboteText: { fontSize: 12, color: '#e53e3e', textAlign: 'center', marginTop: 6 },

  // Button
  button: {
    borderRadius: 10,
    padding: 11,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 13, fontWeight: 'bold', color: '#000' },
  standortLaden: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  standortText: { fontSize: 11, color: '#aaa' },
  sosBtn: {
    position: 'absolute',
    right: 14,
    backgroundColor: '#e53e3e',
    borderRadius: 22,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 1200,
  },
  sosBtnText: { fontSize: 18 },
  sosBtnLabel: { fontSize: 9, color: '#fff', fontWeight: 'bold', marginTop: -2 },
});
