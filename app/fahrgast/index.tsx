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
import * as Location from 'expo-location';
import { collection, addDoc, serverTimestamp, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import MapComponent from '@/components/MapComponent';
import AdressSuche from '@/components/AdressSuche';
import { KoordType, OrtType } from '@/types';
import { berechneKm } from '@/utils/distanz';
import { useTranslation } from 'react-i18next';

type Kategorie = 'furtgo_x' | 'furtgo_comfort' | 'eigen';

const TARIFE = {
  furtgo_x: { grundpreis: 3.50, proKm: 2.20, label: 'Furtgo X', farbe: '#FFD700' },
  furtgo_comfort: { grundpreis: 5.00, proKm: 2.80, label: 'Furtgo Comfort', farbe: '#60a5fa' },
};

type AngebotInfo = {
  furtgo_x: { verfuegbar: boolean; preis: number };
  furtgo_comfort: { verfuegbar: boolean; preis: number };
  eigen: { verfuegbar: boolean; preis: number; fahrerId: string | null };
};

export default function FahrgastHaupt() {
  const { t } = useTranslation();
  const [standort, setStandort] = useState<KoordType | null>(null);
  const [abholOrt, setAbholOrt] = useState<OrtType | null>(null);
  const [zielOrt, setZielOrt] = useState<OrtType | null>(null);
  const [laden, setLaden] = useState(false);
  const [zielSchluessel, setZielSchluessel] = useState(0);
  const [abholSchluessel, setAbholSchluessel] = useState(0);
  const [kategorie, setKategorie] = useState<Kategorie>('furtgo_x');
  const [angebote, setAngebote] = useState<AngebotInfo | null>(null);
  const [pruefen, setPruefen] = useState(false);

  const sosAnrufen = () => {
    Linking.openURL('tel:117');
  };

  // Reverse Geocoding: GPS-Koordinaten → echte Adresse
  const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=de&addressdetails=1`,
        { headers: { Accept: 'application/json', 'User-Agent': 'MeineUberApp/1.0' } }
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
  }, []);

  // Verfügbarkeit prüfen wenn Start + Ziel vorhanden
  const pruefeVerfuegbarkeit = async (startOrt: OrtType, ziel: OrtType) => {
    setPruefen(true);
    try {
      const fahrerSnap = await getDocs(
        query(collection(db, 'fahrer'), where('online', '==', true))
      );

      const km = berechneKm(startOrt, ziel);
      const jetzt = Date.now();

      let hatX = false;
      let hatComfort = false;
      let eigenBesterPreis = 0;
      let eigenBesterFahrerId: string | null = null;
      let eigenBesterDist = Infinity;

      fahrerSnap.forEach((d) => {
        const data = d.data();
        const lastSeen = typeof data.lastSeen === 'number' ? data.lastSeen : 0;
        if (jetzt - lastSeen > 30000) {
          updateDoc(doc(db, 'fahrer', d.id), { online: false }).catch(() => {});
          return;
        }
        if (!data.standort?.latitude) return;
        const dist = berechneKm(startOrt, data.standort);
        if (dist > 10) return;

        // Angebote lesen (mit Rückwärtskompatibilität für alte tarifModus-Felder)
        let fahrerAngebote: string[] = [];
        if (Array.isArray(data.angebote) && data.angebote.length > 0) {
          fahrerAngebote = data.angebote;
        } else if (data.tarifModus) {
          // Alte Fahrer: tarifModus → angebote umwandeln
          fahrerAngebote = data.tarifModus === 'eigen' ? ['eigen'] : [data.tarifModus];
        } else {
          // Ganz alte Fahrer ohne Tarif-Infos: Standard
          fahrerAngebote = ['furtgo_x'];
        }

        if (fahrerAngebote.includes('furtgo_x')) hatX = true;
        if (fahrerAngebote.includes('furtgo_comfort')) hatComfort = true;
        if (fahrerAngebote.includes('eigen')) {
          const eigenProKm = typeof data.eigenProKm === 'number' ? data.eigenProKm : 2.20;
          const eigenPreis = Math.round((3.50 + km * eigenProKm) * 100) / 100;
          if (dist < eigenBesterDist) {
            eigenBesterPreis = eigenPreis;
            eigenBesterFahrerId = d.id;
            eigenBesterDist = dist;
          }
        }
      });

      const preisX = Math.round((TARIFE.furtgo_x.grundpreis + km * TARIFE.furtgo_x.proKm) * 100) / 100;
      const preisComfort = Math.round((TARIFE.furtgo_comfort.grundpreis + km * TARIFE.furtgo_comfort.proKm) * 100) / 100;

      const hatEigen = eigenBesterFahrerId !== null;

      setAngebote({
        furtgo_x: { verfuegbar: hatX, preis: preisX },
        furtgo_comfort: { verfuegbar: hatComfort, preis: preisComfort },
        eigen: {
          verfuegbar: hatEigen,
          preis: eigenBesterPreis,
          fahrerId: eigenBesterFahrerId,
        },
      });

      // Auto-select erstes verfügbares Angebot
      if (hatX) setKategorie('furtgo_x');
      else if (hatComfort) setKategorie('furtgo_comfort');
      else if (hatEigen) setKategorie('eigen');
    } catch (e) {
      console.error('Verfügbarkeit prüfen Fehler:', e);
    } finally {
      setPruefen(false);
    }
  };

  const gpsZuruecksetzen = async () => {
    if (standort) {
      const adresse = await reverseGeocode(standort.latitude, standort.longitude);
      const ort = { ...standort, adresse };
      setAbholOrt(ort);
      setAbholSchluessel((k) => k + 1);
      if (zielOrt) pruefeVerfuegbarkeit(ort, zielOrt);
    }
  };

  const onAbholAuswaehlen = (ort: OrtType) => {
    setAbholOrt(ort);
    if (zielOrt) pruefeVerfuegbarkeit(ort, zielOrt);
  };

  const onZielAuswaehlen = (ort: OrtType) => {
    setZielOrt(ort);
    const basis = abholOrt ?? (standort ? { ...standort, adresse: abholOrt?.adresse ?? 'Mein Standort' } : null);
    if (basis) pruefeVerfuegbarkeit(basis, ort);
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
        if (jetzt - lastSeen > 30000) {
          updateDoc(doc(db, 'fahrer', d.id), { online: false }).catch(() => {});
          return;
        }
        if (!data.standort?.latitude) return;
        const dist = berechneKm(startOrt, data.standort);
        if (dist > 10) return;

        // Angebote lesen (mit Rückwärtskompatibilität)
        let fahrerAngebote: string[] = [];
        if (Array.isArray(data.angebote) && data.angebote.length > 0) {
          fahrerAngebote = data.angebote;
        } else if (data.tarifModus) {
          fahrerAngebote = data.tarifModus === 'eigen' ? ['eigen'] : [data.tarifModus];
        } else {
          fahrerAngebote = ['furtgo_x'];
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

      const docRef = await addDoc(collection(db, 'fahrten'), {
        fahrgastId: user.uid,
        fahrgastEmail: user.email ?? null,
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
            {/* Furtgo X */}
            <TouchableOpacity
              style={[
                styles.angebotKarte,
                !angebote.furtgo_x.verfuegbar && styles.angebotNichtVerfuegbar,
                kategorie === 'furtgo_x' && angebote.furtgo_x.verfuegbar && styles.angebotAktivX,
              ]}
              onPress={() => angebote.furtgo_x.verfuegbar && setKategorie('furtgo_x')}
              disabled={!angebote.furtgo_x.verfuegbar}
            >
              <View style={styles.angebotLinks}>
                <Text style={[styles.angebotLabel, !angebote.furtgo_x.verfuegbar && styles.angebotLabelGrau]}>
                  {t('tarife.furtgoX')}
                </Text>
                <Text style={styles.angebotSub}>3.50 + 2.20/km</Text>
              </View>
              {angebote.furtgo_x.verfuegbar ? (
                <Text style={styles.angebotPreis}>CHF {angebote.furtgo_x.preis.toFixed(2)}</Text>
              ) : (
                <Text style={styles.angebotNichtText}>{t('tarife.nichtVerfuegbar')}</Text>
              )}
            </TouchableOpacity>

            {/* Furtgo Comfort */}
            <TouchableOpacity
              style={[
                styles.angebotKarte,
                !angebote.furtgo_comfort.verfuegbar && styles.angebotNichtVerfuegbar,
                kategorie === 'furtgo_comfort' && angebote.furtgo_comfort.verfuegbar && styles.angebotAktivComfort,
              ]}
              onPress={() => angebote.furtgo_comfort.verfuegbar && setKategorie('furtgo_comfort')}
              disabled={!angebote.furtgo_comfort.verfuegbar}
            >
              <View style={styles.angebotLinks}>
                <Text style={[styles.angebotLabel, !angebote.furtgo_comfort.verfuegbar && styles.angebotLabelGrau]}>
                  {t('tarife.furtgoComfort')}
                </Text>
                <Text style={styles.angebotSub}>5.00 + 2.80/km</Text>
              </View>
              {angebote.furtgo_comfort.verfuegbar ? (
                <Text style={styles.angebotPreis}>CHF {angebote.furtgo_comfort.preis.toFixed(2)}</Text>
              ) : (
                <Text style={styles.angebotNichtText}>{t('tarife.nichtVerfuegbar')}</Text>
              )}
            </TouchableOpacity>

            {/* Eigen */}
            <TouchableOpacity
              style={[
                styles.angebotKarte,
                !angebote.eigen.verfuegbar && styles.angebotNichtVerfuegbar,
                kategorie === 'eigen' && angebote.eigen.verfuegbar && styles.angebotAktivEigen,
              ]}
              onPress={() => angebote.eigen.verfuegbar && setKategorie('eigen')}
              disabled={!angebote.eigen.verfuegbar}
            >
              <View style={styles.angebotLinks}>
                <Text style={[styles.angebotLabel, !angebote.eigen.verfuegbar && styles.angebotLabelGrau]}>
                  {t('tarife.eigenTarif')}
                </Text>
                <Text style={styles.angebotSub}>{t('fahrgast.fahrerPreis')}</Text>
              </View>
              {angebote.eigen.verfuegbar ? (
                <Text style={styles.angebotPreis}>CHF {angebote.eigen.preis.toFixed(2)}</Text>
              ) : (
                <Text style={styles.angebotNichtText}>{t('tarife.nichtVerfuegbar')}</Text>
              )}
            </TouchableOpacity>

            {/* Keine Angebote */}
            {!angebote.furtgo_x.verfuegbar && !angebote.furtgo_comfort.verfuegbar && !angebote.eigen.verfuegbar && (
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
                  kategorie === 'furtgo_x' ? '#FFD700'
                    : kategorie === 'furtgo_comfort' ? '#60a5fa'
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
                {kategorie === 'eigen' ? t('tarife.eigenTarif') : kategorie === 'furtgo_x' ? t('tarife.furtgoX') : t('tarife.furtgoComfort')} — CHF {gewaehlterPreis?.toFixed(2)} {t('fahrgast.anfordern')}
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
      <TouchableOpacity style={styles.sosBtn} onPress={sosAnrufen}>
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
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  topBtnText: { fontSize: 24, fontWeight: 'bold', color: '#111', lineHeight: 26 },
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
  angebotAktivX: { borderColor: '#FFD700', backgroundColor: '#fffbeb' },
  angebotAktivComfort: { borderColor: '#60a5fa', backgroundColor: '#eff6ff' },
  angebotAktivEigen: { borderColor: '#4ade80', backgroundColor: '#f0fdf4' },
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
    bottom: 28,
    right: 14,
    backgroundColor: '#e53e3e',
    borderRadius: 28,
    width: 52,
    height: 52,
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
