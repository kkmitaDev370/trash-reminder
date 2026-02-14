import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import { Calendar } from 'react-native-calendars';
import { auth, db, isFirebaseConfigured, loginUser, registerUser } from './firebase';

type TrashEvent = {
  id: string;
  date: string;
  wasteType: string;
  notificationId?: string;
};

type HouseholdJoinResult = {
  householdId: string;
  secretCode: string;
};

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

const normalizeCode = (value: string) => value.trim().toUpperCase();

const createSecretCode = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [householdInviteCode, setHouseholdInviteCode] = useState('');

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userUid, setUserUid] = useState<string | null>(null);

  const [currentHouseholdId, setCurrentHouseholdId] = useState<string | null>(null);
  const [householdSecretCode, setHouseholdSecretCode] = useState<string>('');

  const [eventDate, setEventDate] = useState('');
  const [wasteType, setWasteType] = useState('Zmieszane');
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [modalError, setModalError] = useState('');
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [events, setEvents] = useState<TrashEvent[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(false);

  const markedDates = useMemo(() => {
    const marks: Record<
      string,
      {
        selected?: boolean;
        selectedColor?: string;
        marked?: boolean;
        dotColor?: string;
      }
    > = {};

    for (const item of events) {
      marks[item.date] = {
        ...(marks[item.date] ?? {}),
        marked: true,
        dotColor: '#38bdf8',
      };
    }

    if (eventDate) {
      marks[eventDate] = {
        ...(marks[eventDate] ?? {}),
        selected: true,
        selectedColor: '#22c55e',
        marked: true,
        dotColor: '#38bdf8',
      };
    }

    return marks;
  }, [eventDate, events]);

  const notify = (title: string, message?: string) => {
    const text = message ? `${title}: ${message}` : title;

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(text);
      }
      return;
    }

    Alert.alert(title, message);
  };

  const parseAuthErrorMessage = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);

    if (raw.includes('auth/invalid-email')) {
      return 'Niepoprawny adres email (przykład: jan@example.com).';
    }
    if (raw.includes('auth/email-already-in-use')) {
      return 'Ten email jest już zarejestrowany.';
    }
    if (raw.includes('auth/weak-password')) {
      return 'Hasło jest za słabe (minimum 6 znaków).';
    }
    if (raw.includes('auth/invalid-credential') || raw.includes('auth/user-not-found')) {
      return 'Nieprawidłowy email lub hasło.';
    }

    return raw;
  };

  const saveUserHousehold = async (
    uid: string,
    userMail: string | null,
    householdId: string
  ) => {
    if (!db) {
      return;
    }

    await setDoc(
      doc(db, 'users', uid),
      {
        householdId,
        email: userMail ?? '',
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  };

  const createHouseholdForUser = async (
    uid: string,
    userMail: string | null
  ): Promise<HouseholdJoinResult> => {
    if (!db) {
      throw new Error('Firebase nie jest skonfigurowany.');
    }

    const householdRef = doc(collection(db, 'households'));
    const secretCode = createSecretCode();

    await setDoc(householdRef, {
      secretCode,
      members: [uid],
      memberEmails: userMail ? [userMail] : [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    return {
      householdId: householdRef.id,
      secretCode,
    };
  };

  const joinHouseholdByCode = async (
    uid: string,
    userMail: string | null,
    code: string
  ): Promise<HouseholdJoinResult | null> => {
    if (!db) {
      throw new Error('Firebase nie jest skonfigurowany.');
    }

    const codeQuery = query(
      collection(db, 'households'),
      where('secretCode', '==', code),
      limit(1)
    );

    const snapshot = await getDocs(codeQuery);
    if (snapshot.empty) {
      return null;
    }

    const householdDoc = snapshot.docs[0];
    const householdRef = doc(db, 'households', householdDoc.id);

    const membershipPayload: {
      members: ReturnType<typeof arrayUnion>;
      updatedAt: Timestamp;
      memberEmails?: ReturnType<typeof arrayUnion>;
    } = {
      members: arrayUnion(uid),
      updatedAt: Timestamp.now(),
    };

    if (userMail) {
      membershipPayload.memberEmails = arrayUnion(userMail);
    }

    await setDoc(householdRef, membershipPayload, { merge: true });

    return {
      householdId: householdDoc.id,
      secretCode: code,
    };
  };

  const ensureUserHousehold = async (uid: string, userMail: string | null) => {
    if (!db) {
      return;
    }

    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data() as { householdId?: string };
      if (data.householdId) {
        setCurrentHouseholdId(data.householdId);

        const householdRef = doc(db, 'households', data.householdId);
        const householdSnap = await getDoc(householdRef);
        if (householdSnap.exists()) {
          const householdData = householdSnap.data() as { secretCode?: string };
          setHouseholdSecretCode(householdData.secretCode ?? '');
        }

        return;
      }
    }

    const created = await createHouseholdForUser(uid, userMail);
    await saveUserHousehold(uid, userMail, created.householdId);
    setCurrentHouseholdId(created.householdId);
    setHouseholdSecretCode(created.secretCode);
  };

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setUserEmail(user?.email ?? null);
      setUserUid(user?.uid ?? null);
      if (!user) {
        setCurrentHouseholdId(null);
        setHouseholdSecretCode('');
        setEvents([]);
      }
    });

    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (!db || !userUid) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await ensureUserHousehold(userUid, userEmail);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Nie udało się załadować gospodarstwa.';
          notify('Błąd', message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userUid, userEmail]);

  useEffect(() => {
    if (!isFirebaseConfigured || !db || !userUid || !currentHouseholdId) {
      setEvents([]);
      setIsEventsLoading(false);
      return;
    }

    const householdRef = doc(db, 'households', currentHouseholdId);
    let unsubscribe = () => {};
    let isMounted = true;
    setIsEventsLoading(true);

    (async () => {
      try {
        const membershipPayload: {
          members: ReturnType<typeof arrayUnion>;
          updatedAt: Timestamp;
          memberEmails?: ReturnType<typeof arrayUnion>;
        } = {
          members: arrayUnion(userUid),
          updatedAt: Timestamp.now(),
        };

        if (userEmail) {
          membershipPayload.memberEmails = arrayUnion(userEmail);
        }

        await setDoc(householdRef, membershipPayload, { merge: true });

        const householdSnap = await getDoc(householdRef);
        if (householdSnap.exists() && isMounted) {
          const data = householdSnap.data() as { secretCode?: string };
          setHouseholdSecretCode(data.secretCode ?? '');
        }

        const eventsRef = collection(householdRef, 'events');
        const q = query(eventsRef, orderBy('date', 'asc'));

        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            const loaded: TrashEvent[] = snapshot.docs.map((item) => {
              const data = item.data() as {
                date: string;
                wasteType: string;
                notificationId?: string;
              };

              return {
                id: item.id,
                date: data.date,
                wasteType: data.wasteType,
                notificationId: data.notificationId,
              };
            });

            setEvents(loaded);
            setIsEventsLoading(false);
          },
          () => {
            setIsEventsLoading(false);
            notify('Błąd', 'Brak dostępu do danych gospodarstwa.');
          }
        );
      } catch (error) {
        setIsEventsLoading(false);
        const message = error instanceof Error ? error.message : 'Nie udało się załadować wydarzeń.';
        notify('Błąd', message);
      }
    })();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [currentHouseholdId, userUid, userEmail]);

  const requestNotificationsPermission = async () => {
    if (Platform.OS === 'web') {
      return false;
    }

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  };

  const scheduleDayBeforeNotification = async (date: string, type: string) => {
    const [year, month, day] = date.split('-').map(Number);

    if (!year || !month || !day) {
      return undefined;
    }

    const triggerDate = new Date(year, month - 1, day);
    triggerDate.setDate(triggerDate.getDate() - 1);
    triggerDate.setHours(19, 0, 0, 0);

    if (triggerDate <= new Date()) {
      return undefined;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('trash-reminders', {
        name: 'Trash reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    return Notifications.scheduleNotificationAsync({
      content: {
        title: `Jutro odbiór: ${type}`,
        body: `Jutro (${date}) odbiór: ${type}`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: Platform.OS === 'android' ? 'trash-reminders' : undefined,
      },
    });
  };

  const onRegister = async () => {
    const normalizedEmail = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      notify('Błąd rejestracji', 'Podaj poprawny adres email (np. jan@example.com).');
      return;
    }

    if (password.length < 6) {
      notify('Błąd rejestracji', 'Hasło musi mieć co najmniej 6 znaków.');
      return;
    }

    if (!db) {
      notify('Błąd', 'Firebase nie jest skonfigurowany.');
      return;
    }

    try {
      const credential = await registerUser(normalizedEmail, password);
      const uid = credential.user.uid;
      const registeredEmail = credential.user.email ?? normalizedEmail;
      const inputCode = normalizeCode(householdInviteCode);

      let assignment: HouseholdJoinResult;

      if (inputCode) {
        const joined = await joinHouseholdByCode(uid, registeredEmail, inputCode);

        if (!joined) {
          try {
            await credential.user.delete();
          } catch {
            // no-op
          }
          notify('Błąd rejestracji', 'Nie znaleziono gospodarstwa dla podanego kodu.');
          return;
        }

        assignment = joined;
      } else {
        assignment = await createHouseholdForUser(uid, registeredEmail);
      }

      await saveUserHousehold(uid, registeredEmail, assignment.householdId);

      setUserEmail(registeredEmail);
      setUserUid(uid);
      setCurrentHouseholdId(assignment.householdId);
      setHouseholdSecretCode(assignment.secretCode);
      setHouseholdInviteCode('');
    } catch (error) {
      notify('Błąd rejestracji', parseAuthErrorMessage(error));
    }
  };

  const onLogin = async () => {
    const normalizedEmail = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      notify('Błąd logowania', 'Podaj poprawny adres email (np. jan@example.com).');
      return;
    }

    try {
      await loginUser(normalizedEmail, password);
    } catch (error) {
      notify('Błąd logowania', parseAuthErrorMessage(error));
    }
  };

  const onLogout = async () => {
    if (!auth) {
      return;
    }

    await signOut(auth);
  };

  const onAddEvent = async () => {
    const normalizedDate = eventDate.trim();
    const normalizedType = wasteType.trim();

    if (!normalizedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const message = 'Data musi mieć format YYYY-MM-DD.';
      setModalError(message);
      notify('Błąd', message);
      return false;
    }

    if (!normalizedType) {
      const message = 'Podaj typ śmieci.';
      setModalError(message);
      notify('Błąd', message);
      return false;
    }

    if (!currentHouseholdId) {
      const message = 'Brak przypisanego gospodarstwa.';
      setModalError(message);
      notify('Błąd', message);
      return false;
    }

    if (!userUid) {
      const message = 'Brak danych użytkownika. Zaloguj się ponownie.';
      setModalError(message);
      notify('Błąd', message);
      return false;
    }

    try {
      if (!db) {
        const message = 'Firebase nie jest skonfigurowany.';
        setModalError(message);
        notify('Błąd', message);
        return false;
      }

      const hasPermission = await requestNotificationsPermission();
      const notificationId = hasPermission
        ? await scheduleDayBeforeNotification(normalizedDate, normalizedType)
        : undefined;

      const householdRef = doc(db, 'households', currentHouseholdId);
      const eventsRef = collection(householdRef, 'events');

      const eventPayload: {
        date: string;
        wasteType: string;
        createdAt: Timestamp;
        householdId: string;
        createdByUid: string;
        createdByEmail?: string;
        notificationId?: string;
      } = {
        date: normalizedDate,
        wasteType: normalizedType,
        createdAt: Timestamp.now(),
        householdId: currentHouseholdId,
        createdByUid: userUid,
      };

      if (userEmail) {
        eventPayload.createdByEmail = userEmail;
      }

      if (notificationId) {
        eventPayload.notificationId = notificationId;
      }

      const docRef = await addDoc(eventsRef, eventPayload);

      setEvents((previous) => {
        const next = [
          ...previous.filter((item) => item.id !== docRef.id),
          {
            id: docRef.id,
            date: normalizedDate,
            wasteType: normalizedType,
            notificationId,
          },
        ];

        return next.sort((left, right) => left.date.localeCompare(right.date));
      });

      setEventDate('');
      setWasteType('Zmieszane');
      setModalError('');
      return true;
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Nie udało się dodać wydarzenia.';
      if (message.includes('permission-denied') || message.includes('Missing or insufficient permissions')) {
        message = 'Brak uprawnień Firestore. Sprawdź reguły bazy.';
      }

      setModalError(message);
      notify('Błąd', message);
      return false;
    }
  };

  const onCalendarDayPress = (day: { dateString: string }) => {
    setEventDate(day.dateString);
    setWasteType('Zmieszane');
    setModalError('');
    setShowWasteModal(true);
  };

  const onConfirmWasteType = async () => {
    if (isSavingEvent) {
      return;
    }

    setIsSavingEvent(true);
    const saved = await onAddEvent();
    setIsSavingEvent(false);

    if (saved) {
      setShowWasteModal(false);
    }
  };

  const onDeleteEvent = async (item: TrashEvent) => {
    try {
      if (!db || !currentHouseholdId) {
        notify('Błąd', 'Firebase nie jest skonfigurowany.');
        return;
      }

      if (item.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(item.notificationId);
      }

      await deleteDoc(doc(db, 'households', currentHouseholdId, 'events', item.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nie udało się usunąć wydarzenia.';
      notify('Błąd', message);
    }
  };

  if (!isFirebaseConfigured) {
    return (
      <View style={styles.container}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>Brak konfiguracji Firebase</Text>
          <Text style={styles.subtitle}>
            Uzupełnij EXPO_PUBLIC_FIREBASE_* w .env i zrestartuj Expo.
          </Text>
        </View>
      </View>
    );
  }

  if (!userEmail) {
    return (
      <View style={styles.container}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>Śmieci App — logowanie</Text>
          <Text style={styles.subtitle}>Zaloguj się lub załóż konto dla gospodarstwa.</Text>
        </View>

        <View style={styles.card}>
          <TextInput
            placeholder="Email"
            placeholderTextColor="#64748b"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            placeholder="Hasło"
            placeholderTextColor="#64748b"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
          />
          <TextInput
            placeholder="Tajny kod gospodarstwa (opcjonalnie przy rejestracji)"
            placeholderTextColor="#64748b"
            value={householdInviteCode}
            onChangeText={setHouseholdInviteCode}
            autoCapitalize="characters"
            style={styles.input}
          />

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onRegister}>
              <Text style={styles.secondaryButtonText}>Zarejestruj</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={onLogin}>
              <Text style={styles.primaryButtonText}>Zaloguj</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.hamburgerButton}
          onPress={() => setShowMenuModal(true)}
        >
          <Text style={styles.hamburgerIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Wspólny kalendarz śmieci</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Kalendarz</Text>
        <Calendar
          onDayPress={onCalendarDayPress}
          markedDates={markedDates}
          theme={{
            calendarBackground: 'transparent',
            textSectionTitleColor: '#94a3b8',
            dayTextColor: '#e5e7eb',
            monthTextColor: '#e5e7eb',
            arrowColor: '#22c55e',
            todayTextColor: '#38bdf8',
            selectedDayTextColor: '#ffffff',
          }}
          style={styles.calendar}
        />

        <Text style={styles.selectedDateLabel}>
          Kliknij dzień w kalendarzu, aby dodać odbiór śmieci.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Zaplanowane odbiory</Text>
        {isEventsLoading ? (
          <View style={styles.loaderBox}>
            <ActivityIndicator size="small" color="#38bdf8" />
            <Text style={styles.loaderText}>Wczytywanie powiadomień...</Text>
          </View>
        ) : (
          <FlatList
            data={events}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={<Text style={styles.muted}>Brak wydarzeń</Text>}
            renderItem={({ item }) => (
              <View style={styles.eventRow}>
                <View style={styles.eventContent}>
                  <Text style={styles.eventText}>{item.date}</Text>
                  <Text style={styles.muted}>{item.wasteType}</Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => onDeleteEvent(item)}
                >
                  <Text style={styles.deleteButtonText}>Usuń</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      <Modal
        visible={showWasteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWasteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Dodaj odbiór śmieci</Text>
            <Text style={styles.modalSubtitle}>Data: {eventDate}</Text>

            <TextInput
              value={wasteType}
              onChangeText={setWasteType}
              placeholder="Rodzaj śmieci"
              placeholderTextColor="#64748b"
              style={styles.input}
            />

            {modalError ? <Text style={styles.modalError}>{modalError}</Text> : null}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setShowWasteModal(false)}
              >
                <Text style={styles.secondaryButtonText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, isSavingEvent && styles.disabledButton]}
                onPress={onConfirmWasteType}
                disabled={isSavingEvent}
              >
                <Text style={styles.primaryButtonText}>{isSavingEvent ? 'Zapisywanie...' : 'Zapisz'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showMenuModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenuModal(false)}
      >
        <View style={styles.menuOverlay}>
          <TouchableOpacity
            style={styles.menuBackdrop}
            onPress={() => setShowMenuModal(false)}
          />
          <View style={styles.menuPanel}>
            <Text style={styles.menuTitle}>Konto</Text>
            <View style={styles.menuUserBox}>
              <Text style={styles.menuUserLabel}>Zalogowany użytkownik</Text>
              <Text style={styles.menuUserEmail}>{userEmail}</Text>
            </View>
            <View style={styles.menuUserBox}>
              <Text style={styles.menuUserLabel}>Tajny kod gospodarstwa</Text>
              <Text style={styles.menuSecretCode}>{householdSecretCode || '—'}</Text>
            </View>
            <TouchableOpacity
              style={styles.menuLogoutButton}
              onPress={async () => {
                setShowMenuModal(false);
                await onLogout();
              }}
            >
              <Text style={styles.menuLogoutText}>Wyloguj</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 14,
    backgroundColor: '#0b1220',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburgerIcon: {
    color: '#f8fafc',
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '700',
  },
  topBarTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    flexShrink: 1,
  },
  headerCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
    color: '#f8fafc',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  muted: {
    color: '#94a3b8',
  },
  sectionTitle: {
    color: '#e5e7eb',
    fontWeight: '600',
    marginBottom: 10,
  },
  calendar: {
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 10,
  },
  selectedDateLabel: {
    color: '#94a3b8',
    marginBottom: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    color: '#e5e7eb',
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#22c55e',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.65,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#e5e7eb',
    fontWeight: '700',
  },
  eventRow: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  eventContent: {
    flex: 1,
  },
  eventText: {
    fontWeight: '600',
    color: '#f8fafc',
  },
  loaderBox: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loaderText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  deleteButton: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 10,
  },
  deleteButtonText: {
    color: '#fecaca',
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSubtitle: {
    color: '#94a3b8',
    marginBottom: 12,
  },
  modalError: {
    color: '#fca5a5',
    marginBottom: 8,
    fontSize: 12,
  },
  menuOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(2, 6, 23, 0.6)',
  },
  menuBackdrop: {
    flex: 1,
  },
  menuPanel: {
    width: '78%',
    maxWidth: 320,
    backgroundColor: '#0f172a',
    borderRightWidth: 1,
    borderRightColor: '#1f2937',
    paddingTop: 32,
    paddingHorizontal: 16,
    gap: 14,
  },
  menuTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
  },
  menuUserBox: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#111827',
  },
  menuUserLabel: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 4,
  },
  menuUserEmail: {
    color: '#f8fafc',
    fontWeight: '600',
  },
  menuSecretCode: {
    color: '#22c55e',
    fontWeight: '700',
    letterSpacing: 1,
  },
  menuLogoutButton: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  menuLogoutText: {
    color: '#fecaca',
    fontWeight: '700',
  },
});
