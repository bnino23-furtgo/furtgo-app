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
import { httpsCallable } from 'firebase/functions';
import { auth, db, storage, functions } from '@/constants/firebase';
import { Ionicons } from '@expo/vector-icons';

type FotoKey = 'fahrzeugausweis' | 'fuehrerscheinVorne' | 'fuehrerscheinHinten' | 'strafregister';

interface Fotos {
  fahrzeugausweis: string | null;
  fuehrerscheinVorne: string | null;
  fuehrerscheinHinten: string | null;
  strafregister: string | null;
}

interface UidErgebnis {
  gefunden: boolean;
  uid?: string;
  name?: string;
  ort?: string | null;
  aktiv?: boolean;
  status?: string | null;
  fehler?: string;
}

const SCHRITTE: { key: FotoKey; nr: number; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'fahrzeugausweis',    nr: 1, label: 'Fahrzeugausweis',              sub: 'Vorder- und Rückseite fotografieren',         icon: 'car-outline' },
  { key: 'fuehrerscheinVorne', nr: 2, label: 'Führerschein – Vorderseite',   sub: 'Name und Nummer müssen sichtbar sein',         icon: 'id-card-outline' },
  { key: 'fuehrerscheinHinten',nr: 3, label: 'Führerschein – Rückseite',     sub: 'Vollständige Rückseite fotografieren',         icon: 'id-card-outline' },
  { key: 'strafregister',      nr: 4, label: 'Strafregisterauszug',          sub: 'Offizieller Auszug, nicht älter als 3 Monate', icon: 'document-text-outline' },
];

