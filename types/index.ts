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
}

export interface FahrerProfil {
  name: string;
  online: boolean;
  standort: KoordType | null;
  aktiveFahrtId: string | null;
}
