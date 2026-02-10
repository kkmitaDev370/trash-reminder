# Konfiguracja Firebase dla Harmonogram Śmieci

## 1. Utwórz projekt Firebase

1. Przejdź na [Firebase Console](https://console.firebase.google.com/)
2. Kliknij **Add project** (Dodaj projekt)
3. Nazwij projekt np. `trash-reminder-app`
4. Wyłącz Google Analytics (opcjonalnie)
5. Kliknij **Create project**

## 2. Dodaj aplikację internetową (Web App)

1. W panelu projektu kliknij ikonę **Web** (`</>`)
2. Nadaj nazwę aplikacji (np. `Harmonogram Śmieci`)
3. **NIE zaznaczaj** "Also set up Firebase Hosting"
4. Kliknij **Register app**
5. Skopiuj konfigurację Firebase (obiekt `firebaseConfig`)

## 3. Zaktualizuj plik firebaseConfig.ts

Otwórz plik `firebaseConfig.ts` i zastąp dane konfiguracyjne swoimi:

```typescript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "trash-reminder-app.firebaseapp.com",
  projectId: "trash-reminder-app",
  storageBucket: "trash-reminder-app.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

## 4. Włącz Authentication

1. W Firebase Console, przejdź do **Authentication** → **Get started**
2. Zakładka **Sign-in method**
3. Włącz:
   - **Email/Password** - zaznacz "Enable" i zapisz
   - **Anonymous** - zaznacz "Enable" i zapisz

## 5. Utwórz bazę Firestore

1. Przejdź do **Firestore Database** → **Create database**
2. Wybierz **Start in production mode**
3. Wybierz lokalizację (np. `europe-west3` dla Europy)
4. Kliknij **Enable**

## 6. Skonfiguruj reguły Firestore

Przejdź do zakładki **Rules** i wklej poniższe reguły:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Przypomnienia mogą być odczytywane przez właściciela lub osoby, którym udostępniono
    match /reminders/{reminderId} {
      allow read: if request.auth != null && (
        resource.data.userId == request.auth.uid ||
        resource.data.shareWith.hasAny([request.auth.token.email])
      );
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
  }
}
```

Kliknij **Publish** aby zapisać reguły.

## 7. Testowanie

1. Uruchom aplikację: `npx expo start`
2. Zarejestruj nowe konto lub zaloguj się anonimowo
3. Dodaj przypomnienie - zostanie zapisane w Firestore
4. Możesz udostępnić przypomnienie innemu użytkownikowi podając jego email

## Struktura danych w Firestore

### Kolekcja `reminders`:
```
{
  userId: string,           // UID użytkownika
  date: string,             // Data odbioru (YYYY-MM-DD)
  type: string,             // Rodzaj śmieci
  time: string,             // Godzina przypomnienia
  notificationId: string,   // ID powiadomienia
  shareWith: string[],      // Tablica emaili użytkowników
  createdAt: string         // Data utworzenia
}
```

## Bezpieczeństwo

⚠️ **WAŻNE**: Nigdy nie commituj pliku `firebaseConfig.ts` z prawdziwymi danymi do publicznego repozytorium!

Dodaj do `.gitignore`:
```
firebaseConfig.ts
```

## Troubleshooting

**Problem**: "Firebase: Error (auth/email-already-in-use)"
- Ten email jest już zarejestrowany. Użyj opcji logowania.

**Problem**: "Missing or insufficient permissions"
- Sprawdź reguły Firestore w Firebase Console
- Upewnij się, że użytkownik jest zalogowany

**Problem**: Przypomnienia nie pojawiają się
- Sprawdź czy użytkownik jest zalogowany
- Otwórz Firebase Console → Firestore i sprawdź czy dane są zapisywane
- Sprawdź konsolę w terminalu po błędy
