import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/constants/firebase';

const ADMIN_PIN = '1234';

interface FahrerDaten {
  id: string;
  name?: string;
  verifiziert?: string;
  gesperrt?: boolean;
  aboGueltigBis?: number;
  dokumente?: {
    fahrzeugausweisUrl?: string;
    fuehrerscheinVorneUrl?: string;
    fuehrerscheinHintenUrl?: string;
    strafregisterUrl?: string;
    strafregisterSauber?: boolean;
    plattformUrl?: string;
    eingereichtAm?: number;
  };
}

export default function AdminPanel() {
  const [pin, setPin] = useState('');
  const [freigegeben, setFreigegeben] = useState(false);
  const [fahrer, setFahrer] = useState<FahrerDaten[]>([]);
  const [laden, setLaden] = useState(false);

  const pinPruefen = () => {
    if (pin === ADMIN_PIN) {
      setFreigegeben(true);
      fahrerLaden();
    } else {
      Alert.alert('Falsch', 'Falscher PIN.');
      setPin('');
    }
  };

  const fahrerLaden = async () => {
    setLaden(true);
    try {
      const snap = await getDocs(collection(db, 'fahrer'));
      const liste: FahrerDaten[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FahrerDaten));
      setFahrer(liste);
    } finally {
      setLaden(false);
    }
  };

  const verifizierenSetzen = async (fahrerId: string, status: string) => {
    await updateDoc(doc(db, 'fahrer', fahrerId), { verifiziert: status });
    setFahrer((prev) =>
      prev.map((f) => (f.id === fahrerId ? { ...f, verifiziert: status } : f))
    );
  };

  const gesperrtSetzen = async (fahrerId: string, wert: boolean) => {
    await updateDoc(doc(db, 'fahrer', fahrerId), { gesperrt: wert });
    setFahrer((prev) =>
      prev.map((f) => (f.id === fahrerId ? { ...f, gesperrt: wert } : f))
    );
  };

  const aboVerlaengern = async (fahrerId: string) => {
    const f = fahrer.find((x) => x.id === fahrerId);
    const basis = f?.aboGueltigBis && f.aboGueltigBis > Date.now() ? f.aboGueltigBis : Date.now();
    const neuesDatum = basis + 30 * 24 * 60 * 60 * 1000;
    await updateDoc(doc(db, 'fahrer', fahrerId), { aboGueltigBis: neuesDatum });
    setFahrer((prev) =>
      prev.map((x) => (x.id === fahrerId ? { ...x, aboGueltigBis: neuesDatum } : x))
    );
  };

  if (!freigegeben) {
    return (
      <View style={styles.pinContainer}>
        <TouchableOpacity style={styles.zurueck} onPress={() => router.back()}>
          <Text style={styles.zurueckText}>← Zurück</Text>
        </TouchableOpacity>
        <Text style={styles.pinTitel}>Admin-Bereich</Text>
        <Text style={styles.pinSub}>PIN eingeben</Text>
        <TextInput
          style={styles.pinInput}
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          placeholder="****"
          placeholderTextColor="#555"
        />
        <TouchableOpacity style={styles.pinButton} onPress={pinPruefen}>
          <Text style={styles.pinButtonText}>Zugang</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inhalt}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.zurueckText}>← Zurück</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={fahrerLaden}>
          <Text style={styles.refreshText}>↻ Aktualisieren</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.titel}>Admin-Panel</Text>
      <Text style={styles.sub}>{fahrer.length} Fahrer registriert</Text>

      {laden && <ActivityIndicator color="#FFD700" style={{ marginTop: 20 }} />}

      {fahrer.map((f) => (
        <View key={f.id} style={styles.fahrerCard}>
          <View style={styles.fahrerHeader}>
            <Text style={styles.fahrerName}>{f.name ?? '(kein Name)'}</Text>
            <View style={styles.badges}>
              {f.gesperrt && (
                <Text style={styles.badgeRot}>Gesperrt</Text>
              )}
              {f.verifiziert === 'genehmigt' && <Text style={styles.badgeGruen}>✓ Verifiziert</Text>}
              {f.verifiziert === 'ausstehend' && <Text style={styles.badgeGelb}>⏳ Ausstehend</Text>}
              {f.verifiziert === 'abgelehnt' && <Text style={styles.badgeRot}>✕ Abgelehnt</Text>}
            </View>
          </View>

          <Text style={styles.fahrerId}>ID: {f.id.slice(0, 12)}...</Text>

          {/* Abo-Status */}
          <View style={styles.aboZeile}>
            {f.aboGueltigBis ? (
              <Text style={f.aboGueltigBis > Date.now() ? styles.aboAktiv : styles.aboAbgelaufen}>
                {f.aboGueltigBis > Date.now()
                  ? `Abo aktiv bis ${new Date(f.aboGueltigBis).toLocaleDateString('de-CH')}`
                  : `Abo abgelaufen am ${new Date(f.aboGueltigBis).toLocaleDateString('de-CH')}`}
              </Text>
            ) : (
              <Text style={styles.aboKein}>Kein Abo</Text>
            )}
            <TouchableOpacity style={styles.aboBtn} onPress={() => aboVerlaengern(f.id)}>
              <Text style={styles.aboBtnText}>+30 Tage</Text>
            </TouchableOpacity>
          </View>

          {f.dokumente ? (
            <View style={styles.dokBox}>
              <Text style={styles.dokTitel}>Eingereichte Dokumente:</Text>
              <Text style={styles.dokZeile}>
                🔍 Strafregister: {f.dokumente.strafregisterSauber === true ? '✓ Sauber' : f.dokumente.strafregisterSauber === false ? '✕ Einträge vorhanden' : '–'}
              </Text>
              {f.dokumente.eingereichtAm && (
                <Text style={styles.dokDatum}>
                  Eingereicht: {new Date(f.dokumente.eingereichtAm).toLocaleDateString('de-CH')}
                </Text>
              )}
              {(['fahrzeugausweisUrl', 'fuehrerscheinVorneUrl', 'fuehrerscheinHintenUrl', 'strafregisterUrl', 'plattformUrl'] as const).map((key) => {
                const labels: Record<string, string> = {
                  fahrzeugausweisUrl: '🚗 Fahrzeugausweis',
                  fuehrerscheinVorneUrl: '📋 Führerschein – Vorderseite',
                  fuehrerscheinHintenUrl: '📋 Führerschein – Rückseite',
                  strafregisterUrl: '📄 Strafregisterauszug',
                  plattformUrl: '📱 Uber/Bolt Screenshot',
                };
                const url = f.dokumente![key];
                return (
                  <View key={key} style={styles.fotoSektion}>
                    <Text style={styles.fotoLabel}>{labels[key]}</Text>
                    {url ? (
                      <TouchableOpacity onPress={() => Linking.openURL(url)}>
                        <Image source={{ uri: url }} style={styles.dokFoto} />
                        <Text style={styles.fotoOeffnen}>Vollbild öffnen</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.keineFoto}>Kein Foto</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.keineDok}>Keine Dokumente eingereicht</Text>
          )}

          <View style={styles.aktionenRow}>
            {f.verifiziert !== 'genehmigt' && (
              <TouchableOpacity
                style={styles.btnGruen}
                onPress={() => verifizierenSetzen(f.id, 'genehmigt')}
              >
                <Text style={styles.btnText}>✓ Verifizieren</Text>
              </TouchableOpacity>
            )}
            {f.verifiziert !== 'abgelehnt' && (
              <TouchableOpacity
                style={styles.btnGrau}
                onPress={() => verifizierenSetzen(f.id, 'abgelehnt')}
              >
                <Text style={styles.btnText}>✕ Ablehnen</Text>
              </TouchableOpacity>
            )}
            {f.gesperrt ? (
              <TouchableOpacity
                style={styles.btnGelb}
                onPress={() => gesperrtSetzen(f.id, false)}
              >
                <Text style={[styles.btnText, { color: '#000' }]}>Entsperren</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.btnRot}
                onPress={() =>
                  Alert.alert('Sperren?', `${f.name ?? 'Fahrer'} wirklich sperren?`, [
                    { text: 'Abbrechen', style: 'cancel' },
                    { text: 'Sperren', style: 'destructive', onPress: () => gesperrtSetzen(f.id, true) },
                  ])
                }
              >
                <Text style={styles.btnText}>Sperren</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pinContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    padding: 32,
  },
  zurueck: { position: 'absolute', top: 50, left: 24 },
  zurueckText: { color: '#FFD700', fontSize: 15 },
  pinTitel: { fontSize: 28, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 8 },
  pinSub: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 24 },
  pinInput: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 18,
    fontSize: 24,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
    letterSpacing: 8,
  },
  pinButton: {
    backgroundColor: '#FFD700',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  pinButtonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },

  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inhalt: { padding: 24, paddingBottom: 60 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 40,
    marginBottom: 20,
  },
  refreshText: { color: '#FFD700', fontSize: 14 },
  titel: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  sub: { fontSize: 13, color: '#aaa', marginBottom: 20 },

  fahrerCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  fahrerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  fahrerName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badgeGruen: { fontSize: 11, color: '#4ade80', fontWeight: '700' },
  badgeGelb: { fontSize: 11, color: '#FFD700', fontWeight: '700' },
  badgeRot: { fontSize: 11, color: '#f87171', fontWeight: '700' },
  fahrerId: { fontSize: 11, color: '#555', marginBottom: 10 },

  dokBox: {
    backgroundColor: '#0f2035',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  dokTitel: { fontSize: 12, fontWeight: '700', color: '#aaa', marginBottom: 6 },
  dokZeile: { fontSize: 13, color: '#fff', marginBottom: 3 },
  dokDatum: { fontSize: 11, color: '#555', marginTop: 4, marginBottom: 8 },
  keineDok: { fontSize: 13, color: '#555', marginBottom: 12, fontStyle: 'italic' },
  fotoSektion: { marginTop: 10 },
  fotoLabel: { fontSize: 12, color: '#aaa', fontWeight: '600', marginBottom: 4 },
  dokFoto: { width: '100%', height: 140, borderRadius: 8, resizeMode: 'cover' },
  fotoOeffnen: { color: '#FFD700', fontSize: 11, marginTop: 4, marginBottom: 4 },
  keineFoto: { fontSize: 12, color: '#555', fontStyle: 'italic' },

  aboZeile: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  aboAktiv: { fontSize: 12, color: '#4ade80', fontWeight: '600' },
  aboAbgelaufen: { fontSize: 12, color: '#f87171', fontWeight: '600' },
  aboKein: { fontSize: 12, color: '#888' },
  aboBtn: { backgroundColor: '#FFD700', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10 },
  aboBtnText: { fontSize: 12, fontWeight: 'bold', color: '#000' },
  aktionenRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btnGruen: { backgroundColor: '#14532d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnGrau: { backgroundColor: '#333', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnGelb: { backgroundColor: '#FFD700', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnRot: { backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
