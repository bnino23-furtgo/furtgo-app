// Typen-Deklaration für TypeScript
// Zur Laufzeit wird MapComponent.native.tsx (iOS/Android) oder MapComponent.web.tsx (Web) verwendet
import { KoordType } from '@/types';

interface Props {
  standort?: KoordType | null;
  zielOrt?: (KoordType & { adresse?: string }) | null;
  fahrerStandort?: KoordType | null;
  standortAlsLogo?: boolean;
}

export default function MapComponent(_props: Props) {
  return null;
}
