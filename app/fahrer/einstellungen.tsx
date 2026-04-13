import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

type Kategorie = 'furtgo_x' | 'furtgo_comfort';
const TARIFE: Record<Kategorie, { grundpreis: number; proKm: number; label: string }> = {
  furtgo_x: { grundpreis: 3.50, proKm: 2.20, label: 'Furtgo X' },
  furtgo_comfort: { grundpreis: 5.00, proKm: 2.80, label: 'Furtgo Comfort' },
};

export default function FahrerEinstellungen() {
  const { t } = useTranslation();
  const [bildschirmWach, setBildschirmWach] = useState(false);
  const [angebote, setAngebote] = useState<string[]>(['furtgo_x', 'furtgo_comfort']);
  const [eigenProKm, setEigenProKm] = useState(2.20);

  useEffect(() => {
    // Bildschirm-Einstellung laden
    AsyncStorage.getItem('bildschirmWach').then((wert) => {
      if (wert === 'true') setBildschirmWach(true);
    });

    // Angebote aus Firestore laden
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, 'fahrer', uid)).then((snap) => {
      const data = snap.data();
      if (!data) return;
      if (Array.isArray(data.angebote) && data.angebote.length > 0) {
        setAngebote(data.angebote);
      } else if (data.tarifModus) {
        const alt = data.tarifModus === 'eigen' ? ['eigen'] : [data.tarifModus];
        setAngebote(alt);
      }
      if (typeof data.eigenProKm === 'number') setEigenProKm(data.eigenProKm);
    });
  }, []);

  const tarifSpeichern = async (neueAngebote: string[], proKm: number) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(doc(db, 'fahrer', uid), { angebote: neueAngebote, eigenProKm: proKm }, { merge: true }).catch(() => {});
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inhalt}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.zurueckButton}>
          <View style={styles.zurueckPill}>
            <Text style={styles.zurueckText}>{t('allgemein.zurueck')}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.titel}>{t('einstellungen.titel')}</Text>
        <View style={{ width: 80 }} />
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

      {/* Mein Angebot */}
      <View style={styles.sektion}>
        <Text style={styles.sektionTitel}>{t('einstellungen.meinAngebot')}</Text>
        <Text style={styles.sektionSub}>{t('einstellungen.meinAngebotSub')}</Text>

        <View style={styles.checkboxContainer}>
          {(['furtgo_x', 'furtgo_comfort'] as const).map((kat) => {
            const aktiv = angebote.includes(kat);
            return (
              <TouchableOpacity
                key={kat}
                style={[styles.checkboxRow, aktiv && (kat === 'furtgo_x' ? styles.checkboxAktivX : styles.checkboxAktivComfort)]}
                onPress={() => {
                  let neueAngebote: string[];
                  if (aktiv) {
                    neueAngebote = angebote.filter((a) => a !== kat);
                    if (neueAngebote.length === 0) return;
                  } else {
                    neueAngebote = [...angebote, kat];
                  }
                  setAngebote(neueAngebote);
                  tarifSpeichern(neueAngebote, eigenProKm);
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

          {/* Eigen-Tarif */}
          {(() => {
            const eigenAktiv = angebote.includes('eigen');
            return (
              <TouchableOpacity
                style={[styles.checkboxRow, eigenAktiv && styles.checkboxAktivEigen]}
                onPress={() => {
                  let neueAngebote: string[];
                  if (eigenAktiv) {
                    neueAngebote = angebote.filter((a) => a !== 'eigen');
                    if (neueAngebote.length === 0) return;
                  } else {
                    neueAngebote = [...angebote, 'eigen'];
                  }
                  setAngebote(neueAngebote);
                  tarifSpeichern(neueAngebote, eigenProKm);
                }}
              >
                <Text style={styles.checkboxIcon}>{eigenAktiv ? '☑' : '☐'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.checkboxLabel, eigenAktiv && styles.checkboxLabelAktiv]}>
                    {t('einstellungen.eigenTarif')}
                  </Text>
                  <Text style={styles.checkboxSub}>
                    CHF 3.50 + {eigenProKm.toFixed(2)}/km
                  </Text>
                </View>
                {eigenAktiv && (
                  <View style={styles.eigenBtnRow}>
                    <TouchableOpacity
                      style={styles.eigenBtn}
                      onPress={() => {
                        const neu = Math.max(1.00, Math.round((eigenProKm - 0.10) * 100) / 100);
                        setEigenProKm(neu);
                        tarifSpeichern(angebote, neu);
                      }}
                    >
                      <Text style={styles.eigenBtnText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.eigenWert}>{eigenProKm.toFixed(2)}</Text>
                    <TouchableOpacity
                      style={styles.eigenBtn}
                      onPress={() => {
                        const neu = Math.min(9.00, Math.round((eigenProKm + 0.10) * 100) / 100);
                        setEigenProKm(neu);
                        tarifSpeichern(angebote, neu);
                      }}
                    >
                      <Text style={styles.eigenBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
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
  zurueckButton: { width: 80 },
  zurueckPill: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  zurueckText: { color: '#fff', fontSize: 13, fontWeight: '600' },
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
  checkboxAktivX: { borderColor: '#FFD700', backgroundColor: '#2a2000' },
  checkboxAktivComfort: { borderColor: '#60a5fa', backgroundColor: '#0f1a3e' },
  checkboxAktivEigen: { borderColor: '#4ade80', backgroundColor: '#0f2d18' },
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
