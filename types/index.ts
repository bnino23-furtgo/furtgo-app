export type KoordType = {
  latitude: number;
  longitude: number;
};

export type OrtType = KoordType & {
  adresse: string;
};

export type FahrtStatus =
  | 'wartend'
  | 'angenommen'
  | 'unterwegs'
  | 'abgeschlossen'
  | 'abgebrochen';

export interface Fahrt {
  id: string;
  fahrgastId: string;
  fahrerId: string | null;
  abholort: OrtType;
  zielort: OrtType;
  status: FahrtStatus;
  erstelltAm: Date;
  // ARV 2 (optional, ab arv2Version >= 1)
  kmStartStand?: number;
  kmEndStand?: number;
  istPrivatfahrt?: boolean;
  andererFahrerKm?: number;
  andererFahrerVermerk?: string;
  startZeit?: Date;
  endZeit?: Date;
  arv2Version?: number;
}

export interface FahrerProfil {
  name: string;
  online: boolean;
  standort: KoordType | null;
  aktiveFahrtId: string | null;
}

// === ARV 2: Arbeitszeit-Erfassung (Schweizer Verordnung) ===

export type FahrerTyp = 'arbeitnehmer' | 'selbstaendig';

export interface Pause {
  start: Date;
  ende: Date;
  dauerMin: number;
}

export interface PrivatfahrtEintrag {
  start: Date;
  ende: Date;
  km: number;
  fahrerName?: string; // bei Drittnutzung
}

export interface Schicht {
  id: string; // {fahrerId}_{YYYY-MM-DD}
  fahrerId: string;
  datum: string; // "2026-04-23"
  fahrerTyp: FahrerTyp;
  kontrollschild: string;
  ruhezeitVorBeginnMin: number;
  arbeitsbeginn: Date;
  arbeitsende: Date | null;
  kmStandStart: number;
  kmStandEnde: number | null;
  pausen: Pause[];
  privatfahrten: PrivatfahrtEintrag[];
  lenkzeitMin: number;
  arbeitszeitMin: number;
  pauseMinTotal: number;
  bemerkungen: string;
  unterschrift: string | null; // base64 PNG
  abgeschlossenAm: Date | null;
  wochenbundelId: string | null;
}

export interface AuditChange {
  timestamp: Date;
  userId: string;
  aenderungen: Record<string, { alt: unknown; neu: unknown }>;
  grund?: string;
}

export interface OnlineEvent {
  timestamp: Date;
  istOnline: boolean;
  standort?: KoordType;
  grund?: 'manuell' | 'auto-pause' | 'inaktiv' | 'privat' | 'privat-ende';
}

export interface ARV2Config {
  arv2Enabled: boolean;
  arv2TestFahrerIds: string[];
  arv2Laender: string[]; // z.B. ['CH']
}
