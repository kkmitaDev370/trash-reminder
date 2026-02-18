import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged, signOut } from "firebase/auth";
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
} from "firebase/firestore";
import * as Notifications from "expo-notifications";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Calendar, LocaleConfig } from "react-native-calendars";
// Ustawienia polskiej lokalizacji dla kalendarza
LocaleConfig.locales['pl'] = {
  monthNames: [
    'Styczeń',
    'Luty',
    'Marzec',
    'Kwiecień',
    'Maj',
    'Czerwiec',
    'Lipiec',
    'Sierpień',
    'Wrzesień',
    'Październik',
    'Listopad',
    'Grudzień',
  ],
  monthNamesShort: [
    'Sty',
    'Lut',
    'Mar',
    'Kwi',
    'Maj',
    'Cze',
    'Lip',
    'Sie',
    'Wrz',
    'Paź',
    'Lis',
    'Gru',
  ],
  dayNames: [
    'Niedziela',
    'Poniedziałek',
    'Wtorek',
    'Środa',
    'Czwartek',
    'Piątek',
    'Sobota',
  ],
  dayNamesShort: [
    'Nd',
    'Pn',
    'Wt',
    'Śr',
    'Cz',
    'Pt',
    'Sb',
  ],
  today: 'Dziś',
};
LocaleConfig.defaultLocale = 'pl';
import {
  auth,
  db,
  isFirebaseConfigured,
  loginUser,
  registerUser,
} from "./firebase";

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

