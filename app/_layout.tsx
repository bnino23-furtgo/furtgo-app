import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { auth } from '@/constants/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { initI18n } from '@/i18n';

const isExpoGo = Constants.executionEnvironment === 'storeClient';
let Notifications: typeof import('expo-notifications') | null = null;
if (Platform.OS !== 'web' && !isExpoGo) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [laden, setLaden] = useState(true);
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
  }, []);

  // Tap auf Push-Notification → zur Fahrer-Seite navigieren
  useEffect(() => {
    if (!Notifications) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { fahrtId?: string } | undefined;
      if (!data?.fahrtId) return;
      // Wichtig: replace (nicht push), sonst stapelt sich eine zweite Fahrer-Instanz
      // mit eigenem Snapshot-Listener → doppeltes Anfrage-Modal.
      router.replace('/fahrer');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const navigate = (eingeloggt: boolean) => {
      setLaden(false);
      setTimeout(() => {
        if (eingeloggt) {
          router.replace('/(tabs)');
        } else {
          router.replace('/login');
        }
      }, 200);
    };

    console.log('AUTH START', auth);

    // Sicherheits-Timeout: nach 6 Sekunden zu Login
    const timeout = setTimeout(() => {
      console.log('TIMEOUT FIRED');
      navigate(false);
    }, 6000);

    let unsubscribe = () => {};
    let letzterStatus: boolean | null = null;
    try {
      unsubscribe = onAuthStateChanged(auth, (user) => {
        console.log('AUTH STATE CHANGED', user?.email);
        const eingeloggt = !!user && user.emailVerified;
        if (letzterStatus === eingeloggt) return;
        letzterStatus = eingeloggt;
        clearTimeout(timeout);
        navigate(eingeloggt);
      });
    } catch (e) {
      console.log('AUTH ERROR', e);
      clearTimeout(timeout);
      navigate(false);
    }

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (laden || !i18nReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar style="light" backgroundColor="#FFD700" />
        <ActivityIndicator size="large" color="#FFD700" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StatusBar style="light" backgroundColor="#FFD700" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="fahrer/index" />
          <Stack.Screen name="fahrer/fahrt" />
          <Stack.Screen name="fahrer/dokumente" />
          <Stack.Screen name="fahrer/einstellungen" />
          <Stack.Screen name="fahrgast/index" />
          <Stack.Screen name="fahrgast/fahrt" />
          <Stack.Screen name="fahrgast/suchen" />
          <Stack.Screen name="verlauf" />
          <Stack.Screen name="profil" />
          <Stack.Screen name="admin" />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
