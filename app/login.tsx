import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '@/constants/firebase';
import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

const LEGAL_URL = 'https://bnino23-furtgo.github.io/furtgo-legal';

const AKTUELLES_JAHR = new Date().getFullYear();
const MIN_BAUJAHR = AKTUELLES_JAHR - 12; // Fahrzeug max. 12 Jahre alt

export default function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [isRegistrierung, setIsRegistrierung] = useState(false);
  const [laden, setLaden] = useState(false);
  const [fehler, setFehler] = useState('');
  const [resetErfolg, setResetErfolg] = useState('');

  // Registrierungs-Felder
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [telefon, setTelefon] = useState('');
  const [strasse, setStrasse] = useState('');
  const [ortschaft, setOrtschaft] = useState('');
  const [rolle, setRolle] = useState<'fahrgast' | 'fahrer'>('fahrgast');
  const [baujahr, setBaujahr] = useState('');
  const [agbAkzeptiert, setAgbAkzeptiert] = useState(false);
  const [ausweisUri, setAusweisUri] = useState<string | null>(null);

  const ausweisWaehlen = async (quelle: 'kamera' | 'galerie') => {
    let result;
    if (quelle === 'kamera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') return;
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    }
    if (!result.canceled && result.assets[0]) {
      setAusweisUri(result.assets[0].uri);
    }
  };

  const passwortZuruecksetzen = async () => {
    setFehler('');
    setResetErfolg('');
    if (!email.trim()) {
      setFehler(t('login.fehlerEmail'));
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetErfolg(t('login.resetErfolg'));
    } catch (e: any) {
      setFehler(t('login.fehlerUngueltigeEmail'));
    }
  };

  const absenden = async () => {
    setFehler('');
    if (!email.trim() || !passwort.trim()) {
      setFehler(t('login.fehlerEmailPasswort'));
      return;
    }
    if (isRegistrierung) {
      if (!vorname.trim() || !nachname.trim()) {
        setFehler(t('login.fehlerName'));
        return;
      }
      if (!telefon.trim()) {
        setFehler(t('login.fehlerTelefon'));
        return;
      }
      if (!strasse.trim() || !ortschaft.trim()) {
        setFehler(t('login.fehlerAdresse'));
        return;
      }
      if (!agbAkzeptiert) {
        setFehler(t('login.fehlerAgb'));
        return;
      }
      if (!ausweisUri) {
        setFehler(t('login.fehlerAusweis'));
        return;
      }
      if (rolle === 'fahrer') {
        const baujahrZahl = parseInt(baujahr.trim(), 10);
        if (!baujahr.trim() || isNaN(baujahrZahl)) {
          setFehler(t('login.fehlerBaujahr'));
          return;
        }
        if (baujahrZahl < MIN_BAUJAHR || baujahrZahl > AKTUELLES_JAHR) {
          setFehler(t('login.baujahrFehler', { min: MIN_BAUJAHR }));
          return;
        }
      }
    }
    setLaden(true);
    try {
      if (isRegistrierung) {
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), passwort);
        const vollname = `${vorname.trim()} ${nachname.trim()}`;
        await updateProfile(user, { displayName: vollname });
        const nutzerDaten: Record<string, any> = {
          vorname: vorname.trim(),
          nachname: nachname.trim(),
          email: email.trim(),
          telefon: telefon.trim(),
          strasse: strasse.trim(),
          ortschaft: ortschaft.trim(),
          rolle,
          erstelltAm: Date.now(),
        };
        if (rolle === 'fahrer') {
          nutzerDaten.baujahr = parseInt(baujahr.trim(), 10);
        }
        // Ausweis hochladen
        if (ausweisUri) {
          try {
            const xhr = new XMLHttpRequest();
            const blob: Blob = await new Promise((resolve, reject) => {
              xhr.onload = () => resolve(xhr.response);
              xhr.onerror = reject;
              xhr.responseType = 'blob';
              xhr.open('GET', ausweisUri);
              xhr.send();
            });
            const fRef = storageRef(storage, `ausweis/${user.uid}/dokument`);
            const snap = await uploadBytes(fRef, blob);
            nutzerDaten.ausweisUrl = await getDownloadURL(snap.ref);
          } catch {
            // Upload-Fehler blockiert nicht die Registrierung
          }
        }
        await setDoc(doc(db, 'nutzer', user.uid), nutzerDaten);
        if (rolle === 'fahrer') {
          await setDoc(doc(db, 'fahrer', user.uid), {
            name: vollname,
            baujahr: parseInt(baujahr.trim(), 10),
            online: false,
            erstelltAm: Date.now(),
          });
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), passwort);
      }
    } catch (e: any) {
      const meldungen: Record<string, string> = {
        'auth/invalid-email': t('login.fehlerUngueltigeEmail'),
        'auth/user-not-found': t('login.fehlerKeinKonto'),
        'auth/wrong-password': t('login.fehlerPasswort'),
        'auth/invalid-credential': t('login.fehlerCredential'),
        'auth/email-already-in-use': t('login.fehlerEmailVergeben'),
        'auth/weak-password': t('login.fehlerSchwachesPasswort'),
      };
      setFehler(meldungen[e.code] ?? `${t('allgemein.fehler')}: ${e.code}`);
    } finally {
      setLaden(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#1a1a2e' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, !isRegistrierung && styles.containerZentriert]}
        keyboardShouldPersistTaps="handled"
      >
        <Image source={require('@/assets/images/icon.png')} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.untertitel}>
          {isRegistrierung ? t('login.neuesKonto') : t('login.willkommen')}
        </Text>

        {isRegistrierung && (
          <>
            {/* Rolle wählen */}
            <Text style={styles.sektionLabel}>{t('login.rolleWaehlen')}</Text>
            <View style={styles.rolleRow}>
              <TouchableOpacity
                style={[styles.rolleBtn, rolle === 'fahrgast' && styles.rolleBtnAktiv]}
                onPress={() => setRolle('fahrgast')}
              >
                <Text style={styles.rolleBtnIcon}>🙋</Text>
                <Text style={[styles.rolleBtnText, rolle === 'fahrgast' && styles.rolleBtnTextAktiv]}>
                  {t('login.fahrgast')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rolleBtn, rolle === 'fahrer' && styles.rolleBtnAktivFahrer]}
                onPress={() => setRolle('fahrer')}
              >
                <Text style={styles.rolleBtnIcon}>🚗</Text>
                <Text style={[styles.rolleBtnText, rolle === 'fahrer' && styles.rolleBtnTextAktiv]}>
                  {t('login.fahrer')}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.rolleHinweis}>
              {t('login.rolleHinweis')}
            </Text>

            {/* Fahrer-spezifische Felder */}
            {rolle === 'fahrer' && (
              <TextInput
                style={[styles.input, styles.inputRegister]}
                placeholder={t('login.baujahr', { min: MIN_BAUJAHR })}
                placeholderTextColor="#6a9a6a"
                value={baujahr}
                onChangeText={setBaujahr}
                keyboardType="number-pad"
                maxLength={4}
              />
            )}

            <View style={styles.zeile}>
              <TextInput
                style={[styles.input, styles.inputRegister, styles.inputHalb]}
                placeholder={t('login.vorname')}
                placeholderTextColor="#6a9a6a"
                value={vorname}
                onChangeText={setVorname}
              />
              <TextInput
                style={[styles.input, styles.inputRegister, styles.inputHalb]}
                placeholder={t('login.nachname')}
                placeholderTextColor="#6a9a6a"
                value={nachname}
                onChangeText={setNachname}
              />
            </View>
            <TextInput
              style={[styles.input, styles.inputRegister]}
              placeholder={t('login.mobilnummer')}
              placeholderTextColor="#6a9a6a"
              value={telefon}
              onChangeText={setTelefon}
              keyboardType="phone-pad"
            />
            <TextInput
              style={[styles.input, styles.inputRegister]}
              placeholder={t('login.strasse')}
              placeholderTextColor="#6a9a6a"
              value={strasse}
              onChangeText={setStrasse}
            />
            <TextInput
              style={[styles.input, styles.inputRegister]}
              placeholder={t('login.plzOrt')}
              placeholderTextColor="#6a9a6a"
              value={ortschaft}
              onChangeText={setOrtschaft}
            />

            {/* Ausweis / Pass / Ausländerbewilligung */}
            <Text style={styles.sektionLabel}>{t('login.ausweis')}</Text>
            <View style={styles.zeile}>
              <TouchableOpacity style={styles.ausweisPickBtn} onPress={() => ausweisWaehlen('kamera')}>
                <Text style={styles.ausweisPickText}>{t('login.kamera')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ausweisPickBtn} onPress={() => ausweisWaehlen('galerie')}>
                <Text style={styles.ausweisPickText}>{t('login.galerie')}</Text>
              </TouchableOpacity>
            </View>
            {ausweisUri && (
              <Image source={{ uri: ausweisUri }} style={styles.ausweisVorschau} resizeMode="cover" />
            )}
          </>
        )}

        <TextInput
          style={[styles.input, isRegistrierung ? styles.inputRegister : styles.inputLogin]}
          placeholder={t('login.email')}
          placeholderTextColor={isRegistrierung ? '#6a9a6a' : '#556a8a'}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={[styles.input, isRegistrierung ? styles.inputRegister : styles.inputLogin]}
          placeholder={t('login.passwort')}
          placeholderTextColor={isRegistrierung ? '#6a9a6a' : '#556a8a'}
          value={passwort}
          onChangeText={setPasswort}
          secureTextEntry
        />

        {isRegistrierung && (
          <TouchableOpacity
            style={styles.agbRow}
            onPress={() => setAgbAkzeptiert(!agbAkzeptiert)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, agbAkzeptiert && styles.checkboxAktiv]}>
              {agbAkzeptiert && <Text style={styles.checkboxHaken}>✓</Text>}
            </View>
            <Text style={styles.agbText}>
              {t('login.agb')}{' '}
              <Text style={styles.agbLink} onPress={() => Linking.openURL(`${LEGAL_URL}#agb`)}>{t('login.agbLink')}</Text>
              {' '}{t('login.und')}{' '}
              <Text style={styles.agbLink} onPress={() => Linking.openURL(`${LEGAL_URL}#datenschutz`)}>{t('login.datenschutz')}</Text>
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, isRegistrierung ? styles.buttonRegister : styles.buttonLogin, laden && styles.buttonDisabled]}
          onPress={absenden}
          disabled={laden}
        >
          {laden ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>
              {isRegistrierung ? t('login.registrieren') : t('login.einloggen')}
            </Text>
          )}
        </TouchableOpacity>

        {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}
        {resetErfolg ? <Text style={styles.erfolg}>{resetErfolg}</Text> : null}

        <TouchableOpacity onPress={() => { setIsRegistrierung(!isRegistrierung); setFehler(''); }}>
          <Text style={styles.wechseln}>
            {isRegistrierung
              ? t('login.bereitsKonto')
              : t('login.nochKeinKonto')}
          </Text>
        </TouchableOpacity>

        {!isRegistrierung && (
          <TouchableOpacity onPress={passwortZuruecksetzen} style={styles.resetButton}>
            <Text style={styles.resetText}>{t('login.passwortVergessen')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    padding: 22,
    paddingTop: 40,
    paddingBottom: 40,
  },
  containerZentriert: {
    justifyContent: 'flex-start',
  },
  logoImage: {
    width: 100,
    height: 100,
    alignSelf: 'center',
    marginBottom: 4,
  },
  untertitel: {
    fontSize: 13,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 24,
  },
  rolleHinweis: {
    fontSize: 11,
    color: '#888',
    marginBottom: 14,
    marginTop: -6,
    lineHeight: 15,
  },
  sektionLabel: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 8,
    marginTop: 4,
  },
  rolleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  rolleBtn: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 11,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  rolleBtnAktiv: {
    borderColor: '#FFD700',
    backgroundColor: '#2a2000',
  },
  rolleBtnAktivFahrer: {
    borderColor: '#4ade80',
    backgroundColor: '#0f2d18',
  },
  rolleBtnIcon: { fontSize: 22, marginBottom: 4 },
  rolleBtnText: { fontSize: 13, color: '#aaa', fontWeight: '600' },
  rolleBtnTextAktiv: { color: '#fff' },
  zeile: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 11,
    paddingVertical: 6,
    paddingHorizontal: 13,
    fontSize: 14,
    color: '#fff',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  inputHalb: {
    flex: 1,
  },
  inputLogin: {
    borderColor: '#1e3a5f',
    backgroundColor: '#0f2035',
  },
  inputRegister: {
    borderColor: '#1e4d2b',
    backgroundColor: '#0f2d18',
  },
  button: {
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 13,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  buttonLogin: { backgroundColor: '#FFD700' },
  buttonRegister: { backgroundColor: '#4ade80' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 14, fontWeight: 'bold', color: '#000' },
  agbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: '#4ade80',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxAktiv: { backgroundColor: '#4ade80' },
  checkboxHaken: { fontSize: 12, color: '#000', fontWeight: 'bold' },
  agbText: { fontSize: 12, color: '#aaa', flex: 1 },
  agbLink: { color: '#4ade80', textDecorationLine: 'underline' },
  wechseln: { color: '#aaa', textAlign: 'center', fontSize: 12 },
  fehler: {
    color: '#ff6b6b',
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 12,
    backgroundColor: '#2a1a1a',
    padding: 10,
    borderRadius: 8,
  },
  erfolg: {
    color: '#4ade80',
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 12,
    backgroundColor: '#0f2d18',
    padding: 10,
    borderRadius: 8,
  },
  resetButton: { marginTop: 12, alignItems: 'center' },
  resetText: { color: '#FFD700', fontSize: 12 },
  ausweisPickBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 9,
    borderWidth: 1, borderColor: '#1e4d2b',
    backgroundColor: '#0f2d18', alignItems: 'center', marginBottom: 10,
  },
  ausweisPickText: { fontSize: 12, color: '#4ade80' },
  ausweisVorschau: {
    width: '100%', height: 100, borderRadius: 9,
    marginBottom: 10, borderWidth: 1, borderColor: '#1e4d2b',
  },
});