if (Platform.OS !== "web") {
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

const isValidTimeHHmm = (value: string) =>
  /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

const POPULAR_WASTE_TYPES = [
  "Zmieszane",
  "Plastik i metal",
  "Papier",
  "Szkło",
  "Bio",
  "Gabaryty",
  "Elektroodpady",
  "Inne",
];

const MIXED_WASTE_DAY_COLOR = "#7c3aed";
const SESSION_CREDENTIALS_KEY = "trash_reminder_session_credentials_v1";
const SESSION_TOKEN_KEY = "trash_reminder_session_token_v1";

const getWasteTypeColor = (wasteType: string) => {
  const normalized = wasteType.trim().toLowerCase();

  if (normalized.includes("zmiesz")) return "#475569";
  if (normalized.includes("plastik") || normalized.includes("metal"))
    return "#f59e0b";
  if (normalized.includes("papier")) return "#3b82f6";
  if (normalized.includes("szk")) return "#14b8a6";
  if (normalized.includes("bio")) return "#16a34a";
  if (normalized.includes("gabary")) return "#a855f7";
  if (normalized.includes("elektro")) return "#ef4444";

  return "#6366f1";
};

export default function App() {
    // Pokazuj wersję tylko dla buildów deweloperskich
    const isDevBuild =
      Constants.executionEnvironment === 'storeClient' // Expo Go
      || (Constants.manifest2?.extra?.eas?.buildProfile &&
        ['development', 'preview', 'previewLight'].includes(Constants.manifest2.extra.eas.buildProfile))
      || (__DEV__ === true);
  const isSigningOutRef = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdInviteCode, setHouseholdInviteCode] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  const emailRef = useRef<any>(null);
  const passwordRef = useRef<any>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [notificationTime, setNotificationTime] = useState("19:00");
  const [notificationTimeInput, setNotificationTimeInput] = useState("19:00");
  const [isSavingNotificationTime, setIsSavingNotificationTime] =
    useState(false);
  const [isSendingTestNotification, setIsSendingTestNotification] =
    useState(false);

  const [currentHouseholdId, setCurrentHouseholdId] = useState<string | null>(
    null,
  );
  const [householdSecretCode, setHouseholdSecretCode] = useState<string>("");

  const [eventDate, setEventDate] = useState("");
  const [selectedWasteType, setSelectedWasteType] = useState("Zmieszane");
  const [customWasteType, setCustomWasteType] = useState("");
  const [isWasteTypeDropdownOpen, setIsWasteTypeDropdownOpen] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [modalError, setModalError] = useState("");
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [events, setEvents] = useState<TrashEvent[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(false);
  const [isSessionBootstrapping, setIsSessionBootstrapping] = useState(
    Platform.OS !== "web",
  );
  const [autoLoginStatus, setAutoLoginStatus] = useState("idle");
  const [autoLoginError, setAutoLoginError] = useState("");
  const [sessionDebugInfo, setSessionDebugInfo] = useState<{
    tokenPreview: string;
    hasCredentials: boolean;
    savedEmail: string;
    hasPassword: boolean;
    firebaseUid: string;
    firebaseEmail: string;
    autoLoginStatus: string;
    autoLoginError: string;
  }>({
    tokenPreview: "—",
    hasCredentials: false,
    savedEmail: "—",
    hasPassword: false,
    firebaseUid: "—",
    firebaseEmail: "—",
    autoLoginStatus: "idle",
    autoLoginError: "—",
  });
  const [isSessionDebugLoading, setIsSessionDebugLoading] = useState(false);
  const isAuthenticated = Boolean(userUid);
  const appVersionLabel = (() => {
    const nativeVersion = Application.nativeApplicationVersion ?? "dev";
    const nativeBuild = Application.nativeBuildVersion ?? "dev";
    const otaVersion = Constants.expoConfig?.version;

    if (otaVersion && otaVersion !== nativeVersion) {
      return `v${otaVersion} • apk ${nativeVersion} (${nativeBuild})`;
    }

    return `v${nativeVersion} (${nativeBuild})`;
  })();

  const markedDates = useMemo(() => {
    const marks: Record<
      string,
      {
        selected?: boolean;
        selectedColor?: string;
        selectedTextColor?: string;
      }
    > = {};

    for (const item of events) {
      const eventColor = getWasteTypeColor(item.wasteType);
      const existingColor = marks[item.date]?.selectedColor;

      marks[item.date] = {
        ...(marks[item.date] ?? {}),
        selected: true,
        selectedColor:
          existingColor && existingColor !== eventColor
            ? MIXED_WASTE_DAY_COLOR
            : eventColor,
        selectedTextColor: "#ffffff",
      };
    }

    // Nie podświetlaj wybranego dnia na zielono po kliknięciu
    // if (eventDate) {
    //   marks[eventDate] = {
    //     ...(marks[eventDate] ?? {}),
    //     selected: true,
    //     selectedColor: marks[eventDate]?.selectedColor ?? "#22c55e",
    //     selectedTextColor: "#ffffff",
    //   };
    // }

    return marks;
  }, [eventDate, events]);

  const notify = (title: string, message?: string) => {
    const text = message ? `${title}: ${message}` : title;

    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert(text);
      }
      return;
    }

    Alert.alert(title, message);
  };

  const parseAuthErrorMessage = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);

    if (raw.includes("auth/invalid-email")) {
      return "Niepoprawny adres email (przykład: jan@example.com).";
    }
    if (raw.includes("auth/email-already-in-use")) {
      return "Ten email jest już zarejestrowany.";
    }
    if (raw.includes("auth/weak-password")) {
      return "Hasło jest za słabe (minimum 6 znaków).";
    }
    if (
      raw.includes("auth/invalid-credential") ||
      raw.includes("auth/user-not-found")
    ) {
      return "Nieprawidłowy email lub hasło.";
    }

    return raw;
  };

  const saveSessionCredentials = async (
    savedEmail: string,
    savedPassword: string,
    token?: string,
  ) => {
    if (Platform.OS === "web") {
      return;
    }

    await AsyncStorage.setItem(
      SESSION_CREDENTIALS_KEY,
      JSON.stringify({ email: savedEmail, password: savedPassword }),
    );

    const normalizedToken = typeof token === "string" ? token.trim() : "";
    const sessionToken =
      normalizedToken ||
      `session_${savedEmail}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    await AsyncStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
  };

  const clearSessionCredentials = async () => {
    if (Platform.OS === "web") {
      return;
    }

    await AsyncStorage.multiRemove([
      SESSION_CREDENTIALS_KEY,
      SESSION_TOKEN_KEY,
    ]);
  };

  const refreshSessionDebug = async () => {
    if (Platform.OS === "web") {
      setSessionDebugInfo((previous) => ({
        ...previous,
        autoLoginStatus,
        autoLoginError: autoLoginError || "—",
      }));
      return;
    }

    setIsSessionDebugLoading(true);

    try {
      const [savedToken, rawCredentials] = await AsyncStorage.multiGet([
        SESSION_TOKEN_KEY,
        SESSION_CREDENTIALS_KEY,
      ]);

      const token = savedToken[1] ?? "";
      const raw = rawCredentials[1] ?? "";
      const parsed = raw
        ? (JSON.parse(raw) as { email?: string; password?: string })
        : null;
      const firebaseUser = auth?.currentUser;

      setSessionDebugInfo({
        tokenPreview: token ? `${token.slice(0, 14)}...` : "BRAK",
        hasCredentials: Boolean(raw),
        savedEmail: parsed?.email?.trim() || "BRAK",
        hasPassword: Boolean(parsed?.password),
        firebaseUid: firebaseUser?.uid ?? "BRAK",
        firebaseEmail: firebaseUser?.email ?? "BRAK",
        autoLoginStatus,
        autoLoginError: autoLoginError || "—",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionDebugInfo((previous) => ({
        ...previous,
        autoLoginStatus,
        autoLoginError: message,
      }));
    } finally {
      setIsSessionDebugLoading(false);
    }
  };

  const saveUserHousehold = async (
    uid: string,
    userMail: string | null,
    householdId: string,
    reminderTime?: string,
  ) => {
    if (!db) {
      return;
    }

    await setDoc(
      doc(db, "users", uid),
      {
        householdId,
        email: userMail ?? "",
        ...(reminderTime ? { notificationTime: reminderTime } : {}),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  };

  const createHouseholdForUser = async (
    uid: string,
    userMail: string | null,
  ): Promise<HouseholdJoinResult> => {
    if (!db) {
      throw new Error("Firebase nie jest skonfigurowany.");
    }

    const householdRef = doc(collection(db, "households"));
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
    code: string,
  ): Promise<HouseholdJoinResult | null> => {
    if (!db) {
      throw new Error("Firebase nie jest skonfigurowany.");
    }

    const codeQuery = query(
      collection(db, "households"),
      where("secretCode", "==", code),
      limit(1),
    );

    const snapshot = await getDocs(codeQuery);
    if (snapshot.empty) {
      return null;
    }

    const householdDoc = snapshot.docs[0];
    const householdRef = doc(db, "households", householdDoc.id);

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

    try {
      await setDoc(householdRef, membershipPayload, { merge: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('permission-denied')) {
        throw new Error('Brak uprawnień do dołączenia do gospodarstwa (reguły Firestore).');
      }
      throw err;
    }

    return {
      householdId: householdDoc.id,
      secretCode: code,
    };
  };

  const ensureUserHousehold = async (uid: string, userMail: string | null) => {
    if (!db) {
      return;
    }

    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data() as {
        householdId?: string;
        notificationTime?: string;
      };

      if (data.notificationTime && isValidTimeHHmm(data.notificationTime)) {
        setNotificationTime(data.notificationTime);
        setNotificationTimeInput(data.notificationTime);
      }

      if (data.householdId) {
        setCurrentHouseholdId(data.householdId);

        const householdRef = doc(db, "households", data.householdId);
        const householdSnap = await getDoc(householdRef);
        if (householdSnap.exists()) {
          const householdData = householdSnap.data() as { secretCode?: string };
          setHouseholdSecretCode(householdData.secretCode ?? "");
        }

        return;
      }
    }

    // Jeśli użytkownik został już dopisany do gospodarstwa (np. joinHouseholdByCode
    // zadziałało wcześniej, ale /users/{uid} jeszcze nie zostało zaktualizowane),
    // znajdź takie gospodarstwo po polu `members` i użyj go zamiast tworzyć nowego.
    try {
      const membershipQuery = query(
        collection(db, "households"),
        where("members", "array-contains", uid),
        limit(1),
      );

      const membershipSnap = await getDocs(membershipQuery);
      if (!membershipSnap.empty) {
        const householdDoc = membershipSnap.docs[0];
        const hid = householdDoc.id;
        const hhData = householdDoc.data() as { secretCode?: string };

        // Zapisz householdId w dokumencie użytkownika (jeśli jeszcze nie ma)
        await saveUserHousehold(uid, userMail, hid, "19:00");

        setCurrentHouseholdId(hid);
        setHouseholdSecretCode(hhData.secretCode ?? "");
        return;
      }
    } catch (err) {
      // jeśli zapytanie nie powiedzie się — kontynuuj i utwórz nowe gospodarstwo
      // (nie blokujemy użytkownika przez błąd zapisu czy odczytu)
    }

    const created = await createHouseholdForUser(uid, userMail);
    await saveUserHousehold(uid, userMail, created.householdId, "19:00");
    setCurrentHouseholdId(created.householdId);
    setHouseholdSecretCode(created.secretCode);
    setNotificationTime("19:00");
    setNotificationTimeInput("19:00");
  };

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable || cancelled) {
          return;
        }

        await Updates.fetchUpdateAsync();
        if (!cancelled) {
          await Updates.reloadAsync();
        }
      } catch {
        // silent fallback: app continues with currently installed bundle
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setUserEmail(user?.email ?? null);
      setUserUid(user?.uid ?? null);
      if (user) {
        setIsSessionBootstrapping(false);
      }
      if (!user) {
        isSigningOutRef.current = false;
        setCurrentHouseholdId(null);
        setHouseholdSecretCode("");
        setEvents([]);
      }
    });

    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      setIsSessionBootstrapping(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setAutoLoginStatus("attempt");
      setAutoLoginError("");

      try {
        const [savedToken, rawCredentials] = await AsyncStorage.multiGet([
          SESSION_TOKEN_KEY,
          SESSION_CREDENTIALS_KEY,
        ]);

        const token = savedToken[1];
        const raw = rawCredentials[1];

        if (cancelled) {
          return;
        }

        if (!token || !raw) {
          setAutoLoginStatus("no-token");
          return;
        }

        const parsed = JSON.parse(raw) as { email?: string; password?: string };
        const savedEmail = parsed.email?.trim();
        const savedPassword = parsed.password ?? "";

        if (!savedEmail || !savedPassword) {
          await clearSessionCredentials();
          setAutoLoginStatus("missing-credentials");
          return;
        }

        await loginUser(savedEmail, savedPassword);
        setAutoLoginStatus("success");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setAutoLoginStatus("error");
        setAutoLoginError(message);

        if (
          message.includes("auth/invalid-credential") ||
          message.includes("auth/user-not-found") ||
          message.includes("auth/wrong-password")
        ) {
          await clearSessionCredentials();
        }
      } finally {
        if (!cancelled) {
          setIsSessionBootstrapping(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (showMenuModal) {
      refreshSessionDebug();
    }
  }, [showMenuModal, userUid, userEmail, autoLoginStatus, autoLoginError]);

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
          const message =
            error instanceof Error
              ? error.message
              : "Nie udało się załadować gospodarstwa.";
          notify("Błąd", message);
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

    const householdRef = doc(db, "households", currentHouseholdId);
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
          setHouseholdSecretCode(data.secretCode ?? "");
        }

        const eventsRef = collection(householdRef, "events");
        const q = query(eventsRef, orderBy("date", "asc"));

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

            if (isSigningOutRef.current || !auth?.currentUser) {
              return;
            }

            notify("Błąd", "Brak dostępu do danych gospodarstwa.");
          },
        );
      } catch (error) {
        setIsEventsLoading(false);

        if (isSigningOutRef.current || !auth?.currentUser) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Nie udało się załadować wydarzeń.";
        notify("Błąd", message);
      }
    })();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [currentHouseholdId, userUid, userEmail]);

  const requestNotificationsPermission = async () => {
    if (Platform.OS === "web") {
      return false;
    }

    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  };

  const scheduleDayBeforeNotification = async (
    date: string,
    type: string,
    time: string,
  ) => {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);

    if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
      return undefined;
    }

    const triggerDate = new Date(year, month - 1, day);
    triggerDate.setDate(triggerDate.getDate() - 1);
    triggerDate.setHours(hour, minute, 0, 0);

    if (triggerDate <= new Date()) {
      return undefined;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("trash-reminders", {
        name: "Trash reminders",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const triggerYear = triggerDate.getFullYear();
    const triggerMonth = triggerDate.getMonth() + 1;
    const triggerDay = triggerDate.getDate();
    const triggerHour = triggerDate.getHours();
    const triggerMinute = triggerDate.getMinutes();

    return Notifications.scheduleNotificationAsync({
      content: {
        title: `Jutro odbiór: ${type}`,
        body: `Jutro (${date}) odbiór: ${type}`,
      },
      trigger:
        Platform.OS === "android"
          ? {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: triggerDate,
              channelId: "trash-reminders",
            }
          : {
              type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
              year: triggerYear,
              month: triggerMonth,
              day: triggerDay,
              hour: triggerHour,
              minute: triggerMinute,
              second: 0,
              repeats: false,
            },
    });
  };

  const rescheduleFutureEventNotifications = async (time: string) => {
    if (Platform.OS === "web") {
      return { updated: 0, skipped: events.length, permissionGranted: false };
    }

    if (!db || !currentHouseholdId) {
      return { updated: 0, skipped: events.length, permissionGranted: true };
    }

    const permissionGranted = await requestNotificationsPermission();
    if (!permissionGranted) {
      return { updated: 0, skipped: events.length, permissionGranted: false };
    }

    const updatedNotificationIds: Record<string, string> = {};
    let updated = 0;
    let skipped = 0;

    for (const item of events) {
      const notificationId = await scheduleDayBeforeNotification(
        item.date,
        item.wasteType,
        time,
      );

      if (!notificationId) {
        skipped += 1;
        continue;
      }

      if (item.notificationId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(
            item.notificationId,
          );
        } catch {
          // no-op
        }
      }

      await setDoc(
        doc(db, "households", currentHouseholdId, "events", item.id),
        {
          notificationId,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      updatedNotificationIds[item.id] = notificationId;
      updated += 1;
    }

    if (Object.keys(updatedNotificationIds).length > 0) {
      setEvents((previous) =>
        previous.map((item) => ({
          ...item,
          notificationId:
            updatedNotificationIds[item.id] ?? item.notificationId,
        })),
      );
    }

    return { updated, skipped, permissionGranted: true };
  };

  const onRegister = async () => {
    setRegisterError("");
    const normalizedEmail = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      const msg = "Podaj poprawny adres email (np. jan@example.com).";
      setRegisterError(msg);
      notify("Błąd rejestracji", msg);
      return;
    }

    if (password.length < 6) {
      const msg = "Hasło musi mieć co najmniej 6 znaków.";
      setRegisterError(msg);
      notify("Błąd rejestracji", msg);
      return;
    }

    if (!db) {
      const msg = "Firebase nie jest skonfigurowany.";
      setRegisterError(msg);
      notify("Błąd", msg);
      return;
    }

    // Sprawdź format kodu gospodarstwa ZANIM utworzymy konto w Firebase
    const inputCode = normalizeCode(householdInviteCode);
    if (inputCode && !/^[A-Z0-9]{6}$/.test(inputCode)) {
      const msg = "Nieprawidłowy kod gospodarstwa (format: 6 znaków).";
      setRegisterError(msg);
      notify("Błąd rejestracji", msg);
      return;
    }

    setIsRegistering(true);
    try {
      const credential = await registerUser(normalizedEmail, password);
      const uid = credential.user.uid;
      const registeredEmail = credential.user.email ?? normalizedEmail;

      let assignment: HouseholdJoinResult;

      if (inputCode) {
        const joined = await joinHouseholdByCode(
          uid,
          registeredEmail,
          inputCode,
        );

        if (!joined) {
          try {
            await credential.user.delete();
          } catch {
            // no-op
          }
          const msg = "Nie znaleziono gospodarstwa dla podanego kodu.";
          setRegisterError(msg);
          notify("Błąd rejestracji", msg);
          return;
        }

        assignment = joined;
      } else {
        assignment = await createHouseholdForUser(uid, registeredEmail);
      }

      await saveUserHousehold(
        uid,
        registeredEmail,
        assignment.householdId,
        "19:00",
      );

      setUserEmail(registeredEmail);
      setUserUid(uid);
      setCurrentHouseholdId(assignment.householdId);
      setHouseholdSecretCode(assignment.secretCode);
      setNotificationTime("19:00");
      setNotificationTimeInput("19:00");
      setHouseholdInviteCode("");
      setRegisterError("");

      // Wyświetl użytkownikowi co się stało (dołączył czy utworzono nowe)
      if (inputCode) {
        notify("OK", "Dołączono do istniejącego gospodarstwa.");
      } else {
        notify("OK", "Utworzono nowe gospodarstwo.");
      }

      await saveSessionCredentials(
        registeredEmail,
        password,
        credential.user.refreshToken,
      );
    } catch (error) {
      const msg = parseAuthErrorMessage(error);
      setRegisterError(msg);
      notify("Błąd rejestracji", msg);
    } finally {
      setIsRegistering(false);
    }
  };

  const onLogin = async () => {
    setLoginError("");
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      const msg = "Podaj adres email.";
      setLoginError(msg);
      notify("Błąd logowania", msg);
      emailRef.current?.focus?.();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      const msg = "Podaj poprawny adres email (np. jan@example.com).";
      setLoginError(msg);
      notify("Błąd logowania", msg);
      emailRef.current?.focus?.();
      return;
    }

    if (!password) {
      const msg = "Podaj hasło.";
      setLoginError(msg);
      notify("Błąd logowania", msg);
      passwordRef.current?.focus?.();
      return;
    }

    if (password.length < 6) {
      const msg = "Hasło musi mieć co najmniej 6 znaków.";
      setLoginError(msg);
      notify("Błąd logowania", msg);
      passwordRef.current?.focus?.();
      return;
    }

    setIsLoggingIn(true);
    try {
      try {
        const credential = await loginUser(normalizedEmail, password);
        await saveSessionCredentials(
          normalizedEmail,
          password,
          credential.user.refreshToken,
        );

        const uid = credential.user.uid;
        const mail = credential.user.email ?? normalizedEmail;

        // Ustaw natychmiast kontekst użytkownika i odśwież gospodarstwo
        setUserEmail(mail);
        setUserUid(uid);
        try {
          await ensureUserHousehold(uid, mail);
        } catch {
          // silent
        }
      } catch (error) {
        const msg = parseAuthErrorMessage(error);
        setLoginError(msg);
        notify("Błąd logowania", msg);
        return;
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const onLogout = async () => {
    if (!auth) {
      return;
    }

    isSigningOutRef.current = true;
    setCurrentHouseholdId(null);
    setHouseholdSecretCode("");
    setEvents([]);

    try {
      await signOut(auth);
      await clearSessionCredentials();
    } catch (error) {
      isSigningOutRef.current = false;
      const message =
        error instanceof Error ? error.message : "Nie udało się wylogować.";
      notify("Błąd", message);
    }
  };

  const onAddEvent = async () => {
    const normalizedDate = eventDate.trim();
    const normalizedType =
      selectedWasteType === "Inne"
        ? customWasteType.trim()
        : selectedWasteType.trim();

    if (!normalizedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const message = "Data musi mieć format YYYY-MM-DD.";
      setModalError(message);
      notify("Błąd", message);
      return false;
    }

    if (!normalizedType) {
      const message = "Podaj typ śmieci.";
      setModalError(message);
      notify("Błąd", message);
      return false;
    }

    if (!currentHouseholdId) {
      const message = "Brak przypisanego gospodarstwa.";
      setModalError(message);
      notify("Błąd", message);
      return false;
    }

    if (!userUid) {
      const message = "Brak danych użytkownika. Zaloguj się ponownie.";
      setModalError(message);
      notify("Błąd", message);
      return false;
    }

    try {
      if (!db) {
        const message = "Firebase nie jest skonfigurowany.";
        setModalError(message);
        notify("Błąd", message);
        return false;
      }

      const hasPermission = await requestNotificationsPermission();
      const notificationId = hasPermission
        ? await scheduleDayBeforeNotification(
            normalizedDate,
            normalizedType,
            notificationTime,
          )
        : undefined;

      if (!hasPermission) {
        notify(
          "Powiadomienia",
          "Brak zgody na powiadomienia. Odbiór zapisany bez przypomnienia.",
        );
      } else if (!notificationId) {
        notify(
          "Powiadomienia",
          "Nie zaplanowano przypomnienia (termin przypomnienia już minął).",
        );
      }

      const householdRef = doc(db, "households", currentHouseholdId);
      const eventsRef = collection(householdRef, "events");

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

      setEventDate("");
      setSelectedWasteType("Zmieszane");
      setCustomWasteType("");
      setIsWasteTypeDropdownOpen(false);
      setModalError("");
      return true;
    } catch (error) {
      let message =
        error instanceof Error
          ? error.message
          : "Nie udało się dodać wydarzenia.";
      if (
        message.includes("permission-denied") ||
        message.includes("Missing or insufficient permissions")
      ) {
        message = "Brak uprawnień Firestore. Sprawdź reguły bazy.";
      }

      setModalError(message);
      notify("Błąd", message);
      return false;
    }
  };

  const onCalendarDayPress = (day: { dateString: string }) => {
    setEventDate(day.dateString);
    setSelectedWasteType("Zmieszane");
    setCustomWasteType("");
    setIsWasteTypeDropdownOpen(false);
    setModalError("");
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
        notify("Błąd", "Firebase nie jest skonfigurowany.");
        return;
      }

      if (item.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(
          item.notificationId,
        );
      }

      await deleteDoc(
        doc(db, "households", currentHouseholdId, "events", item.id),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Nie udało się usunąć wydarzenia.";
      notify("Błąd", message);
    }
  };

  const onSaveNotificationTime = async () => {
    const normalizedTime = notificationTimeInput.trim();

    if (!isValidTimeHHmm(normalizedTime)) {
      notify("Błąd", "Podaj godzinę w formacie HH:mm, np. 19:30");
      return;
    }

    if (!db || !userUid) {
      notify("Błąd", "Brak danych użytkownika.");
      return;
    }

    try {
      setIsSavingNotificationTime(true);
      await setDoc(
        doc(db, "users", userUid),
        {
          notificationTime: normalizedTime,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      setNotificationTime(normalizedTime);
      setNotificationTimeInput(normalizedTime);

      const rescheduleResult =
        await rescheduleFutureEventNotifications(normalizedTime);

      if (!rescheduleResult.permissionGranted) {
        notify(
          "Powiadomienia",
          "Brak zgody na powiadomienia. Godzina zapisana, ale system nie mógł przeplanować przypomnień.",
        );
        return;
      }

      notify(
        "OK",
        `Godzina zapisana. Przeplanowano: ${rescheduleResult.updated}, pominięto: ${rescheduleResult.skipped}.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Nie udało się zapisać godziny.";
      notify("Błąd", message);
    } finally {
      setIsSavingNotificationTime(false);
    }
  };

  const onSendTestNotification = async () => {
    if (Platform.OS === "web") {
      notify("Info", "Test powiadomień działa tylko na telefonie.");
      return;
    }

    if (isSendingTestNotification) {
      return;
    }

    try {
      setIsSendingTestNotification(true);
      const hasPermission = await requestNotificationsPermission();

      if (!hasPermission) {
        notify(
          "Powiadomienia",
          "Brak zgody na powiadomienia w systemie Android.",
        );
        return;
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("trash-reminders", {
          name: "Trash reminders",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Test powiadomienia",
          body: "Powiadomienia w aplikacji działają poprawnie.",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
          channelId: Platform.OS === "android" ? "trash-reminders" : undefined,
        },
      });

      notify("OK", "Testowe powiadomienie zaplanowane za 5 sekund.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Nie udało się zaplanować testu.";
      notify("Błąd", message);
    } finally {
      setIsSendingTestNotification(false);
    }
  };

  if (!isFirebaseConfigured) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.containerContent}
        showsVerticalScrollIndicator={false}
      >
        {/* {isDevBuild && (
          <Text style={styles.versionBadge}>{appVersionLabel}</Text>
        )} */}
        <View style={styles.headerCard}>
          <Text style={styles.title}>Brak konfiguracji Firebase</Text>
          <Text style={styles.subtitle}>
            Uzupełnij EXPO_PUBLIC_FIREBASE_* w .env i zrestartuj Expo.
          </Text>
        </View>
      </ScrollView>
    );
  }

  if (!isAuthenticated && isSessionBootstrapping) {
    return (
      <View style={styles.container}>
        {/* {isDevBuild && (
          <Text style={styles.versionBadge}>{appVersionLabel}</Text>
        )} */}
        <View style={styles.headerCard}>
          <Text style={styles.title}>Przywracanie sesji...</Text>
          <Text style={styles.subtitle}>
            Sprawdzam lokalny token logowania.
          </Text>
          <View style={styles.loaderBox}>
            <ActivityIndicator size="small" color="#38bdf8" />
          </View>
        </View>
      </View>
    );
  }

  if (!isAuthenticated || isRegistering || isLoggingIn) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.containerContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* {isDevBuild && (
          <Text style={styles.versionBadge}>{appVersionLabel}</Text>
        )} */}
        <View style={styles.headerCard}>
          <Text style={styles.title}>Śmieci App — logowanie</Text>
          <Text style={styles.subtitle}>
            Zaloguj się lub załóż konto dla gospodarstwa.
          </Text>
        </View>

        <View style={styles.card}>
          <TextInput
            ref={emailRef}
            placeholder="Email"
            placeholderTextColor="#64748b"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setLoginError("");
              setRegisterError("");
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            ref={passwordRef}
            placeholder="Hasło"
            placeholderTextColor="#64748b"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setLoginError("");
              setRegisterError("");
            }}
            secureTextEntry
            style={styles.input}
          />
          <TextInput
            placeholder="Kod gospodarstwa (opcjonalnie przy rejestracji)"
            placeholderTextColor="#64748b"
            value={householdInviteCode}
            onChangeText={(t) => { setHouseholdInviteCode(t); setRegisterError(""); }}
            autoCapitalize="characters"
            style={styles.input}
          />

          {loginError ? (
            <Text style={styles.modalError}>{loginError}</Text>
          ) : null}
          {registerError ? (
            <Text style={styles.modalError}>{registerError}</Text>
          ) : null}

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.primaryButton, isLoggingIn && styles.disabledButton]} onPress={onLogin} disabled={isLoggingIn}>
              <Text style={styles.primaryButtonText}>{isLoggingIn ? "Loguję..." : "Zaloguj"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, isRegistering && styles.disabledButton]}
              onPress={onRegister}
              disabled={isRegistering}
            >
              <Text style={styles.secondaryButtonText}>{isRegistering ? "Rejestruję..." : "Zarejestruj"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      {/* {isDevBuild && (
        <Text style={styles.versionBadge}>{appVersionLabel}</Text>
      )} */}
      <ScrollView
        contentContainerStyle={styles.containerContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.hamburgerButton}
            onPress={() => setShowMenuModal(true)}
          >
            <Text style={styles.hamburgerIcon}>☰</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Kalendarz przypomnień</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Kalendarz</Text>
          <Calendar
            onDayPress={onCalendarDayPress}
            markedDates={markedDates}
            firstDay={1}
            theme={{
              calendarBackground: "transparent",
              textSectionTitleColor: "#94a3b8",
              dayTextColor: "#e5e7eb",
              monthTextColor: "#e5e7eb",
              arrowColor: "#22c55e",
              todayTextColor: "#38bdf8",
              selectedDayTextColor: "#ffffff",
            }}
            style={styles.calendar}
            locale="pl"
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
              ListEmptyComponent={
                <Text style={styles.muted}>Brak wydarzeń</Text>
              }
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
      </ScrollView>

      <Modal
        visible={showWasteModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowWasteModal(false);
          setIsWasteTypeDropdownOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Dodaj odbiór śmieci</Text>
            <Text style={styles.modalSubtitle}>Data: {eventDate}</Text>

            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() =>
                setIsWasteTypeDropdownOpen((previous) => !previous)
              }
            >
              <Text style={styles.dropdownTriggerText}>
                {selectedWasteType}
              </Text>
              <Text style={styles.dropdownChevron}>
                {isWasteTypeDropdownOpen ? "▴" : "▾"}
              </Text>
            </TouchableOpacity>

            {isWasteTypeDropdownOpen ? (
              <View style={styles.dropdownList}>
                {POPULAR_WASTE_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setSelectedWasteType(type);
                      if (type !== "Inne") {
                        setCustomWasteType("");
                      }
                      setIsWasteTypeDropdownOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        selectedWasteType === type &&
                          styles.dropdownItemTextSelected,
                      ]}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {selectedWasteType === "Inne" ? (
              <TextInput
                value={customWasteType}
                onChangeText={setCustomWasteType}
                placeholder="Wpisz własny rodzaj śmieci"
                placeholderTextColor="#64748b"
                style={styles.input}
              />
            ) : null}

            {modalError ? (
              <Text style={styles.modalError}>{modalError}</Text>
            ) : null}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  isSavingEvent && styles.disabledButton,
                ]}
                onPress={onConfirmWasteType}
                disabled={isSavingEvent}
              >
                <Text style={styles.primaryButtonText}>
                  {isSavingEvent ? "Zapisywanie..." : "Zapisz"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setShowWasteModal(false);
                  setIsWasteTypeDropdownOpen(false);
                }}
              >
                <Text style={styles.secondaryButtonText}>Anuluj</Text>
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
          <ScrollView
            style={styles.menuPanel}
            contentContainerStyle={styles.menuPanelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.menuTitle}>Konto</Text>
            <View style={styles.menuUserBox}>
              <Text style={styles.menuUserLabel}>Zalogowany użytkownik</Text>
              <Text style={styles.menuUserEmail}>
                {userEmail ?? "Brak email"}
              </Text>
            </View>
            <View style={styles.menuUserBox}>
              <Text style={styles.menuUserLabel}>Kod gospodarstwa</Text>
              <Text style={styles.menuSecretCode}>
                {householdSecretCode || "—"}
              </Text>
            </View>

            <View style={styles.menuUserBox}>
              <Text style={styles.menuUserLabel}>
                Godzina przypomnienia (dzień wcześniej)
              </Text>
              <TextInput
                value={notificationTimeInput}
                onChangeText={setNotificationTimeInput}
                placeholder="HH:mm"
                placeholderTextColor="#64748b"
                style={styles.menuInput}
              />
              <TouchableOpacity
                style={[
                  styles.menuSaveButton,
                  isSavingNotificationTime && styles.disabledButton,
                ]}
                onPress={onSaveNotificationTime}
                disabled={isSavingNotificationTime}
              >
                <Text style={styles.menuSaveText}>
                  {isSavingNotificationTime
                    ? "Zapisywanie..."
                    : "Zapisz godzinę"}
                </Text>
              </TouchableOpacity>
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
          </ScrollView>
          <TouchableOpacity
            style={styles.menuBackdrop}
            onPress={() => setShowMenuModal(false)}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b1220",
  },
  containerContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 24,
  },
  versionBadge: {
    position: "absolute",
    top: 8,
    right: 10,
    zIndex: 20,
    color: "#94a3b8",
    fontSize: 11,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  hamburgerIcon: {
    color: "#f8fafc",
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "700",
  },
  topBarTitle: {
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: "700",
    flexShrink: 1,
  },
  headerCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 6,
    color: "#f8fafc",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  muted: {
    color: "#94a3b8",
  },
  sectionTitle: {
    color: "#e5e7eb",
    fontWeight: "600",
    marginBottom: 10,
  },
  calendar: {
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 10,
  },
  selectedDateLabel: {
    color: "#94a3b8",
    marginBottom: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#0f172a",
    color: "#e5e7eb",
    marginBottom: 10,
  },
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#0f172a",
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownTriggerText: {
    color: "#e5e7eb",
    fontSize: 14,
  },
  dropdownChevron: {
    color: "#94a3b8",
    fontSize: 14,
    marginLeft: 10,
  },
  dropdownList: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 8,
    marginBottom: 10,
    overflow: "hidden",
    backgroundColor: "#0b1220",
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  dropdownItemText: {
    color: "#cbd5e1",
  },
  dropdownItemTextSelected: {
    color: "#22c55e",
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: "#22c55e",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.65,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "#1f2937",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#e5e7eb",
    fontWeight: "700",
  },
  eventRow: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0f172a",
  },
  eventContent: {
    flex: 1,
  },
  eventText: {
    fontWeight: "600",
    color: "#f8fafc",
  },
  loaderBox: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loaderText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  deleteButton: {
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 10,
  },
  deleteButtonText: {
    color: "#fecaca",
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.75)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  modalTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  modalSubtitle: {
    color: "#94a3b8",
    marginBottom: 12,
  },
  modalError: {
    color: "#fca5a5",
    marginBottom: 8,
    fontSize: 12,
  },
  menuOverlay: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(2, 6, 23, 0.6)",
  },
  menuBackdrop: {
    flex: 1,
  },
  menuPanel: {
    width: "78%",
    maxWidth: 320,
    backgroundColor: "#0f172a",
    borderRightWidth: 1,
    borderRightColor: "#1f2937",
    paddingTop: 32,
    paddingHorizontal: 16,
  },
  menuPanelContent: {
    gap: 14,
    paddingBottom: 20,
  },
  menuTitle: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
  },
  menuUserBox: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#111827",
  },
  menuUserLabel: {
    color: "#94a3b8",
    fontSize: 12,
    marginBottom: 4,
  },
  menuUserEmail: {
    color: "#f8fafc",
    fontWeight: "600",
  },
  menuSecretCode: {
    color: "#22c55e",
    fontWeight: "700",
    letterSpacing: 1,
  },
  menuInput: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#0b1220",
    color: "#e5e7eb",
    marginBottom: 10,
  },
  menuSaveButton: {
    backgroundColor: "#1d4ed8",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  menuSaveText: {
    color: "#dbeafe",
    fontWeight: "700",
  },
  menuTestButton: {
    marginTop: 10,
    backgroundColor: "#0f766e",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  menuTestText: {
    color: "#ccfbf1",
    fontWeight: "700",
  },
  menuDebugLine: {
    color: "#cbd5e1",
    fontSize: 12,
    marginBottom: 4,
  },
  menuDebugButton: {
    marginTop: 8,
    backgroundColor: "#334155",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  menuDebugButtonText: {
    color: "#e2e8f0",
    fontWeight: "700",
  },
  menuDebugDangerButton: {
    marginTop: 8,
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  menuDebugDangerText: {
    color: "#fecaca",
    fontWeight: "700",
  },
  menuLogoutButton: {
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  menuLogoutText: {
    color: "#fecaca",
    fontWeight: "700",
  },
});
