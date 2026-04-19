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
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { addDoc, collection, doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '@/constants/firebase';
import { Ionicons } from '@expo/vector-icons';

type FotoKey = 'fahrzeugausweis' | 'fuehrerscheinVorne' | 'fuehrerscheinHinten' | 'strafregister' | 'uidDokument';

interface Fotos {
  fahrzeugausweis: string | null;
  fuehrerscheinVorne: string | null;
  fuehrerscheinHinten: string | null;
  strafregister: string | null;
  uidDokument: string | null;
}

const SCHRITTE: { key: FotoKey; nr: number; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'fahrzeugausweis',    nr: 1, label: 'Fahrzeugausweis',              sub: 'Vorder- und Rückseite fotografieren',         icon: 'car-outline' },
  { key: 'fuehrerscheinVorne', nr: 2, label: 'Führerschein – Vorderseite',   sub: 'Name und Nummer müssen sichtbar sein',         icon: 'id-card-outline' },
  { key: 'fuehrerscheinHinten',nr: 3, label: 'Führerschein – Rückseite',     sub: 'Vollständige Rückseite fotografieren',         icon: 'id-card-outline' },
  { key: 'strafregister',      nr: 4, label: 'Strafregisterauszug',          sub: 'Offizieller Auszug, nicht älter als 3 Monate', icon: 'document-text-outline' },
  { key: 'uidDokument',        nr: 5, label: 'UID-Bestätigung',             sub: 'Handelsregister- oder UID-Auszug fotografieren', icon: 'business-outline' },
];

