import React, { useEffect, useRef } from 'react';
import { KoordType } from '@/types';

interface Props {
  standort?: KoordType | null;
  zielOrt?: (KoordType & { adresse?: string }) | null;
  fahrerStandort?: KoordType | null;
}

const LEAFLET_CSS =
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const ZUERICH = { lat: 47.3769, lng: 8.5417 };

// OSRM-Route holen (kostenlos, OpenStreetMap)
async function fetchRoute(von: KoordType, nach: KoordType): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${von.longitude},${von.latitude};${nach.longitude},${nach.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes?.[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
    }
  } catch (e) {
    console.error('Route Fehler:', e);
  }
  return [];
}

export default function MapComponent({ standort, zielOrt, fahrerStandort }: Props) {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeLayerRef = useRef<any>(null);

  useEffect(() => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    import('leaflet').then((leaflet) => {
      const L = leaflet.default;
      if (!containerRef.current || mapRef.current) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl:
          'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl:
          'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const center = standort
        ? ([standort.latitude, standort.longitude] as [number, number])
        : ([ZUERICH.lat, ZUERICH.lng] as [number, number]);

      mapRef.current = L.map(containerRef.current).setView(center, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      }).addTo(mapRef.current);

      updateMarkers(L);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const updateMarkers = (L: any) => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }
    if (!mapRef.current) return;

    const redIcon = L.icon({
      iconUrl:
        'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
      shadowUrl:
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });
    const greenIcon = L.icon({
      iconUrl:
        'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
      shadowUrl:
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });

    if (standort) {
      const m = L.marker([standort.latitude, standort.longitude])
        .addTo(mapRef.current)
        .bindPopup('Dein Standort');
      markersRef.current.push(m);
      mapRef.current.setView([standort.latitude, standort.longitude], 14);
    }
    if (zielOrt) {
      const m = L.marker([zielOrt.latitude, zielOrt.longitude], { icon: redIcon })
        .addTo(mapRef.current)
        .bindPopup('Ziel');
      markersRef.current.push(m);
    }
    if (fahrerStandort) {
      const m = L.marker([fahrerStandort.latitude, fahrerStandort.longitude], {
        icon: greenIcon,
      })
        .addTo(mapRef.current)
        .bindPopup('Fahrer');
      markersRef.current.push(m);
    }

    // Route zeichnen
    const von = fahrerStandort ?? standort;
    if (von && zielOrt) {
      fetchRoute(von, zielOrt).then((coords) => {
        if (coords.length > 1 && mapRef.current) {
          routeLayerRef.current = L.polyline(coords, {
            color: '#4285F4',
            weight: 5,
            opacity: 0.8,
          }).addTo(mapRef.current);
          mapRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
        }
      });
    }
  };

  useEffect(() => {
    if (!mapRef.current) return;
    import('leaflet').then((leaflet) => updateMarkers(leaflet.default));
  }, [standort, zielOrt, fahrerStandort]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 400 }} />
  );
}
