import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/constants/firebase';
import { FahrtStatus } from '@/types';
import { spieleTon } from '@/utils/ton';
import { berechneKm } from '@/utils/distanz';
import { useTranslation } from 'react-i18next';

export default function FahrerSuchen() {
  const { t } = useTranslation();
  const { fahrtId } = useLocalSearchParams<{ fahrtId: string }>();
  const [status, setStatus] = useState<FahrtStatus>('wartend');
  const [preis, setPreis] = useState<number | null>(null);
  const [zielAdresse, setZielAdresse] = useState<string | null>(null);

  useEffect(() => {
    if (!fahrtId) return;

    const unsubscribe = onSnapshot(doc(db, 'fahrten', fahrtId), (snap) => {
      const data = snap.data();
      if (!data) return;
      const neuerStatus = data.status as FahrtStatus;
      setStatus(neuerStatus);
      if (data.preis != null) setPreis(data.preis);
      if (data.zielort?.adresse) setZielAdresse(data.zielort.adresse);

      if (neuerStatus === 'angenommen' || neuerStatus === 'unterwegs') {
        spieleTon.fahrtAngenommen();
        router.replace(`/fahrgast/fahrt?fahrtId=${fahrtId}` as any);
      }
      if (neuerStatus === 'abgebrochen') {
        spieleTon.fahrtAbgebrochen();
      }

      // Wenn kein Fahrer zugewiesen aber noch wartend → nächsten suchen
      if (neuerStatus === 'wartend' && data.zugewiesenerFahrerId === null) {
        const abgelehntVon: string[] = data.abgelehntVon ?? [];
        getDocs(query(collection(db, 'fahrer'), where('online', '==', true)))
          .then((fahrerSnap) => {
            let naechsterFahrerId: string | null = null;
            let aeltesteLetzteAnfrage = Infinity;
            const jetzt = Date.now();
            fahrerSnap.forEach((d) => {
              if (abgelehntVon.includes(d.id)) return;
              const fData = d.data();
              const lastSeen = typeof fData.lastSeen === 'number' ? fData.lastSeen : 0;
              if (jetzt - lastSeen > 30000) return;
              if (fData.standort?.latitude) {
                const dist = berechneKm(data.abholort, fData.standort);
                if (dist <= 10) {
                  const letzteAnfrageZeit = typeof fData.letzteAnfrageZeit === 'number' ? fData.letzteAnfrageZeit : 0;
                  if (naechsterFahrerId === null || letzteAnfrageZeit < aeltesteLetzteAnfrage) {
                    aeltesteLetzteAnfrage = letzteAnfrageZeit;
                    naechsterFahrerId = d.id;
                  }
                }
              }
            });
            const fahrtUpdates: Record<string, any> = { zugewiesenerFahrerId: naechsterFahrerId };
            if (naechsterFahrerId && data.abholort && data.zielort) {
              const fahrerDoc = fahrerSnap.docs.find((d) => d.id === naechsterFahrerId);
              const fahrerPreisProKm = fahrerDoc?.data()?.preisProKm ?? 2.2;
              const km = berechneKm(data.abholort, data.zielort);
              fahrtUpdates.preis = Math.round((3.5 + km * fahrerPreisProKm) * 100) / 100;
            }
            const updates: Promise<any>[] = [
              updateDoc(doc(db, 'fahrten', fahrtId), fahrtUpdates),
            ];
            if (naechsterFahrerId) {
              updates.push(updateDoc(doc(db, 'fahrer', naechsterFahrerId), { letzteAnfrageZeit: jetzt }));
            }
            return Promise.all(updates);
          })
          .catch((err) => console.error('Fahrer-Suche Fehler:', err));
      }
    });

    return unsubscribe;
  }, [fahrtId]);

  const abbrechen = async () => {
    if (!fahrtId) return;
    await updateDoc(doc(db, 'fahrten', fahrtId), { status: 'abgebrochen' });
    router.replace('/fahrgast' as any);
  };

  return (
    <View style={styles.container}>
      <View style={styles.inhalt}>
        <ActivityIndicator size="large" color="#FFD700" style={styles.spinner} />
        <Text style={styles.statusText}>{t(`suchen.${status}`, { defaultValue: t('suchen.warte') })}</Text>
        <Text style={styles.sub}>{t('suchen.bitteWarten')}</Text>

        {/* Preis-Box */}
        {preis !== null && (
          <View style={styles.preisBox}>
            <Text style={styles.preisLabel}>{t('suchen.fahrpreis')}</Text>
            <Text style={styles.preisWert}>CHF {preis.toFixed(2)}</Text>
            {zielAdresse && (
              <Text style={styles.preisZiel} numberOfLines={1}>{t('suchen.nach', { ziel: zielAdresse })}</Text>
            )}
          </View>
        )}

        <View style={styles.punkte}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.punkt} />
          ))}
        </View>
      </View>

      <TouchableOpacity style={styles.abbrechenButton} onPress={abbrechen}>
        <Text style={styles.abbrechenText}>{t('suchen.abbrechen')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  inhalt: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  spinner: { marginBottom: 24 },
  statusText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 6,
  },
  sub: { fontSize: 13, color: '#aaa', marginBottom: 20 },
  preisBox: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FFD700',
    minWidth: 200,
  },
  preisLabel: { fontSize: 12, color: '#aaa', marginBottom: 4 },
  preisWert: { fontSize: 32, fontWeight: 'bold', color: '#FFD700' },
  preisZiel: { fontSize: 11, color: '#888', marginTop: 4, maxWidth: 220 },
  punkte: { flexDirection: 'row', gap: 8 },
  punkt: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFD700',
  },
  abbrechenButton: {
    position: 'absolute',
    bottom: 48,
    backgroundColor: '#ff4444',
    borderRadius: 14,
    paddingHorizontal: 36,
    paddingVertical: 13,
  },
  abbrechenText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});
