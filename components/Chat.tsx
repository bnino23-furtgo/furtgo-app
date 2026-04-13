import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';
import { spieleTon } from '@/utils/ton';
import { useTranslation } from 'react-i18next';

interface Nachricht {
  id: string;
  text: string;
  senderId: string;
}

interface Props {
  fahrtId: string;
  rolle: 'fahrer' | 'fahrgast';
  onSchliessen: () => void;
}

export default function Chat({ fahrtId, rolle, onSchliessen }: Props) {
  const { t } = useTranslation();
  const [nachrichten, setNachrichten] = useState<Nachricht[]>([]);
  const [eingabe, setEingabe] = useState('');
  const listRef = useRef<FlatList>(null);
  const meinUid = auth.currentUser?.uid;

  useEffect(() => {
    const q = query(
      collection(db, 'fahrten', fahrtId, 'nachrichten'),
      orderBy('erstelltAm', 'asc')
    );
    return onSnapshot(q, (snap) => {
      const neu = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Nachricht));
      setNachrichten((prev) => {
        const letzte = neu[neu.length - 1];
        if (letzte && prev.length < neu.length && letzte.senderId !== meinUid) {
          spieleTon.nachricht();
        }
        return neu;
      });
    });
  }, [fahrtId]);

  const senden = async () => {
    const text = eingabe.trim();
    if (!text) return;
    setEingabe('');
    await addDoc(collection(db, 'fahrten', fahrtId, 'nachrichten'), {
      text,
      senderId: meinUid,
      rolle,
      erstelltAm: serverTimestamp(),
    });
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.header}>
        <Text style={styles.headerTitel}>{t('chat.titel')}</Text>
        <TouchableOpacity onPress={onSchliessen} style={styles.schliessenButton}>
          <Text style={styles.schliessenText}>✕</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <FlatList
          ref={listRef}
          data={nachrichten}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          contentContainerStyle={styles.liste}
          renderItem={({ item }) => {
            const meine = item.senderId === meinUid;
            return (
              <View style={[styles.bubble, meine ? styles.meineBubble : styles.andereBubble]}>
                <Text style={[styles.bubbleText, meine ? styles.meineText : styles.andereText]}>
                  {item.text}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.leer}>{t('chat.keineNachrichten')}</Text>
          }
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={eingabe}
            onChangeText={setEingabe}
            placeholder={t('chat.nachricht')}
            placeholderTextColor="#999"
            onSubmitEditing={senden}
            returnKeyType="send"
          />
          <TouchableOpacity style={styles.sendenButton} onPress={senden}>
            <Text style={styles.sendenText}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    zIndex: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTitel: { fontSize: 18, fontWeight: 'bold', color: '#FFD700' },
  schliessenButton: { padding: 4 },
  schliessenText: { fontSize: 20, color: '#fff' },
  body: { flex: 1 },
  liste: { padding: 16, gap: 8, flexGrow: 1 },
  leer: { textAlign: 'center', color: '#aaa', marginTop: 40, fontSize: 14 },
  bubble: { maxWidth: '75%', borderRadius: 18, padding: 12, marginBottom: 4 },
  meineBubble: { alignSelf: 'flex-end', backgroundColor: '#FFD700' },
  andereBubble: { alignSelf: 'flex-start', backgroundColor: '#f0f0f0' },
  bubbleText: { fontSize: 15 },
  meineText: { color: '#000' },
  andereText: { color: '#333' },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 32,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#000',
  },
  sendenButton: {
    backgroundColor: '#FFD700',
    borderRadius: 24,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendenText: { fontSize: 18, color: '#000' },
});
