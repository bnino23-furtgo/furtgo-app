import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut,
  deleteUser,
} from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@/constants/firebase';
import { useTranslation } from 'react-i18next';
import { supportedLanguages, driverLanguages, changeLanguage } from '@/i18n';

const SUMUP_LINK = 'https://pay.sumup.com/b2c/X8YC4RF074';
const LEGAL_URL = 'https://furtgo.ch/legal.html';
const HILFE_URL = 'https://furtgo.ch/hilfe.html';

export default function ProfilScreen() {
  const { t, i18n } = useTranslation();
  const { rolle } = useLocalSearchParams<{ rolle?: string }>();
  const istFahrerRolle = rolle === 'fahrer';
  const user = auth.currentUser;

  // Persönliche Daten
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [telefon, setTelefon] = useState('');
  const [strasse, setStrasse] = useState('');
  const [ortschaft, setOrtschaft] = useState('');
  const [ladenProfil, setLadenProfil] = useState(false);

  // Fahrer-Infos
  const [verifiziert, setVerifiziert] = useState<string | null>(null);
  const [bewertung, setBewertung] = useState<number | null>(null);
  const [anzahlFahrten, setAnzahlFahrten] = useState<number | null>(null);
  const [tarif, setTarif] = useState<number | null>(null);
  const [aboGueltigBis, setAboGueltigBis] = useState<number | null>(null);

  // Fahrgast-Infos
  const [anzahlFahrtenAlsFahrgast, setAnzahlFahrtenAlsFahrgast] = useState<number | null>(null);
  const [istFahrer, setIstFahrer] = useState(false);

  // Passwort ändern
  const [altesPasswort, setAltesPasswort] = useState('');
  const [neuesPasswort, setNeuesPasswort] = useState('');
  const [passwortBestaetigen, setPasswortBestaetigen] = useState('');
  const [ladenPasswort, setLadenPasswort] = useState(false);

  const [istAdmin, setIstAdmin] = useState(false);
  const [datenladen, setDatenladen] = useState(true);

  // Support Formular
  const [supportModal, setSupportModal] = useState(false);
  const [supportThema, setSupportThema] = useState('');
  const [supportNachricht, setSupportNachricht] = useState('');
  const [supportLaden, setSupportLaden] = useState(false);

  // Konto löschen Modal
  const [loeschenModal, setLoeschenModal] = useState(false);

  // Sprachauswahl
  const [sprachModal, setSprachModal] = useState(false);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;

    const laden = async () => {
      try {
        const nutzerSnap = await getDoc(doc(db, 'nutzer', uid));
        if (nutzerSnap.exists()) {
          const d = nutzerSnap.data();
          setVorname(d.vorname ?? '');
          setNachname(d.nachname ?? '');
          setTelefon(d.telefon ?? '');
          setStrasse(d.strasse ?? '');
          setOrtschaft(d.ortschaft ?? '');
          setIstAdmin(d.istAdmin === true);
        }

        const fahrerSnap = await getDoc(doc(db, 'fahrer', uid));
        if (fahrerSnap.exists()) {
          setIstFahrer(true);
          const d = fahrerSnap.data();
          setVerifiziert(d.verifiziert ?? null);
          setBewertung(d.bewertungsDurchschnitt ?? null);
          setTarif(d.preisProKm ?? null);
          setAboGueltigBis(d.aboGueltigBis ?? null);
        }

        const fahrtenSnap = await getDocs(
          query(collection(db, 'fahrten'), where('fahrerId', '==', uid), where('status', '==', 'abgeschlossen'))
        );
        setAnzahlFahrten(fahrtenSnap.size);

        const fahrgastFahrtenSnap = await getDocs(
          query(collection(db, 'fahrten'), where('fahrgastId', '==', uid), where('status', '==', 'abgeschlossen'))
        );
        setAnzahlFahrtenAlsFahrgast(fahrgastFahrtenSnap.size);
      } catch (e) {
        console.log('Profil laden Fehler (ignoriert):', e);
      } finally {
        setDatenladen(false);
      }
    };
    laden();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profilSpeichern = async () => {
    if (!vorname.trim() || !nachname.trim()) {
      Alert.alert(t('allgemein.fehler'), t('login.fehlerName'));
      return;
    }
    const uid = user?.uid;
    if (!uid) return;
    setLadenProfil(true);
    try {
      const vollname = `${vorname.trim()} ${nachname.trim()}`;
      if (user) await updateProfile(user, { displayName: vollname });
      await setDoc(doc(db, 'nutzer', uid), {
        vorname: vorname.trim(),
        nachname: nachname.trim(),
        telefon: telefon.trim(),
        strasse: strasse.trim(),
        ortschaft: ortschaft.trim(),
      }, { merge: true });
      if (istFahrer) {
        await setDoc(doc(db, 'fahrer', uid), { name: vollname }, { merge: true });
      }
      Alert.alert(t('profil.gespeichert'), t('profil.datenAktualisiert'));
    } catch (e: any) {
      Alert.alert(t('allgemein.fehler'), e.message ?? t('allgemein.fehler'));
    } finally {
      setLadenProfil(false);
    }
  };

  const passwortAendern = async () => {
    if (!altesPasswort || !neuesPasswort || !passwortBestaetigen) {
      Alert.alert(t('allgemein.fehler'), t('login.fehlerEmailPasswort'));
      return;
    }
    if (neuesPasswort !== passwortBestaetigen) {
      Alert.alert(t('allgemein.fehler'), t('login.fehlerPasswort'));
      return;
    }
    if (neuesPasswort.length < 6) {
      Alert.alert(t('allgemein.fehler'), t('login.fehlerSchwachesPasswort'));
      return;
    }
    setLadenPasswort(true);
    try {
      if (!user?.email) throw new Error('');
      const credential = EmailAuthProvider.credential(user.email, altesPasswort);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, neuesPasswort);
      setAltesPasswort('');
      setNeuesPasswort('');
      setPasswortBestaetigen('');
      Alert.alert(t('allgemein.erfolg'), t('profil.passwortGeaendert'));
    } catch (e: any) {
      const meldungen: Record<string, string> = {
        'auth/wrong-password': t('login.fehlerPasswort'),
        'auth/invalid-credential': t('login.fehlerPasswort'),
        'auth/too-many-requests': t('allgemein.fehler'),
      };
      Alert.alert(t('allgemein.fehler'), meldungen[e.code] ?? e.message ?? t('allgemein.fehler'));
    } finally {
      setLadenPasswort(false);
    }
  };

  const kontoLoeschenBestaetigt = async () => {
    try {
      if (user) await deleteUser(user);
    } catch (e: any) {
      setLoeschenModal(false);
      if (e.code === 'auth/requires-recent-login') {
        Alert.alert(t('profil.erneutAnmelden'), t('profil.erneutAnmeldenText'));
      } else {
        Alert.alert(t('allgemein.fehler'), t('allgemein.fehler'));
      }
    }
  };

  const supportSenden = async () => {
    if (!supportThema.trim() || !supportNachricht.trim()) {
      Alert.alert(t('allgemein.fehler'), t('allgemein.fehler'));
      return;
    }
    const uid = user?.uid;
    if (!uid) return;
    setSupportLaden(true);
    try {
      const fullName = `${vorname} ${nachname}`.trim();
      const userEmail = user?.email ?? '';
      const thema = supportThema.trim();
      const nachricht = supportNachricht.trim();

      await setDoc(doc(db, 'support_anfragen', `${uid}_${Date.now()}`), {
        uid,
        email: userEmail,
        name: fullName,
        thema,
        nachricht,
        rolle: istFahrerRolle ? 'fahrer' : 'fahrgast',
        erstellt: Date.now(),
        gelesen: false,
      });

      try {
        // Mail server-seitig einreihen (Empfaenger fix = Support, Inhalt server-gebaut).
        await httpsCallable(functions, 'sendeSupportMail')({ thema, nachricht });
      } catch (mailErr) {
        console.error('Support-Mail Fehler (ignoriert):', mailErr);
      }

      setSupportModal(false);
      setSupportThema('');
      setSupportNachricht('');
      Alert.alert(t('profil.gesendet'), t('profil.gesendetText'));
    } catch {
      Alert.alert(t('allgemein.fehler'), t('allgemein.fehler'));
    } finally {
      setSupportLaden(false);
    }
  };

  const aboStatusText = () => {
    if (!aboGueltigBis) return null;
    const datum = new Date(aboGueltigBis);
    const istAktiv = aboGueltigBis > Date.now();
    return { aktiv: istAktiv, text: datum.toLocaleDateString('de-CH') };
  };

  const abo = aboStatusText();

  if (datenladen) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#FFD700" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.inhalt}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.zurueckBtn}>
            <Text style={styles.zurueckPfeil}>&#x2039;</Text>
          </TouchableOpacity>
          <Text style={styles.titel}>{t('profil.titel')}</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(vorname || user?.email || '?')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.vollname}>{vorname} {nachname}</Text>
        <Text style={styles.email}>{user?.email}</Text>

        {istFahrerRolle && istFahrer && (
          <View style={styles.sektion}>
            <Text style={styles.sektionTitel}>{t('profil.fahrerUebersicht')}</Text>

            <View style={styles.statsGrid}>
              {bewertung !== null && (
                <View style={styles.statBox}>
                  <Text style={styles.statWert}>⭐ {bewertung}/5</Text>
                  <Text style={styles.statLabel}>{t('profil.bewertung')}</Text>
                </View>
              )}
              {anzahlFahrten !== null && (
                <View style={styles.statBox}>
                  <Text style={styles.statWert}>{anzahlFahrten}</Text>
                  <Text style={styles.statLabel}>{t('profil.fahrten')}</Text>
                </View>
              )}
              {tarif !== null && (
                <View style={styles.statBox}>
                  <Text style={styles.statWert}>CHF {tarif.toFixed(2)}</Text>
                  <Text style={styles.statLabel}>{t('profil.proKm')}</Text>
                </View>
              )}
            </View>

            {verifiziert === 'genehmigt' ? (
              <TouchableOpacity
                style={styles.verifikationBadge}
                onPress={() => router.push('/fahrer/dokumente' as any)}
              >
                <Text style={styles.verifikationBadgeText}>{t('profil.verifiziert')}</Text>
                <Text style={styles.verifikationBtnSub}>{t('profil.dokumenteNeu')}</Text>
              </TouchableOpacity>
            ) : verifiziert === 'ausstehend' ? (
              <TouchableOpacity
                style={[styles.verifikationBadge, { backgroundColor: '#2a2000', borderColor: '#FFD700' }]}
                onPress={() => router.push('/fahrer/dokumente' as any)}
              >
                <Text style={[styles.verifikationBadgeText, { color: '#FFD700' }]}>{t('profil.dokumenteGeprueft')}</Text>
                <Text style={[styles.verifikationBtnSub, { color: '#FFD700' }]}>{t('profil.dokumenteNeu')}</Text>
              </TouchableOpacity>
            ) : verifiziert === 'abgelehnt' ? (
              <TouchableOpacity
                style={[styles.verifikationBtn, { borderColor: '#f87171', backgroundColor: '#2a0000' }]}
                onPress={() => router.push('/fahrer/dokumente' as any)}
              >
                <Text style={[styles.verifikationBtnText, { color: '#f87171' }]}>{t('profil.abgelehnt')}</Text>
                <Text style={[styles.verifikationBtnSub, { color: '#f87171' }]}>{t('profil.dokumenteNeu')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.verifikationBtn}
                onPress={() => router.push('/fahrer/dokumente' as any)}
              >
                <Text style={styles.verifikationBtnText}>{t('profil.verifizierungBeantragen')}</Text>
                <Text style={styles.verifikationBtnSub}>{t('profil.dokumenteHochladen')}</Text>
              </TouchableOpacity>
            )}

            <View style={styles.infoZeile}>
              <Text style={styles.infoLabel}>{t('profil.aboStatus')}</Text>
              {abo ? (
                <Text style={abo.aktiv ? styles.badgeGruen : styles.badgeRot}>
                  {abo.aktiv ? t('profil.aboAktiv', { datum: abo.text }) : t('profil.aboAbgelaufen', { datum: abo.text })}
                </Text>
              ) : (
                <Text style={styles.badgeGrau}>{t('profil.keinAbo')}</Text>
              )}
            </View>

            {(!abo || !abo.aktiv) && (
              <TouchableOpacity style={styles.aboButton} onPress={() => Linking.openURL(SUMUP_LINK)}>
                <Text style={styles.aboButtonText}>{t('profil.aboBezahlen')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!istFahrerRolle && anzahlFahrtenAlsFahrgast !== null && (
          <View style={styles.sektion}>
            <Text style={styles.sektionTitel}>{t('profil.fahrgastUebersicht')}</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statWert}>{anzahlFahrtenAlsFahrgast}</Text>
                <Text style={styles.statLabel}>{t('profil.fahrtenGenutzt')}</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.sektion}>
          <Text style={styles.sektionTitel}>{t('profil.persoenlicheDaten')}</Text>
          <View style={styles.zeile}>
            <TextInput
              style={[styles.input, styles.inputHalb]}
              value={vorname}
              onChangeText={setVorname}
              placeholder={t('login.vorname')}
              placeholderTextColor="#555"
            />
            <TextInput
              style={[styles.input, styles.inputHalb]}
              value={nachname}
              onChangeText={setNachname}
              placeholder={t('login.nachname')}
              placeholderTextColor="#555"
            />
          </View>
          <TextInput
            style={styles.input}
            value={telefon}
            onChangeText={setTelefon}
            placeholder={t('profil.mobilnummer')}
            placeholderTextColor="#555"
            keyboardType="phone-pad"
          />
          <TextInput
            style={styles.input}
            value={strasse}
            onChangeText={setStrasse}
            placeholder={t('profil.strasseHausnummer')}
            placeholderTextColor="#555"
          />
          <TextInput
            style={styles.input}
            value={ortschaft}
            onChangeText={setOrtschaft}
            placeholder={t('profil.plzOrtschaft')}
            placeholderTextColor="#555"
          />
          <TouchableOpacity
            style={[styles.button, ladenProfil && styles.buttonDisabled]}
            onPress={profilSpeichern}
            disabled={ladenProfil}
          >
            {ladenProfil ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>{t('profil.speichern')}</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.sektion}>
          <Text style={styles.sektionTitel}>{t('profil.passwortAendern')}</Text>
          <TextInput
            style={styles.input}
            value={altesPasswort}
            onChangeText={setAltesPasswort}
            placeholder={t('profil.aktuellesPasswort')}
            placeholderTextColor="#555"
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            value={neuesPasswort}
            onChangeText={setNeuesPasswort}
            placeholder={t('profil.neuesPasswort')}
            placeholderTextColor="#555"
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            value={passwortBestaetigen}
            onChangeText={setPasswortBestaetigen}
            placeholder={t('profil.neuesPasswortBestaetigen')}
            placeholderTextColor="#555"
            secureTextEntry
          />
          <TouchableOpacity
            style={[styles.button, styles.buttonBlau, ladenPasswort && styles.buttonDisabled]}
            onPress={passwortAendern}
            disabled={ladenPasswort}
          >
            {ladenPasswort ? <ActivityIndicator color="#fff" /> : <Text style={[styles.buttonText, styles.buttonTextHell]}>{t('profil.passwortAendern')}</Text>}
          </TouchableOpacity>
        </View>

        {/* Sprachauswahl */}
        <TouchableOpacity style={styles.supportButton} onPress={() => setSprachModal(true)}>
          <Text style={styles.supportText}>🌐 {t('allgemein.sprache')}: {supportedLanguages.find((l) => l.code === i18n.language)?.label ?? 'Deutsch'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.supportButton} onPress={() => setSupportModal(true)}>
          <Text style={styles.supportText}>{t('profil.supportKontaktieren')}</Text>
        </TouchableOpacity>

        {istAdmin && (
          <TouchableOpacity style={styles.adminButton} onPress={() => router.push('/admin' as any)}>
            <Text style={styles.adminText}>{t('profil.adminBereich')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.abmeldenButton}
          onPress={() => {
            // Alert.alert ist auf react-native-web ein No-Op → im Web erschiene kein
            // Dialog und signOut liefe nie. Daher web-tauglicher window.confirm-Fallback.
            if (Platform.OS === 'web') {
              const ok = typeof window !== 'undefined'
                ? window.confirm(`${t('fahrer.abmeldenFrage')}\n\n${t('fahrer.abmeldenText')}`)
                : true;
              if (ok) signOut(auth);
              return;
            }
            Alert.alert(t('fahrer.abmeldenFrage'), t('fahrer.abmeldenText'), [
              { text: t('fahrer.abbrechen'), style: 'cancel' },
              { text: t('fahrer.abmelden'), style: 'destructive', onPress: () => signOut(auth) },
            ]);
          }}
        >
          <Text style={styles.abmeldenText}>{t('fahrer.abmelden')}</Text>
        </TouchableOpacity>

        <View style={styles.rechtlichesRow}>
          <TouchableOpacity onPress={() => Linking.openURL(HILFE_URL)}>
            <Text style={styles.rechtlichesLink}>{t('profil.hilfe')}</Text>
          </TouchableOpacity>
          <Text style={styles.rechtlichesTrenner}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`${LEGAL_URL}#impressum`)}>
            <Text style={styles.rechtlichesLink}>{t('profil.impressum')}</Text>
          </TouchableOpacity>
          <Text style={styles.rechtlichesTrenner}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`${LEGAL_URL}#agb`)}>
            <Text style={styles.rechtlichesLink}>{t('login.agbLink')}</Text>
          </TouchableOpacity>
          <Text style={styles.rechtlichesTrenner}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`${LEGAL_URL}#datenschutz`)}>
            <Text style={styles.rechtlichesLink}>{t('profil.datenschutz')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.loeschenButton} onPress={() => setLoeschenModal(true)}>
          <Text style={styles.loeschenText}>{t('profil.kontoLoeschen')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={supportModal} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalKarte}>
              <Text style={styles.modalTitel}>{t('profil.supportTitel')}</Text>
              <Text style={styles.modalSub}>{t('profil.supportSub')}</Text>

              <TextInput
                style={styles.modalInput}
                placeholder={t('profil.supportThema')}
                placeholderTextColor="#555"
                value={supportThema}
                onChangeText={setSupportThema}
              />
              <TextInput
                style={[styles.modalInput, { height: 100, textAlignVertical: 'top' }]}
                placeholder={t('profil.supportNachricht')}
                placeholderTextColor="#555"
                value={supportNachricht}
                onChangeText={setSupportNachricht}
                multiline
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#333' }]}
                  onPress={() => { setSupportModal(false); setSupportThema(''); setSupportNachricht(''); }}
                >
                  <Text style={styles.modalBtnText}>{t('fahrer.abbrechen')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#FFD700' }, supportLaden && { opacity: 0.5 }]}
                  onPress={supportSenden}
                  disabled={supportLaden}
                >
                  {supportLaden ? <ActivityIndicator color="#000" /> : <Text style={[styles.modalBtnText, { color: '#000' }]}>{t('profil.senden')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={loeschenModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalKarte}>
            <Text style={[styles.modalTitel, { color: '#f87171' }]}>{t('profil.kontoLoeschenFrage')}</Text>
            <Text style={styles.modalSub}>
              {t('profil.kontoLoeschenText')}
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#333' }]}
                onPress={() => setLoeschenModal(false)}
              >
                <Text style={styles.modalBtnText}>{t('fahrer.abbrechen')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#e53e3e' }]}
                onPress={kontoLoeschenBestaetigt}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>{t('profil.loeschen')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sprachauswahl Modal */}
      <Modal visible={sprachModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalKarte, { maxHeight: '70%' }]}>
            <Text style={styles.modalTitel}>🌐 {t('allgemein.sprache')}</Text>
            <ScrollView style={{ marginBottom: 10 }}>
              {(istFahrerRolle ? driverLanguages : supportedLanguages).map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    marginBottom: 4,
                    backgroundColor: i18n.language === lang.code ? '#FFD70022' : '#0f2035',
                    borderWidth: i18n.language === lang.code ? 1 : 0,
                    borderColor: '#FFD700',
                  }}
                  onPress={() => {
                    changeLanguage(lang.code, istFahrerRolle ? 'fahrer' : 'fahrgast');
                    setSprachModal(false);
                  }}
                >
                  <Text style={{
                    fontSize: 14,
                    color: i18n.language === lang.code ? '#FFD700' : '#fff',
                    fontWeight: i18n.language === lang.code ? 'bold' : 'normal',
                  }}>
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: '#333' }]}
              onPress={() => setSprachModal(false)}
            >
              <Text style={styles.modalBtnText}>{t('fahrer.abbrechen')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inhalt: { padding: 18, paddingBottom: 50 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 36,
    marginBottom: 20,
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
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFD700',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  avatarText: { fontSize: 26, fontWeight: 'bold', color: '#000' },
  vollname: { color: '#fff', textAlign: 'center', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  email: { color: '#aaa', textAlign: 'center', fontSize: 12, marginBottom: 20 },

  sektion: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  sektionTitel: { fontSize: 13, fontWeight: 'bold', color: '#fff', marginBottom: 10 },

  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: {
    flex: 1,
    backgroundColor: '#0f2035',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  statWert: { fontSize: 14, fontWeight: 'bold', color: '#FFD700' },
  statLabel: { fontSize: 10, color: '#aaa', marginTop: 2 },

  infoZeile: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  infoLabel: { fontSize: 12, color: '#aaa' },
  badgeGruen: { fontSize: 12, color: '#4ade80', fontWeight: '700' },
  badgeGelb: { fontSize: 12, color: '#FFD700', fontWeight: '700' },
  badgeRot: { fontSize: 12, color: '#f87171', fontWeight: '700' },
  badgeGrau: { fontSize: 12, color: '#888', fontWeight: '600' },

  verifikationBadge: {
    backgroundColor: '#0a2a0a',
    borderWidth: 1,
    borderColor: '#4ade80',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  verifikationBadgeText: { color: '#4ade80', fontSize: 13, fontWeight: '700' },
  verifikationBtn: {
    borderWidth: 1,
    borderColor: '#FFD700',
    backgroundColor: '#1a1400',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  verifikationBtnText: { color: '#FFD700', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  verifikationBtnSub: { color: '#FFD700', fontSize: 11, opacity: 0.7 },

  aboButton: {
    backgroundColor: '#0f2035',
    borderRadius: 8,
    padding: 9,
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  aboButtonText: { fontSize: 12, color: '#FFD700', fontWeight: '600' },

  zeile: { flexDirection: 'row', gap: 8 },
  inputHalb: { flex: 1 },
  input: {
    backgroundColor: '#0f2035',
    borderRadius: 10,
    padding: 11,
    fontSize: 13,
    color: '#fff',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  button: {
    backgroundColor: '#FFD700',
    borderRadius: 10,
    padding: 11,
    alignItems: 'center',
    marginTop: 3,
  },
  buttonBlau: { backgroundColor: '#3b82f6' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 13, fontWeight: 'bold', color: '#000' },
  buttonTextHell: { color: '#fff' },

  supportButton: {
    backgroundColor: '#16213e',
    borderRadius: 11,
    padding: 12,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  supportText: { color: '#FFD700', fontSize: 13, fontWeight: '600' },
  supportEmail: { color: '#aaa', fontSize: 11, marginTop: 3 },

  adminButton: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 11,
    padding: 11,
    alignItems: 'center',
    marginTop: 6,
  },
  adminText: { color: '#555', fontSize: 12 },

  abmeldenButton: {
    borderWidth: 1,
    borderColor: '#ff4444',
    borderRadius: 11,
    padding: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  abmeldenText: { color: '#ff4444', fontSize: 13, fontWeight: '600' },

  rechtlichesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 4,
  },
  rechtlichesLink: { color: '#555', fontSize: 12, textDecorationLine: 'underline' },
  rechtlichesTrenner: { color: '#333', fontSize: 12 },
  loeschenButton: {
    padding: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  loeschenText: { color: '#555', fontSize: 12, textDecorationLine: 'underline' },

  modalOverlay: {
    flex: 1, backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  modalKarte: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  modalTitel: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  modalSub: { fontSize: 13, color: '#aaa', marginBottom: 18, lineHeight: 18 },
  modalInput: {
    backgroundColor: '#0f2035',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#fff',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtn: { flex: 1, padding: 13, borderRadius: 10, alignItems: 'center' },
  modalBtnText: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
});
