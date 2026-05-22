import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  Platform,
  Linking,
  Switch,
  AppState,
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
import { auth, db, functions } from '@/constants/firebase';
import { httpsCallable } from 'firebase/functions';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { KoordType } from '@/types';
import { logOnlineEvent } from '@/utils/arv2';
import MapComponent from '@/components/MapComponent';
import { spieleTon } from '@/utils/ton';
import { berechneKm, formatDistanz } from '@/utils/distanz';
import Constants from 'expo-constants';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { applyLanguageForRole } from '@/i18n';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingBubble from '@/modules/floating-bubble/src';

async function abozahlungStarten() {
  try {
    const callable = httpsCallable<unknown, { paymentUrl: string }>(functions, 'createAboPaymentPage');
    const result = await callable({});
    await Linking.openURL(result.data.paymentUrl);
  } catch (e) {
    console.log('Abo-Start Fehler:', e);
    Alert.alert('Fehler', 'Abo-Seite konnte nicht erstellt werden. Bitte später erneut versuchen.');
  }
}

type Kategorie = 'furtgo_mini' | 'furtgo_plus' | 'furtgo_limu';
const TARIFE: Record<Kategorie, { grundpreis: number; proKm: number; label: string }> = {
  furtgo_mini: { grundpreis: 3.50, proKm: 2.20, label: 'Furtgo Mini' },
  furtgo_plus: { grundpreis: 5.00, proKm: 2.80, label: 'Furtgo Plus' },
  furtgo_limu: { grundpreis: 8.00, proKm: 6.00, label: 'Furtgo Limu' },
};

// expo-notifications funktioniert nicht in Expo Go ab SDK 53
const isExpoGo = Constants.executionEnvironment === 'storeClient';

