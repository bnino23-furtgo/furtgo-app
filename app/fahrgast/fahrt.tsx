import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, BackHandler } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { doc, onSnapshot, updateDoc, collection, query, orderBy } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import MapComponent from '@/components/MapComponent';
import Chat from '@/components/Chat';
import { FahrtStatus, KoordType, OrtType } from '@/types';
import { spieleTon } from '@/utils/ton';
import { formatDistanz } from '@/utils/distanz';
import { useTranslation } from 'react-i18next';

export default function FahrgastFahrt() {
  const { t } = useTranslation();
  const { fahrtId } = useLocalSearchParams<{ fahrtId: string }>();
  const [status, setStatus] = useState<FahrtStatus>('angenommen');
  const [fahrerStandort, setFahrerStandort] = useState<KoordType | null>(null);
  const [abholort, setAbholort] = useState<KoordType | null>(null);
  const [zielort, setZielort] = useState<OrtType | null>(null);
  const [fahrerId, setFahrerId] = useState<string | null>(null);
  const [fahrerName, setFahrerName] = useState<string | null>(null);
  const [fahrerBewertung, setFahrerBewertung] = useState<number | null>(null);
  const [fahrzeug, setFahrzeug] = useState<{ schildnummer?: string; marke?: string; jahrgang?: string; farbe?: string } | null>(null);
  const [chatOffen, setChatOffen] = useState(false);
  const [ungelesen, setUngelesen] = useState(0);
  const gelesenBisRef = useRef(0);
  const [bewertung, setBewertung] = useState(0);
  const [bewertet, setBewertet] = useState(false);
  const [stornierenModal, setStornierenModal] = useState(false);
  const [preis, setPreis] = useState<number | null>(null);

  // Chat-Nachrichten zählen
  useEffect(() => {
    if (!fahrtId) return;
    const meinUid = auth.currentUser?.uid;
    const chatQ = query(collection(db, 'fahrten', fahrtId, 'nachrichten'), orderBy('erstelltAm', 'asc'));
    return onSnapshot(chatQ, (snap) => {
      const fremde = snap.docs.filter((d) => d.data().senderId !== meinUid).length;
      setUngelesen(Math.max(0, fremde - gelesenBisRef.current));
    }, (err) => console.log('Chat-Listener Fehler (ignoriert):', err));
  }, [fahrtId]);

  // Fahrt-Status beobachten
  useEffect(() => {
    if (!fahrtId) return;
    return onSnapshot(doc(db, 'fahrten', fahrtId), (snap) => {
      const data = snap.data();
      if (!data) return;
      const neuerStatus = data.status as FahrtStatus;
      setStatus((prev) => {
        if (prev !== neuerStatus) {
          if (neuerStatus === 'unterwegs') spieleTon.statusUpdate();
          if (neuerStatus === 'abgeschlossen') spieleTon.statusUpdate();
          if (neuerStatus === 'abgebrochen') spieleTon.fahrtAbgebrochen();
        }
        return neuerStatus;
      });
      setAbholort(data.abholort);
      setZielort(data.zielort);
      if (data.fahrerId) setFahrerId(data.fahrerId);
      if (data.preis != null) setPreis(data.preis);
    }, (err) => console.log('Fahrt-Listener Fehler (ignoriert):', err));
  }, [fahrtId]);

  // Fahrer-Standort, Name und Bewertung beobachten
  useEffect(() => {
    if (!fahrerId) return;
    return onSnapshot(doc(db, 'fahrer', fahrerId), (snap) => {
      const data = snap.data();
      if (data?.standort) setFahrerStandort(data.standort);
      if (data?.name) setFahrerName(String(data.name).trim().split(/\s+/)[0]);
      if (data?.bewertungsDurchschnitt != null) setFahrerBewertung(data.bewertungsDurchschnitt);
      if (data?.fahrzeug) setFahrzeug(data.fahrzeug);
    }, (err) => console.log('Fahrer-Listener Fehler (ignoriert):', err));
  }, [fahrerId]);

  const navigation = useNavigation();

  // Nach abgeschlossener Fahrt: Zurück erst nach Bewertung erlauben.
  // Wichtig: Im native-stack wird Zurück (Hardware-Button UND Wisch-Geste) nativ
  // behandelt — der JS-BackHandler greift dort nicht zuverlässig. Darum zusätzlich
  // das navigation-eigene 'beforeRemove'-Event abfangen + Geste deaktivieren.
  useEffect(() => {
    const blockiert = status === 'abgeschlossen' && !bewertet;
    navigation.setOptions({ gestureEnabled: !blockiert });
    if (!blockiert) return;
    const subBack = BackHandler.addEventListener('hardwareBackPress', () => true);
    const subRemove = navigation.addListener('beforeRemove', (e: any) => {
      e.preventDefault(); // Screen darf nicht entfernt werden, bis bewertet
    });
    return () => {
      subBack.remove();
      subRemove();
    };
  }, [navigation, status, bewertet]);

  const stornierenBestaetigen = async () => {
    if (!fahrtId) return;
    setStornierenModal(false);
    await updateDoc(doc(db, 'fahrten', fahrtId), { status: 'abgebrochen' });
    router.replace('/' as any);
  };

  if (status === 'abgebrochen') {
    return (
      <View style={styles.fertigContainer}>
        <Text style={styles.fertigIcon}>❌</Text>
        <Text style={styles.fertigTitel}>{t('fahrgast.abgebrochen')}</Text>
        <Text style={styles.fertigSub}>{t('fahrgast.fahrerAbgebrochen')}</Text>
        <TouchableOpacity style={styles.heimButton} onPress={() => router.replace('/')}>
          <Text style={styles.heimText}>{t('fahrgast.zurStartseite')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bewertungAbsenden = async (sterne: number) => {
    if (!fahrtId || !fahrerId) return;
    await updateDoc(doc(db, 'fahrten', fahrtId), { bewertung: sterne });
    setBewertet(true);
  };

  if (status === 'abgeschlossen') {
    return (
      <View style={styles.fertigContainer}>
        <Text style={styles.fertigIcon}>🎉</Text>
        <Text style={styles.fertigTitel}>{t('fahrgast.abgeschlossen')}</Text>
        <Text style={styles.fertigSub}>{t('fahrgast.danke')}</Text>

        {preis !== null && (
          <View style={styles.preisBox}>
            <Text style={styles.preisLabel}>{t('fahrgast.gesamtbetrag')}</Text>
            <Text style={styles.preisWert}>CHF {preis.toFixed(2)}</Text>
          </View>
        )}

        {!bewertet ? (
          <View style={styles.bewertungBox}>
            <Text style={styles.bewertungTitel}>{t('fahrgast.wieWarFahrer')}</Text>
            <View style={styles.sterne}>
              {[1, 2, 3, 4, 5].map((s) => (
                <TouchableOpacity key={s} onPress={() => setBewertung(s)}>
                  <Text style={[styles.stern, bewertung >= s && styles.sternAktiv]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.bewertungButton, !bewertung && styles.buttonDisabled]}
              onPress={() => bewertung && bewertungAbsenden(bewertung)}
              disabled={!bewertung}
            >
              <Text style={styles.bewertungButtonText}>{t('fahrgast.bewertungAbschicken')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.dankeStern}>{t('fahrgast.dankeBewertung')}</Text>
            <TouchableOpacity style={styles.heimButton} onPress={() => router.replace('/')}>
              <Text style={styles.heimText}>{t('fahrgast.zurStartseite')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  const STATUS_LABEL: Partial<Record<FahrtStatus, string>> = {
    angenommen: t('fahrgast.fahrerAufWeg'),
    unterwegs: t('fahrgast.unterwegs'),
    abgeschlossen: t('fahrgast.angekommen'),
  };

  return (
    <View style={styles.container}>
      <MapComponent
        standort={abholort}
        zielOrt={zielort}
        fahrerStandort={fahrerStandort}
      />

      <View style={styles.statusPanel}>
        <Text style={styles.statusText}>{STATUS_LABEL[status] ?? t('fahrgast.fahrtAktiv')}</Text>
        {fahrerName && (
          <View style={styles.fahrerInfo}>
            <Text style={styles.fahrerName}>🧑‍✈️ {fahrerName}</Text>
            {fahrerBewertung !== null && (
              <Text style={styles.fahrerBewertung}>⭐ {fahrerBewertung}</Text>
            )}
          </View>
        )}
        {fahrzeug && (
          <View style={styles.fahrzeugInfo}>
            <Text style={styles.fahrzeugMarke}>{fahrzeug.farbe} {fahrzeug.marke}{fahrzeug.jahrgang ? ` (${fahrzeug.jahrgang})` : ''}</Text>
            <Text style={styles.fahrzeugSchild}>{fahrzeug.schildnummer}</Text>
          </View>
        )}
        {status === 'angenommen' && fahrerStandort && abholort && (
          <Text style={styles.distanz}>
            🚗 {formatDistanz(fahrerStandort, abholort)}
          </Text>
        )}
        {status === 'angenommen' && !fahrerStandort && (
          <Text style={styles.sub}>{t('fahrgast.fahrerKommt')}</Text>
        )}
        {status === 'unterwegs' && fahrerStandort && zielort && (
          <Text style={styles.distanz}>
            🏁 {formatDistanz(fahrerStandort, zielort)}
          </Text>
        )}
        {status === 'angenommen' && (
          <TouchableOpacity style={styles.stornierenButton} onPress={() => setStornierenModal(true)}>
            <Text style={styles.stornierenText}>{t('fahrgast.stornieren')}</Text>
          </TouchableOpacity>
        )}
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

      {chatOffen && fahrtId && (
        <Chat fahrtId={fahrtId} rolle="fahrgast" onSchliessen={() => setChatOffen(false)} />
      )}

      <Modal visible={stornierenModal} transparent animationType="fade">
        <View style={styles.stornierenOverlay}>
          <View style={styles.stornierenCard}>
            <Text style={styles.stornierenTitel}>{t('fahrgast.stornierenFrage')}</Text>
            <Text style={styles.stornierenSub}>{t('fahrgast.stornierenHinweis')}</Text>
            <View style={styles.stornierenButtons}>
              <TouchableOpacity style={styles.neinButton} onPress={() => setStornierenModal(false)}>
                <Text style={styles.neinText}>{t('fahrt.nein')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.jaButton} onPress={stornierenBestaetigen}>
                <Text style={styles.jaText}>{t('suchen.abbrechen')}</Text>
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
  statusPanel: {
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
  statusText: { fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  sub: { fontSize: 13, color: '#666', textAlign: 'center' },
  distanz: { fontSize: 15, color: '#333', fontWeight: '700', textAlign: 'center', marginTop: 4 },
  fahrerInfo: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginVertical: 6,
  },
  fahrerName: { fontSize: 14, fontWeight: '600', color: '#222' },
  fahrerBewertung: { fontSize: 13, color: '#555' },
  fahrzeugInfo: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 4,
    alignItems: 'center',
  },
  fahrzeugMarke: { fontSize: 13, color: '#fff', fontWeight: '500' },
  fahrzeugSchild: { fontSize: 16, fontWeight: 'bold', color: '#FFD700', marginTop: 2 },
  chatButton: {
    position: 'absolute',
    bottom: 40,
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
  preisBox: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  preisLabel: { fontSize: 13, color: '#aaa', marginBottom: 6 },
  preisWert: { fontSize: 34, fontWeight: 'bold', color: '#FFD700' },
  fertigSub: { fontSize: 16, color: '#aaa', marginBottom: 40 },
  heimButton: {
    backgroundColor: '#FFD700',
    borderRadius: 16,
    paddingHorizontal: 40,
    paddingVertical: 16,
    marginTop: 16,
  },
  heimText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  bewertungBox: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginVertical: 20,
    width: '100%',
  },
  bewertungTitel: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  sterne: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  stern: { fontSize: 44, color: '#444' },
  sternAktiv: { color: '#FFD700' },
  bewertungButton: {
    backgroundColor: '#FFD700',
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  buttonDisabled: { opacity: 0.4 },
  bewertungButtonText: { fontSize: 15, fontWeight: 'bold', color: '#000' },
  dankeStern: { fontSize: 18, color: '#FFD700', marginVertical: 16 },

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
});
