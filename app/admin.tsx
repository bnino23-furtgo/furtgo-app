import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { addDoc, collection, getDoc, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';

interface FahrerDaten {
  id: string;
  name?: string;
  fahrerEmail?: string | null;
  fahrerName?: string | null;
  verifiziert?: string;
  gesperrt?: boolean;
  aboGueltigBis?: number;
  dokumente?: {
    fahrzeugausweisUrl?: string;
    fuehrerscheinVorneUrl?: string;
    fuehrerscheinHintenUrl?: string;
    strafregisterUrl?: string;
    strafregisterSauber?: boolean;
    uidDokumentUrl?: string;
    uidNummer?: string;
    eingereichtAm?: number;
  };
  fahrzeug?: {
    schildnummer?: string;
    marke?: string;
    jahrgang?: string;
    farbe?: string;
  };
}

interface FahrgastDaten {
  id: string;
  vorname?: string;
  nachname?: string;
  email?: string;
  telefon?: string;
  strasse?: string;
  ortschaft?: string;
  erstelltAm?: number;
  ausweisUrl?: string;
  rolle?: string;
  istAdmin?: boolean;
  istFahrer?: boolean;
}

export default function AdminPanel() {
  const [istAdmin, setIstAdmin] = useState<boolean | null>(null);
  const [fahrer, setFahrer] = useState<FahrerDaten[]>([]);
  const [fahrgaeste, setFahrgaeste] = useState<FahrgastDaten[]>([]);
  const [laden, setLaden] = useState(false);

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) { setIstAdmin(false); return; }
      try {
        const snap = await getDoc(doc(db, 'nutzer', uid));
        const ok = snap.data()?.istAdmin === true;
        setIstAdmin(ok);
        if (ok) {
          fahrerLaden();
          fahrgaesteLaden();
        }
      } catch {
        setIstAdmin(false);
      }
    })();
  }, []);

  const fahrerLaden = async () => {
    setLaden(true);
    try {
      const snap = await getDocs(collection(db, 'fahrer'));
      const liste: FahrerDaten[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FahrerDaten));
      setFahrer(liste);
    } catch (e) {
      console.log('Admin Fahrer laden Fehler (ignoriert):', e);
    } finally {
      setLaden(false);
    }
  };

  const fahrgaesteLaden = async () => {
    try {
      const snap = await getDocs(collection(db, 'nutzer'));
      const liste: FahrgastDaten[] = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as FahrgastDaten))
        .filter((n) => n.istFahrer !== true && n.istAdmin !== true && n.rolle !== 'fahrer')
        .sort((a, b) => (b.erstelltAm ?? 0) - (a.erstelltAm ?? 0));
      setFahrgaeste(liste);
    } catch (e) {
      console.log('Admin Fahrgaeste laden Fehler (ignoriert):', e);
    }
  };

  const allesLaden = () => {
    fahrerLaden();
    fahrgaesteLaden();
  };

  const verifizierenSetzen = async (fahrerId: string, status: string) => {
    await updateDoc(doc(db, 'fahrer', fahrerId), { verifiziert: status });
    setFahrer((prev) =>
      prev.map((f) => (f.id === fahrerId ? { ...f, verifiziert: status } : f))
    );

    const f = fahrer.find((x) => x.id === fahrerId);
    if (f?.fahrerEmail && (status === 'genehmigt' || status === 'abgelehnt')) {
      try {
        const anrede = f.fahrerName ?? f.name ?? 'Fahrer';
        const istGenehmigt = status === 'genehmigt';
        const betreff = istGenehmigt
          ? 'Furtgo — Du bist freigeschaltet ✓'
          : 'Furtgo — Deine Dokumente wurden abgelehnt';
        const html = istGenehmigt
          ? `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
              <h2 style="margin:0 0 4px;">Furtgo</h2>
              <p style="color:#666;margin:0 0 20px;font-size:13px;">Verifikations-Bestätigung</p>
              <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
              <h3 style="margin:0 0 12px;color:#16a34a;">Willkommen an Bord, ${anrede}!</h3>
              <p style="font-size:14px;line-height:1.6;">Deine Dokumente wurden geprüft und freigegeben. Du kannst jetzt online gehen und Fahrten annehmen.</p>
              <p style="font-size:14px;line-height:1.6;"><b>Nächster Schritt:</b> Abo aktivieren (CHF 60/Monat), dann im Fahrer-Dashboard den Online-Schalter umlegen.</p>
              <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
              <p style="color:#666;font-size:12px;text-align:center;">Bei Fragen: support.furtgo@gmail.com</p>
            </div>`
          : `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
              <h2 style="margin:0 0 4px;">Furtgo</h2>
              <p style="color:#666;margin:0 0 20px;font-size:13px;">Dokumenten-Prüfung</p>
              <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
              <h3 style="margin:0 0 12px;color:#dc2626;">Hallo ${anrede},</h3>
              <p style="font-size:14px;line-height:1.6;">Leider konnten wir deine eingereichten Dokumente nicht freigeben.</p>
              <p style="font-size:14px;line-height:1.6;">Du kannst die Unterlagen jederzeit neu einreichen. Öffne dazu die Furtgo-App → Profil → Verifikation.</p>
              <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;">
              <p style="color:#666;font-size:12px;text-align:center;">Bei Fragen: support.furtgo@gmail.com</p>
            </div>`;

        await addDoc(collection(db, 'mail'), {
          to: [f.fahrerEmail],
          message: { subject: betreff, html },
        });
      } catch (mailErr) {
        console.error('Fahrer-Mail Fehler (ignoriert):', mailErr);
      }
    }
  };

  const gesperrtSetzen = async (fahrerId: string, wert: boolean) => {
    await updateDoc(doc(db, 'fahrer', fahrerId), { gesperrt: wert });
    setFahrer((prev) =>
      prev.map((f) => (f.id === fahrerId ? { ...f, gesperrt: wert } : f))
    );
  };

  const alleAbgelehntenLoeschen = () => {
    const abgelehnte = fahrer.filter((f) => f.verifiziert === 'abgelehnt');
    if (abgelehnte.length === 0) {
      Alert.alert('Keine abgelehnten', 'Es gibt keine abgelehnten Fahrer zum Löschen.');
      return;
    }
    Alert.alert(
      `${abgelehnte.length} Fahrer löschen?`,
      `Alle abgelehnten Fahrer-Dokumente werden unwiderruflich gelöscht. Auth-Accounts müssen manuell in der Firebase Console gelöscht werden.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            setLaden(true);
            let erfolg = 0;
            let fehler = 0;
            for (const f of abgelehnte) {
              try {
                await deleteDoc(doc(db, 'fahrer', f.id));
                try { await deleteDoc(doc(db, 'nutzer', f.id)); } catch { /* nutzer-Doc evtl. nicht vorhanden */ }
                erfolg++;
              } catch (e) {
                console.log('Löschen Fehler:', f.id, e);
                fehler++;
              }
            }
            setFahrer((prev) => prev.filter((f) => f.verifiziert !== 'abgelehnt'));
            setLaden(false);
            Alert.alert(
              'Fertig',
              `${erfolg} gelöscht, ${fehler} Fehler.\n\nAuth-Accounts + Ausweis-Fotos: Firebase Console manuell aufräumen.`
            );
          },
        },
      ]
    );
  };

  const agbUpdateMailSenden = () => {
    Alert.alert(
      'AGB-Update-Mail senden?',
      'An ALLE registrierten Nutzer wird eine E-Mail über die AGB- und Datenschutz-Aktualisierung verschickt. Diese Aktion kann nicht rückgängig gemacht werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Senden',
          onPress: async () => {
            setLaden(true);
            try {
              const escapeHtml = (s: string) =>
                s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const snap = await getDocs(collection(db, 'nutzer'));
              const nutzer = snap.docs
                .map((d) => ({ id: d.id, ...d.data() } as any))
                .filter((n) => n.email && typeof n.email === 'string');

              let erfolg = 0;
              let fehler = 0;
              for (const n of nutzer) {
                const name = `${n.vorname ?? ''} ${n.nachname ?? ''}`.trim() || 'Furtgo-Nutzer';
                const html = `
                  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
                    <h2 style="margin:0 0 4px;">Furtgo</h2>
                    <p style="color:#666;margin:0 0 20px;font-size:13px;">Wichtige Information</p>
                    <hr style="border:none;border-top:1px solid #ccc;margin-bottom:16px;">
                    <p style="font-size:14px;line-height:1.6;">Hallo ${escapeHtml(name)},</p>
                    <p style="font-size:14px;line-height:1.6;">
                      wir haben unsere <strong>Allgemeinen Geschäftsbedingungen</strong> und die
                      <strong>Datenschutzerklärung</strong> aktualisiert (Stand 30. Mai 2026).
                    </p>
                    <p style="font-size:14px;line-height:1.6;">Die wichtigste Änderung:</p>
                    <ul style="font-size:14px;line-height:1.6;">
                      <li>Die Zahlungsabwicklung für das Fahrer-Abonnement erfolgt neu über <strong>Stripe</strong> statt über PostFinance Checkout. Für dich ändert sich am Ablauf nichts &ndash; das Abo kostet weiterhin CHF 60 pro Monat und kann jederzeit in der App gekündigt werden.</li>
                    </ul>
                    <p style="text-align:center;margin:24px 0;">
                      <a href="https://furtgo.ch/legal.html" style="background:#FFD700;color:#000;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Legal-Seite öffnen</a>
                    </p>
                    <p style="font-size:13px;color:#666;line-height:1.6;">
                      Wenn du Furtgo weiter nutzt, gelten die neuen AGB als angenommen. Bei Fragen melde dich gerne bei
                      <a href="mailto:support.furtgo@gmail.com">support.furtgo@gmail.com</a>.
                    </p>
                    <p style="font-size:14px;line-height:1.6;margin-top:20px;">
                      Bis bald auf der Strasse,<br>
                      Dein Furtgo-Team
                    </p>
                  </div>`;
                try {
                  await addDoc(collection(db, 'mail'), {
                    to: [n.email],
                    message: {
                      subject: 'Furtgo: AGB und Datenschutz aktualisiert',
                      html,
                    },
                  });
                  erfolg++;
                } catch (e) {
                  console.error('AGB-Mail Fehler:', n.id, e);
                  fehler++;
                }
              }
              setLaden(false);
              Alert.alert(
                'Versand abgeschlossen',
                `${erfolg} Mails initiiert, ${fehler} Fehler.\n\nDie Trigger-Email-Extension verschickt sie nun via Gmail SMTP (kann ein paar Minuten dauern).`
              );
            } catch (e: any) {
              setLaden(false);
              Alert.alert('Fehler', e?.message ?? 'Unbekannter Fehler beim Lesen der Nutzer-Liste');
            }
          },
        },
      ]
    );
  };

  const aboVerlaengern = async (fahrerId: string) => {
    const f = fahrer.find((x) => x.id === fahrerId);
    const basis = f?.aboGueltigBis && f.aboGueltigBis > Date.now() ? f.aboGueltigBis : Date.now();
    const neuesDatum = basis + 30 * 24 * 60 * 60 * 1000;
    await updateDoc(doc(db, 'fahrer', fahrerId), { aboGueltigBis: neuesDatum });
    setFahrer((prev) =>
      prev.map((x) => (x.id === fahrerId ? { ...x, aboGueltigBis: neuesDatum } : x))
    );
  };

  if (istAdmin === null) {
    return (
      <View style={styles.pinContainer}>
        <ActivityIndicator size="large" color="#FFD700" />
      </View>
    );
  }

  if (istAdmin === false) {
    return (
      <View style={styles.pinContainer}>
        <TouchableOpacity style={styles.zurueckBtn} onPress={() => router.back()}>
          <Text style={styles.zurueckPfeil}>&#x2039;</Text>
        </TouchableOpacity>
        <Text style={styles.pinTitel}>Kein Zugang</Text>
        <Text style={styles.pinSub}>Dein Konto hat keine Admin-Rechte.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inhalt}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.zurueckBtnInline}>
          <Text style={styles.zurueckPfeil}>&#x2039;</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={allesLaden}>
          <Text style={styles.refreshText}>↻ Aktualisieren</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.titel}>Admin-Panel</Text>
      <Text style={styles.sub}>{fahrer.length} Fahrer · {fahrgaeste.length} Fahrgäste</Text>

      <TouchableOpacity style={styles.loeschenAlleBtn} onPress={alleAbgelehntenLoeschen}>
        <Text style={styles.loeschenAlleText}>🗑  Alle abgelehnten löschen</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.agbMailBtn} onPress={agbUpdateMailSenden}>
        <Text style={styles.agbMailText}>📧  AGB-Update-Mail an alle senden</Text>
      </TouchableOpacity>

      {laden && <ActivityIndicator color="#FFD700" style={{ marginTop: 20 }} />}

      {fahrer.map((f) => (
        <View key={f.id} style={styles.fahrerCard}>
          <View style={styles.fahrerHeader}>
            <Text style={styles.fahrerName}>{f.name ?? '(kein Name)'}</Text>
            <View style={styles.badges}>
              {f.gesperrt && (
                <Text style={styles.badgeRot}>Gesperrt</Text>
              )}
              {f.verifiziert === 'genehmigt' && <Text style={styles.badgeGruen}>✓ Verifiziert</Text>}
              {f.verifiziert === 'ausstehend' && <Text style={styles.badgeGelb}>⏳ Ausstehend</Text>}
              {f.verifiziert === 'abgelehnt' && <Text style={styles.badgeRot}>✕ Abgelehnt</Text>}
            </View>
          </View>

          <Text style={styles.fahrerId}>ID: {f.id.slice(0, 12)}...</Text>

          {/* Abo-Status */}
          <View style={styles.aboZeile}>
            {f.aboGueltigBis ? (
              <Text style={f.aboGueltigBis > Date.now() ? styles.aboAktiv : styles.aboAbgelaufen}>
                {f.aboGueltigBis > Date.now()
                  ? `Abo aktiv bis ${new Date(f.aboGueltigBis).toLocaleDateString('de-CH')}`
                  : `Abo abgelaufen am ${new Date(f.aboGueltigBis).toLocaleDateString('de-CH')}`}
              </Text>
            ) : (
              <Text style={styles.aboKein}>Kein Abo</Text>
            )}
            <TouchableOpacity style={styles.aboBtn} onPress={() => aboVerlaengern(f.id)}>
              <Text style={styles.aboBtnText}>+30 Tage</Text>
            </TouchableOpacity>
          </View>

          {f.fahrzeug && (f.fahrzeug.schildnummer || f.fahrzeug.marke || f.fahrzeug.jahrgang || f.fahrzeug.farbe) ? (
            <View style={styles.dokBox}>
              <Text style={styles.dokTitel}>Fahrzeug:</Text>
              {f.fahrzeug.schildnummer ? <Text style={styles.dokZeile}>🔢 Schildnummer: {f.fahrzeug.schildnummer}</Text> : null}
              {f.fahrzeug.marke ? <Text style={styles.dokZeile}>🚗 Marke/Modell: {f.fahrzeug.marke}</Text> : null}
              {f.fahrzeug.jahrgang ? <Text style={styles.dokZeile}>📅 Jahrgang: {f.fahrzeug.jahrgang}</Text> : null}
              {f.fahrzeug.farbe ? <Text style={styles.dokZeile}>🎨 Farbe: {f.fahrzeug.farbe}</Text> : null}
            </View>
          ) : null}

          {f.dokumente ? (
            <View style={styles.dokBox}>
              <Text style={styles.dokTitel}>Eingereichte Dokumente:</Text>
              <Text style={styles.dokZeile}>
                🔍 Strafregister: {f.dokumente.strafregisterSauber === true ? '✓ Sauber' : f.dokumente.strafregisterSauber === false ? '✕ Einträge vorhanden' : '–'}
              </Text>
              {f.dokumente.uidNummer ? (
                <Text style={styles.dokZeile}>🏢 UID-Nummer: {f.dokumente.uidNummer}</Text>
              ) : null}
              {f.dokumente.eingereichtAm && (
                <Text style={styles.dokDatum}>
                  Eingereicht: {new Date(f.dokumente.eingereichtAm).toLocaleDateString('de-CH')}
                </Text>
              )}
              {(['fahrzeugausweisUrl', 'fuehrerscheinVorneUrl', 'fuehrerscheinHintenUrl', 'strafregisterUrl', 'uidDokumentUrl'] as const).map((key) => {
                const labels: Record<string, string> = {
                  fahrzeugausweisUrl: '🚗 Fahrzeugausweis',
                  fuehrerscheinVorneUrl: '📋 Führerschein – Vorderseite',
                  fuehrerscheinHintenUrl: '📋 Führerschein – Rückseite',
                  strafregisterUrl: '📄 Strafregisterauszug',
                  uidDokumentUrl: '🏢 UID-/Handelsregister-Bestätigung',
                };
                const url = f.dokumente![key];
                return (
                  <View key={key} style={styles.fotoSektion}>
                    <Text style={styles.fotoLabel}>{labels[key]}</Text>
                    {url ? (
                      <TouchableOpacity onPress={() => Linking.openURL(url)}>
                        <Image source={{ uri: url }} style={styles.dokFoto} />
                        <Text style={styles.fotoOeffnen}>Vollbild öffnen</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.keineFoto}>Kein Foto</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.keineDok}>Keine Dokumente eingereicht</Text>
          )}

          <View style={styles.aktionenRow}>
            {f.verifiziert !== 'genehmigt' && (
              <TouchableOpacity
                style={styles.btnGruen}
                onPress={() => verifizierenSetzen(f.id, 'genehmigt')}
              >
                <Text style={styles.btnText}>✓ Verifizieren</Text>
              </TouchableOpacity>
            )}
            {f.verifiziert !== 'abgelehnt' && (
              <TouchableOpacity
                style={styles.btnGrau}
                onPress={() => verifizierenSetzen(f.id, 'abgelehnt')}
              >
                <Text style={styles.btnText}>✕ Ablehnen</Text>
              </TouchableOpacity>
            )}
            {f.gesperrt ? (
              <TouchableOpacity
                style={styles.btnGelb}
                onPress={() => gesperrtSetzen(f.id, false)}
              >
                <Text style={[styles.btnText, { color: '#000' }]}>Entsperren</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.btnRot}
                onPress={() =>
                  Alert.alert('Sperren?', `${f.name ?? 'Fahrer'} wirklich sperren?`, [
                    { text: 'Abbrechen', style: 'cancel' },
                    { text: 'Sperren', style: 'destructive', onPress: () => gesperrtSetzen(f.id, true) },
                  ])
                }
              >
                <Text style={styles.btnText}>Sperren</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      {/* Fahrgäste-Sektion */}
      <Text style={styles.sektionTitel}>Registrierte Fahrgäste ({fahrgaeste.length})</Text>
      {fahrgaeste.length === 0 && !laden && (
        <Text style={styles.keineDok}>Noch keine Fahrgäste registriert.</Text>
      )}
      {fahrgaeste.map((g) => {
        const vollname = `${g.vorname ?? ''} ${g.nachname ?? ''}`.trim() || '(kein Name)';
        return (
          <View key={g.id} style={styles.fahrerCard}>
            <View style={styles.fahrerHeader}>
              <Text style={styles.fahrerName}>{vollname}</Text>
              <View style={styles.badges}>
                <Text style={styles.badgeBlau}>Fahrgast</Text>
              </View>
            </View>
            <Text style={styles.fahrerId}>ID: {g.id.slice(0, 12)}…</Text>
            <View style={styles.dokBox}>
              {g.email ? <Text style={styles.dokZeile}>📧 {g.email}</Text> : null}
              {g.telefon ? <Text style={styles.dokZeile}>📞 {g.telefon}</Text> : null}
              {(g.strasse || g.ortschaft) ? (
                <Text style={styles.dokZeile}>🏠 {[g.strasse, g.ortschaft].filter(Boolean).join(', ')}</Text>
              ) : null}
              {g.erstelltAm ? (
                <Text style={styles.dokDatum}>
                  Registriert: {new Date(g.erstelltAm).toLocaleDateString('de-CH')}
                </Text>
              ) : null}
              {g.ausweisUrl ? (
                <View style={styles.fotoSektion}>
                  <Text style={styles.fotoLabel}>🪪 Ausweis</Text>
                  <TouchableOpacity onPress={() => Linking.openURL(g.ausweisUrl!)}>
                    <Image source={{ uri: g.ausweisUrl }} style={styles.dokFoto} />
                    <Text style={styles.fotoOeffnen}>Vollbild öffnen</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.keineFoto}>Kein Ausweis hochgeladen</Text>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pinContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    padding: 32,
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
    position: 'absolute',
    top: 50,
    left: 24,
  },
  zurueckBtnInline: {
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
  pinTitel: { fontSize: 28, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 8 },
  pinSub: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 24 },
  pinInput: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 18,
    fontSize: 24,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
    letterSpacing: 8,
  },
  pinButton: {
    backgroundColor: '#FFD700',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  pinButtonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },

  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inhalt: { padding: 24, paddingBottom: 60 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 40,
    marginBottom: 20,
  },
  refreshText: { color: '#FFD700', fontSize: 14 },
  titel: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  sub: { fontSize: 13, color: '#aaa', marginBottom: 20 },

  fahrerCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  fahrerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  fahrerName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badgeGruen: { fontSize: 11, color: '#4ade80', fontWeight: '700' },
  badgeGelb: { fontSize: 11, color: '#FFD700', fontWeight: '700' },
  badgeRot: { fontSize: 11, color: '#f87171', fontWeight: '700' },
  badgeBlau: { fontSize: 11, color: '#60a5fa', fontWeight: '700' },
  sektionTitel: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginTop: 28, marginBottom: 12 },
  fahrerId: { fontSize: 11, color: '#555', marginBottom: 10 },

  dokBox: {
    backgroundColor: '#0f2035',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  dokTitel: { fontSize: 12, fontWeight: '700', color: '#aaa', marginBottom: 6 },
  dokZeile: { fontSize: 13, color: '#fff', marginBottom: 3 },
  dokDatum: { fontSize: 11, color: '#555', marginTop: 4, marginBottom: 8 },
  keineDok: { fontSize: 13, color: '#555', marginBottom: 12, fontStyle: 'italic' },
  fotoSektion: { marginTop: 10 },
  fotoLabel: { fontSize: 12, color: '#aaa', fontWeight: '600', marginBottom: 4 },
  dokFoto: { width: '100%', height: 140, borderRadius: 8, resizeMode: 'cover' },
  fotoOeffnen: { color: '#FFD700', fontSize: 11, marginTop: 4, marginBottom: 4 },
  keineFoto: { fontSize: 12, color: '#555', fontStyle: 'italic' },

  aboZeile: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  aboAktiv: { fontSize: 12, color: '#4ade80', fontWeight: '600' },
  aboAbgelaufen: { fontSize: 12, color: '#f87171', fontWeight: '600' },
  aboKein: { fontSize: 12, color: '#888' },
  aboBtn: { backgroundColor: '#FFD700', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10 },
  aboBtnText: { fontSize: 12, fontWeight: 'bold', color: '#000' },
  aktionenRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btnGruen: { backgroundColor: '#14532d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnGrau: { backgroundColor: '#333', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnGelb: { backgroundColor: '#FFD700', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  btnRot: { backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  loeschenAlleBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  loeschenAlleText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  agbMailBtn: {
    backgroundColor: '#1e3a5f',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  agbMailText: { color: '#FFD700', fontSize: 14, fontWeight: 'bold' },
  btnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
