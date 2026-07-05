import { Alert, Platform } from 'react-native';

// Alert.alert von react-native ist auf react-native-web ein No-Op (kein Dialog).
// Diese Helfer liefern im Web echte Browser-Dialoge, nativ das gewohnte Alert.

/** Einfache Hinweis-/Fehlermeldung mit OK-Button. */
export function zeigeHinweis(titel: string, nachricht?: string): void {
  if (Platform.OS === 'web') {
    const text = nachricht ? `${titel}\n\n${nachricht}` : titel;
    if (typeof window !== 'undefined') window.alert(text);
    return;
  }
  Alert.alert(titel, nachricht);
}

interface BestaetigenOptionen {
  titel: string;
  nachricht?: string;
  bestaetigenText?: string;
  abbrechenText?: string;
  /** Nativ rote „destructive"-Schaltfläche (z. B. Abmelden/Löschen). */
  destruktiv?: boolean;
}

/** Ja/Nein-Bestätigung. Löst zu true auf, wenn der Nutzer bestätigt. */
export function bestaetige(opts: BestaetigenOptionen): Promise<boolean> {
  const {
    titel,
    nachricht,
    bestaetigenText = 'OK',
    abbrechenText = 'Abbrechen',
    destruktiv = false,
  } = opts;

  if (Platform.OS === 'web') {
    const text = nachricht ? `${titel}\n\n${nachricht}` : titel;
    const ok = typeof window !== 'undefined' ? window.confirm(text) : true;
    return Promise.resolve(ok);
  }

  return new Promise((resolve) => {
    Alert.alert(
      titel,
      nachricht,
      [
        { text: abbrechenText, style: 'cancel', onPress: () => resolve(false) },
        { text: bestaetigenText, style: destruktiv ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      // Android: Wegtippen zählt als Abbruch, damit das Promise immer auflöst.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
