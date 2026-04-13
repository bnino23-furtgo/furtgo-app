import { KoordType } from '@/types';

export function berechneKm(a: KoordType, b: KoordType): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistanz(a: KoordType, b: KoordType): string {
  const km = berechneKm(a, b);
  const min = Math.max(1, Math.round((km / 30) * 60));
  const kmText = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  return `${kmText} • ca. ${min} Min.`;
}
