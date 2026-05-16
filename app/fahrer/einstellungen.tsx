import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Linking,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { doc, getDoc, setDoc, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@/constants/firebase';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

type AboStatus = 'aktiv' | 'fehlgeschlagen' | 'pending' | 'inaktiv' | 'gekuendigt';

interface AboDaten {
  status?: AboStatus;
  nextChargeAt?: Timestamp;
  cancelledAt?: Timestamp;
  pendingTransactionId?: number;
}

type Kategorie = 'furtgo_mini' | 'furtgo_plus' | 'furtgo_limu';
const TARIFE: Record<Kategorie, { grundpreis: number; proKm: number; label: string }> = {
  furtgo_mini: { grundpreis: 3.50, proKm: 2.20, label: 'Furtgo Mini' },
  furtgo_plus: { grundpreis: 5.00, proKm: 2.80, label: 'Furtgo Plus' },
  furtgo_limu: { grundpreis: 8.00, proKm: 6.00, label: 'Furtgo Limu' },
};

const fahrzeugKategorie = (jahrgang: number | undefined): Kategorie => {
  if (!jahrgang) return 'furtgo_mini';
  const alter = new Date().getFullYear() - jahrgang;
  if (alter <= 5) return 'furtgo_limu';
  if (alter <= 12) return 'furtgo_plus';
  return 'furtgo_mini';
};

const erlaubteAngebote = (kat: Kategorie): string[] => {
  if (kat === 'furtgo_limu') return ['furtgo_mini', 'furtgo_plus', 'furtgo_limu', 'frei'];
  if (kat === 'furtgo_plus') return ['furtgo_mini', 'furtgo_plus', 'frei'];
  return ['furtgo_mini', 'frei'];
};

export default function FahrerEinstellungen() {
  const { t } = useTranslation();
  const [bildschirmWach, setBildschirmWach] = useState(false);
  const [angebote, setAngebote] = useState<string[]>(['furtgo_mini']);
  const [freiGrundpreis, setFreiGrundpreis] = useState(5.00);
  const [freiProKm, setFreiProKm] = useState(2.20);
  const [fahrerKat, setFahrerKat] = useState<Kategorie>('furtgo_mini');
  const [abo, setAbo] = useState<AboDaten>({});
  const [aboLaedt, setAboLaedt] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'fahrer', uid), (snap) => {
      const data = snap.data();
      setAbo((data?.abo ?? {}) as AboDaten);
    });
    return unsub;
  }, []);

  const aboStarten = async () => {
    setAboLaedt(true);
    try {
      const callable = httpsCallable<unknown, { paymentUrl: string; transactionId: number }>(
        functions,
        'createAboPaymentPage',
      );
      const result = await callable({});
      const url = result.data.paymentUrl;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Fehler', 'Browser konnte nicht geöffnet werden');
      }
    } catch (e) {
      console.log('Abo-Start Fehler:', e);
      Alert.alert('Fehler', 'Abo-Seite konnte nicht erstellt werden. Bitte später erneut versuchen.');
    } finally {
      setAboLaedt(false);
    }
  };

  const aboKuendigen = () => {
    const bisDatum = abo.nextChargeAt?.toDate().toLocaleDateString('de-CH') ?? '—';
    Alert.alert(
      'Abo kündigen?',
      `Du behältst vollen Zugang bis ${bisDatum}. Danach läuft das Abo aus und es wird nichts mehr abgebucht.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Ja, kündigen',
          style: 'destructive',
          onPress: async () => {
            setAboLaedt(true);
            try {
              const callable = httpsCallable(functions, 'cancelAbo');
              await callable({});
            } catch (e) {
              console.log('Kündigung Fehler:', e);
              Alert.alert('Fehler', 'Kündigung konnte nicht durchgeführt werden. Bitte später erneut versuchen.');
            } finally {
              setAboLaedt(false);
            }
          },
        },
      ],
    );
  };

  const aboReaktivieren = async () => {
    setAboLaedt(true);
    try {
      const callable = httpsCallable(functions, 'reactivateAbo');
      await callable({});
    } catch (e) {
      console.log('Reaktivierung Fehler:', e);
      Alert.alert('Fehler', 'Abo konnte nicht reaktiviert werden. Bitte später erneut versuchen.');
    } finally {
      setAboLaedt(false);
    }
  };

  useEffect(() => {
    // Bildschirm-Einstellung laden
    AsyncStorage.getItem('bildschirmWach').then((wert) => {
      if (wert === 'true') setBildschirmWach(true);
    });

    // Angebote + Fahrzeug-Kategorie aus Firestore laden
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, 'fahrer', uid)).then((snap) => {
      const data = snap.data();
      if (!data) return;
      // Fahrzeug-Kategorie bestimmen
      const jahrgang = data.fahrzeug?.jahrgang ? parseInt(data.fahrzeug.jahrgang) : undefined;
      const kat = fahrzeugKategorie(jahrgang);
      setFahrerKat(kat);
      const erlaubt = erlaubteAngebote(kat);
      if (Array.isArray(data.angebote) && data.angebote.length > 0) {
        // Nur erlaubte Angebote behalten
        const gefiltert = data.angebote.filter((a: string) => erlaubt.includes(a));
        setAngebote(gefiltert.length > 0 ? gefiltert : [kat]);
      } else {
        setAngebote([kat]);
      }
      if (typeof data.freiProKm === 'number') setFreiProKm(data.freiProKm);
      else if (typeof data.eigenProKm === 'number') setFreiProKm(data.eigenProKm);
      if (typeof data.freiGrundpreis === 'number') setFreiGrundpreis(data.freiGrundpreis);
    }).catch((e) => console.log('Einstellungen laden Fehler (ignoriert):', e));
  }, []);

  const tarifSpeichern = async (neueAngebote: string[], grundpreis: number, proKm: number) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(doc(db, 'fahrer', uid), { angebote: neueAngebote, freiGrundpreis: grundpreis, freiProKm: proKm }, { merge: true }).catch(() => {});
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inhalt}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.zurueckBtn}>
          <Text style={styles.zurueckPfeil}>&#x2039;</Text>
        </TouchableOpacity>
        <Text style={styles.titel}>{t('einstellungen.titel')}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Bildschirm wach halten */}
      <View style={styles.sektion}>
        <Text style={styles.sektionTitel}>{t('einstellungen.allgemein')}</Text>
        <View style={styles.wachRow}>
          <View style={styles.wachInfo}>
            <Text style={styles.wachLabel}>{t('einstellungen.bildschirmWach')}</Text>
            <Text style={styles.wachSub}>{t('einstellungen.bildschirmWachSub')}</Text>
          </View>
          <Switch
            value={bildschirmWach}
            onValueChange={(wert) => {
              setBildschirmWach(wert);
              AsyncStorage.setItem('bildschirmWach', wert ? 'true' : 'false');
              if (wert) {
                activateKeepAwakeAsync();
              } else {
                deactivateKeepAwake();
              }
            }}
            trackColor={{ false: '#444', true: '#4ade80' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Fahrer-Abo */}
      <View style={styles.sektion}>
        <Text style={styles.sektionTitel}>Fahrer-Abo</Text>
        <Text style={styles.sektionSub}>CHF 60.- pro Monat — automatische Belastung alle 30 Tage</Text>

        {abo.status === 'aktiv' && (
          <>
            <View style={[styles.aboStatusBox, styles.aboStatusAktiv]}>
              <Text style={styles.aboStatusLabel}>✓ Abo aktiv</Text>
              {abo.nextChargeAt && (
                <Text style={styles.aboStatusSub}>
                  Nächste Belastung: {abo.nextChargeAt.toDate().toLocaleDateString('de-CH')}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={[styles.aboKuendigenBtn, aboLaedt && styles.aboBtnDisabled]}
              onPress={aboKuendigen}
              disabled={aboLaedt}
            >
              {aboLaedt ? (
                <ActivityIndicator color="#ff6b6b" />
              ) : (
                <Text style={styles.aboKuendigenBtnText}>Abo kündigen</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {abo.status === 'gekuendigt' && (
          <>
            <View style={[styles.aboStatusBox, styles.aboStatusGekuendigt]}>
              <Text style={styles.aboStatusLabel}>⏳ Abo gekündigt</Text>
              {abo.nextChargeAt && (
                <Text style={styles.aboStatusSub}>
                  Zugang läuft noch bis: {abo.nextChargeAt.toDate().toLocaleDateString('de-CH')}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={[styles.aboBtn, aboLaedt && styles.aboBtnDisabled]}
              onPress={aboReaktivieren}
              disabled={aboLaedt}
            >
              {aboLaedt ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.aboBtnText}>Abo reaktivieren</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {abo.status === 'fehlgeschlagen' && (
          <View style={[styles.aboStatusBox, styles.aboStatusFehler]}>
            <Text style={styles.aboStatusLabel}>✕ Letzte Zahlung fehlgeschlagen</Text>
            <Text style={styles.aboStatusSub}>Bitte erneut starten</Text>
          </View>
        )}

        {(!abo.status || abo.status === 'inaktiv' || abo.status === 'fehlgeschlagen') && (
          <TouchableOpacity
            style={[styles.aboBtn, aboLaedt && styles.aboBtnDisabled]}
            onPress={aboStarten}
            disabled={aboLaedt}
          >
            {aboLaedt ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.aboBtnText}>
                {abo.status === 'fehlgeschlagen' ? 'Abo erneut starten' : 'Abo abschliessen'}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {abo.pendingTransactionId && !abo.status && (
          <Text style={styles.aboStatusSub}>Zahlung läuft… Status aktualisiert sich automatisch.</Text>
        )}

        <TouchableOpacity
          style={styles.rechnungenLink}
          onPress={() => router.push('/fahrer/rechnungen')}
        >
          <Text style={styles.rechnungenLinkText}>Meine Rechnungen anzeigen →</Text>
        </TouchableOpacity>
      </View>

      {/* Mein Angebot */}
      <View style={styles.sektion}>
        <Text style={styles.sektionTitel}>{t('einstellungen.meinAngebot')}</Text>
        <Text style={styles.sektionSub}>{t('einstellungen.meinAngebotSub')}</Text>

        {/* Kategorie-Info */}
        <View style={styles.katInfoBox}>
          <Text style={styles.katInfoLabel}>{t('einstellungen.deineKategorie')}</Text>
          <Text style={styles.katInfoWert}>{TARIFE[fahrerKat].label}</Text>
        </View>

        <View style={styles.checkboxContainer}>
          {(erlaubteAngebote(fahrerKat).filter(k => k !== 'frei') as Kategorie[]).map((kat) => {
            const aktiv = angebote.includes(kat);
            const stil = kat === 'furtgo_limu' ? styles.checkboxAktivLimu
              : kat === 'furtgo_plus' ? styles.checkboxAktivPlus
              : styles.checkboxAktivMini;
            return (
              <TouchableOpacity
                key={kat}
                style={[styles.checkboxRow, aktiv && stil]}
                onPress={() => {
                  let neueAngebote: string[];
                  if (aktiv) {
                    neueAngebote = angebote.filter((a) => a !== kat);
                    if (neueAngebote.length === 0) return;
                  } else {
                    neueAngebote = [...angebote, kat];
                  }
                  setAngebote(neueAngebote);
                  tarifSpeichern(neueAngebote, freiGrundpreis, freiProKm);
                }}
              >
                <Text style={styles.checkboxIcon}>{aktiv ? '☑' : '☐'}</Text>
                <View>
                  <Text style={[styles.checkboxLabel, aktiv && styles.checkboxLabelAktiv]}>
                    {TARIFE[kat].label}
                  </Text>
                  <Text style={styles.checkboxSub}>
                    CHF {TARIFE[kat].grundpreis.toFixed(2)} + {TARIFE[kat].proKm.toFixed(2)}/km
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Frei wählbar */}
          {(() => {
            const freiAktiv = angebote.includes('frei');
            return (
              <View style={[styles.checkboxRowFrei, freiAktiv && styles.checkboxAktivFrei]}>
                <TouchableOpacity
                  style={styles.freiHeader}
                  onPress={() => {
                    let neueAngebote: string[];
                    if (freiAktiv) {
                      neueAngebote = angebote.filter((a) => a !== 'frei');
                      if (neueAngebote.length === 0) return;
                    } else {
                      neueAngebote = [...angebote, 'frei'];
                    }
                    setAngebote(neueAngebote);
                    tarifSpeichern(neueAngebote, freiGrundpreis, freiProKm);
                  }}
                >
                  <Text style={styles.checkboxIcon}>{freiAktiv ? '☑' : '☐'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.checkboxLabel, freiAktiv && styles.checkboxLabelAktiv]}
                      numberOfLines={1}
                    >
                      {t('einstellungen.freiWaehlbar')}
                    </Text>
                    <Text style={styles.checkboxSub}>
                      CHF {freiGrundpreis.toFixed(2)} + {freiProKm.toFixed(2)}/km
                    </Text>
                  </View>
                </TouchableOpacity>
                {freiAktiv && (
                  <View style={styles.freiEinstellBlock}>
                    <View style={styles.freiZeile}>
                      <Text style={styles.freiZeileLabel}>Grundpreis</Text>
                      <View style={styles.eigenBtnRow}>
                        <TouchableOpacity
                          style={styles.eigenBtn}
                          onPress={() => {
                            const neu = Math.max(1.00, Math.round((freiGrundpreis - 0.50) * 100) / 100);
                            setFreiGrundpreis(neu);
                            tarifSpeichern(angebote, neu, freiProKm);
                          }}
                        >
                          <Text style={styles.eigenBtnText}>-</Text>
                        </TouchableOpacity>
                        <Text style={styles.eigenWert}>{freiGrundpreis.toFixed(2)}</Text>
                        <TouchableOpacity
                          style={styles.eigenBtn}
                          onPress={() => {
                            const neu = Math.min(20.00, Math.round((freiGrundpreis + 0.50) * 100) / 100);
                            setFreiGrundpreis(neu);
                            tarifSpeichern(angebote, neu, freiProKm);
                          }}
                        >
                          <Text style={styles.eigenBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={styles.freiZeile}>
                      <Text style={styles.freiZeileLabel}>Pro km</Text>
                      <View style={styles.eigenBtnRow}>
                        <TouchableOpacity
                          style={styles.eigenBtn}
                          onPress={() => {
                            const neu = Math.max(1.00, Math.round((freiProKm - 0.10) * 100) / 100);
                            setFreiProKm(neu);
                            tarifSpeichern(angebote, freiGrundpreis, neu);
                          }}
                        >
                          <Text style={styles.eigenBtnText}>-</Text>
                        </TouchableOpacity>
                        <Text style={styles.eigenWert}>{freiProKm.toFixed(2)}</Text>
                        <TouchableOpacity
                          style={styles.eigenBtn}
                          onPress={() => {
                            const neu = Math.min(9.00, Math.round((freiProKm + 0.10) * 100) / 100);
                            setFreiProKm(neu);
                            tarifSpeichern(angebote, freiGrundpreis, neu);
                          }}
                        >
                          <Text style={styles.eigenBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            );
          })()}
        </View>
      </View>
    </ScrollView>
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

  sektion: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  sektionTitel: { fontSize: 13, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  sektionSub: { fontSize: 11, color: '#aaa', marginBottom: 10 },

  wachRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wachInfo: { flex: 1 },
  wachLabel: { fontSize: 13, color: '#ccc', fontWeight: '600' },
  wachSub: { fontSize: 11, color: '#555', marginTop: 1 },

  checkboxContainer: { gap: 8 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0f1a2e',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  checkboxAktivMini: { borderColor: '#FFD700', backgroundColor: '#2a2000' },
  checkboxAktivPlus: { borderColor: '#60a5fa', backgroundColor: '#0f1a3e' },
  checkboxAktivLimu: { borderColor: '#a855f7', backgroundColor: '#1a0f2e' },
  checkboxAktivFrei: { borderColor: '#4ade80', backgroundColor: '#0f2d18' },
  checkboxRowFrei: {
    backgroundColor: '#0f1a2e',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  freiHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  freiEinstellBlock: { marginTop: 12, gap: 8 },
  freiZeile: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  freiZeileLabel: { fontSize: 13, color: '#ccc', fontWeight: '600' },
  katInfoBox: {
    backgroundColor: '#0f2035',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  katInfoLabel: { color: '#aaa', fontSize: 13 },
  katInfoWert: { color: '#FFD700', fontSize: 14, fontWeight: 'bold' },

  aboStatusBox: {
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  aboStatusAktiv: { backgroundColor: '#0f2d18', borderColor: '#4ade80' },
  aboStatusFehler: { backgroundColor: '#2d0f0f', borderColor: '#ff6b6b' },
  aboStatusGekuendigt: { backgroundColor: '#2d2008', borderColor: '#fbbf24' },
  aboStatusLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  aboStatusSub: { color: '#aaa', fontSize: 12, marginTop: 4 },
  aboBtn: {
    backgroundColor: '#FFD700',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  aboBtnDisabled: { opacity: 0.5 },
  aboBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  aboKuendigenBtn: {
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  aboKuendigenBtnText: { color: '#ff6b6b', fontSize: 13, fontWeight: '600' },
  rechnungenLink: { marginTop: 12, paddingVertical: 8, alignItems: 'center' },
  rechnungenLinkText: { color: '#FFD700', fontSize: 13, fontWeight: '600' },

  checkboxIcon: { fontSize: 20, color: '#fff' },
  checkboxLabel: { fontSize: 14, color: '#888', fontWeight: '600' },
  checkboxLabelAktiv: { color: '#fff' },
  checkboxSub: { fontSize: 11, color: '#556', marginTop: 2 },
  eigenBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eigenBtn: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  eigenBtnText: { fontSize: 20, color: '#fff', lineHeight: 24 },
  eigenWert: { fontSize: 16, color: '#4ade80', fontWeight: 'bold', minWidth: 70, textAlign: 'center' },
});
