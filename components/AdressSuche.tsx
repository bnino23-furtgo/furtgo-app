import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { OrtType } from '@/types';

interface Vorschlag {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface Props {
  placeholder?: string;
  onAuswahl: (ort: OrtType) => void;
  initialWert?: string;
}

export default function AdressSuche({ placeholder = 'Wohin?', onAuswahl, initialWert }: Props) {
  const [eingabe, setEingabe] = useState(initialWert ?? '');
  const [vorschlaege, setVorschlaege] = useState<Vorschlag[]>([]);
  const [laden, setLaden] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suchen = async (text: string) => {
    if (text.length < 3) {
      setVorschlaege([]);
      return;
    }
    setLaden(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=5&accept-language=de&countrycodes=ch,de,at,fr,it,li&addressdetails=1`,
        { headers: { Accept: 'application/json', 'User-Agent': 'MeineUberApp/1.0' } }
      );
      const data = await res.json();
      setVorschlaege(
        data.map((item: any) => {
          const a = item.address || {};
          const strasse = a.road || a.pedestrian || a.footway || '';
          const nr = a.house_number || '';
          const ort = a.city || a.town || a.village || a.municipality || '';
          const plz = a.postcode || '';
          // Format: "Strasse Nr, PLZ Ort" (wie Google Maps)
          const strasseNr = nr ? `${strasse} ${nr}` : strasse;
          const ortPlz = plz ? `${plz} ${ort}` : ort;
          const schoen = [strasseNr, ortPlz].filter(Boolean).join(', ') || item.display_name;
          return {
            id: item.place_id.toString(),
            name: schoen,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
          };
        })
      );
    } catch (e) {
      console.error('Adresssuche Fehler:', e);
    } finally {
      setLaden(false);
    }
  };

  const onChange = (text: string) => {
    setEingabe(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => suchen(text), 500);
  };

  const auswaehlen = (v: Vorschlag) => {
    setEingabe(v.name);
    setVorschlaege([]);
    onAuswahl({
      latitude: v.lat,
      longitude: v.lon,
      adresse: v.name,
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={eingabe}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor="#999"
        />
        {laden && <ActivityIndicator size="small" color="#333" style={styles.loader} />}
      </View>
      {vorschlaege.length > 0 && (
        <FlatList
          style={styles.liste}
          data={vorschlaege}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.item} onPress={() => auswaehlen(item)}>
              <Text style={styles.itemText} numberOfLines={2}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: { flex: 1, fontSize: 13, color: '#000' },
  loader: { marginLeft: 6 },
  liste: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginTop: 3,
    maxHeight: 180,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  item: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  itemText: { fontSize: 12, color: '#333' },
});
