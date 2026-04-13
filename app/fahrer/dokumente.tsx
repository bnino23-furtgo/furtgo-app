import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '@/constants/firebase';
import { Ionicons } from '@expo/vector-icons';

type FotoKey = 'fahrzeugausweis' | 'fuehrerscheinVorne' | 'fuehrerscheinHinten' | 'strafregister' | 'plattform';

interface Fotos {
  fahrzeugausweis: string | null;
  fuehrerscheinVorne: string | null;
  fuehrerscheinHinten: string | null;
  strafregister: string | null;
  plattform: string | null;
}

const SCHRITTE: { key: FotoKey; nr: number; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'fahrzeugausweis',    nr: 1, label: 'Fahrzeugausweis',              sub: 'Vorder- und Rückseite fotografieren',         icon: 'car-outline' },
  { key: 'fuehrerscheinVorne', nr: 2, label: 'Führerschein – Vorderseite',   sub: 'Name und Nummer müssen sichtbar sein',         icon: 'id-card-outline' },
  { key: 'fuehrerscheinHinten',nr: 3, label: 'Führerschein – Rückseite',     sub: 'Vollständige Rückseite fotografieren',         icon: 'id-card-outline' },
  { key: 'strafregister',      nr: 4, label: 'Strafregisterauszug',          sub: 'Offizieller Auszug, nicht älter als 3 Monate', icon: 'document-text-outline' },
  { key: 'plattform',          nr: 5, label: 'Uber / Bolt Screenshot',       sub: 'Name und Vorname müssen sichtbar sein',        icon: 'phone-portrait-outline' },
];

