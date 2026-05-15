import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';

interface Rechnung {
  id: string;
  rechnungsNr: string;
  datum?: Timestamp;
  periode?: string;
  betrag?: number;
  pfcTxId?: number;
  storagePath?: string;
  downloadUrl?: string;
}

export default function RechnungenScreen() {
  const [rechnungen, setRechnungen] = useState<Rechnung[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [downloadId, setDownloadId] = useState<string | null>(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLaedt(false);
      return;
    }
    const q = query(
      collection(db, 'fahrer', uid, 'rechnungen'),
      orderBy('datum', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const liste: Rechnung[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Rechnung, 'id'>) }));
        setRechnungen(liste);
        setLaedt(false);
      },
      (err) => {
        console.log('Rechnungen laden Fehler:', err);
        setLaedt(false);
      },
    );
    return unsub;
  }, []);

  const oeffneRechnung = async (rechnung: Rechnung) => {
    if (!rechnung.downloadUrl) {
      Alert.alert('Nicht verfügbar', 'Für diese Rechnung ist kein PDF gespeichert.');
      return;
    }
    setDownloadId(rechnung.id);
    try {
      const supported = await Linking.canOpenURL(rechnung.downloadUrl);
      if (supported) {
        await Linking.openURL(rechnung.downloadUrl);
      } else {
        Alert.alert('Fehler', 'PDF konnte nicht geöffnet werden.');
      }
    } catch (e) {
      console.log('PDF-Öffnen Fehler:', e);
      Alert.alert('Fehler', 'PDF konnte nicht geöffnet werden.');
    } finally {
      setDownloadId(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.zurueckBtn}>
          <Text style={styles.zurueckPfeil}>&#x2039;</Text>
        </TouchableOpacity>
        <Text style={styles.titel}>Meine Rechnungen</Text>
        <View style={{ width: 36 }} />
      </View>

      {laedt && (
        <View style={styles.center}>
          <ActivityIndicator color="#FFD700" />
        </View>
      )}

      {!laedt && rechnungen.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.leerText}>Noch keine Rechnungen vorhanden.</Text>
          <Text style={styles.leerSub}>Rechnungen erscheinen hier automatisch nach erfolgter Abo-Belastung.</Text>
        </View>
      )}

      {!laedt && rechnungen.length > 0 && (
        <ScrollView contentContainerStyle={styles.liste}>
          {rechnungen.map((r) => {
            const datum = r.datum?.toDate().toLocaleDateString('de-CH') ?? '—';
            const betrag = typeof r.betrag === 'number' ? `CHF ${r.betrag.toFixed(2)}` : '—';
            const istLaden = downloadId === r.id;
            return (
              <TouchableOpacity
                key={r.id}
                style={styles.karte}
                onPress={() => oeffneRechnung(r)}
                disabled={istLaden}
              >
                <View style={styles.karteOben}>
                  <Text style={styles.rechnungsNr}>{r.rechnungsNr}</Text>
                  <Text style={styles.betrag}>{betrag}</Text>
                </View>
                <Text style={styles.datum}>{datum}</Text>
                {r.periode && <Text style={styles.periode}>{r.periode}</Text>}
                <View style={styles.karteUnten}>
                  {istLaden ? (
                    <ActivityIndicator color="#FFD700" size="small" />
                  ) : (
                    <Text style={styles.downloadHint}>PDF öffnen →</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.fussHinweis}>
            Lädt das PDF nicht? AdBlocker im Router oder VPN kann firebasestorage.googleapis.com blockieren. Wi-Fi kurz aus und über Mobilfunk versuchen.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 36,
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  zurueckBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  zurueckPfeil: { color: '#fff', fontSize: 22, fontWeight: '300', marginTop: -2 },
  titel: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  leerText: { color: '#aaa', fontSize: 15, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  leerSub: { color: '#666', fontSize: 12, textAlign: 'center' },
  liste: { padding: 18, paddingBottom: 50, gap: 10 },
  karte: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  karteOben: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rechnungsNr: { color: '#FFD700', fontSize: 14, fontWeight: '700' },
  betrag: { color: '#fff', fontSize: 16, fontWeight: '700' },
  datum: { color: '#ccc', fontSize: 12, marginBottom: 2 },
  periode: { color: '#888', fontSize: 11 },
  karteUnten: { marginTop: 8, alignItems: 'flex-end' },
  downloadHint: { color: '#FFD700', fontSize: 12, fontWeight: '600' },
  fussHinweis: {
    color: '#777',
    fontSize: 11,
    marginTop: 18,
    paddingHorizontal: 4,
    lineHeight: 16,
    fontStyle: 'italic',
  },
});
