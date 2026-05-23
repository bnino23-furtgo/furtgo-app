import { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KoordType } from '@/types';

interface Props {
  standort?: KoordType | null;
  zielOrt?: (KoordType & { adresse?: string }) | null;
  fahrerStandort?: KoordType | null;
  standortAlsLogo?: boolean;
}

const ZUERICH = {
  latitude: 47.3769,
  longitude: 8.5417,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// OSRM-Route holen (kostenlos, OpenStreetMap)
async function fetchRoute(von: KoordType, nach: KoordType): Promise<KoordType[]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${von.longitude},${von.latitude};${nach.longitude},${nach.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes?.[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates.map((c: number[]) => ({
        latitude: c[1],
        longitude: c[0],
      }));
    }
  } catch (e) {
    console.error('Route Fehler:', e);
  }
  return [];
}

export default function MapComponent({ standort, zielOrt, fahrerStandort, standortAlsLogo }: Props) {
  const [route, setRoute] = useState<KoordType[]>([]);
  const mapRef = useRef<MapView>(null);
  const letztesZielRef = useRef<string>('');
  const ersteFitRef = useRef(false);
  const insets = useSafeAreaInsets();

  const region = standort
    ? {
        latitude: standort.latitude,
        longitude: standort.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : ZUERICH;

  // Route nur laden wenn sich das Ziel ändert (nicht bei jedem Standort-Update)
  useEffect(() => {
    const von = fahrerStandort ?? standort;
    if (!von || !zielOrt) {
      setRoute([]);
      letztesZielRef.current = '';
      ersteFitRef.current = false;
      return;
    }
    const schluessel = `${zielOrt.latitude},${zielOrt.longitude}`;
    if (schluessel === letztesZielRef.current) return;
    letztesZielRef.current = schluessel;
    ersteFitRef.current = false;
    fetchRoute(von, zielOrt).then(setRoute);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zielOrt?.latitude, zielOrt?.longitude, standort?.latitude, fahrerStandort?.latitude]);

  // Karte einmalig an Route anpassen
  useEffect(() => {
    if (route.length > 1 && mapRef.current && !ersteFitRef.current) {
      ersteFitRef.current = true;
      mapRef.current.fitToCoordinates(route, {
        edgePadding: { top: 80, right: 40, bottom: 80, left: 40 },
        animated: true,
      });
    }
  }, [route]);

  const aufStandortZentrieren = () => {
    if (!standort || !mapRef.current) return;
    mapRef.current.animateToRegion({
      latitude: standort.latitude,
      longitude: standort.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 500);
  };

  return (
    <View style={styles.container}>
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      initialRegion={region}
      showsUserLocation={!standort}
      showsMyLocationButton={false}
    >
      {standort && (
        standortAlsLogo ? (
          <Marker coordinate={standort} title="Dein Standort" anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.logoMarker}>
              <Ionicons name="car-sport" size={20} color="#1a1a2e" />
            </View>
          </Marker>
        ) : (
          <Marker coordinate={standort} title="Dein Standort" pinColor="blue" />
        )
      )}
      {zielOrt && (
        <Marker coordinate={zielOrt} title="Ziel" pinColor="red" />
      )}
      {fahrerStandort && (
        <Marker coordinate={fahrerStandort} title="Fahrer" pinColor="green" />
      )}
      {route.length > 1 && (
        <Polyline
          coordinates={route}
          strokeColor="#4285F4"
          strokeWidth={5}
        />
      )}
    </MapView>
    {standort && (
      <TouchableOpacity
        style={[styles.zentrierBtn, { bottom: insets.bottom + 16 }]}
        onPress={aufStandortZentrieren}
        accessibilityLabel="Auf meinen Standort zentrieren"
      >
        <Ionicons name="locate" size={22} color="#1a1a2e" />
      </TouchableOpacity>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  zentrierBtn: {
    position: 'absolute',
    left: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFD700',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  logoMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFD700',
    borderWidth: 3,
    borderColor: '#1e3a8a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});
