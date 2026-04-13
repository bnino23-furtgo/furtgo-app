import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import {
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  updateDoc,
  getDocs,
  arrayUnion,
} from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { KoordType } from '@/types';
import MapComponent from '@/components/MapComponent';
import { spieleTon } from '@/utils/ton';
import { formatDistanz, berechneKm } from '@/utils/distanz';
import { Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import { Switch } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

const SUMUP_LINK = 'https://pay.sumup.com/b2c/X8YC4RF074';

type Kategorie = 'furtgo_x' | 'furtgo_comfort';
const TARIFE: Record<Kategorie, { grundpreis: number; proKm: number; label: string }> = {
  furtgo_x: { grundpreis: 3.50, proKm: 2.20, label: 'Furtgo X' },
  furtgo_comfort: { grundpreis: 5.00, proKm: 2.80, label: 'Furtgo Comfort' },
};

// expo-notifications funktioniert nicht in Expo Go ab SDK 53
const isExpoGo = Constants.executionEnvironment === 'storeClient';

let Notifications: typeof import('expo-notifications') | null = null;
if (!isExpoGo) {
  Notifications = require('expo-notifications');
  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export default function FahrerDashboard() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [nameFestgelegt, setNameFestgelegt] = useState(false);
  const [gesperrt, setGesperrt] = useState(false);
  const [online, setOnline] = useState(false);
  const [standort, setStandort] = useState<KoordType | null>(null);
  const [anfrage, setAnfrage] = useState<any>(null);
  const [modalSichtbar, setModalSichtbar] = useState(false);
  const [verifiziert, setVerifiziert] = useState<string | null>(null);
  const [aboAbgelaufen, setAboAbgelaufen] = useState(false);
  const [abmeldenModalSichtbar, setAbmeldenModalSichtbar] = useState(false);
  // Bildschirm-Einstellung beim Start laden
  useEffect(() => {
    AsyncStorage.getItem('bildschirmWach').then((wert) => {
      if (wert === 'true') {
        activateKeepAwakeAsync();
      }
    });
    return () => { deactivateKeepAwake(); };
  }, []);

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listenUnsubRef = useRef<(() => void) | null>(null);
  const modalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anfrageRef = useRef<any>(null);
  const onlineNotifIdRef = useRef<string | null>(null);

  // Durchschnittsbewertung laden und in Firestore speichern
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Nur nach fahrerId filtern — kein zusammengesetzter Index nötig
    getDocs(query(collection(db, 'fahrten'), where('fahrerId', '==', uid)))
      .then(async (snap) => {
        const bewertet = snap.docs.filter((d) => (d.data().bewertung ?? 0) > 0);
        if (bewertet.length === 0) return;
        const summe = bewertet.reduce((acc, d) => acc + (d.data().bewertung ?? 0), 0);
        const durchschnitt = Math.round((summe / bewertet.length) * 10) / 10;
        await setDoc(doc(db, 'fahrer', uid), { bewertungsDurchschnitt: durchschnitt }, { merge: true });
      });
  }, []);

  // Push-Berechtigung anfragen
  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo || !Notifications) return;
    Notifications.requestPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
    });
  }, []);

  // Beim Start: warten bis Auth bereit ist, dann Online-Status wiederherstellen
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      console.log('FAHRER AUTH:', user?.uid ?? 'kein user');
      if (!user) {
        stoppeOnlineBetrieb();
        return;
      }
      const uid = user.uid;
      getDoc(doc(db, 'fahrer', uid)).then((snap) => {
        const data = snap.data();
        if (data?.gesperrt) {
          setGesperrt(true);
          return;
        }
        if (data?.name) {
          setName(data.name);
          setNameFestgelegt(true);
        }
        if (data?.verifiziert) setVerifiziert(data.verifiziert);
        if (data?.aboGueltigBis && data.aboGueltigBis < Date.now()) setAboAbgelaufen(true);
        if (data?.online) {
          setOnline(true);
          const fRef = doc(db, 'fahrer', uid);
          // lastSeen sofort aktualisieren, damit Fahrgast den Fahrer nicht als Geist filtert
          standortAktualisieren().then((loc) => {
            if (loc) updateDoc(fRef, { standort: loc, lastSeen: Date.now() }).catch(() => {});
          });
          starteOnlineBetrieb(fRef);
        }
      });
    });
    return () => {
      unsubAuth();
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
      if (listenUnsubRef.current) listenUnsubRef.current();
    };
  }, []);

  const sosAnrufen = () => {
    Linking.openURL('tel:117');
  };

  const fahrerRef = () => {
    const uid = auth.currentUser?.uid;
    return uid ? doc(db, 'fahrer', uid) : null;
  };

  const standortAktualisieren = async (): Promise<KoordType | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    setStandort(coords);
    return coords;
  };

  const starteOnlineBetrieb = (ref: any) => {
    if (locationIntervalRef.current) return; // läuft bereits
    locationIntervalRef.current = setInterval(async () => {
      const loc = await standortAktualisieren();
      if (loc) await updateDoc(ref, { standort: loc, lastSeen: Date.now() });
    }, 10000);

    const uid = auth.currentUser?.uid;
    console.log('STARTE ONLINE BETRIEB, uid:', uid);
    if (!uid) return;

    const q = query(collection(db, 'fahrten'), where('status', '==', 'wartend'));
    listenUnsubRef.current = onSnapshot(q, (snap) => {
      console.log('SNAPSHOT:', snap.docs.length, 'wartende Fahrten, uid:', uid);
      snap.docs.forEach(d => console.log('  Fahrt:', d.id, 'zugewiesen an:', d.data().zugewiesenerFahrerId));
      const zugewieseneDoc = snap.docs.find((d) => d.data().zugewiesenerFahrerId === uid);
      if (zugewieseneDoc) {
        const d = zugewieseneDoc;
        setAnfrage((prev: any) => {
          if (!prev || prev.id !== d.id) {
            const neueAnfrage = { id: d.id, ...d.data() };
            anfrageRef.current = neueAnfrage;
            spieleTon.neuerAuftrag();
            if (Platform.OS !== 'web' && !isExpoGo && Notifications) {
              Notifications.scheduleNotificationAsync({
                content: {
                  title: '🔔 Neue Fahrtanfrage!',
                  body: `Ziel: ${d.data().zielort?.adresse ?? 'Unbekannt'}`,
                },
                trigger: null,
              });
            }
            // Modal nach 20 Sekunden automatisch schließen → Fahrt weitergeben
            if (modalTimeoutRef.current) clearTimeout(modalTimeoutRef.current);
            modalTimeoutRef.current = setTimeout(() => {
              const aktuelleAnfrage = anfrageRef.current;
              spieleTon.stopAuftrag();
              setModalSichtbar(false);
              setAnfrage(null);
              anfrageRef.current = null;
              if (aktuelleAnfrage && uid) {
                updateDoc(doc(db, 'fahrten', aktuelleAnfrage.id), {
                  zugewiesenerFahrerId: null,
                  abgelehntVon: arrayUnion(uid),
                }).catch((err) => console.error('Timeout-Update Fehler:', err));
              }
            }, 20000);
          }
          return { id: d.id, ...d.data() };
        });
        setModalSichtbar(true);
      } else {
        if (modalTimeoutRef.current) clearTimeout(modalTimeoutRef.current);
        setAnfrage(null);
        anfrageRef.current = null;
        setModalSichtbar(false);
      }
    }, (err) => console.error('Fahrten-Listener Fehler:', err));
  };

  const stoppeOnlineBetrieb = () => {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
    if (listenUnsubRef.current) {
      listenUnsubRef.current();
      listenUnsubRef.current = null;
    }
    setAnfrage(null);
    setModalSichtbar(false);
  };

  const onlineSchalten = async (wert: boolean) => {
    const ref = fahrerRef();
    if (!ref) return;

    setOnline(wert);
    const aktuellerStandort = await standortAktualisieren();
    if (wert && !aktuellerStandort) {
      Alert.alert(t('fahrer.standortFehlt'), t('fahrer.standortFehltText'));
      setOnline(false);
      return;
    }
    await setDoc(ref, { name, online: wert, standort: aktuellerStandort, aktiveFahrtId: null, lastSeen: Date.now() }, { merge: true });

    if (wert) {
      starteOnlineBetrieb(ref);
      // Persistente Benachrichtigung — Logo in Statusleiste sichtbar (wie Uber/Bolt)
      if (Platform.OS !== 'web' && !isExpoGo && Notifications) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: t('fahrer.benachrichtigung'),
            body: t('fahrer.benachrichtigungText'),
            sticky: true,
            autoDismiss: false,
          } as any,
          trigger: null,
        }).then((id) => { onlineNotifIdRef.current = id; }).catch(() => {});
      }
    } else {
      stoppeOnlineBetrieb();
      // Persistente Benachrichtigung entfernen
      if (!isExpoGo && Notifications && onlineNotifIdRef.current) {
        Notifications.dismissNotificationAsync(onlineNotifIdRef.current).catch(() => {});
        onlineNotifIdRef.current = null;
      }
    }
  };

  const annehmen = async () => {
    if (!anfrage) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (modalTimeoutRef.current) clearTimeout(modalTimeoutRef.current);
    spieleTon.stopAuftrag();

    // Preis bleibt wie vom Fahrgast gewählt (auch bei Eigen — Preis wurde schon berechnet)
    const neuerPreis = anfrage.preis ?? 0;

    await updateDoc(doc(db, 'fahrten', anfrage.id), {
      status: 'angenommen',
      fahrerId: uid,
      preis: neuerPreis,
    });
    const ref = fahrerRef();
    if (ref) await updateDoc(ref, { aktiveFahrtId: anfrage.id });

    setModalSichtbar(false);
    router.push(`/fahrer/fahrt?fahrtId=${anfrage.id}` as any);
  };

  const ablehnen = async () => {
    if (!anfrage) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (modalTimeoutRef.current) clearTimeout(modalTimeoutRef.current);
    spieleTon.stopAuftrag();
    // Fahrt nicht abbrechen — Zuweisung aufheben, nächsten Fahrer suchen
    await updateDoc(doc(db, 'fahrten', anfrage.id), {
      zugewiesenerFahrerId: null,
      abgelehntVon: arrayUnion(uid),
    });
    setModalSichtbar(false);
    setAnfrage(null);
    anfrageRef.current = null;
  };

  if (gesperrt) {
    return (
      <View style={styles.nameContainer}>
        <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 16 }}>🚫</Text>
        <Text style={styles.nameTitel}>{t('fahrer.kontoGesperrt')}</Text>
        <Text style={styles.nameSub}>
          {t('fahrer.gesperrtText')}
        </Text>
        <TouchableOpacity style={styles.weiterButton} onPress={() => router.replace('/')}>
          <Text style={styles.weiterText}>{t('fahrer.zurueck')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (aboAbgelaufen) {
    return (
      <View style={styles.nameContainer}>
        <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 16 }}>💳</Text>
        <Text style={styles.nameTitel}>{t('fahrer.aboAbgelaufen')}</Text>
        <Text style={styles.nameSub}>
          {t('fahrer.aboAbgelaufenText')}
        </Text>
        <TouchableOpacity style={styles.weiterButton} onPress={() => Linking.openURL(SUMUP_LINK)}>
          <Text style={styles.weiterText}>{t('fahrer.aboBezahlen')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.weiterButton, { backgroundColor: '#16213e', marginTop: 10 }]} onPress={() => router.replace('/')}>
          <Text style={[styles.weiterText, { color: '#aaa' }]}>{t('fahrer.zurueck')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!nameFestgelegt) {
    return (
      <View style={styles.nameContainer}>
        <Text style={styles.nameTitel}>{t('fahrer.wieHeisst')}</Text>
        <Text style={styles.nameSub}>{t('fahrer.nameAngezeigt')}</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder={t('fahrer.deinName')}
          placeholderTextColor="#555"
          autoFocus
        />
        <TouchableOpacity
          style={[styles.weiterButton, !name.trim() && styles.disabled]}
          onPress={async () => {
            if (!name.trim()) return;
            const uid = auth.currentUser?.uid;
            if (uid) {
              await setDoc(doc(db, 'fahrer', uid), { name: name.trim() }, { merge: true });
            }
            setNameFestgelegt(true);
          }}
        >
          <Text style={styles.weiterText}>{t('fahrer.weiter')}</Text>
        </TouchableOpacity>
      </View>
    );
  }


  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLinks}>
          <Text style={styles.willkommen} numberOfLines={1}>{t('fahrer.hallo', { name })}</Text>
          <Text style={styles.headerSub}>{t('fahrer.dashboard')}</Text>
        </View>
        <View style={styles.headerRechts}>
          <TouchableOpacity onPress={() => router.push('/verlauf?rolle=fahrer' as any)}>
            <Text style={styles.headerBtn}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/profil?rolle=fahrer' as any)}>
            <Text style={styles.headerBtn}>👤</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/fahrer/einstellungen' as any)}>
            <Text style={styles.headerBtn}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAbmeldenModalSichtbar(true)}>
            <Text style={styles.abmeldenText}>⎋</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        {/* Status + Switch */}
        <View style={styles.onlineRow}>
          <Text style={[styles.onlineStatus, online ? styles.statusAn : styles.statusAus]}>
            {online ? t('fahrer.online') : t('fahrer.offline')}
          </Text>
          <Switch
            value={online}
            onValueChange={onlineSchalten}
            trackColor={{ false: '#444', true: '#FFD700' }}
            thumbColor="#fff"
          />
        </View>

        {online && <Text style={styles.warteText}>{t('fahrer.warteAufAnfragen')}</Text>}
      </View>

      {standort && online && (
        <View style={styles.karteContainer}>
          <MapComponent standort={standort} />
        </View>
      )}

      {/* SOS — klein, Ecke unten rechts */}
      <TouchableOpacity style={styles.sosBtn} onPress={sosAnrufen}>
        <Text style={styles.sosBtnText}>🆘</Text>
        <Text style={styles.sosBtnLabel}>SOS</Text>
      </TouchableOpacity>

      {/* Abmelden-Modal */}
      <Modal visible={abmeldenModalSichtbar} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { alignItems: 'center' }]}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 }}>{t('fahrer.abmeldenFrage')}</Text>
            <Text style={{ color: '#aaa', marginBottom: 24, textAlign: 'center' }}>{t('fahrer.abmeldenText')}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setAbmeldenModalSichtbar(false)}
                style={{ flex: 1, backgroundColor: '#333', padding: 12, borderRadius: 10, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('fahrer.abbrechen')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setAbmeldenModalSichtbar(false); signOut(auth); }}
                style={{ flex: 1, backgroundColor: '#e53e3e', padding: 12, borderRadius: 10, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('fahrer.abmelden')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Anfrage-Modal */}
      <Modal visible={modalSichtbar} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitel}>{t('fahrer.neueAnfrage')}</Text>
            {anfrage && (
              <>
                {/* Kategorie-Badge */}
                <View style={[
                  styles.modalKategorieBadge,
                  anfrage.kategorie === 'furtgo_comfort' ? styles.modalBadgeComfort
                    : anfrage.kategorie === 'eigen' ? styles.modalBadgeEigen
                    : styles.modalBadgeX,
                ]}>
                  <Text style={styles.modalKategorieBadgeText}>
                    {anfrage.kategorie === 'eigen' ? t('tarife.eigenTarif')
                      : TARIFE[anfrage.kategorie as Kategorie]?.label ?? t('tarife.furtgoX')}
                  </Text>
                  <Text style={styles.modalKategoriePreis}>
                    CHF {(anfrage.preis ?? 0).toFixed(2)}
                  </Text>
                </View>

                {standort && anfrage?.abholort && (
                  <View style={styles.distanzBox}>
                    <Text style={styles.distanzText}>
                      {t('fahrer.bisZumFahrgast', { distanz: formatDistanz(standort, anfrage.abholort) })}
                    </Text>
                    {anfrage?.zielort && (
                      <Text style={styles.distanzText}>
                        {t('fahrer.fahrtstrecke', { distanz: formatDistanz(anfrage.abholort, anfrage.zielort) })}
                      </Text>
                    )}
                  </View>
                )}

                <View style={styles.routeBox}>
                  <View style={styles.routeZeile}>
                    <View style={styles.punktBlau} />
                    <View style={styles.routeTextBox}>
                      <Text style={styles.routeLabel}>{t('fahrer.abholung')}</Text>
                      <Text style={styles.routeAdresse}>
                        {anfrage.abholort?.adresse ?? 'Aktueller Standort'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.routeLinie} />
                  <View style={styles.routeZeile}>
                    <View style={styles.punktGruen} />
                    <View style={styles.routeTextBox}>
                      <Text style={styles.routeLabel}>{t('fahrer.ziel')}</Text>
                      <Text style={[styles.routeAdresse, styles.zielAdresse]}>
                        {anfrage.zielort?.adresse ?? t('allgemein.unbekannt')}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.karteVorschau}>
                  <MapComponent
                    standort={anfrage.abholort}
                    zielOrt={anfrage.zielort}
                  />
                </View>
              </>
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.ablehnenButton} onPress={ablehnen}>
                <Text style={styles.ablehnenText}>{t('fahrer.ablehnen')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.annehmenButton} onPress={annehmen}>
                <Text style={styles.annehmenText}>{t('fahrer.annehmen')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  nameContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'flex-start',
    paddingTop: 80,
    padding: 20,
  },
  nameTitel: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 6,
  },
  nameSub: { fontSize: 12, color: '#aaa', textAlign: 'center', marginBottom: 20 },
  nameInput: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#fff',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  weiterButton: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
  },
  disabled: { opacity: 0.4 },
  weiterText: { fontSize: 14, fontWeight: 'bold', color: '#000' },

  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 12, paddingTop: 36 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  headerLinks: { flex: 1, marginRight: 10 },
  willkommen: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  headerSub: { fontSize: 10, color: '#aaa', marginTop: 1 },
  headerRechts: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 },
  headerBtn: { fontSize: 18 },
  verlaufText: { fontSize: 12, color: '#FFD700' },
  abmeldenText: { fontSize: 18, color: '#aaa' },

  card: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  onlineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  onlineStatus: { fontSize: 13, fontWeight: 'bold' },
  statusAn: { color: '#4ade80' },
  statusAus: { color: '#f87171' },
  warteText: { color: '#aaa', textAlign: 'center', fontSize: 11, marginBottom: 4 },
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

  karteContainer: { flex: 1, borderRadius: 14, overflow: 'hidden', minHeight: 160 },

  modalKategorieBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  modalBadgeX: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#FFD700' },
  modalBadgeComfort: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#60a5fa' },
  modalBadgeEigen: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#4ade80' },
  modalKategorieBadgeText: { fontSize: 14, fontWeight: 'bold', color: '#111' },
  modalKategoriePreis: { fontSize: 16, fontWeight: 'bold', color: '#111' },

  infoZeile: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 },
  aboButton: {
    backgroundColor: '#0f2035',
    borderRadius: 8,
    padding: 9,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  aboButtonText: { fontSize: 12, color: '#FFD700', fontWeight: '600' },
  verifGenehmigt: { color: '#4ade80', fontWeight: '700', fontSize: 11 },
  verifAusstehend: { color: '#FFD700', fontWeight: '700', fontSize: 11 },
  verifOffen: { color: '#aaa', fontSize: 11, textDecorationLine: 'underline' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 44,
  },
  modalTitel: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  distanzBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  distanzText: { fontSize: 13, color: '#333', fontWeight: '600' },
  routeBox: {
    backgroundColor: '#f8f8f8',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  routeZeile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeLinie: {
    width: 2,
    height: 16,
    backgroundColor: '#ddd',
    marginLeft: 9,
    marginVertical: 2,
  },
  punktBlau: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3b82f6',
  },
  punktGruen: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#22c55e',
  },
  routeTextBox: { flex: 1 },
  routeLabel: { fontSize: 10, color: '#aaa', fontWeight: '700', letterSpacing: 0.5 },
  routeAdresse: { fontSize: 14, color: '#333', fontWeight: '500', marginTop: 1 },
  zielAdresse: { color: '#111', fontWeight: '700', fontSize: 15 },
  karteVorschau: {
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 4,
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  ablehnenButton: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  ablehnenText: { fontSize: 15, color: '#333', fontWeight: '600' },
  annehmenButton: {
    flex: 1,
    backgroundColor: '#FFD700',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  annehmenText: { fontSize: 15, color: '#000', fontWeight: 'bold' },
});
