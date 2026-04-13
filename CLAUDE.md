# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Start Expo dev server
npm run android    # Run on Android emulator
npm run ios        # Run on iOS simulator
npm run web        # Run in browser
npm run lint       # Run ESLint
```

**Building for distribution (EAS):**
```bash
eas build --profile preview --platform android   # APK for testing
eas build --profile production --platform android # AAB for Play Store
```

## Architecture Overview

**Stack:** Expo 54 + React Native 0.81.5 + TypeScript, file-based routing via `expo-router`, Firebase backend (Auth + Firestore).

**App name in production:** Furtgo (Android package: `com.nino.furtgo`)

### Role-Based Flow

The app has three roles — **Fahrgast** (passenger), **Fahrer** (driver), **Admin** — selected from `app/(tabs)/index.tsx` after login. Each role has its own screen subtree under `app/fahrgast/` and `app/fahrer/`. Admin is PIN-protected in `app/admin.tsx`.

### Routing Structure

```
app/
├── _layout.tsx          # Root: checks Firebase auth state (6s timeout), redirects to login or tabs
├── login.tsx            # Firebase email/password auth + password reset
├── (tabs)/index.tsx     # Role selection screen
├── fahrer/              # Driver: dashboard, active ride, document verification
├── fahrgast/            # Passenger: request ride, active ride tracking, address search
├── admin.tsx            # Driver verification panel
├── profil.tsx           # Profile/settings
└── verlauf.tsx          # Ride history
```

### Firebase

Config lives in `constants/firebase.ts` — exports `auth` and `db` (Firestore).

- **Auth:** email/password, in-memory persistence (no local storage)
- **Firestore collections:** `fahrer`, `fahrgast`, `fahrten`, `nachrichten` (subcollection on `fahrten`)
- **Real-time:** `onSnapshot()` listeners used throughout for live ride status, driver location, and chat
- **Rules:** `firestore.rules` — currently allows any authenticated user full read/write

### Platform-Specific Maps

Maps use the `.native.tsx` / `.web.tsx` extension pattern:
- `components/MapComponent.native.tsx` — `react-native-maps` with Google Maps
- `components/MapComponent.web.tsx` — Leaflet.js (OpenStreetMap)

Import `MapComponent` and Expo's bundler resolves the right file automatically.

### Key Utilities & Constants

| Path | Purpose |
|---|---|
| `constants/firebase.ts` | Firebase init, `auth`, `db` exports |
| `constants/theme.ts` | Colors and fonts |
| `types/index.ts` | Shared TypeScript types (`Fahrt`, `FahrerProfil`, `KoordType`, `OrtType`) |
| `utils/distanz.ts` | Haversine distance calculation |
| `utils/ton.ts` | Audio playback (5 sound types via `expo-audio`) |

### Address Search

`components/AdressSuche.tsx` uses the OpenStreetMap Nominatim API (no key required) with a 500ms debounce. Returns address + lat/lng.

### Pricing Logic

Calculated inline in the passenger/driver screens: base fare **€3.50** + **€2.20/km** using the Haversine formula from `utils/distanz.ts`.

### Path Alias

`@/*` maps to the repo root (configured in `tsconfig.json`). Use `@/constants/firebase` instead of relative paths.

### Google Maps API Key

Defined in `app.json` under `android.config.googleMaps.apiKey`. Required for `react-native-maps` on Android.

### Language

All UI text and most variable/function names are in **German**.
