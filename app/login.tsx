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
  Linking,
} from 'react-native';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage, functions } from '@/constants/firebase';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

const LEGAL_URL = 'https://furtgo.ch/legal.html';
const DOWNLOAD_URL = 'https://furtgo.ch/download/';
const IST_WEB = Platform.OS === 'web';

const AKTUELLES_JAHR = new Date().getFullYear();

export default function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [isRegistrierung, setIsRegistrierung] = useState(false);
  const [laden, setLaden] = useState(false);
  const [fehler, setFehler] = useState('');
  const [resetErfolg, setResetErfolg] = useState('');
  const [bestaetigungGesendet, setBestaetigungGesendet] = useState<string | null>(null);
  const [kannErneutSenden, setKannErneutSenden] = useState<string | null>(null);

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

  const bestaetigungErneutSenden = async () => {
    if (!kannErneutSenden || !passwort.trim()) {
      setFehler(t('login.fehlerEmailPasswort'));
      return;
    }
    setFehler('');
    try {
      const { user } = await signInWithEmailAndPassword(auth, kannErneutSenden, passwort);
      if (!user.emailVerified) {
        await httpsCallable(functions, 'sendeBestaetigungsMail')({});
      }
      await signOut(auth);
      setResetErfolg(t('login.bestaetigungErneutGesendet'));
      setKannErneutSenden(null);
    } catch {
      setFehler(t('login.fehlerPasswort'));
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
    } catch {
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
        if (baujahrZahl > AKTUELLES_JAHR) {
          setFehler(t('login.baujahrFehler', { jahr: AKTUELLES_JAHR }));
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
        try {
          await httpsCallable(functions, 'sendeBestaetigungsMail')({});
        } catch {
          // Mail-Versand-Fehler blockiert nicht die Registrierung
        }
        await signOut(auth);
        setBestaetigungGesendet(email.trim());
        setIsRegistrierung(false);
        setVorname(''); setNachname(''); setTelefon('');
        setStrasse(''); setOrtschaft(''); setBaujahr('');
        setAgbAkzeptiert(false); setAusweisUri(null);
        setPasswort('');
      } else {
        const { user } = await signInWithEmailAndPassword(auth, email.trim(), passwort);
        if (!user.emailVerified) {
          await signOut(auth);
          setFehler(t('login.fehlerEmailNichtBestaetigt'));
          setKannErneutSenden(email.trim());
          return;
        }
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
        <View style={styles.logoWrapper}>
          <View style={styles.logoLine} />
          {['25%', '50%', '75%'].map((topPos) => (
            <View key={topPos} style={[styles.roadDashes, { top: topPos as any }]}>
              {Array.from({ length: 30 }).map((_, i) => (
                <View key={i} style={styles.roadDash} />
              ))}
            </View>
          ))}
          <View style={styles.logoSide} />
          <Image
            source={
              isRegistrierung && rolle === 'fahrgast'
                ? require('@/assets/images/icon-fahrgast.png')
                : require('@/assets/images/icon.png')
            }
            style={styles.logoImage}
            resizeMode="contain"
          />
          <View style={styles.logoSide} />
        </View>
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
              {!IST_WEB && (
                <TouchableOpacity
                  style={[styles.rolleBtn, rolle === 'fahrer' && styles.rolleBtnAktivFahrer]}
                  onPress={() => setRolle('fahrer')}
                >
                  <Text style={styles.rolleBtnIcon}>🚗</Text>
                  <Text style={[styles.rolleBtnText, rolle === 'fahrer' && styles.rolleBtnTextAktiv]}>
                    {t('login.fahrer')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.rolleHinweis}>
              {t('login.rolleHinweis')}
            </Text>
            {IST_WEB && (
              <TouchableOpacity onPress={() => Linking.openURL(DOWNLOAD_URL)}>
                <Text style={styles.webFahrerHinweis}>
                  Du bist Fahrer? Android-App installieren →
                </Text>
              </TouchableOpacity>
            )}

            {/* Fahrer-spezifische Felder */}
            {rolle === 'fahrer' && (
              <TextInput
                style={[styles.input, styles.inputRegister]}
                placeholder={t('login.baujahr')}
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

        {bestaetigungGesendet && (
          <View style={styles.bestaetigungBox}>
            <Text style={styles.bestaetigungTitel}>{t('login.bestaetigungTitel')}</Text>
            <Text style={styles.bestaetigungText}>
              {t('login.bestaetigungText', { email: bestaetigungGesendet })}
            </Text>
          </View>
        )}

        {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}
        {resetErfolg ? <Text style={styles.erfolg}>{resetErfolg}</Text> : null}

        {kannErneutSenden && (
          <TouchableOpacity onPress={bestaetigungErneutSenden} style={styles.resetButton}>
            <Text style={styles.resetText}>{t('login.bestaetigungErneutSenden')}</Text>
          </TouchableOpacity>
        )}

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
  logoWrapper: {
    height: 100,
    marginBottom: 4,
    marginHorizontal: -22,
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoSide: {
    flex: 1,
  },
  logoLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFD700',
  },
  roadDashes: {
    position: 'absolute',
    left: 0,
    right: 0,
    marginTop: -0.5,
    height: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  roadDash: {
    width: 6,
    height: 1,
    backgroundColor: '#000',
  },
  logoImage: {
    width: 100,
    height: 100,
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
  webFahrerHinweis: {
    fontSize: 12,
    color: '#FFD700',
    marginBottom: 14,
    marginTop: -4,
    textDecorationLine: 'underline',
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
  bestaetigungBox: {
    backgroundColor: '#0f2d18',
    borderColor: '#4ade80',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  bestaetigungTitel: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
  },
  bestaetigungText: {
    color: '#aaa',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
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