export default function DokumenteEinreichen() {
  const [fotos, setFotos] = useState<Fotos>({
    fahrzeugausweis: null,
    fuehrerscheinVorne: null,
    fuehrerscheinHinten: null,
    strafregister: null,
    plattform: null,
  });
  const [strafregisterSauber, setStrafregisterSauber] = useState<boolean | null>(null);
  const [laden, setLaden] = useState(false);
  const [uploadFortschritt, setUploadFortschritt] = useState('');

  const fotoMitKamera = async (key: FotoKey) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Berechtigung fehlt', 'Bitte erlaube den Kamerazugriff in den Einstellungen.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setFotos((prev) => ({ ...prev, [key]: result.assets[0].uri }));
  };

  const fotoAusGalerie = async (key: FotoKey) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Berechtigung fehlt', 'Bitte erlaube den Galerie-Zugriff in den Einstellungen.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setFotos((prev) => ({ ...prev, [key]: result.assets[0].uri }));
  };

  const fotoHochladen = async (uri: string, pfad: string): Promise<string> => {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(new Error('Upload fehlgeschlagen'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
    const storageRef = ref(storage, pfad);
    await uploadBytes(storageRef, blob);
    return await getDownloadURL(storageRef);
  };

  const einreichen = async () => {
    if (!fotos.fahrzeugausweis || !fotos.fuehrerscheinVorne || !fotos.fuehrerscheinHinten || !fotos.strafregister || !fotos.plattform) {
      Alert.alert('Dokumente fehlen', 'Bitte lade alle 5 Dokumente hoch.');
      return;
    }
    if (strafregisterSauber === null) {
      Alert.alert('Angabe fehlt', 'Bitte gib an ob dein Strafregister sauber ist.');
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setLaden(true);
    try {
      const uploads: [string, string][] = [
        [fotos.fahrzeugausweis,    `dokumente/${uid}/fahrzeugausweis`],
        [fotos.fuehrerscheinVorne, `dokumente/${uid}/fuehrerschein_vorne`],
        [fotos.fuehrerscheinHinten,`dokumente/${uid}/fuehrerschein_hinten`],
        [fotos.strafregister,      `dokumente/${uid}/strafregister`],
        [fotos.plattform,          `dokumente/${uid}/plattform`],
      ];
      const labels = ['Fahrzeugausweis', 'Führerschein Vorne', 'Führerschein Hinten', 'Strafregister', 'Plattform'];
      const urls: string[] = [];
      for (let i = 0; i < uploads.length; i++) {
        setUploadFortschritt(`${labels[i]} wird hochgeladen... (${i + 1}/5)`);
        urls.push(await fotoHochladen(uploads[i][0], uploads[i][1]));
      }
      setUploadFortschritt('Wird gespeichert...');
      await setDoc(
        doc(db, 'fahrer', uid),
        {
          verifiziert: 'ausstehend',
          dokumente: {
            fahrzeugausweisUrl: urls[0],
            fuehrerscheinVorneUrl: urls[1],
            fuehrerscheinHintenUrl: urls[2],
            strafregisterUrl: urls[3],
            strafregisterSauber,
            plattformUrl: urls[4],
            eingereichtAm: Date.now(),
          },
        },
        { merge: true }
      );
      Alert.alert('Eingereicht ✓', 'Deine Dokumente wurden erfolgreich eingereicht. Du wirst nach der Prüfung freigeschaltet.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Fehler', 'Upload fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      setLaden(false);
      setUploadFortschritt('');
    }
  };

  const fertigCount = Object.values(fotos).filter(Boolean).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inhalt}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.zurueckBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#FFD700" />
          <Text style={styles.zurueckText}>Zurück</Text>
        </TouchableOpacity>
        <View style={styles.headerTitel}>
          <Ionicons name="shield-checkmark-outline" size={32} color="#FFD700" />
          <Text style={styles.titel}>Verifizierung</Text>
          <Text style={styles.sub}>Lade deine Dokumente hoch um als Fahrer freigeschaltet zu werden.</Text>
        </View>

        {/* Fortschrittsbalken */}
        <View style={styles.fortschrittContainer}>
          <View style={styles.fortschrittBalken}>
            <View style={[styles.fortschrittFill, { width: `${(fertigCount / 5) * 100}%` }]} />
          </View>
          <Text style={styles.fortschrittLabel}>{fertigCount} / 5 Dokumente hochgeladen</Text>
        </View>
      </View>

      {/* Dokument-Karten */}
      {SCHRITTE.map((schritt) => {
        const hatFoto = !!fotos[schritt.key];
        return (
          <View key={schritt.key} style={[styles.karte, hatFoto && styles.karteErledigt]}>
            <View style={styles.karteHeader}>
              <View style={[styles.nrBadge, hatFoto && styles.nrBadgeErledigt]}>
                {hatFoto
                  ? <Ionicons name="checkmark" size={16} color="#000" />
                  : <Text style={styles.nrText}>{schritt.nr}</Text>
                }
              </View>
              <View style={styles.karteInfo}>
                <Text style={styles.karteLabel}>{schritt.label}</Text>
                <Text style={styles.karteSub}>{schritt.sub}</Text>
              </View>
              <Ionicons name={schritt.icon} size={22} color={hatFoto ? '#4ade80' : '#444'} />
            </View>

            {hatFoto && (
              <Image source={{ uri: fotos[schritt.key]! }} style={styles.vorschau} />
            )}

            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.btn} onPress={() => fotoMitKamera(schritt.key)}>
                <Ionicons name="camera-outline" size={18} color="#FFD700" />
                <Text style={styles.btnText}>Kamera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => fotoAusGalerie(schritt.key)}>
                <Ionicons name="images-outline" size={18} color="#FFD700" />
                <Text style={styles.btnText}>Galerie</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Strafregister Ja/Nein */}
      <View style={styles.karte}>
        <View style={styles.karteHeader}>
          <View style={[styles.nrBadge, strafregisterSauber !== null && styles.nrBadgeErledigt]}>
            {strafregisterSauber !== null
              ? <Ionicons name="checkmark" size={16} color="#000" />
              : <Text style={styles.nrText}>6</Text>
            }
          </View>
          <View style={styles.karteInfo}>
            <Text style={styles.karteLabel}>Strafregister sauber?</Text>
            <Text style={styles.karteSub}>Bitte ehrlich angeben</Text>
          </View>
          <Ionicons name="checkmark-circle-outline" size={22} color={strafregisterSauber !== null ? '#4ade80' : '#444'} />
        </View>
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, strafregisterSauber === true && styles.btnGruen]}
            onPress={() => setStrafregisterSauber(true)}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={strafregisterSauber === true ? '#000' : '#4ade80'} />
            <Text style={[styles.btnText, strafregisterSauber === true && { color: '#000' }]}>Ja, sauber</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, strafregisterSauber === false && styles.btnRot]}
            onPress={() => setStrafregisterSauber(false)}
          >
            <Ionicons name="close-circle-outline" size={18} color={strafregisterSauber === false ? '#fff' : '#f87171'} />
            <Text style={[styles.btnText, strafregisterSauber === false && { color: '#fff' }]}>Nein</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Hinweis */}
      <View style={styles.hinweisBox}>
        <Ionicons name="information-circle-outline" size={18} color="#aaa" />
        <Text style={styles.hinweisText}>Der Admin prüft deine Unterlagen. Du kannst jederzeit neue Versionen einreichen.</Text>
      </View>

      {/* Upload-Fortschritt */}
      {laden && uploadFortschritt ? (
        <View style={styles.uploadBox}>
          <ActivityIndicator color="#FFD700" size="small" />
          <Text style={styles.uploadText}>{uploadFortschritt}</Text>
        </View>
      ) : null}

      {/* Einreichen Button */}
      <TouchableOpacity
        style={[styles.einreichenBtn, laden && { opacity: 0.5 }]}
        onPress={einreichen}
        disabled={laden}
      >
        {laden ? (
          <ActivityIndicator color="#000" />
        ) : (
          <>
            <Ionicons name="cloud-upload-outline" size={20} color="#000" />
            <Text style={styles.einreichenText}>Dokumente einreichen</Text>
          </>
        )}
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d1a' },
  inhalt: { paddingBottom: 50 },

  header: {
    backgroundColor: '#1a1a2e',
    padding: 20,
    paddingTop: 50,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff10',
  },
  zurueckBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 20 },
  zurueckText: { color: '#FFD700', fontSize: 14 },
  headerTitel: { alignItems: 'center', marginBottom: 20 },
  titel: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginTop: 10, marginBottom: 6 },
  sub: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18 },

  fortschrittContainer: { gap: 6 },
  fortschrittBalken: { height: 6, backgroundColor: '#ffffff15', borderRadius: 3, overflow: 'hidden' },
  fortschrittFill: { height: 6, backgroundColor: '#FFD700', borderRadius: 3 },
  fortschrittLabel: { fontSize: 12, color: '#888', textAlign: 'right' },

  karte: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ffffff10',
  },
  karteErledigt: { borderColor: '#4ade8040' },
  karteHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  nrBadge: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#ffffff15',
    alignItems: 'center', justifyContent: 'center',
  },
  nrBadgeErledigt: { backgroundColor: '#FFD700' },
  nrText: { color: '#aaa', fontSize: 13, fontWeight: 'bold' },
  karteInfo: { flex: 1 },
  karteLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },
  karteSub: { fontSize: 11, color: '#666', marginTop: 2 },

  vorschau: {
    width: '100%', height: 160,
    borderRadius: 12, resizeMode: 'cover',
    marginBottom: 12,
  },

  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11,
    backgroundColor: '#ffffff08',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFD70030',
  },
  btnText: { fontSize: 13, color: '#FFD700', fontWeight: '600' },
  btnGruen: { backgroundColor: '#4ade80', borderColor: '#4ade80' },
  btnRot: { backgroundColor: '#e53e3e', borderColor: '#e53e3e' },

  hinweisBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: '#ffffff08',
    borderRadius: 10, padding: 12,
  },
  hinweisText: { flex: 1, fontSize: 12, color: '#888', lineHeight: 17 },

  uploadBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#ffffff08', borderRadius: 10, padding: 12,
  },
  uploadText: { color: '#aaa', fontSize: 12 },

  einreichenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD700',
    marginHorizontal: 16, borderRadius: 14,
    paddingVertical: 15,
  },
  einreichenText: { fontSize: 15, fontWeight: 'bold', color: '#000' },
});