let Notifications: typeof import('expo-notifications') | null = null;
if (!isExpoGo) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  // Android Notification Channel mit HIGH Priorität → Heads-Up Banner
  // Neue ID, damit Android nicht einen evtl. alten stummen Channel wiederverwendet (Channels sind immutable)
  if (Platform.OS === 'android') {
    Notifications!.setNotificationChannelAsync('fahrtanfragen_v3', {
      name: 'Fahrtanfragen',
      importance: Notifications!.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility: Notifications!.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
    // alten Channel löschen, damit der Nutzer ihn nicht in den Settings sieht
    Notifications!.deleteNotificationChannelAsync('fahrtanfragen').catch(() => {});
    Notifications!.deleteNotificationChannelAsync('fahrtanfragen_v2').catch(() => {});
  }
}

export default function FahrerDashboard() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [nameFestgelegt, setNameFestgelegt] = useState(false);
  const [profilGeladen, setProfilGeladen] = useState(false);
  const [gesperrt, setGesperrt] = useState(false);
  const [online, setOnline] = useState(false);
  const [standort, setStandort] = useState<KoordType | null>(null);
  const [anfrage, setAnfrage] = useState<any>(null);
  const [modalSichtbar, setModalSichtbar] = useState(false);
  const [verifiziert, setVerifiziert] = useState<string | null>(null);
  const [aboGueltigBis, setAboGueltigBis] = useState<number | null>(null);
  const [pfcAboAktiv, setPfcAboAktiv] = useState(false);
  const [aboAbgelaufen, setAboAbgelaufen] = useState(false);
  const [abmeldenModalSichtbar, setAbmeldenModalSichtbar] = useState(false);
  const [menuOffen, setMenuOffen] = useState(false);
  const [onboardingSichtbar, setOnboardingSichtbar] = useState(false);

  // Fahrer-Rolle ist im Web nicht unterstuetzt (Background-GPS + Notifications in iOS-Safari unzuverlaessig)
  useEffect(() => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Nur in der App verfügbar',
        'Die Fahrer-Funktionen benötigen die Android-App. Bitte lade die App herunter.',
        [{ text: 'OK', onPress: () => router.replace('/login') }]
      );
    }
  }, []);

  // Bildschirm-Einstellung beim Start laden
  useEffect(() => {
    if (Platform.OS === 'web') return;
    AsyncStorage.getItem('bildschirmWach').then((wert) => {
      if (wert === 'true') {
        activateKeepAwakeAsync();
      }
    });
    return () => { deactivateKeepAwake(); };
  }, []);

  // Fahrer-Sprache laden
  useEffect(() => {
    applyLanguageForRole('fahrer');
  }, []);

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listenUnsubRef = useRef<(() => void) | null>(null);
  const modalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anfrageRef = useRef<any>(null);
  const onlineNotifIdRef = useRef<string | null>(null);
  const bubblePermissionDeclinedRef = useRef(false);
  const battOptDeclinedRef = useRef(false);
  const letzterGeschriebenerStandortRef = useRef<KoordType | null>(null);

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
      })
      .catch((e) => console.log('Bewertung laden Fehler (ignoriert):', e));
  }, []);

  // Push-Berechtigung + Token registrieren — ohne Token kommen keine Push-Notifications
  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo || !Notifications) return;
    const registriere = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        let { status } = await Notifications!.getPermissionsAsync();
        if (status !== 'granted') {
          const r = await Notifications!.requestPermissionsAsync();
          status = r.status;
        }
        if (status !== 'granted') return;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const tokenResult = await Notifications!.getExpoPushTokenAsync({ projectId });
        const token = tokenResult.data;
        if (!token) return;
        await setDoc(doc(db, 'fahrer', user.uid), { pushToken: token }, { merge: true });
        console.log('PUSH-TOKEN registriert:', token);
      } catch (e) {
        console.log('Push-Token-Fehler (ignoriert):', e);
      }
    };
    const unsub = onAuthStateChanged(auth, (u) => { if (u) registriere(); });
    return () => unsub();
  }, []);

  // Floating Bubble: wenn Fahrer aus Settings zurückkommt und online ist, Bubble starten
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!online) return;
      if (!FloatingBubble.hasPermission()) return;
      if (FloatingBubble.isRunning()) return;
      FloatingBubble.start().catch(() => {});
    });
    return () => sub.remove();
  }, [online]);

  // Floating Bubble: wann immer offline, garantiert stoppen (defense-in-depth)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!online) {
      FloatingBubble.stop().catch(() => {});
    }
  }, [online]);

  // Beim Start: warten bis Auth bereit ist, dann Online-Status wiederherstellen
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      console.log('FAHRER AUTH:', user?.uid ?? 'kein user');
      if (!user) {
        stoppeOnlineBetrieb();
        if (Platform.OS === 'android') FloatingBubble.stop().catch(() => {});
        return;
      }
      const uid = user.uid;
      getDoc(doc(db, 'fahrer', uid)).then((snap) => {
        const data = snap.data();
        if (data?.gesperrt) {
          setGesperrt(true);
          setProfilGeladen(true);
          return;
        }
        if (data?.name) {
          setName(data.name);
          setNameFestgelegt(true);
        }
        if (data?.verifiziert) setVerifiziert(data.verifiziert);
        if (data?.aboGueltigBis) {
          setAboGueltigBis(data.aboGueltigBis);
        }
        const aboStatus = data?.abo?.status;
        const nextChargeRaw = data?.abo?.nextChargeAt;
        const nextChargeMs =
          typeof nextChargeRaw?.toMillis === 'function'
            ? nextChargeRaw.toMillis()
            : typeof nextChargeRaw?.seconds === 'number'
              ? nextChargeRaw.seconds * 1000
              : 0;
        const pfcAktiv =
          aboStatus === 'aktiv' ||
          (aboStatus === 'gekuendigt' && nextChargeMs > Date.now());
        setPfcAboAktiv(pfcAktiv);
        const altAboGueltig = typeof data?.aboGueltigBis === 'number' && data.aboGueltigBis > Date.now();
        if (!pfcAktiv && data?.aboGueltigBis && !altAboGueltig) setAboAbgelaufen(true);
        if (!data?.onboardingGesehen) setOnboardingSichtbar(true);
        const darfOnlineBeimLaden =
          data?.verifiziert === 'genehmigt' &&
          (pfcAktiv || altAboGueltig);
        if (data?.online && darfOnlineBeimLaden) {
          setOnline(true);
          const fRef = doc(db, 'fahrer', uid);
          // lastSeen sofort aktualisieren, damit Fahrgast den Fahrer nicht als Geist filtert
          standortAktualisieren().then((loc) => {
            if (loc) {
              updateDoc(fRef, { standort: loc, lastSeen: Date.now() }).catch(() => {});
              letzterGeschriebenerStandortRef.current = loc;
            }
          });
          starteOnlineBetrieb(fRef);
        } else if (data?.online && !darfOnlineBeimLaden) {
          // Altlast: online=true in DB, aber Voraussetzungen fehlen → zurücksetzen
          updateDoc(doc(db, 'fahrer', uid), { online: false }).catch(() => {});
          logOnlineEvent(uid, false, null, 'auto-pause');
        }
        setProfilGeladen(true);
      }).catch((e) => {
        console.log('Fahrer laden Fehler (ignoriert):', e);
        setProfilGeladen(true);
      });
    });
    return () => {
      unsubAuth();
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
      if (listenUnsubRef.current) listenUnsubRef.current();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      try {
        if (!auth.currentUser) return;
        const loc = await standortAktualisieren();
        if (!loc) return;
        const letzter = letzterGeschriebenerStandortRef.current;
        const bewegungM = letzter ? berechneKm(letzter, loc) * 1000 : Infinity;
        if (bewegungM < 30) {
          // Stationär (parkiert/wartet): nur lastSeen — spart Akku + Firestore-Writes
          await updateDoc(ref, { lastSeen: Date.now() });
        } else {
          await updateDoc(ref, { standort: loc, lastSeen: Date.now() });
          letzterGeschriebenerStandortRef.current = loc;
        }
      } catch (e) {
        console.log('Standort-Update Fehler (ignoriert):', e);
      }
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
            // Push kommt aus der Cloud Function (onFahrtErstellt / onFahrtZugewiesen),
            // nicht zusätzlich lokal — sonst doppelte/mehrfache Notifications.
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

  const onboardingAbschliessen = async () => {
    setOnboardingSichtbar(false);
    const ref = fahrerRef();
    if (ref) {
      try {
        await setDoc(ref, { onboardingGesehen: true }, { merge: true });
      } catch (e) {
        console.log('Onboarding speichern Fehler (ignoriert):', e);
      }
    }
  };

  const dokumenteOk = verifiziert !== null && verifiziert !== 'abgelehnt';
  const verifiziertOk = verifiziert === 'genehmigt';
  const aboOk = pfcAboAktiv || (aboGueltigBis !== null && aboGueltigBis > Date.now());
  const darfOnline = verifiziertOk && aboOk;

  const onlineSchalten = async (wert: boolean) => {
    console.log('ONLINE-SCHALTEN aufgerufen mit wert=', wert, 'darfOnline=', darfOnline);
    if (wert && !darfOnline) {
      const buttons: any[] = [{ text: t('fahrer.abbrechen'), style: 'cancel' }];
      if (!dokumenteOk) {
        buttons.push({
          text: t('fahrer.dokumenteHochladen'),
          onPress: () => router.push('/fahrer/dokumente' as any),
        });
      }
      if (!aboOk) {
        buttons.push({
          text: t('fahrer.aboBezahlen'),
          onPress: abozahlungStarten,
        });
      }
      Alert.alert(t('fahrer.nichtBereitTitel'), t('fahrer.nichtBereitText'), buttons);
      return;
    }
    const ref = fahrerRef();
    if (!ref) return;

    setOnline(wert);
    if (wert) spieleTon.onlineAn();
    else spieleTon.onlineAus();

    if (!wert) {
      // Offline: Listener sofort stoppen und online:false schreiben, BEVOR irgendein
      // langsamer Call (GPS) wartet. Sonst sieht DB/CloudFn noch online:true und
      // schickt Fahrtangebote in dem Zeitfenster.
      stoppeOnlineBetrieb();
      letzterGeschriebenerStandortRef.current = null;
      await setDoc(ref, { online: false, aktiveFahrtId: null, lastSeen: Date.now() }, { merge: true });
      const uidOff = auth.currentUser?.uid;
      if (uidOff) logOnlineEvent(uidOff, false, null, 'manuell');
      if (!isExpoGo && Notifications && onlineNotifIdRef.current) {
        Notifications.dismissNotificationAsync(onlineNotifIdRef.current).catch(() => {});
        onlineNotifIdRef.current = null;
      }
      if (Platform.OS === 'android') {
        FloatingBubble.stop().catch(() => {});
      }
      return;
    }

    let aktuellerStandort: KoordType | null = null;
    try {
      aktuellerStandort = await standortAktualisieren();
    } catch (e: any) {
      console.error('GPS-Fehler beim Online-Schalten:', e?.message ?? e);
      Alert.alert('GPS-Fehler', `Konnte Standort nicht ermitteln: ${e?.message ?? 'unbekannt'}`);
      setOnline(false);
      return;
    }
    if (!aktuellerStandort) {
      Alert.alert(t('fahrer.standortFehlt'), t('fahrer.standortFehltText'));
      setOnline(false);
      return;
    }
    try {
      await setDoc(ref, { name, online: true, standort: aktuellerStandort, aktiveFahrtId: null, lastSeen: Date.now() }, { merge: true });
      letzterGeschriebenerStandortRef.current = aktuellerStandort;
      console.log('ONLINE-SCHALTEN: setDoc(online:true) erfolgreich');
    } catch (e: any) {
      console.error('Firestore-Schreibfehler:', e?.message ?? e);
      Alert.alert('Speicher-Fehler', `Konnte Online-Status nicht speichern: ${e?.message ?? 'unbekannt'}`);
      setOnline(false);
      return;
    }
    const uid = auth.currentUser?.uid;
    if (uid) logOnlineEvent(uid, true, aktuellerStandort, 'manuell');

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
    // Floating Bubble (nur Android)
    if (Platform.OS === 'android') {
      if (FloatingBubble.hasPermission()) {
        FloatingBubble.start().catch(() => {});
      } else if (!bubblePermissionDeclinedRef.current) {
        Alert.alert(
          t('fahrer.bubblePermissionTitel'),
          t('fahrer.bubblePermissionText'),
          [
            {
              text: t('fahrer.bubblePermissionSpaeter'),
              style: 'cancel',
              onPress: () => { bubblePermissionDeclinedRef.current = true; },
            },
            {
              text: t('fahrer.bubblePermissionErlauben'),
              onPress: () => { FloatingBubble.requestPermission().catch(() => {}); },
            },
          ]
        );
      }

      // Akku-Optimierung deaktivieren (verhindert dass MIUI/EMUI/OneUI die Bubble killen)
      if (!FloatingBubble.isBatteryOptimizationIgnored() && !battOptDeclinedRef.current) {
        Alert.alert(
          t('fahrer.battOptTitel'),
          t('fahrer.battOptText'),
          [
            {
              text: t('fahrer.battOptSpaeter'),
              style: 'cancel',
              onPress: () => { battOptDeclinedRef.current = true; },
            },
            {
              text: t('fahrer.battOptErlauben'),
              onPress: () => { FloatingBubble.requestIgnoreBatteryOptimization().catch(() => {}); },
            },
          ]
        );
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

  if (!profilGeladen) {
    return <View style={[styles.nameContainer, { justifyContent: 'center' }]} />;
  }

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
        <TouchableOpacity style={styles.weiterButton} onPress={abozahlungStarten}>
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
      <View style={styles.topBar}>
        <Text style={[styles.onlineStatus, online ? styles.statusAn : styles.statusAus, !darfOnline && styles.statusGesperrt]}>
          {online ? t('fahrer.online') : t('fahrer.offline')}
        </Text>
        <Switch
          value={online}
          onValueChange={onlineSchalten}
          trackColor={{ false: '#444', true: '#FFD700' }}
          thumbColor="#fff"
        />
        <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOffen(!menuOffen)}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
      </View>

      {menuOffen && (
        <View style={styles.menuDropdown}>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOffen(false); router.push('/profil?rolle=fahrer' as any); }}>
            <Text style={styles.menuItemIcon}>👤</Text>
            <Text style={styles.menuItemText}>{t('profil.titel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOffen(false); router.push('/verlauf?rolle=fahrer' as any); }}>
            <Text style={styles.menuItemIcon}>📋</Text>
            <Text style={styles.menuItemText}>{t('verlauf.titel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOffen(false); router.push('/fahrer/einstellungen' as any); }}>
            <Text style={styles.menuItemIcon}>⚙️</Text>
            <Text style={styles.menuItemText}>{t('einstellungen.titel')}</Text>
          </TouchableOpacity>
          <View style={styles.menuTrenner} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOffen(false); setAbmeldenModalSichtbar(true); }}>
            <Text style={styles.menuItemIcon}>⎋</Text>
            <Text style={[styles.menuItemText, { color: '#f87171' }]}>{t('fahrer.abmelden')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {standort && online && (
        <View style={[styles.karteContainer, { marginBottom: insets.bottom }]}>
          <MapComponent standort={standort} standortAlsLogo />
        </View>
      )}

      {/* SOS — klein, Ecke unten rechts */}
      <TouchableOpacity style={[styles.sosBtn, { bottom: insets.bottom + 16 }]} onPress={sosAnrufen}>
        <Text style={styles.sosBtnText}>🆘</Text>
        <Text style={styles.sosBtnLabel}>SOS</Text>
      </TouchableOpacity>

      {/* Willkommens-/Onboarding-Modal */}
      <Modal visible={onboardingSichtbar} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.onboardingCard}>
            <Text style={styles.onboardingTitel}>{t('fahrer.willkommenTitel')}</Text>
            <Text style={styles.onboardingSub}>{t('fahrer.willkommenSub')}</Text>

            <View style={styles.onboardingSchritt}>
              <Text style={styles.onboardingNr}>1</Text>
              <View style={styles.onboardingTextBox}>
                <Text style={styles.onboardingSchrittTitel}>{t('fahrer.willkommenSchritt1')}</Text>
                <Text style={styles.onboardingSchrittSub}>{t('fahrer.willkommenSchritt1Sub')}</Text>
              </View>
            </View>
            <View style={styles.onboardingSchritt}>
              <Text style={styles.onboardingNr}>2</Text>
              <View style={styles.onboardingTextBox}>
                <Text style={styles.onboardingSchrittTitel}>{t('fahrer.willkommenSchritt2')}</Text>
                <Text style={styles.onboardingSchrittSub}>{t('fahrer.willkommenSchritt2Sub')}</Text>
              </View>
            </View>
            <View style={styles.onboardingSchritt}>
              <Text style={styles.onboardingNr}>3</Text>
              <View style={styles.onboardingTextBox}>
                <Text style={styles.onboardingSchrittTitel}>{t('fahrer.willkommenSchritt3')}</Text>
                <Text style={styles.onboardingSchrittSub}>{t('fahrer.willkommenSchritt3Sub')}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.onboardingBtn} onPress={onboardingAbschliessen}>
              <Text style={styles.onboardingBtnText}>{t('fahrer.losGehts')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
                onPress={() => {
                  setAbmeldenModalSichtbar(false);
                  if (Platform.OS === 'android') FloatingBubble.stop().catch(() => {});
                  signOut(auth);
                }}
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
                  anfrage.kategorie === 'furtgo_plus' ? styles.modalBadgePlus
                    : anfrage.kategorie === 'furtgo_limu' ? styles.modalBadgeLimu
                    : anfrage.kategorie === 'frei' ? styles.modalBadgeFrei
                    : styles.modalBadgeMini,
                ]}>
                  <Text style={styles.modalKategorieBadgeText}>
                    {anfrage.kategorie === 'frei' ? t('tarife.frei')
                      : TARIFE[anfrage.kategorie as Kategorie]?.label ?? t('tarife.furtgoMini')}
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
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  disabled: { opacity: 0.4 },
  weiterText: { fontSize: 12, fontWeight: 'bold', color: '#000' },

  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 12, paddingTop: 36, paddingBottom: 0 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 12,
  },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  menuIcon: { fontSize: 20, color: '#fff' },
  menuDropdown: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItemIcon: { fontSize: 18 },
  menuItemText: { fontSize: 14, color: '#fff', fontWeight: '500' },
  menuTrenner: { height: 1, backgroundColor: '#333', marginHorizontal: 16 },

  onlineStatus: { fontSize: 14, fontWeight: 'bold', flex: 1 },
  statusGesperrt: { opacity: 0.4 },
  statusAn: { color: '#4ade80' },
  statusAus: { color: '#f87171' },
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

  karteContainer: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 160,
  },

  modalKategorieBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  modalBadgeMini: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#FFD700' },
  modalBadgePlus: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#60a5fa' },
  modalBadgeLimu: { backgroundColor: '#fdf2f8', borderWidth: 1, borderColor: '#a855f7' },
  modalBadgeFrei: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#4ade80' },
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
  onboardingCard: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 44,
  },
  onboardingTitel: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFD700',
    textAlign: 'center',
    marginBottom: 6,
  },
  onboardingSub: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 24,
  },
  onboardingSchritt: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 16,
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  onboardingNr: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFD700',
    color: '#000',
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 30,
    overflow: 'hidden',
  },
  onboardingTextBox: { flex: 1 },
  onboardingSchrittTitel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 3,
  },
  onboardingSchrittSub: {
    fontSize: 12,
    color: '#888',
    lineHeight: 17,
  },
  onboardingBtn: {
    backgroundColor: '#FFD700',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  onboardingBtnText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000',
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
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  ablehnenButton: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 11,
    alignItems: 'center',
  },
  ablehnenText: { fontSize: 13, color: '#333', fontWeight: '600' },
  annehmenButton: {
    flex: 1,
    backgroundColor: '#FFD700',
    borderRadius: 12,
    padding: 11,
    alignItems: 'center',
  },
  annehmenText: { fontSize: 13, color: '#000', fontWeight: 'bold' },
});