export default function DokumenteEinreichen() {
  const [fotos, setFotos] = useState<Fotos>({
    fahrzeugausweis: null,
    fuehrerscheinVorne: null,
    fuehrerscheinHinten: null,
    strafregister: null,
  });
  const [strafregisterSauber, setStrafregisterSauber] = useState<boolean | null>(null);
  const [laden, setLaden] = useState(false);
  const [uploadFortschritt, setUploadFortschritt] = useState('');

  // Fahrzeug-Daten
  const [schildnummer, setSchildnummer] = useState('');
  const [autoMarke, setAutoMarke] = useState('');
  const [autoJahrgang, setAutoJahrgang] = useState('');
  const [autoFarbe, setAutoFarbe] = useState('');

  // UID-Nummer + Firmenname, Live-Prüfung gegen das öffentliche UID-Register
  const [uidNummer, setUidNummer] = useState('');
  const [firmenName, setFirmenName] = useState('');
  const [uidPruefen, setUidPruefen] = useState(false);
  const [uidErgebnis, setUidErgebnis] = useState<UidErgebnis | null>(null);

  // Tippt der offizielle Name vom eingegebenen ab? (nur Hinweis, nicht blockierend)
  const nameWeichtAb =
    uidErgebnis?.gefunden &&
    firmenName.trim().length > 0 &&
    uidErgebnis.name?.trim().toLowerCase() !== firmenName.trim().toLowerCase();

  const uidLivePruefen = async () => {
    if (!uidNummer.trim()) {
      Alert.alert('UID fehlt', 'Bitte gib zuerst deine UID-Nummer ein.');
      return;
    }
    setUidPruefen(true);
    setUidErgebnis(null);
    try {
      const callable = httpsCallable<{ uid: string }, UidErgebnis>(functions, 'pruefeUid');
      const res = await callable({ uid: uidNummer.trim() });
      const data = res.data;
      setUidErgebnis(data);
      if (data.gefunden && data.uid) setUidNummer(data.uid); // auf CHE-XXX.XXX.XXX normalisieren
    } catch (e) {
      console.error('UID-Prüfung Fehler:', e);
      setUidErgebnis({ gefunden: false, fehler: 'UID-Register nicht erreichbar. Bitte später erneut versuchen.' });
    } finally {
      setUidPruefen(false);
    }
  };

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
    if (!fotos.fahrzeugausweis || !fotos.fuehrerscheinVorne || !fotos.fuehrerscheinHinten || !fotos.strafregister) {
      Alert.alert('Dokumente fehlen', 'Bitte lade alle 4 Dokumente hoch.');
      return;
    }
    if (!uidErgebnis?.gefunden) {
      Alert.alert('UID nicht geprüft', 'Bitte gib deine UID-Nummer ein und tippe auf "UID prüfen". Sie muss im Register gefunden werden.');
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
      ];
      const labels = ['Fahrzeugausweis', 'Führerschein Vorne', 'Führerschein Hinten', 'Strafregister'];
      const urls: string[] = [];
      for (let i = 0; i < uploads.length; i++) {
        setUploadFortschritt(`${labels[i]} wird hochgeladen... (${i + 1}/${uploads.length})`);
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
            uidNummer: uidErgebnis.uid ?? uidNummer.trim(),
            firmenName: uidErgebnis.name ?? null,
            uidOrt: uidErgebnis.ort ?? null,
            uidAktiv: uidErgebnis.aktiv ?? null,
            uidGeprueftAm: Date.now(),
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
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">UID-Nummer</td><td style="text-align:right;font-size:14px;">${uidErgebnis.uid ?? uidNummer.trim()}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#333;">Firma (UID-Register)</td><td style="text-align:right;font-size:14px;">${uidErgebnis.name ?? '–'}${uidErgebnis.aktiv ? ' ✓ aktiv' : ' (nicht aktiv)'}</td></tr>
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
            <View style={[styles.fortschrittFill, { width: `${(fertigCount / SCHRITTE.length) * 100}%` }]} />
          </View>
          <Text style={styles.fortschrittLabel}>{fertigCount} / {SCHRITTE.length} Dokumente hochgeladen</Text>
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
              : <Text style={styles.nrText}>5</Text>
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

      {/* UID-Nummer + Firmenname mit Live-Prüfung */}
      <View style={styles.karte}>
        <View style={styles.karteHeader}>
          <View style={[styles.nrBadge, uidErgebnis?.gefunden ? styles.nrBadgeErledigt : {}]}>
            {uidErgebnis?.gefunden
              ? <Ionicons name="checkmark" size={16} color="#000" />
              : <Text style={styles.nrText}>6</Text>
            }
          </View>
          <View style={styles.karteInfo}>
            <Text style={styles.karteLabel}>Firma & UID-Nummer</Text>
            <Text style={styles.karteSub}>Wird live im offiziellen UID-Register geprüft</Text>
          </View>
          <Ionicons name="business-outline" size={22} color={uidErgebnis?.gefunden ? '#4ade80' : '#444'} />
        </View>
        <TextInput
          style={styles.fahrzeugInput}
          placeholder="Firmenname (z.B. Muster Transport GmbH)"
          placeholderTextColor="#555"
          value={firmenName}
          onChangeText={setFirmenName}
        />
        <TextInput
          style={[styles.fahrzeugInput, { marginTop: 10 }]}
          placeholder="CHE-123.456.789"
          placeholderTextColor="#555"
          value={uidNummer}
          onChangeText={(v) => { setUidNummer(v); setUidErgebnis(null); }}
          autoCapitalize="characters"
        />
        <TouchableOpacity
          style={[styles.uidPruefBtn, (uidPruefen || !uidNummer.trim()) && { opacity: 0.5 }]}
          onPress={uidLivePruefen}
          disabled={uidPruefen || !uidNummer.trim()}
        >
          {uidPruefen ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <>
              <Ionicons name="search-outline" size={18} color="#000" />
              <Text style={styles.uidPruefBtnText}>UID prüfen</Text>
            </>
          )}
        </TouchableOpacity>

        {uidErgebnis && (
          uidErgebnis.gefunden ? (
            <View style={styles.uidOk}>
              <Ionicons name="checkmark-circle" size={20} color="#4ade80" />
              <View style={{ flex: 1 }}>
                <Text style={styles.uidOkName}>
                  {uidErgebnis.name}{uidErgebnis.ort ? ` · ${uidErgebnis.ort}` : ''}
                </Text>
                <Text style={styles.uidOkSub}>
                  {uidErgebnis.uid} · {uidErgebnis.aktiv ? 'aktiv im Register' : 'im Register, aber nicht aktiv'}
                </Text>
                {nameWeichtAb && (
                  <Text style={styles.uidHinweis}>
                    Hinweis: offizieller Name weicht ab — es wird «{uidErgebnis.name}» übernommen.
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.uidFehler}>
              <Ionicons name="close-circle" size={20} color="#f87171" />
              <Text style={styles.uidFehlerText}>{uidErgebnis.fehler ?? 'UID nicht gefunden.'}</Text>
            </View>
          )
        )}
      </View>

      {/* Fahrzeug-Daten */}
      <View style={styles.karte}>
        <View style={styles.karteHeader}>
          <View style={[styles.nrBadge, (schildnummer && autoMarke && autoJahrgang && autoFarbe) ? styles.nrBadgeErledigt : {}]}>
            {(schildnummer && autoMarke && autoJahrgang && autoFarbe)
              ? <Ionicons name="checkmark" size={16} color="#000" />
              : <Text style={styles.nrText}>7</Text>
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

  uidPruefBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FFD700',
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 10,
  },
  uidPruefBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },
  uidOk: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: '#4ade8015',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ade8040',
    padding: 12,
    marginTop: 12,
  },
  uidOkName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  uidOkSub: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  uidHinweis: { color: '#FFD700', fontSize: 12, marginTop: 6 },
  uidFehler: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    backgroundColor: '#f8717115',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f8717140',
    padding: 12,
    marginTop: 12,
  },
  uidFehlerText: { color: '#fca5a5', fontSize: 13, flex: 1 },

  einreichenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD700',
    marginHorizontal: 16, borderRadius: 14,
    paddingVertical: 15,
  },
  einreichenText: { fontSize: 15, fontWeight: 'bold', color: '#000' },
});