export default function DokumenteEinreichen() {
  const [fotos, setFotos] = useState<Fotos>({
    fahrzeugausweis: null,
    fuehrerscheinVorne: null,
    fuehrerscheinHinten: null,
    strafregister: null,
    uidDokument: null,
  });
  const [strafregisterSauber, setStrafregisterSauber] = useState<boolean | null>(null);
  const [laden, setLaden] = useState(false);
  const [uploadFortschritt, setUploadFortschritt] = useState('');

  // Fahrzeug-Daten
  const [schildnummer, setSchildnummer] = useState('');
  const [autoMarke, setAutoMarke] = useState('');
  const [autoJahrgang, setAutoJahrgang] = useState('');
  const [autoFarbe, setAutoFarbe] = useState('');

  // UID-Nummer
  const [uidNummer, setUidNummer] = useState('');

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
    if (!fotos.fahrzeugausweis || !fotos.fuehrerscheinVorne || !fotos.fuehrerscheinHinten || !fotos.strafregister || !fotos.uidDokument) {
      Alert.alert('Dokumente fehlen', 'Bitte lade alle 5 Dokumente hoch.');
      return;
    }
    if (!uidNummer.trim()) {
      Alert.alert('UID-Nummer fehlt', 'Bitte gib deine UID-Nummer ein.');
      return;
    }
    if (strafregisterSauber === null) {
      Alert.alert('Angabe fehlt', 'Bitte gib an ob dein Strafregister sauber ist.');
      return;
    }
    if (!schildnummer.trim() || !autoMarke.trim() || !autoJahrgang.trim() || !autoFarbe.trim()) {
      Alert.alert('Fahrzeug-Daten fehlen', 'Bitte fülle alle Fahrzeug-Felder aus.');
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
        [fotos.uidDokument,        `dokumente/${uid}/uid_dokument`],
      ];
      const labels = ['Fahrzeugausweis', 'Führerschein Vorne', 'Führerschein Hinten', 'Strafregister', 'UID-Bestätigung'];
      const urls: string[] = [];
      for (let i = 0; i < uploads.length; i++) {
        setUploadFortschritt(`${labels[i]} wird hochgeladen... (${i + 1}/5)`);
        urls.push(await fotoHochladen(uploads[i][0], uploads[i][1]));
      }
      setUploadFortschritt('Wird gespeichert...');
      const benutzer = auth.currentUser;
      await setDoc(
        doc(db, 'fahrer', uid),
        {
          verifiziert: 'ausstehend',
          fahrerEmail: benutzer?.email ?? null,
          fahrerName: benutzer?.displayName ?? null,
          dokumente: {
            fahrzeugausweisUrl: urls[0],
            fuehrerscheinVorneUrl: urls[1],
            fuehrerscheinHintenUrl: urls[2],
            strafregisterUrl: urls[3],
            uidDokumentUrl: urls[4],
            uidNummer: uidNummer.trim(),
            strafregisterSauber,
            eingereichtAm: Date.now(),
          },
          fahrzeug: {
            schildnummer: schildnummer.trim(),
            marke: autoMarke.trim(),
            jahrgang: autoJahrgang.trim(),
            farbe: autoFarbe.trim(),
          },
        },
        { merge: true }
      );

      try {
        await addDoc(collection(db, 'mail'), {
          to: ['support.furtgo@gmail.com'],
          message: {
            subject: `Neue Dokumente eingereicht — ${benutzer?.displayName ?? 'Fahrer'}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
                <h2 style="margin:0 0 4px;">Furtgo</h2>
                <p style="color:#666;margin:0 0 20px;font-size:13px;">Admin-Benachrichtigung</p>
                <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
                <h3 style="margin:0 0 12px;">Neue Dokumente eingereicht</h3>
                <table style="width:100%;border-collapse:collapse;">
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">Fahrer</td><td style="text-align:right;font-size:14px;">${benutzer?.displayName ?? '(kein Name)'}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">E-Mail</td><td style="text-align:right;font-size:14px;">${benutzer?.email ?? '–'}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">UID-Nummer</td><td style="text-align:right;font-size:14px;">${uidNummer.trim()}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">Fahrzeug</td><td style="text-align:right;font-size:14px;">${autoMarke.trim()} (${autoJahrgang.trim()}, ${autoFarbe.trim()})</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">Schildnummer</td><td style="text-align:right;font-size:14px;">${schildnummer.trim()}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">Strafregister sauber</td><td style="text-align:right;font-size:14px;">${strafregisterSauber ? 'Ja' : 'Nein (Einträge vorhanden)'}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">Eingereicht am</td><td style="text-align:right;font-size:14px;">${new Date().toLocaleString('de-CH')}</td></tr>
                </table>
                <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
                <p style="color:#666;font-size:13px;text-align:center;">Bitte im Admin-Panel prüfen und freigeben oder ablehnen.</p>
              </div>`,
          },
        });
      } catch (mailErr) {
        console.error('Admin-Mail Fehler (ignoriert):', mailErr);
      }

      Alert.alert('Eingereicht ✓', 'Deine Dokumente wurden erfolgreich eingereicht. Du wirst nach der Prüfung freigeschaltet.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error('Dokumente-Upload Fehler:', err);
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
          <Text style={styles.zurueckPfeil}>&#x2039;</Text>
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

      {/* UID-Nummer */}
      <View style={styles.karte}>
        <View style={styles.karteHeader}>
          <View style={[styles.nrBadge, uidNummer.trim() ? styles.nrBadgeErledigt : {}]}>
            {uidNummer.trim()
              ? <Ionicons name="checkmark" size={16} color="#000" />
              : <Text style={styles.nrText}>7</Text>
            }
          </View>
          <View style={styles.karteInfo}>
            <Text style={styles.karteLabel}>UID-Nummer</Text>
            <Text style={styles.karteSub}>Unternehmens-Identifikationsnummer (z.B. CHE-123.456.789)</Text>
          </View>
          <Ionicons name="business-outline" size={22} color={uidNummer.trim() ? '#4ade80' : '#444'} />
        </View>
        <TextInput
          style={styles.fahrzeugInput}
          placeholder="CHE-123.456.789"
          placeholderTextColor="#555"
          value={uidNummer}
          onChangeText={setUidNummer}
          autoCapitalize="characters"
        />
      </View>

      {/* Fahrzeug-Daten */}
      <View style={styles.karte}>
        <View style={styles.karteHeader}>
          <View style={[styles.nrBadge, (schildnummer && autoMarke && autoJahrgang && autoFarbe) ? styles.nrBadgeErledigt : {}]}>
            {(schildnummer && autoMarke && autoJahrgang && autoFarbe)
              ? <Ionicons name="checkmark" size={16} color="#000" />
              : <Text style={styles.nrText}>8</Text>
            }
          </View>
          <View style={styles.karteInfo}>
            <Text style={styles.karteLabel}>Fahrzeug-Daten</Text>
            <Text style={styles.karteSub}>Damit der Fahrgast dein Auto erkennt</Text>
          </View>
          <Ionicons name="car-sport-outline" size={22} color={(schildnummer && autoMarke && autoJahrgang && autoFarbe) ? '#4ade80' : '#444'} />
        </View>
        <View style={styles.fahrzeugFelder}>
          <TextInput
            style={styles.fahrzeugInput}
            placeholder="Schildnummer (z.B. ZH 123456)"
            placeholderTextColor="#555"
            value={schildnummer}
            onChangeText={setSchildnummer}
            autoCapitalize="characters"
          />
          <TextInput
            style={styles.fahrzeugInput}
            placeholder="Marke + Modell (z.B. Toyota Camry)"
            placeholderTextColor="#555"
            value={autoMarke}
            onChangeText={setAutoMarke}
          />
          <View style={styles.fahrzeugRow}>
            <TextInput
              style={[styles.fahrzeugInput, { flex: 1 }]}
              placeholder="Jahrgang (z.B. 2020)"
              placeholderTextColor="#555"
              value={autoJahrgang}
              onChangeText={setAutoJahrgang}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.fahrzeugInput, { flex: 1 }]}
              placeholder="Farbe (z.B. Schwarz)"
              placeholderTextColor="#555"
              value={autoFarbe}
              onChangeText={setAutoFarbe}
            />
          </View>
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
  zurueckBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 20,
  },
  zurueckPfeil: { color: '#fff', fontSize: 22, fontWeight: '300', marginTop: -2 },
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

  fahrzeugFelder: { gap: 10 },
  fahrzeugInput: {
    backgroundColor: '#ffffff08',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFD70030',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#fff',
  },
  fahrzeugRow: { flexDirection: 'row', gap: 10 },

  einreichenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD700',
    marginHorizontal: 16, borderRadius: 14,
    paddingVertical: 15,
  },
  einreichenText: { fontSize: 15, fontWeight: 'bold', color: '#000' },
});
