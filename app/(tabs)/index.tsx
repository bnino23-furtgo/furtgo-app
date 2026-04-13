import React, { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/constants/firebase';

export default function Rollenweiterleitung() {
  const [geprüft, setGeprüft] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/login' as any);
      return;
    }
    getDoc(doc(db, 'nutzer', uid)).then((snap) => {
      const rolle = snap.data()?.rolle ?? 'fahrgast';
      if (rolle === 'fahrer') {
        router.replace('/fahrer' as any);
      } else {
        router.replace('/fahrgast' as any);
      }
    }).catch(() => {
      router.replace('/fahrgast' as any);
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color="#FFD700" size="large" />
    </View>
  );
}
