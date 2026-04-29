import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import { useTranslation } from 'react-i18next';

type FilterTyp = 'tag' | 'woche' | 'monat' | 'jahr';

interface FahrtEintrag {
  id: string;
  abholAdresse: string;
  zielAdresse: string;
  status: string;
  erstelltAm: any;
  preis?: number;
  datum: Date;
}

export default function Verlauf() {
  const { t } = useTranslation();
  const { rolle } = useLocalSearchParams<{ rolle: string }>();
  const [fahrten, setFahrten] = useState<FahrtEintrag[]>([]);
  const [laden, setLaden] = useState(true);
  const [filter, setFilter] = useState<FilterTyp>('tag');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const feld = rolle === 'fahrer' ? 'fahrerId' : 'fahrgastId';
    const q = query(collection(db, 'fahrten'), where(feld, '==', uid));

    getDocs(q)
      .then((snap) => {
        const liste: FahrtEintrag[] = snap.docs
          .map((d) => {
            const ts = d.data().erstelltAm;
            const datum = ts?.toDate ? ts.toDate() : new Date(ts ?? 0);
            return {
              id: d.id,
              abholAdresse: d.data().abholort?.adresse ?? t('allgemein.unbekannt'),
              zielAdresse: d.data().zielort?.adresse ?? t('allgemein.unbekannt'),
              status: d.data().status,
              erstelltAm: ts,
              preis: d.data().preis ?? null,
              datum,
            };
          })
          .filter((f) => f.status === 'abgeschlossen' || f.status === 'abgebrochen')
          .sort((a, b) => b.datum.getTime() - a.datum.getTime());
        setFahrten(liste);
      })
      .catch((e) => console.log('Verlauf laden Fehler (ignoriert):', e))
      .finally(() => setLaden(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolle]);

  const gefilterteFahrten = useMemo(() => {
    const jetzt = new Date();
    if (filter === 'tag') {
      const tagesStart = new Date(jetzt);
      tagesStart.setHours(0, 0, 0, 0);
      return fahrten.filter((f) => f.datum >= tagesStart);
    }
    if (filter === 'woche') {
      const wochenStart = new Date(jetzt);
      wochenStart.setHours(0, 0, 0, 0);
      wochenStart.setDate(jetzt.getDate() - ((jetzt.getDay() + 6) % 7)); // Montag
      return fahrten.filter((f) => f.datum >= wochenStart);
    }
    if (filter === 'monat') {
      const monatsStart = new Date(jetzt.getFullYear(), jetzt.getMonth(), 1);
      return fahrten.filter((f) => f.datum >= monatsStart);
    }
    const jahrStart = new Date(jetzt.getFullYear(), 0, 1);
    return fahrten.filter((f) => f.datum >= jahrStart);
  }, [fahrten, filter]);

  const zusammenfassung = useMemo(() => {
    const abgeschlossen = gefilterteFahrten.filter((f) => f.status === 'abgeschlossen');
    const summe = abgeschlossen.reduce((acc, f) => acc + (f.preis ?? 0), 0);
    return { anzahl: abgeschlossen.length, summe };
  }, [gefilterteFahrten]);

  const statusInfo = (status: string) => {
    if (status === 'abgeschlossen') return { label: t('verlauf.abgeschlossen'), farbe: '#4ade80' };
    if (status === 'abgebrochen') return { label: t('verlauf.abgebrochen'), farbe: '#f87171' };
    return { label: status, farbe: '#aaa' };
  };

  const formatDatum = (d: Date) => {
    try {
      return d.toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const filterLabel: Record<FilterTyp, string> = {
    tag: t('verlauf.heute'),
    woche: t('verlauf.dieseWoche'),
    monat: t('verlauf.dieserMonat'),
    jahr: t('verlauf.diesesJahr'),
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.zurueckBtn}>
          <Text style={styles.zurueckPfeil}>&#x2039;</Text>
        </TouchableOpacity>
        <Text style={styles.titel}>{t('verlauf.titel')}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Filter-Tabs */}
      <View style={styles.tabs}>
        {(['tag', 'woche', 'monat', 'jahr'] as FilterTyp[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabAktiv]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextAktiv]}>
              {filterLabel[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Zusammenfassung */}
      {!laden && zusammenfassung.anzahl > 0 && (
        <View style={styles.zusammenfassung}>
          <View style={styles.zusammenfassungLinks}>
            <Text style={styles.zusammenfassungZahl}>{zusammenfassung.anzahl}</Text>
            <Text style={styles.zusammenfassungLabel}>
              {t('verlauf.fahrt', { count: zusammenfassung.anzahl })}
            </Text>
          </View>
          <View style={styles.zusammenfassungTrenner} />
          <View style={styles.zusammenfassungRechts}>
            <Text style={styles.zusammenfassungSumme}>
              CHF {zusammenfassung.summe.toFixed(2)}
            </Text>
            <Text style={styles.zusammenfassungLabel}>
              {rolle === 'fahrer' ? t('verlauf.einnahmen') : t('verlauf.ausgaben')}
            </Text>
          </View>
        </View>
      )}

      {laden ? (
        <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 60 }} />
      ) : gefilterteFahrten.length === 0 ? (
        <View style={styles.leer}>
          <Text style={styles.leerIcon}>🚗</Text>
          <Text style={styles.leerText}>
            {filter === 'tag'
              ? t('verlauf.keineHeute')
              : filter === 'woche'
              ? t('verlauf.keineWoche')
              : filter === 'monat'
              ? t('verlauf.keineMonat')
              : t('verlauf.keineJahr')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={gefilterteFahrten}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => {
            const { label, farbe } = statusInfo(item.status);
            return (
              <View style={styles.karte}>
                <View style={styles.karteHeader}>
                  <Text style={styles.datum}>{formatDatum(item.datum)}</Text>
                  <View style={[styles.badge, { backgroundColor: farbe + '22', borderColor: farbe }]}>
                    <Text style={[styles.badgeText, { color: farbe }]}>{label}</Text>
                  </View>
                </View>
                <View style={styles.route}>
                  <View style={styles.routeZeile}>
                    <View style={styles.punktBlau} />
                    <Text style={styles.adresse} numberOfLines={1}>{item.abholAdresse}</Text>
                  </View>
                  <View style={styles.linie} />
                  <View style={styles.routeZeile}>
                    <View style={styles.punktGruen} />
                    <Text style={styles.adresse} numberOfLines={1}>{item.zielAdresse}</Text>
                  </View>
                </View>
                {item.preis != null && item.status === 'abgeschlossen' && (
                  <View style={styles.preisZeile}>
                    <Text style={styles.preisLabel}>{t('verlauf.betrag')}</Text>
                    <Text style={styles.preisWert}>CHF {item.preis.toFixed(2)}</Text>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
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
  titel: { fontSize: 20, fontWeight: 'bold', color: '#fff' },

  tabs: {
    flexDirection: 'row',
    margin: 16,
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabAktiv: { backgroundColor: '#FFD700' },
  tabText: { fontSize: 12, color: '#aaa', fontWeight: '600' },
  tabTextAktiv: { color: '#000' },

  zusammenfassung: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFD70044',
  },
  zusammenfassungLinks: { flex: 1, alignItems: 'center' },
  zusammenfassungRechts: { flex: 1, alignItems: 'center' },
  zusammenfassungTrenner: { width: 1, height: 36, backgroundColor: '#333' },
  zusammenfassungZahl: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  zusammenfassungSumme: { fontSize: 22, fontWeight: 'bold', color: '#FFD700' },
  zusammenfassungLabel: { fontSize: 11, color: '#888', marginTop: 2 },

  leer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  leerIcon: { fontSize: 60 },
  leerText: { color: '#aaa', fontSize: 16 },
  karte: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 16,
  },
  karteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  datum: { color: '#aaa', fontSize: 12 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: { fontSize: 12, fontWeight: '600' },
  route: { gap: 4 },
  routeZeile: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linie: { width: 2, height: 12, backgroundColor: '#333', marginLeft: 7 },
  punktBlau: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#3b82f6' },
  punktGruen: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#22c55e' },
  adresse: { color: '#ddd', fontSize: 13, flex: 1 },
  preisZeile: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  preisLabel: { fontSize: 12, color: '#aaa' },
  preisWert: { fontSize: 16, fontWeight: 'bold', color: '#FFD700' },
});
