import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Linking, Platform, Alert, Animated } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { doc, onSnapshot, updateDoc, collection, query, orderBy, addDoc, getDoc, where, arrayUnion } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import MapComponent from '@/components/MapComponent';
import Chat from '@/components/Chat';
import { FahrtStatus, KoordType, OrtType } from '@/types';
import { spieleTon } from '@/utils/ton';
import { formatDistanz } from '@/utils/distanz';
import { useTranslation } from 'react-i18next';

type Kategorie = 'furtgo_mini' | 'furtgo_plus' | 'furtgo_limu';
const TARIFE: Record<Kategorie, { label: string }> = {
  furtgo_mini: { label: 'Furtgo Mini' },
  furtgo_plus: { label: 'Furtgo Plus' },
  furtgo_limu: { label: 'Furtgo Limu' },
};

export default function FahrerFahrt() {
  const { t } = useTranslation();
  const { fahrtId } = useLocalSearchParams<{ fahrtId: string }>();
  const [status, setStatus] = useState<FahrtStatus>('angenommen');
  const [abholort, setAbholort] = useState<OrtType | null>(null);
  const [zielort, setZielort] = useState<OrtType | null>(null);
  const [meinStandort, setMeinStandort] = useState<KoordType | null>(null);
  const [preis, setPreis] = useState<number | null>(null);
  const [, setFahrgastId] = useState<string | null>(null);
  const [fahrgastEmail, setFahrgastEmail] = useState<string | null>(null);
  const [chatOffen, setChatOffen] = useState(false);
  const [ungelesen, setUngelesen] = useState(0);
  const [stornierenModal, setStornierenModal] = useState(false);
  const gelesenBisRef = useRef(0);

  // Neue Anfrage während Fahrt
  const [neueAnfrage, setNeueAnfrage] = useState<any>(null);
  const [bannerSichtbar, setBannerSichtbar] = useState(false);
  const [warteschlange, setWarteschlange] = useState<string[]>([]);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const neueAnfrageRef = useRef<any>(null);
  const bannerSlide = useRef(new Animated.Value(-200)).current;

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!fahrtId) return;

    const unsubscribe = onSnapshot(doc(db, 'fahrten', fahrtId), (snap) => {
      const data = snap.data();
      if (!data) return;
      setStatus(data.status);
      setAbholort(data.abholort);
      setZielort(data.zielort);
      if (data.preis != null) setPreis(data.preis);
      if (data.fahrgastId) setFahrgastId(data.fahrgastId);
      if (data.fahrgastEmail) setFahrgastEmail(data.fahrgastEmail);
    }, (err) => console.log('Fahrt-Listener Fehler (ignoriert):', err));

    startStandortUpdates();

    const meinUid = auth.currentUser?.uid;
    const chatQ = query(collection(db, 'fahrten', fahrtId, 'nachrichten'), orderBy('erstelltAm', 'asc'));
    const unsubChat = onSnapshot(chatQ, (snap) => {
      const fremde = snap.docs.filter((d) => d.data().senderId !== meinUid).length;
      setUngelesen(Math.max(0, fremde - gelesenBisRef.current));
    }, (err) => console.log('Chat-Listener Fehler (ignoriert):', err));

    // Listener für neue Anfragen während der Fahrt
    const meinUid2 = auth.currentUser?.uid;
    let unsubNeueAnfragen: (() => void) | null = null;
    if (meinUid2) {
      const anfragenQ = query(collection(db, 'fahrten'), where('status', '==', 'wartend'));
      unsubNeueAnfragen = onSnapshot(anfragenQ, (snap) => {
        const zugewiesene = snap.docs.find((d) => d.data().zugewiesenerFahrerId === meinUid2 && d.id !== fahrtId);
        if (zugewiesene) {
          const daten = { id: zugewiesene.id, ...zugewiesene.data() };
          neueAnfrageRef.current = daten;
          setNeueAnfrage(daten);
          setBannerSichtbar(true);
          spieleTon.neuerAuftrag();
          Animated.spring(bannerSlide, { toValue: 0, useNativeDriver: true }).start();

          if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
          bannerTimeoutRef.current = setTimeout(() => {
            bannerAblehnen();
          }, 20000);
        } else {
          if (!neueAnfrageRef.current) {
            setBannerSichtbar(false);
            Animated.timing(bannerSlide, { toValue: -200, duration: 200, useNativeDriver: true }).start();
          }
        }
      }, (err) => console.log('Neue-Anfragen-Listener Fehler (ignoriert):', err));
    }

    return () => {
      unsubscribe();
      unsubChat();
      if (unsubNeueAnfragen) unsubNeueAnfragen();
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fahrtId]);

  const startStandortUpdates = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const updateLoc = async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setMeinStandort(coords);
        const uid = auth.currentUser?.uid;
        if (uid) await updateDoc(doc(db, 'fahrer', uid), { standort: coords });
      } catch (e) {
        console.log('Fahrt-Standort-Update Fehler (ignoriert):', e);
      }
    };

    await updateLoc();
    locationIntervalRef.current = setInterval(updateLoc, 5000);
  };

  const bannerAnnehmen = async () => {
    if (!neueAnfrage) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    spieleTon.stopAuftrag();

    // Fahrt in Warteschlange speichern
    setWarteschlange((prev) => [...prev, neueAnfrage.id]);

    // Fahrt als angenommen markieren, aber Status bleibt "wartend" bis aktuelle Fahrt fertig
    // Wir speichern die naechsteFahrtId im Fahrer-Dokument
    await updateDoc(doc(db, 'fahrer', uid), { naechsteFahrtId: neueAnfrage.id });

    setBannerSichtbar(false);
    setNeueAnfrage(null);
    neueAnfrageRef.current = null;
    Animated.timing(bannerSlide, { toValue: -200, duration: 200, useNativeDriver: true }).start();
    Alert.alert(t('fahrt.angenommen'), t('fahrt.angenommenText'));
  };

  const bannerAblehnen = async () => {
    if (!neueAnfrage) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    spieleTon.stopAuftrag();

    await updateDoc(doc(db, 'fahrten', neueAnfrage.id), {
      zugewiesenerFahrerId: null,
      abgelehntVon: arrayUnion(uid),
    });

    setBannerSichtbar(false);
    setNeueAnfrage(null);
    neueAnfrageRef.current = null;
    Animated.timing(bannerSlide, { toValue: -200, duration: 200, useNativeDriver: true }).start();
  };

  const navigationStarten = (ziel: OrtType) => {
    const { latitude, longitude } = ziel;
    const label = encodeURIComponent(ziel.adresse ?? 'Ziel');

    if (Platform.OS === 'ios') {
      // Erst Waze versuchen, dann Apple Maps
      Linking.canOpenURL('waze://').then((wazeVerfuegbar) => {
        if (wazeVerfuegbar) {
          Linking.openURL(`waze://?ll=${latitude},${longitude}&navigate=yes`);
        } else {
          Linking.openURL(`maps://app?daddr=${latitude},${longitude}&q=${label}`);
        }
      });
    } else {
      // Android: Google Maps
      Linking.openURL(`google.navigation:q=${latitude},${longitude}`).catch(() => {
        // Fallback: Google Maps im Browser
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`);
      });
    }
  };

  const stornierenBestaetigen = async () => {
    if (!fahrtId) return;
    setStornierenModal(false);
    await updateDoc(doc(db, 'fahrten', fahrtId), { status: 'abgebrochen' });
    const uid = auth.currentUser?.uid;
    if (uid) await updateDoc(doc(db, 'fahrer', uid), { aktiveFahrtId: null });
    router.replace('/fahrer' as any);
  };

  const sendeQuittungen = async (fahrerUid: string) => {
    try {
      console.log('sendeQuittungen gestartet:', { fahrerUid, fahrgastEmail, preis, abholort: abholort?.adresse, zielort: zielort?.adresse, fahrtId });
      const jetzt = new Date();
      const datumText = jetzt.toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      // Fahrer-Daten laden (eigenes Dokument — erlaubt)
      const fahrerSnap = await getDoc(doc(db, 'nutzer', fahrerUid));
      const fahrerDaten = fahrerSnap?.data();
      const fahrerNachname = fahrerDaten?.nachname ?? 'Fahrer';

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
          <h2 style="text-align:center;margin:0 0 4px;">Furtgo</h2>
          <p style="text-align:center;color:#666;margin:0 0 20px;font-size:13px;">Fahrtenquittung</p>
          <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Datum</td><td style="text-align:right;font-size:14px;">${datumText}</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Von</td><td style="text-align:right;font-size:14px;">${abholort?.adresse ?? '–'}</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Nach</td><td style="text-align:right;font-size:14px;">${zielort?.adresse ?? '–'}</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#333;">Fahrer</td><td style="text-align:right;font-size:14px;">${fahrerNachname}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:18px;font-weight:bold;">Gesamtbetrag</td><td style="text-align:right;font-size:18px;font-weight:bold;">CHF ${(preis ?? 0).toFixed(2)}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
          <p style="color:#999;font-size:11px;">Fahrt-ID: ${fahrtId}</p>
          <p style="color:#666;font-size:12px;text-align:center;margin-top:16px;">Vielen Dank für Ihre Fahrt mit Furtgo.<br>Bei Fragen: support.furtgo@gmail.com</p>
        </div>`;

      // Quittung nur an Fahrgast
      if (fahrgastEmail) {
        await addDoc(collection(db, 'mail'), {
          to: [fahrgastEmail],
          message: {
            subject: `Ihre Furtgo Quittung — CHF ${(preis ?? 0).toFixed(2)}`,
            html,
          },
        });
      }
      console.log('Quittungen erfolgreich in Firestore geschrieben');
      Alert.alert(t('quittung.titel'), t('quittung.emailGesendet'));
    } catch (e: any) {
      console.error('Quittung Fehler:', e);
      Alert.alert(t('allgemein.fehler'), e?.message ?? t('quittung.emailFehler'));
    }
  };

  const statusWeiterschalten = async () => {
    if (!fahrtId) return;
    const neuerStatus: FahrtStatus = status === 'angenommen' ? 'unterwegs' : 'abgeschlossen';
    spieleTon.statusUpdate();
    await updateDoc(doc(db, 'fahrten', fahrtId), { status: neuerStatus });

    if (neuerStatus === 'abgeschlossen') {
      const uid = auth.currentUser?.uid;
      if (uid) {
        // Prüfen ob eine nächste Fahrt in der Warteschlange ist
        const fahrerSnap = await getDoc(doc(db, 'fahrer', uid));
        const naechsteFahrtId = fahrerSnap.data()?.naechsteFahrtId;

        if (naechsteFahrtId) {
          // Nächste Fahrt aktivieren
          await updateDoc(doc(db, 'fahrten', naechsteFahrtId), {
            status: 'angenommen',
            fahrerId: uid,
          });
          await updateDoc(doc(db, 'fahrer', uid), {
            aktiveFahrtId: naechsteFahrtId,
            naechsteFahrtId: null,
          });
          await sendeQuittungen(uid);
          router.replace(`/fahrer/fahrt?fahrtId=${naechsteFahrtId}` as any);
        } else {
          await updateDoc(doc(db, 'fahrer', uid), { aktiveFahrtId: null });
          await sendeQuittungen(uid);
        }
      }
    }
  };

  if (status === 'abgebrochen') {
    return (
      <View style={styles.fertigContainer}>
        <Text style={styles.fertigIcon}>❌</Text>
        <Text style={styles.fertigTitel}>{t('fahrt.abgebrochen')}</Text>
        <TouchableOpacity style={styles.heimButton} onPress={() => router.replace('/fahrer' as any)}>
          <Text style={styles.heimText}>{t('fahrt.zurueckDashboard')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'abgeschlossen') {
    return (
      <View style={styles.fertigContainer}>
        <Text style={styles.fertigIcon}>✅</Text>
        <Text style={styles.fertigTitel}>{t('fahrt.abgeschlossen')}</Text>
        <Text style={styles.fertigSub}>{t('fahrt.gutGemacht')}</Text>
        {preis !== null && (
          <View style={styles.preisBox}>
            <Text style={styles.preisLabel}>{t('fahrt.verdienst')}</Text>
            <Text style={styles.preisWert}>CHF {preis.toFixed(2)}</Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.heimButton}
          onPress={() => router.replace('/fahrer' as any)}
        >
          <Text style={styles.heimText}>{t('fahrt.zurueckDashboard')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const STATUS_LABEL: Partial<Record<FahrtStatus, string>> = {
    angenommen: t('fahrt.zumFahrgast'),
    unterwegs: t('fahrt.fahrgastEingestiegen'),
  };

  const NAECHSTER_BUTTON: Partial<Record<FahrtStatus, string>> = {
    angenommen: t('fahrt.fahrgastAbgeholt'),
    unterwegs: t('fahrt.fahrtBeenden'),
  };

  // Zeige je nach Status den relevanten Punkt auf der Karte
  const kartenZiel = status === 'unterwegs' ? zielort : abholort;

  return (
    <View style={styles.container}>
      <MapComponent standort={meinStandort} zielOrt={kartenZiel} />

      <View style={styles.infoPanel}>
        <Text style={styles.statusLabel}>{STATUS_LABEL[status] ?? 'Aktive Fahrt'}</Text>
        {status === 'angenommen' && abholort && (
          <Text style={styles.adresse}>📍 {abholort.adresse ?? 'Abholort'}</Text>
        )}
        {status === 'unterwegs' && zielort && (
          <Text style={styles.adresse}>🏁 {zielort.adresse}</Text>
        )}
        {meinStandort && kartenZiel && (
          <Text style={styles.distanz}>
            {formatDistanz(meinStandort, kartenZiel)}
          </Text>
        )}
        {kartenZiel && (
          <TouchableOpacity
            style={styles.naviButton}
            onPress={() => navigationStarten(kartenZiel)}
          >
            <Text style={styles.naviText}>{t('fahrt.navigationStarten')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.stornierenButton} onPress={() => setStornierenModal(true)}>
          <Text style={styles.stornierenText}>{t('fahrt.fahrtAbbrechen')}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.chatButton} onPress={() => {
        gelesenBisRef.current = gelesenBisRef.current + ungelesen;
        setUngelesen(0);
        setChatOffen(true);
      }}>
        <Text style={styles.chatButtonText}>💬</Text>
        {ungelesen > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{ungelesen}</Text>
          </View>
        )}
      </TouchableOpacity>

      {NAECHSTER_BUTTON[status] && (
        <TouchableOpacity style={styles.actionButton} onPress={statusWeiterschalten}>
          <Text style={styles.actionText}>{NAECHSTER_BUTTON[status]}</Text>
        </TouchableOpacity>
      )}

      {/* Banner für neue Anfrage während Fahrt */}
      {bannerSichtbar && neueAnfrage && (
        <Animated.View style={[styles.banner, { transform: [{ translateY: bannerSlide }] }]}>
          <Text style={styles.bannerTitel}>{t('fahrt.neueAnfrageBanner')}</Text>
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerKategorie}>
              {neueAnfrage.kategorie === 'frei' ? t('tarife.frei')
                : TARIFE[neueAnfrage.kategorie as Kategorie]?.label ?? t('tarife.furtgoMini')}
            </Text>
            <Text style={styles.bannerPreis}>CHF {(neueAnfrage.preis ?? 0).toFixed(2)}</Text>
          </View>
          <Text style={styles.bannerAdresse} numberOfLines={1}>
            📍 {neueAnfrage.abholort?.adresse ?? 'Unbekannt'} → {neueAnfrage.zielort?.adresse ?? 'Unbekannt'}
          </Text>
          {meinStandort && neueAnfrage.abholort && (
            <Text style={styles.bannerDistanz}>
              {t('fahrt.entfernt', { distanz: formatDistanz(meinStandort, neueAnfrage.abholort) })}
            </Text>
          )}
          <View style={styles.bannerButtons}>
            <TouchableOpacity style={styles.bannerAblehnen} onPress={bannerAblehnen}>
              <Text style={styles.bannerAblehnenText}>{t('fahrer.ablehnen')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bannerAnnehmen} onPress={bannerAnnehmen}>
              <Text style={styles.bannerAnnehmenText}>{t('fahrer.annehmen').replace(' ✓', '')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.bannerHinweis}>{t('fahrt.startetNachFahrt')}</Text>
        </Animated.View>
      )}

      {/* Warteschlange-Indikator */}
      {warteschlange.length > 0 && !bannerSichtbar && (
        <View style={styles.warteschlangeChip}>
          <Text style={styles.warteschlangeText}>
            {warteschlange.length > 1
              ? t('fahrt.fahrtenWartendMehrere', { anzahl: warteschlange.length })
              : t('fahrt.fahrtenWartend', { anzahl: warteschlange.length })}
          </Text>
        </View>
      )}

      {chatOffen && fahrtId && (
        <Chat fahrtId={fahrtId} rolle="fahrer" onSchliessen={() => setChatOffen(false)} />
      )}

      <Modal visible={stornierenModal} transparent animationType="fade">
        <View style={styles.stornierenOverlay}>
          <View style={styles.stornierenCard}>
            <Text style={styles.stornierenTitel}>{t('fahrt.fahrtAbbrechenFrage')}</Text>
            <Text style={styles.stornierenSub}>{t('fahrt.fahrgastBenachrichtigt')}</Text>
            <View style={styles.stornierenButtons}>
              <TouchableOpacity style={styles.neinButton} onPress={() => setStornierenModal(false)}>
                <Text style={styles.neinText}>{t('fahrt.nein')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.jaButton} onPress={stornierenBestaetigen}>
                <Text style={styles.jaText}>{t('fahrer.abbrechen')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  infoPanel: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  statusLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  adresse: { fontSize: 13, color: '#555', textAlign: 'center' },
  distanz: { fontSize: 16, color: '#111', fontWeight: '700', textAlign: 'center', marginTop: 6 },
  actionButton: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    backgroundColor: '#FFD700',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  actionText: { fontSize: 18, fontWeight: 'bold', color: '#000' },
  chatButton: {
    position: 'absolute',
    bottom: 120,
    right: 24,
    backgroundColor: '#1a1a2e',
    borderRadius: 30,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  chatButtonText: { fontSize: 26 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ff4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  naviButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 12,
  },
  naviText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  stornierenButton: {
    marginTop: 10,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  stornierenText: { color: '#ff4444', fontSize: 12 },
  fertigContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  fertigIcon: { fontSize: 80, marginBottom: 16 },
  fertigTitel: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  fertigSub: { fontSize: 16, color: '#aaa', marginBottom: 24 },
  preisBox: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  preisLabel: { fontSize: 14, color: '#aaa', marginBottom: 8 },
  preisWert: { fontSize: 36, fontWeight: 'bold', color: '#FFD700' },
  heimButton: {
    backgroundColor: '#FFD700',
    borderRadius: 16,
    paddingHorizontal: 40,
    paddingVertical: 16,
  },
  heimText: { fontSize: 16, fontWeight: 'bold', color: '#000' },

  stornierenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stornierenCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '75%',
    alignItems: 'center',
  },
  stornierenTitel: { fontSize: 15, fontWeight: 'bold', color: '#111', marginBottom: 6 },
  stornierenSub: { fontSize: 12, color: '#666', marginBottom: 16, textAlign: 'center' },
  stornierenButtons: { flexDirection: 'row', gap: 10 },
  neinButton: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  neinText: { fontSize: 13, color: '#333', fontWeight: '600' },
  jaButton: {
    flex: 1,
    backgroundColor: '#ff4444',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  jaText: { fontSize: 13, color: '#fff', fontWeight: '600' },

  // Banner für neue Anfrage
  banner: {
    position: 'absolute',
    top: 50,
    left: 12,
    right: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 14,
    zIndex: 200,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  bannerTitel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFD700',
    textAlign: 'center',
    marginBottom: 6,
  },
  bannerInfo: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  bannerKategorie: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    backgroundColor: '#2a2a4e',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  bannerPreis: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFD700',
  },
  bannerAdresse: {
    fontSize: 12,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 2,
  },
  bannerDistanz: {
    fontSize: 12,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 8,
  },
  bannerButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  bannerAblehnen: {
    flex: 1,
    backgroundColor: '#ff4444',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  bannerAblehnenText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  bannerAnnehmen: {
    flex: 1,
    backgroundColor: '#FFD700',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  bannerAnnehmenText: { color: '#000', fontSize: 13, fontWeight: 'bold' },
  bannerHinweis: {
    fontSize: 10,
    color: '#888',
    textAlign: 'center',
    marginTop: 6,
  },

  // Warteschlange Chip
  warteschlangeChip: {
    position: 'absolute',
    top: 55,
    right: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 50,
    elevation: 4,
  },
  warteschlangeText: {
    fontSize: 12,
    color: '#FFD700',
    fontWeight: '600',
  },
});
