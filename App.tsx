import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SectionList,
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
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import * as Notifications from "expo-notifications";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { translations, WASTE_TYPES, localeData } from './translations';
import { Calendar, LocaleConfig } from "react-native-calendars";

// apply calendar locale data from translations file
LocaleConfig.locales['pl'] = localeData.pl;
LocaleConfig.locales['en'] = localeData.en;
LocaleConfig.defaultLocale = 'pl';

import {
  auth,
  db,
  isFirebaseConfigured,
  loginUser,
  registerUser,
} from "./firebase";

WebBrowser.maybeCompleteAuthSession();

type TrashEvent = {
  id: string;
  date: string;
  wasteType: string;
  notificationId?: string;
};

type ImportItem = {
  date: string;
  wasteType: string;
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

const pad2 = (value: number) => String(value).padStart(2, "0");

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
};

const formatMonthLabel = (dateKey: string, locale: string) => {
  const { year, month } = parseDateKey(dateKey);
  if (!year || !month) {
    return dateKey;
  }

  const base = new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });

  return capitalize(base);
};

const formatDayLabel = (dateKey: string, locale: string, lowerWeekday = false) => {
  const { year, month, day } = parseDateKey(dateKey);
  if (!year || !month || !day) {
    return dateKey;
  }

  const date = new Date(year, month - 1, day);
  const weekday = date.toLocaleDateString(locale, { weekday: "long" });
  const weekdayLabel = lowerWeekday
    ? weekday.toLocaleLowerCase(locale)
    : weekday;

  return `${day} ${weekdayLabel}`;
};

const getTodayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

const isDateInPast = (dateKey: string, todayKey: string) =>
  dateKey < todayKey;

const darkTheme = {
  pageBg: "#0b1220",
  cardBg: "#0f172a",
  panelBg: "#111827",
  inputBg: "#0f172a",
  border: "#1f2937",
  textPrimary: "#f8fafc",
  textSecondary: "#e5e7eb",
  textMuted: "#94a3b8",
  accent: "#22c55e",
  primary: "#22c55e",
  onPrimary: "#ffffff",
  buttonBg: "#1f2937",
  dangerBg: "#7f1d1d",
  dangerText: "#fecaca",
};

const lightTheme = {
  pageBg: "#f8fafc",
  cardBg: "#ffffff",
  panelBg: "#f1f5f9",
  inputBg: "#ffffff",
  border: "#cbd5e1",
  textPrimary: "#0f172a",
  textSecondary: "#1f2937",
  textMuted: "#475569",
  accent: "#16a34a",
  primary: "#16a34a",
  onPrimary: "#ffffff",
  buttonBg: "#e2e8f0",
  dangerBg: "#b91c1c",
  dangerText: "#fff1f2",
};


const MIXED_WASTE_DAY_COLOR = "#7c3aed";
const CALENDAR_DAY_SIZE = 32;
const SESSION_CREDENTIALS_KEY = "trash_reminder_session_credentials_v1";
const SESSION_TOKEN_KEY = "trash_reminder_session_token_v1";
const THEME_PREFERENCE_KEY = "trash_reminder_theme_v1";
const LOCAL_EVENTS_KEY = "trash_reminder_local_events_v1";
const LOCAL_NOTIFICATION_TIME_KEY = "trash_reminder_local_notification_time_v1";
const MAX_IMPORT_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const FIREBASE_PROJECT_ID =
  (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim();
const DEFAULT_FUNCTION_REGION = "us-central1";
const DEFAULT_IMPORT_ENDPOINT = FIREBASE_PROJECT_ID
  ? `https://${DEFAULT_FUNCTION_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/trashImport`
  : "";
const normalizeImportEndpoint = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.endsWith("/trashimport")) {
    return trimmed.replace(/\/trashimport$/, "/trashImport");
  }

  if (trimmed.endsWith("trashimport")) {
    return trimmed.replace(/trashimport$/, "trashImport");
  }

  return trimmed;
};

const IMPORT_ENDPOINT =
  normalizeImportEndpoint(
    process.env.EXPO_PUBLIC_TRASH_AI_IMPORT_URL ?? "",
  ) || DEFAULT_IMPORT_ENDPOINT;
const GOOGLE_WEB_CLIENT_ID =
  (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "").trim();
const GOOGLE_ANDROID_CLIENT_ID =
  (process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "").trim();
const GOOGLE_IOS_CLIENT_ID =
  (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "").trim();
const GOOGLE_ANDROID_REDIRECT_URI = GOOGLE_ANDROID_CLIENT_ID
  ? `com.googleusercontent.apps.${GOOGLE_ANDROID_CLIENT_ID.replace(".apps.googleusercontent.com", "")}:/oauthredirect`
  : undefined;
const DEFAULT_FEEDBACK_ENDPOINT = FIREBASE_PROJECT_ID
  ? `https://${DEFAULT_FUNCTION_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/feedbackSubmit`
  : "";
const FEEDBACK_ENDPOINT =
  normalizeImportEndpoint(
    process.env.EXPO_PUBLIC_FEEDBACK_URL ?? "",
  ) || DEFAULT_FEEDBACK_ENDPOINT;

const sortEventsByDate = (items: TrashEvent[]) =>
  [...items].sort((left, right) => left.date.localeCompare(right.date));

const readStorageItem = async (key: string) => {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }

    return window.localStorage.getItem(key);
  }

  return AsyncStorage.getItem(key);
};

const writeStorageItem = async (key: string, value: string) => {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(key, value);
    return;
  }

  await AsyncStorage.setItem(key, value);
};

const removeStorageItem = async (key: string) => {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.removeItem(key);
    return;
  }

  await AsyncStorage.removeItem(key);
};

const readLocalEvents = async (): Promise<TrashEvent[]> => {
  const raw = await readStorageItem(LOCAL_EVENTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is TrashEvent => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const candidate = item as Partial<TrashEvent>;
        return typeof candidate.id === "string" &&
          typeof candidate.date === "string" &&
          typeof candidate.wasteType === "string";
      })
      .map((item) => ({
        id: item.id,
        date: item.date,
        wasteType: item.wasteType,
        notificationId: item.notificationId,
      }));
  } catch {
    return [];
  }
};

const writeLocalEvents = async (items: TrashEvent[]) => {
  await writeStorageItem(LOCAL_EVENTS_KEY, JSON.stringify(sortEventsByDate(items)));
};

const readLocalNotificationTime = async () => {
  const raw = await readStorageItem(LOCAL_NOTIFICATION_TIME_KEY);
  return typeof raw === "string" ? raw.trim() : "";
};

const writeLocalNotificationTime = async (value: string) => {
  await writeStorageItem(LOCAL_NOTIFICATION_TIME_KEY, value);
};

const getWasteTypeColor = (wasteType: string) => {
  const normalized = wasteType.trim().toLowerCase();

  // Kolory zgodne z ogólnie przyjętymi zasadami segregacji odpadów w Polsce.
  if (normalized.includes("zmiesz") || normalized.includes("mixed")) return "#000000";
  if (normalized.includes("popio") || normalized.includes("ash")) return "#6b7280";
  if (
    normalized.includes("plastik") ||
    normalized.includes("metal") ||
    normalized.includes("plastic")
  )
    return "#eab308";
  if (normalized.includes("papier") || normalized.includes("paper")) return "#3b82f6";
  // Innego odcienia zieleni niż theme.accent, żeby obwódka "dziś" na kalendarzu
  // nie znikała na tle identycznego koloru.
  if (normalized.includes("szk") || normalized.includes("glass")) return "#15803d";
  if (normalized.includes("bio")) return "#92400e";
  if (normalized.includes("gabary") || normalized.includes("bulky")) return "#a855f7";
  if (
    normalized.includes("elektro") ||
    normalized.includes("e-waste") ||
    normalized.includes("ewaste")
  )
    return "#ef4444";

  return "#6366f1";
};

const getContrastTextColor = (hexColor: string) => {
  const hex = hexColor.replace("#", "");
  if (hex.length !== 6) {
    return "#ffffff";
  }

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.6 ? "#0f172a" : "#ffffff";
};

const normalizeMatchText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const WASTE_TYPE_KEYWORDS: Record<"pl" | "en", { type: string; keywords: string[] }[]> = {
  pl: [
    { type: "Zmieszane", keywords: ["zmiesz", "resztk"] },
    { type: "Plastik i metal", keywords: ["plastik", "metal", "tworzyw"] },
    { type: "Papier", keywords: ["papier", "makul"] },
    { type: "Szkło", keywords: ["szklo", "szkło", "glass"] },
    { type: "Bio", keywords: ["bio", "organicz", "kompost"] },
    { type: "Popiół", keywords: ["popio"] },
    { type: "Gabaryty", keywords: ["gabary", "wielkogab", "meble"] },
    { type: "Elektroodpady", keywords: ["elektro", "sprzet", "sprzęt", "e-odp"] },
  ],
  en: [
    { type: "Mixed", keywords: ["mixed", "general"] },
    { type: "Plastic & metal", keywords: ["plastic", "metal", "packaging"] },
    { type: "Paper", keywords: ["paper"] },
    { type: "Glass", keywords: ["glass"] },
    { type: "Bio", keywords: ["bio", "organic", "compost"] },
    { type: "Ash", keywords: ["ash"] },
    { type: "Bulky", keywords: ["bulky", "large", "furniture"] },
    { type: "E-waste", keywords: ["e-waste", "ewaste", "electronics"] },
  ],
};

const normalizeDateString = (raw: string) => {
  const parts = raw.trim().split(/[.\/-]/).map(Number);
  if (parts.length < 2 || parts.some((value) => Number.isNaN(value))) {
    return null;
  }

  const now = new Date();
  const [a, b, c] = parts;
  let year = c;
  let month = b;
  let day = a;

  if (parts.length === 2) {
    year = now.getFullYear();
  } else if (a >= 1000) {
    year = a;
    month = b;
    day = c;
  } else if (c >= 1000) {
    year = c;
    month = b;
    day = a;
  }

  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
};

const normalizeDateParts = (day: number, month: number, year?: number) => {
  if (!day || !month) {
    return null;
  }

  const resolvedYear = year ?? new Date().getFullYear();
  return `${resolvedYear}-${pad2(month)}-${pad2(day)}`;
};

const extractDatesFromLine = (line: string, language: "pl" | "en") => {
  const dates: string[] = [];
  const patterns = [
    /\b\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}\b/g,
    /\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}\b/g,
    /\b\d{1,2}[.\/-]\d{1,2}\b/g,
  ];

  for (const pattern of patterns) {
    const matches = line.match(pattern) ?? [];
    for (const match of matches) {
      const normalized = normalizeDateString(match);
      if (normalized) {
        dates.push(normalized);
      }
    }
  }

  const monthMap =
    language === "pl"
      ? {
          styczen: 1,
          styczenia: 1,
          sty: 1,
          luty: 2,
          lutego: 2,
          lut: 2,
          marzec: 3,
          marca: 3,
          mar: 3,
          kwiecien: 4,
          kwietnia: 4,
          kwi: 4,
          maj: 5,
          maja: 5,
          czerwiec: 6,
          czerwca: 6,
          cze: 6,
          lipiec: 7,
          lipca: 7,
          lip: 7,
          sierpien: 8,
          sierpnia: 8,
          sie: 8,
          wrzesien: 9,
          wrzesnia: 9,
          wrz: 9,
          pazdziernik: 10,
          pazdziernika: 10,
          paz: 10,
          listopad: 11,
          listopada: 11,
          lis: 11,
          grudzien: 12,
          grudnia: 12,
          gru: 12,
        }
      : {
          january: 1,
          jan: 1,
          february: 2,
          feb: 2,
          march: 3,
          mar: 3,
          april: 4,
          apr: 4,
          may: 5,
          june: 6,
          jun: 6,
          july: 7,
          jul: 7,
          august: 8,
          aug: 8,
          september: 9,
          sep: 9,
          sept: 9,
          october: 10,
          oct: 10,
          november: 11,
          nov: 11,
          december: 12,
          dec: 12,
        };
  const monthPattern =
    language === "pl"
      ? /(\d{1,2})\s*(stycznia|styczen|sty|lutego|luty|lut|marca|marzec|mar|kwietnia|kwiecien|kwi|maja|maj|czerwca|czerwiec|cze|lipca|lipiec|lip|sierpnia|sierpien|sie|wrzesnia|wrzesien|wrz|pazdziernika|pazdziernik|paz|listopada|listopad|lis|grudnia|grudzien|gru)\s*(\d{4})?/gi
      : /(\d{1,2})\s*(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s*(\d{4})?/gi;

  const normalizedLine = normalizeMatchText(line);
  let monthMatch: RegExpExecArray | null;
  while ((monthMatch = monthPattern.exec(normalizedLine))) {
    const day = Number(monthMatch[1]);
    const monthKey = monthMatch[2];
    const year = monthMatch[3] ? Number(monthMatch[3]) : undefined;
    const month = monthMap[monthKey as keyof typeof monthMap];
    if (!month) {
      continue;
    }
    const normalized = normalizeDateParts(day, month, year);
    if (normalized) {
      dates.push(normalized);
    }
  }

  return Array.from(new Set(dates));
};

const detectWasteType = (
  line: string,
  language: "pl" | "en",
): string | null => {
  const normalized = normalizeMatchText(line);
  for (const entry of WASTE_TYPE_KEYWORDS[language]) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.type;
    }
  }

  return null;
};

const parseImportText = (
  text: string,
  language: "pl" | "en",
  fallbackType: string,
) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: ImportItem[] = [];
  let pendingDate: string | null = null;

  for (const line of lines) {
    const dates = extractDatesFromLine(line, language);
    const type = detectWasteType(line, language);

    if (dates.length) {
      const resolvedType = type ?? fallbackType;
      for (const date of dates) {
        items.push({ date, wasteType: resolvedType });
      }
      pendingDate = null;
      continue;
    }

    if (pendingDate && type) {
      items.push({ date: pendingDate, wasteType: type });
      pendingDate = null;
    }
  }

  if (pendingDate) {
    items.push({ date: pendingDate, wasteType: fallbackType });
  }

  return items;
};

const readWebFileAsDataUrl = async (uri: string) => {
  const response = await fetch(uri);
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
};

const dataUrlToBase64 = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    return "";
  }
  return dataUrl.slice(commaIndex + 1);
};

export default function App() {
  const topContentInset = Math.max(16, (Constants.statusBarHeight || 0) + 10);

    // Pokazuj wersję tylko dla buildów deweloperskich
    const isDevBuild =
      Constants.executionEnvironment === 'storeClient' // Expo Go
      || ((Constants.manifest2?.extra?.eas as any)?.buildProfile &&
        ['development', 'preview', 'previewLight'].includes((Constants.manifest2?.extra?.eas as any).buildProfile))
      || (__DEV__ === true);
  const isSigningOutRef = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdInviteCode, setHouseholdInviteCode] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);

  // language selector (default Polish)
  const [language, setLanguage] = useState<'pl' | 'en'>('pl');
  const [themeName, setThemeName] = useState<"dark" | "light">("dark");
  const [hasLoadedTheme, setHasLoadedTheme] = useState(false);
  const [todayKey, setTodayKey] = useState(getTodayKey());
  const [showHouseholdHelp, setShowHouseholdHelp] = useState(false);
  const [showImportHelp, setShowImportHelp] = useState(false);

  const theme = useMemo(
    () => (themeName === "dark" ? darkTheme : lightTheme),
    [themeName],
  );
  const isLight = themeName === "light";

  useEffect(() => {
    let isActive = true;
    const loadThemePreference = async () => {
      try {
        if (Platform.OS === "web") {
          const saved = typeof window !== "undefined"
            ? window.localStorage.getItem(THEME_PREFERENCE_KEY)
            : null;
          if (isActive && (saved === "dark" || saved === "light")) {
            setThemeName(saved);
          }
        } else {
          const saved = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
          if (isActive && (saved === "dark" || saved === "light")) {
            setThemeName(saved);
          }
        }
      } catch {
        // Ignore storage failures and keep default theme.
      } finally {
        if (isActive) {
          setHasLoadedTheme(true);
        }
      }
    };

    loadThemePreference();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedTheme) {
      return;
    }

    const saveThemePreference = async () => {
      try {
        if (Platform.OS === "web") {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(THEME_PREFERENCE_KEY, themeName);
          }
          return;
        }

        await AsyncStorage.setItem(THEME_PREFERENCE_KEY, themeName);
      } catch {
        // Ignore storage failures.
      }
    };

    saveThemePreference();
  }, [hasLoadedTheme, themeName]);

  const toggleTheme = () => {
    setThemeName((previous) => (previous === "dark" ? "light" : "dark"));
  };

  // translation helper that reads from dictionary above
  const t = (key: string) => {
    return (
      translations[language]?.[key] ?? translations['pl'][key] ?? key
    );
  };

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
  const [isClearingAllEvents, setIsClearingAllEvents] = useState(false);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);

  const [currentHouseholdId, setCurrentHouseholdId] = useState<string | null>(
    null,
  );
  const [householdSecretCode, setHouseholdSecretCode] = useState<string>("");

  const [eventDate, setEventDate] = useState("");
  const [selectedWasteType, setSelectedWasteType] = useState(
    () => WASTE_TYPES['pl'][0]
  );
  const [customWasteType, setCustomWasteType] = useState("");

  // label for the "other" choice in the dropdown
  const OTHER_WASTE_LABEL = t('otherLabel');

  // when language changes reset selected waste type to first option
  useEffect(() => {
    setSelectedWasteType(WASTE_TYPES[language][0]);
  }, [language]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTodayKey(getTodayKey());
    }, 60 * 1000);

    return () => clearInterval(timer);
  }, []);

  // keep calendar locale in sync
  useEffect(() => {
    LocaleConfig.defaultLocale = language;
  }, [language]);
  const [isWasteTypeDropdownOpen, setIsWasteTypeDropdownOpen] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [modalError, setModalError] = useState("");
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [hasAcknowledgedClearAll, setHasAcknowledgedClearAll] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackSubject, setFeedbackSubject] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [events, setEvents] = useState<TrashEvent[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importRawText, setImportRawText] = useState("");
  const [showImportRaw, setShowImportRaw] = useState(false);
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [isSavingImports, setIsSavingImports] = useState(false);
  const [isSessionBootstrapping, setIsSessionBootstrapping] = useState(
    Platform.OS !== "web",
  );
  const [hasLoadedAnonymousData, setHasLoadedAnonymousData] = useState(false);
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
  const isAiAvailable = Boolean(IMPORT_ENDPOINT);
  const isMainContentLoading =
    !hasLoadedTheme ||
    (Platform.OS !== "web" && isSessionBootstrapping) ||
    (isEventsLoading && events.length === 0);
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
        customStyles?: {
          container?: Record<string, unknown>;
          text?: Record<string, unknown>;
        };
      }
    > = {};

    for (const item of events) {
      const eventColor = getWasteTypeColor(item.wasteType);
      const existingColor =
        marks[item.date]?.customStyles?.container?.backgroundColor as
          | string
          | undefined;
      const resolvedColor =
        existingColor && existingColor !== eventColor
          ? MIXED_WASTE_DAY_COLOR
          : eventColor;

      marks[item.date] = {
        customStyles: {
          container: {
            backgroundColor: resolvedColor,
            borderRadius: 10,
            width: CALENDAR_DAY_SIZE,
            height: CALENDAR_DAY_SIZE,
            alignItems: "center",
            justifyContent: "center",
            // Odznaka "Zmieszane" jest czarna i ginie na ciemnym tle w dark mode,
            // więc każda kropka dostaje delikatną jasną obwódkę dla kontrastu.
            borderWidth: isLight ? 0 : 1.5,
            borderColor: "rgba(255,255,255,0.35)",
          },
          text: {
            color: getContrastTextColor(resolvedColor),
            fontWeight: "700",
          },
        },
      };
    }

    if (todayKey) {
      const existing = marks[todayKey]?.customStyles ?? {};
      const existingText = existing.text ?? {};
      const existingColor = (existingText.color as string | undefined) ??
        theme.textPrimary;
      const existingContainer = existing.container ?? {};
      const hasBackground =
        typeof (existingContainer as { backgroundColor?: string }).backgroundColor ===
        "string";

      marks[todayKey] = {
        customStyles: {
          container: {
            ...existingContainer,
            borderWidth: 2,
            borderColor: theme.accent,
            ...(hasBackground ? {} : { backgroundColor: theme.cardBg }),
            width: CALENDAR_DAY_SIZE,
            height: CALENDAR_DAY_SIZE,
            alignItems: "center",
            justifyContent: "center",
          },
          text: {
            ...existingText,
            color: existingColor,
            fontWeight: "800",
          },
        },
      };
    }

    return marks;
  }, [events, theme.textPrimary, theme.accent, theme.cardBg, isLight, todayKey]);

  const groupedEvents = useMemo(() => {
    const locale = language === "pl" ? "pl-PL" : "en-US";
    const sections: { title: string; data: TrashEvent[] }[] = [];
    const sectionMap = new Map<string, { title: string; data: TrashEvent[] }>();

    for (const item of events) {
      const { year, month } = parseDateKey(item.date);
      if (!year || !month) {
        continue;
      }

      const key = `${year}-${pad2(month)}`;
      let section = sectionMap.get(key);

      if (!section) {
        section = {
          title: formatMonthLabel(item.date, locale),
          data: [],
        };
        sectionMap.set(key, section);
        sections.push(section);
      }

      section.data.push(item);
    }

    return sections;
  }, [events, language]);

  const groupedImportItems = useMemo(() => {
    if (!importItems.length) {
      return [] as { key: string; title: string; items: ImportItem[] }[];
    }

    const locale = language === "pl" ? "pl-PL" : "en-US";
    const sectionMap = new Map<string, { key: string; title: string; items: ImportItem[] }>();

    for (const item of importItems) {
      const { year, month } = parseDateKey(item.date);
      if (!year || !month) {
        continue;
      }

      const key = `${year}-${pad2(month)}`;
      let section = sectionMap.get(key);
      if (!section) {
        section = {
          key,
          title: formatMonthLabel(item.date, locale),
          items: [],
        };
        sectionMap.set(key, section);
      }

      section.items.push(item);
    }

    const sections = Array.from(sectionMap.values());
    sections.sort((left, right) => left.key.localeCompare(right.key));
    sections.forEach((section) =>
      section.items.sort((left, right) => left.date.localeCompare(right.date)),
    );

    return sections;
  }, [importItems, language]);

  const hasGoogleClientIds = Boolean(
    GOOGLE_WEB_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID || GOOGLE_IOS_CLIENT_ID,
  );

  const [googleRequest, , promptGoogleSignIn] =
    Google.useIdTokenAuthRequest(
      hasGoogleClientIds
        ? {
            webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
            androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
            iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
            scopes: ["openid", "profile", "email"],
            selectAccount: true,
          }
        : { clientId: "disabled" },
      Platform.OS === "android" && GOOGLE_ANDROID_REDIRECT_URI
        ? { native: GOOGLE_ANDROID_REDIRECT_URI }
        : undefined,
    );

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

  const isPasswordUser = (user: User | null) => {
    if (!user) {
      return false;
    }

    return user.providerData.some((provider) => provider.providerId === "password");
  };

  const ensureEmailVerified = async (user: User | null) => {
    if (!user || !auth) {
      return;
    }

    if (user.emailVerified || !isPasswordUser(user)) {
      return;
    }

    await signOut(auth);
    await clearSessionCredentials();
    throw new Error("auth/email-not-verified");
  };

  const confirmAction = (title: string, message: string) => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        return Promise.resolve(window.confirm(`${title}\n${message}`));
      }
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      Alert.alert(title, message, [
        {
          text: t('cancel'),
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: t('confirm'),
          style: "destructive",
          onPress: () => resolve(true),
        },
      ]);
    });
  };

  const parseAuthErrorMessage = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);

    if (raw.includes("auth/invalid-email")) {
      return t('enterValidEmail');
    }
    if (raw.includes("auth/email-already-in-use")) {
      return t('emailAlreadyUsed');
    }
    if (raw.includes("auth/weak-password")) {
      return t('weakPassword');
    }
    if (
      raw.includes("auth/invalid-credential") ||
      raw.includes("auth/user-not-found")
    ) {
      return t('invalidCredentials');
    }
    if (raw.includes("auth/email-not-verified")) {
      return t('emailNotVerified');
    }

    return raw;
  };

  const normalizeImportItems = (payload: unknown): ImportItem[] => {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const maybeItems =
      (payload as { items?: unknown }).items ??
      (payload as { events?: unknown }).events ??
      (payload as { data?: { items?: unknown } }).data?.items ??
      [];

    if (!Array.isArray(maybeItems)) {
      return [];
    }

    const normalized = maybeItems
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const rawDate =
          (entry as { date?: string }).date ??
          (entry as { pickupDate?: string }).pickupDate ??
          "";
        const rawType =
          (entry as { wasteType?: string }).wasteType ??
          (entry as { type?: string }).type ??
          "";

        const date = String(rawDate).trim();
        const wasteType = String(rawType).trim();

        if (!date || !wasteType) {
          return null;
        }

        return { date, wasteType };
      })
      .filter(Boolean) as ImportItem[];

    const deduped = new Map<string, ImportItem>();
    for (const item of normalized) {
      const key = `${item.date}__${item.wasteType.toLowerCase()}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
    }

    return Array.from(deduped.values());
  };

  const onPickImportFile = async () => {
    setImportError("");
    setIsImporting(true);
    setImportProgress(null);
    setImportRawText("");

    try {
      let fileUri = "";
      let fileName = "import.jpg";
      let mimeType = "image/jpeg";
      let pickedSize: number | null = null;

      if (Platform.OS === "web") {
        const result = await DocumentPicker.getDocumentAsync({
          type: ["image/*"],
          copyToCacheDirectory: true,
          multiple: false,
        });

        if (result.canceled || !result.assets?.length) {
          return;
        }

        const file = result.assets[0];
        fileUri = file.uri;
        fileName = file.name ?? fileName;
        mimeType = file.mimeType ?? mimeType;
        pickedSize =
          typeof (file as { size?: number }).size === "number"
            ? (file as { size?: number }).size ?? null
            : null;
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.status !== "granted") {
          const message = t('importNoGalleryPermission');
          setImportError(message);
          notify(t('error'), message);
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 1,
        });

        if (result.canceled || !result.assets?.length) {
          return;
        }

        const file = result.assets[0];
        fileUri = file.uri;
        fileName = file.fileName ?? `import_${Date.now()}.jpg`;
        mimeType = file.mimeType ?? mimeType;
      }

      let fileSize = pickedSize ?? 0;

      if (Platform.OS !== "web") {
        const fileInfo = await FileSystem.getInfoAsync(fileUri, { size: true });
        const infoSize =
          fileInfo.exists && "size" in fileInfo
            ? (fileInfo as FileSystem.FileInfo & { size?: number }).size ?? 0
            : 0;
        fileSize = pickedSize ?? infoSize;
      }

      if (fileSize > MAX_IMPORT_FILE_SIZE_BYTES) {
        const message = t('importTooLarge');
        setImportError(message);
        notify(t('error'), message);
        return;
      }

      const importViaEndpoint = async () => {
        if (!IMPORT_ENDPOINT) {
          throw new Error(t('importMissingEndpoint'));
        }

        setImportProgress(0.1);

        const dataBase64 =
          Platform.OS === "web"
            ? dataUrlToBase64(await readWebFileAsDataUrl(fileUri))
            : await FileSystem.readAsStringAsync(fileUri, {
                encoding: FileSystem.EncodingType.Base64,
              });

        setImportProgress(0.45);

        const response = await fetch(IMPORT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName,
            mimeType,
            dataBase64,
            locale: language,
          }),
        });

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim());
        }

        setImportProgress(0.85);
        const payload = await response.json();
        setImportProgress(1);
        const rawText =
          typeof (payload as { rawText?: string }).rawText === "string"
            ? (payload as { rawText?: string }).rawText
            : "";
        if (rawText) {
          setImportRawText(rawText);
        }
        return normalizeImportItems(payload);
      };

      const items = await importViaEndpoint();

      if (!items.length) {
        const message = t('importNoItems');
        setImportError(message);
        notify(t('error'), message);
        return;
      }

      setImportItems(items);
      setImportFileName(fileName);
      setShowImportRaw(false);
      setShowImportModal(true);

      if (db && userUid) {
        try {
          await setDoc(
            doc(db, "users", userUid),
            {
              importCount: increment(1),
              lastImportAt: Timestamp.now(),
            },
            { merge: true },
          );
        } catch {
          // best-effort only
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('importFileError');
      setImportError(message);
      notify(t('error'), message);
    } finally {
      setImportProgress(null);
      setIsImporting(false);
    }
  };

  const addImportedEvent = async (
    date: string,
    wasteType: string,
    notificationsAllowed: boolean,
  ) => {
    const normalizedDate = date.trim();
    const normalizedType = wasteType.trim();

    if (!normalizedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return { saved: false, reason: "invalid-date" };
    }

    if (isDateInPast(normalizedDate, getTodayKey())) {
      return { saved: false, reason: "past-date" };
    }

    if (!normalizedType) {
      return { saved: false, reason: "missing-type" };
    }

    const existingKey = `${normalizedDate}__${normalizedType.toLowerCase()}`;
    const existingSet = new Set(
      events.map((item) => `${item.date}__${item.wasteType.toLowerCase()}`),
    );

    if (existingSet.has(existingKey)) {
      return { saved: false, reason: "duplicate" };
    }

    const notificationId = notificationsAllowed
      ? await scheduleDayBeforeNotification(
          normalizedDate,
          normalizedType,
          notificationTime,
        )
      : undefined;

    if (!isAuthenticated) {
      return {
        saved: true,
        event: {
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          date: normalizedDate,
          wasteType: normalizedType,
          notificationId,
        } as TrashEvent,
      };
    }

    if (!db || !currentHouseholdId || !userUid) {
      throw new Error(t('noHouseholdError'));
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

    return {
      saved: true,
      event: {
        id: docRef.id,
        date: normalizedDate,
        wasteType: normalizedType,
        notificationId,
      } as TrashEvent,
    };
  };

  const onSaveImportedEvents = async () => {
    if (isSavingImports) {
      return;
    }

    if (!importItems.length) {
      setShowImportModal(false);
      return;
    }

    const firestore = db;
    if (isAuthenticated && (!firestore || !currentHouseholdId || !userUid)) {
      notify(t('error'), t('noHouseholdError'));
      return;
    }

    setIsSavingImports(true);

    try {
      const notificationsAllowed =
        Platform.OS === "web" ? false : await requestNotificationsPermission();

      let added = 0;
      let skipped = 0;
      const addedEvents: TrashEvent[] = [];

      for (const item of importItems) {
        try {
          const result = await addImportedEvent(
            item.date,
            item.wasteType,
            notificationsAllowed,
          );

          if (result.saved && result.event) {
            added += 1;
            addedEvents.push(result.event);
          } else {
            skipped += 1;
          }
        } catch {
          skipped += 1;
        }
      }

      if (addedEvents.length) {
        const nextEvents = sortEventsByDate([...events, ...addedEvents]);
        setEvents(nextEvents);

        if (!isAuthenticated) {
          await writeLocalEvents(nextEvents);
        }
      }

      notify(t('ok'), t('importSaved'));
      setShowImportModal(false);
      setImportItems([]);
      setImportFileName("");
      setImportRawText("");
      setShowImportRaw(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('failedAddEvent');
      notify(t('error'), message);
    } finally {
      setIsSavingImports(false);
    }
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
        tokenPreview: token ? `${token.slice(0, 14)}...` : t('none'),
        hasCredentials: Boolean(raw),
        savedEmail: parsed?.email?.trim() || t('none'),
        hasPassword: Boolean(parsed?.password),
        firebaseUid: firebaseUser?.uid ?? t('none'),
        firebaseEmail: firebaseUser?.email ?? t('none'),
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
      throw new Error(t('firebaseNotConfigured'));
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
      throw new Error(t('firebaseNotConfigured'));
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
        throw new Error(t('firestorePermissionError'));
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

        const credential = await loginUser(savedEmail, savedPassword);
        await ensureEmailVerified(credential.user);
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
    if (isAuthenticated) {
      setHasLoadedAnonymousData(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsEventsLoading(true);

      try {
        const [savedEvents, savedTime] = await Promise.all([
          readLocalEvents(),
          readLocalNotificationTime(),
        ]);

        const today = getTodayKey();
        const upcoming = savedEvents.filter((item) => !isDateInPast(item.date, today));
        const past = savedEvents.filter((item) => isDateInPast(item.date, today));

        if (past.length && Platform.OS !== "web") {
          for (const item of past) {
            if (!item.notificationId) {
              continue;
            }

            try {
              await Notifications.cancelScheduledNotificationAsync(item.notificationId);
            } catch {
              // ignore stale notification cleanup failures
            }
          }
        }

        if (past.length) {
          await writeLocalEvents(upcoming);
        }

        if (!cancelled) {
          setEvents(sortEventsByDate(upcoming));

          if (savedTime && isValidTimeHHmm(savedTime)) {
            setNotificationTime(savedTime);
            setNotificationTimeInput(savedTime);
          } else {
            setNotificationTime("19:00");
            setNotificationTimeInput("19:00");
          }
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
        }
      } finally {
        if (!cancelled) {
          setHasLoadedAnonymousData(true);
          setIsEventsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!showMenuModal) {
      setShowHouseholdHelp(false);
      setShowImportHelp(false);
    }
  }, [showMenuModal]);

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
              : t('failedLoadHousehold');
          notify(t('error'), message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userUid, userEmail]);

  useEffect(() => {
    if (!isAuthenticated || !isFirebaseConfigured || !db || !userUid || !currentHouseholdId) {
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

            const today = getTodayKey();
            const past = loaded.filter((item) => isDateInPast(item.date, today));
            const upcoming = loaded.filter(
              (item) => !isDateInPast(item.date, today),
            );

            setEvents(upcoming);
            setIsEventsLoading(false);

            if (past.length > 0) {
              cleanupPastEvents(past, today);
            }
          },
          () => {
            setIsEventsLoading(false);

            if (isSigningOutRef.current || !auth?.currentUser) {
              return;
            }

            notify(t('error'), t('accessDenied'));
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
            : t('failedLoadEvents');
        notify(t('error'), message);
      }
    })();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [currentHouseholdId, userUid, userEmail]);

  useEffect(() => {
    if (!isAuthenticated || !db || !userUid || !currentHouseholdId) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [localEvents, localTime] = await Promise.all([
          readLocalEvents(),
          readLocalNotificationTime(),
        ]);

        if (cancelled || (!localEvents.length && !localTime)) {
          return;
        }

        const householdRef = doc(db, "households", currentHouseholdId);
        const eventsRef = collection(householdRef, "events");
        const existingSnapshot = await getDocs(query(eventsRef, orderBy("date", "asc")));
        const existingKeys = new Set(
          existingSnapshot.docs.map((item) => {
            const data = item.data() as { date?: string; wasteType?: string };
            return `${data.date ?? ""}__${(data.wasteType ?? "").toLowerCase()}`;
          }),
        );

        for (const item of localEvents) {
          const key = `${item.date}__${item.wasteType.toLowerCase()}`;
          if (existingKeys.has(key)) {
            continue;
          }

          const payload: {
            date: string;
            wasteType: string;
            createdAt: Timestamp;
            householdId: string;
            createdByUid: string;
            createdByEmail?: string;
            notificationId?: string;
          } = {
            date: item.date,
            wasteType: item.wasteType,
            createdAt: Timestamp.now(),
            householdId: currentHouseholdId,
            createdByUid: userUid,
          };

          if (userEmail) {
            payload.createdByEmail = userEmail;
          }

          if (item.notificationId) {
            payload.notificationId = item.notificationId;
          }

          await addDoc(eventsRef, payload);
          existingKeys.add(key);
        }

        if (localTime && isValidTimeHHmm(localTime)) {
          await setDoc(
            doc(db, "users", userUid),
            {
              notificationTime: localTime,
              updatedAt: Timestamp.now(),
            },
            { merge: true },
          );
        }

        await Promise.all([
          removeStorageItem(LOCAL_EVENTS_KEY),
          removeStorageItem(LOCAL_NOTIFICATION_TIME_KEY),
        ]);
      } catch {
        // keep local backup if sync fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentHouseholdId, userUid, userEmail]);

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

    // build messages according to selected language using translation templates
    const title = t('tomorrowPickupTitle')
      .replace('{type}', type);
    const body = t('tomorrowPickupBody')
      .replace('{date}', date)
      .replace('{type}', type);

    return Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
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

  const updateLocalEventNotificationId = async (
    eventId: string,
    notificationId?: string,
  ) => {
    const localEvents = await readLocalEvents();
    let changed = false;

    const nextEvents = localEvents.map((item) => {
      if (item.id !== eventId) {
        return item;
      }

      changed = true;
      return {
        ...item,
        notificationId,
      };
    });

    if (!changed) {
      return false;
    }

    await writeLocalEvents(nextEvents);
    setEvents((previous) =>
      previous.map((item) =>
        item.id === eventId
          ? {
              ...item,
              notificationId,
            }
          : item,
      ),
    );

    return true;
  };

  const scheduleNotificationAfterSave = ({
    eventId,
    date,
    wasteType,
    householdId,
    storageMode,
  }: {
    eventId: string;
    date: string;
    wasteType: string;
    householdId?: string;
    storageMode: "cloud" | "local";
  }) => {
    void (async () => {
      const hasPermission = await requestNotificationsPermission();

      if (!hasPermission) {
        notify(
          t('notificationsTitle'),
          t('noPermissionNotifications'),
        );
        return;
      }

      const notificationId = await scheduleDayBeforeNotification(
        date,
        wasteType,
        notificationTime,
      );

      if (!notificationId) {
        notify(
          t('notificationsTitle'),
          t('reminderPast'),
        );
        return;
      }

      if (storageMode === "local") {
        await updateLocalEventNotificationId(eventId, notificationId);
        return;
      }

      if (!db || !householdId) {
        return;
      }

      await updateDoc(
        doc(db, "households", householdId, "events", eventId),
        {
          notificationId,
          updatedAt: Timestamp.now(),
        },
      );

      setEvents((previous) =>
        previous.map((item) =>
          item.id === eventId
            ? {
                ...item,
                notificationId,
              }
            : item,
        ),
      );
    })().catch(() => {
      // best-effort scheduling after the event is already saved
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

  const cleanupPastEvents = async (items: TrashEvent[], today: string) => {
    if (!items.length || !db || !currentHouseholdId) {
      return;
    }

    for (const item of items) {
      if (!isDateInPast(item.date, today)) {
        continue;
      }

      try {
        if (item.notificationId && Platform.OS !== "web") {
          await Notifications.cancelScheduledNotificationAsync(
            item.notificationId,
          );
        }

        await deleteDoc(
          doc(db, "households", currentHouseholdId, "events", item.id),
        );
      } catch {
        // best-effort cleanup only
      }
    }
  };

  const onRegister = async () => {
    setRegisterError("");
    const normalizedEmail = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      const msg = t('enterValidEmail');
      setRegisterError(msg);
      notify(t('registrationError'), msg);
      return;
    }

    if (password.length < 6) {
      const msg = t('passwordTooShort');
      setRegisterError(msg);
      notify(t('registrationError'), msg);
      return;
    }

    if (!db) {
      const msg = t('firebaseNotConfigured');
      setRegisterError(msg);
      notify(t('error'), msg);
      return;
    }

    // Sprawdź format kodu gospodarstwa ZANIM utworzymy konto w Firebase
    const inputCode = normalizeCode(householdInviteCode);
    if (inputCode && !/^[A-Z0-9]{6}$/.test(inputCode)) {
      const msg = t('invalidHouseholdCode');
      setRegisterError(msg);
      notify(t('registrationError'), msg);
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
          const msg = t('householdNotFound');
          setRegisterError(msg);
          notify(t('registrationError'), msg);
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

      try {
        await sendEmailVerification(credential.user);
      } catch (error) {
        const message = error instanceof Error ? error.message : t('verificationFailed');
        notify(t('error'), message);
      }

      if (auth) {
        await signOut(auth);
      }
      await clearSessionCredentials();
      setHouseholdInviteCode("");
      setRegisterError("");
      notify(t('ok'), t('verificationSent'));
    } catch (error) {
      const msg = parseAuthErrorMessage(error);
      setRegisterError(msg);
      notify(t('registrationError'), msg);
    } finally {
      setIsRegistering(false);
    }
  };

  const onLogin = async () => {
    setLoginError("");
    setNeedsEmailVerification(false);
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      const msg = t('enterEmail');
      setLoginError(msg);
      notify(t('loginError'), msg);
      emailRef.current?.focus?.();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      const msg = t('enterValidEmail');
      setLoginError(msg);
      notify(t('loginError'), msg);
      emailRef.current?.focus?.();
      return;
    }

    if (!password) {
      const msg = t('enterPassword');
      setLoginError(msg);
      notify(t('loginError'), msg);
      passwordRef.current?.focus?.();
      return;
    }

    if (password.length < 6) {
      const msg = t('passwordTooShort');
      setLoginError(msg);
      notify(t('loginError'), msg);
      passwordRef.current?.focus?.();
      return;
    }

    setIsLoggingIn(true);
    try {
      try {
        const credential = await loginUser(normalizedEmail, password);
        try {
          await ensureEmailVerified(credential.user);
        } catch (verifyError) {
          const msg = parseAuthErrorMessage(verifyError);
          setLoginError(msg);
          setNeedsEmailVerification(true);
          notify(t('loginError'), msg);
          return;
        }
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
        notify(t('loginError'), msg);
        return;
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const onResendVerification = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      notify(t('loginError'), t('enterEmail'));
      return;
    }

    setIsLoggingIn(true);
    try {
      const credential = await loginUser(normalizedEmail, password);
      await sendEmailVerification(credential.user);
      if (auth) {
        await signOut(auth);
      }
      await clearSessionCredentials();
      notify(t('ok'), t('verificationSent'));
      setNeedsEmailVerification(false);
    } catch (error) {
      const msg = parseAuthErrorMessage(error);
      notify(t('loginError'), msg || t('verificationFailed'));
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
        error instanceof Error ? error.message : t('failedLogout');
      notify(t('error'), message);
    }
  };

  const onGoogleSignIn = async () => {
    if (!auth) {
      notify(t('error'), t('firebaseNotConfigured'));
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      if (Platform.OS === "web") {
        if (!GOOGLE_WEB_CLIENT_ID) {
          notify(t('loginError'), t('googleClientMissing'));
          return;
        }

        const provider = new GoogleAuthProvider();
        const credential = await signInWithPopup(auth, provider);
        const uid = credential.user.uid;
        const mail = credential.user.email ?? null;
        setUserEmail(mail);
        setUserUid(uid);
        await ensureUserHousehold(uid, mail);
        return;
      }

      if (!hasGoogleClientIds || !googleRequest) {
        notify(t('loginError'), t('googleClientMissing'));
        return;
      }

      const result = await promptGoogleSignIn();
      if (result?.type !== "success") {
        return;
      }

      const { id_token: idToken, access_token: accessToken } = result.params ?? {};
      if (!idToken && !accessToken) {
        notify(t('loginError'), t('googleSignInFailed'));
        return;
      }

      const credential = GoogleAuthProvider.credential(idToken, accessToken);
      const signedIn = await signInWithCredential(auth, credential);
      const uid = signedIn.user.uid;
      const mail = signedIn.user.email ?? null;
      setUserEmail(mail);
      setUserUid(uid);
      await ensureUserHousehold(uid, mail);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('googleSignInFailed');
      setLoginError(message);
      notify(t('loginError'), message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const onSendFeedback = async () => {
    if (isSendingFeedback) {
      return;
    }

    const subject = feedbackSubject.trim();
    const message = feedbackMessage.trim();

    if (!subject || !message) {
      const msg = t('feedbackMissing');
      setFeedbackError(msg);
      notify(t('error'), msg);
      return;
    }

    if (!FEEDBACK_ENDPOINT) {
      const msg = t('feedbackMissingEndpoint');
      setFeedbackError(msg);
      notify(t('error'), msg);
      return;
    }

    setIsSendingFeedback(true);
    setFeedbackError("");

    try {
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          message,
          userUid,
          userEmail,
          appVersion: appVersionLabel,
          platform: Platform.OS,
          locale: language,
        }),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }

      setFeedbackSubject("");
      setFeedbackMessage("");
      setShowFeedbackModal(false);
      notify(t('ok'), t('feedbackSent'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('feedbackFailed');
      setFeedbackError(msg);
      notify(t('error'), msg);
    } finally {
      setIsSendingFeedback(false);
    }
  };

  const onAddEvent = async () => {
    const normalizedDate = eventDate.trim();
    const normalizedType =
      selectedWasteType === OTHER_WASTE_LABEL
        ? customWasteType.trim()
        : selectedWasteType.trim();

    if (!normalizedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const message = t('dateFormatError');
      setModalError(message);
      notify(t('error'), message);
      return false;
    }

    if (isDateInPast(normalizedDate, getTodayKey())) {
      const message = t('pastDateError');
      setModalError(message);
      notify(t('error'), message);
      return false;
    }

    if (!normalizedType) {
      const message = t('wasteTypeError');
      setModalError(message);
      notify(t('error'), message);
      return false;
    }

    if (isAuthenticated && !currentHouseholdId) {
      const message = t('noHouseholdError');
      setModalError(message);
      notify(t('error'), message);
      return false;
    }

    if (isAuthenticated && !userUid) {
      const message = t('noUserError');
      setModalError(message);
      notify(t('error'), message);
      return false;
    }

    try {
      if (isAuthenticated && !db) {
        const message = t('firebaseNotConfigured');
        setModalError(message);
        notify(t('error'), message);
        return false;
      }

      if (!isAuthenticated) {
        const localEvent: TrashEvent = {
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          date: normalizedDate,
          wasteType: normalizedType,
        };

        const nextEvents = sortEventsByDate([
          ...events.filter((item) => item.id !== localEvent.id),
          localEvent,
        ]);

        setEvents(nextEvents);
        await writeLocalEvents(nextEvents);

        scheduleNotificationAfterSave({
          eventId: localEvent.id,
          date: normalizedDate,
          wasteType: normalizedType,
          storageMode: "local",
        });
      } else {
        const householdRef = doc(db!, "households", currentHouseholdId!);
        const eventsRef = collection(householdRef, "events");

        const eventPayload: {
          date: string;
          wasteType: string;
          createdAt: Timestamp;
          householdId: string;
          createdByUid: string;
          createdByEmail?: string;
        } = {
          date: normalizedDate,
          wasteType: normalizedType,
          createdAt: Timestamp.now(),
          householdId: currentHouseholdId!,
          createdByUid: userUid!,
        };

        if (userEmail) {
          eventPayload.createdByEmail = userEmail;
        }

        const docRef = await addDoc(eventsRef, eventPayload);

        setEvents((previous) =>
          sortEventsByDate([
            ...previous.filter((item) => item.id !== docRef.id),
            {
              id: docRef.id,
              date: normalizedDate,
              wasteType: normalizedType,
            },
          ]),
        );

        scheduleNotificationAfterSave({
          eventId: docRef.id,
          date: normalizedDate,
          wasteType: normalizedType,
          householdId: currentHouseholdId!,
          storageMode: "cloud",
        });
      }

      setEventDate("");
      setSelectedWasteType(WASTE_TYPES[language][0]);
      setCustomWasteType("");
      setIsWasteTypeDropdownOpen(false);
      setModalError("");
      return true;
    } catch (error) {
      let message =
        error instanceof Error
          ? error.message
          : t('failedAddEvent');
      if (
        message.includes("permission-denied") ||
        message.includes("Missing or insufficient permissions")
      ) {
        message = t('firestorePermissionError');
      }

      setModalError(message);
      notify(t('error'), message);
      return false;
    }
  };

  const onCalendarDayPress = (day: { dateString: string }) => {
    if (isDateInPast(day.dateString, getTodayKey())) {
      notify(t('error'), t('pastDateError'));
      return;
    }
    setEventDate(day.dateString);

    const existingEvent = events.find((item) => item.date === day.dateString);
    if (existingEvent) {
      const matchedType = WASTE_TYPES[language].find(
        (type) =>
          type.toLowerCase() === existingEvent.wasteType.trim().toLowerCase(),
      );

      if (matchedType) {
        setSelectedWasteType(matchedType);
        setCustomWasteType("");
      } else {
        setSelectedWasteType(OTHER_WASTE_LABEL);
        setCustomWasteType(existingEvent.wasteType);
      }
    } else {
      setSelectedWasteType(WASTE_TYPES[language][0]);
      setCustomWasteType("");
    }

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
      if (item.notificationId && Platform.OS !== "web") {
        await Notifications.cancelScheduledNotificationAsync(
          item.notificationId,
        );
      }

      if (!isAuthenticated) {
        const nextEvents = events.filter((event) => event.id !== item.id);
        setEvents(nextEvents);
        await writeLocalEvents(nextEvents);
        return;
      }

      if (!db || !currentHouseholdId) {
        notify(t('error'), t('firebaseNotConfigured'));
        return;
      }

      await deleteDoc(
        doc(db, "households", currentHouseholdId, "events", item.id),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('failedDeleteEvent');
      notify(t('error'), message);
    }
  };

  const onSaveNotificationTime = async () => {
    const normalizedTime = notificationTimeInput.trim();

    if (!isValidTimeHHmm(normalizedTime)) {
      notify(t('error'), t('formatHHmmError'));
      return;
    }

    try {
      setIsSavingNotificationTime(true);

      let rescheduleResult;

      if (!isAuthenticated) {
        await writeLocalNotificationTime(normalizedTime);
        setNotificationTime(normalizedTime);
        setNotificationTimeInput(normalizedTime);

        const permissionGranted =
          Platform.OS === "web" ? false : await requestNotificationsPermission();

        if (!permissionGranted) {
          notify(
            t('notificationsTitle'),
            t('noPermissionReschedule'),
          );
          return;
        }

        let updated = 0;
        let skipped = 0;
        const nextEvents: TrashEvent[] = [];

        for (const item of events) {
          const notificationId = await scheduleDayBeforeNotification(
            item.date,
            item.wasteType,
            normalizedTime,
          );

          if (item.notificationId) {
            try {
              await Notifications.cancelScheduledNotificationAsync(item.notificationId);
            } catch {
              // ignore stale ids
            }
          }

          if (!notificationId) {
            skipped += 1;
            nextEvents.push({ ...item, notificationId: undefined });
            continue;
          }

          updated += 1;
          nextEvents.push({ ...item, notificationId });
        }

        setEvents(nextEvents);
        await writeLocalEvents(nextEvents);
        rescheduleResult = { updated, skipped, permissionGranted: true };
      } else {
        if (!db || !userUid) {
          notify(t('error'), t('noUserData'));
          return;
        }

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
        rescheduleResult = await rescheduleFutureEventNotifications(normalizedTime);
      }

      if (!rescheduleResult.permissionGranted) {
        notify(
          t('notificationsTitle'),
          t('noPermissionReschedule'),
        );
        return;
      }

      notify(t('ok'), t('actionSuccess'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('failedSaveTime');
      notify(t('error'), message);
    } finally {
      setIsSavingNotificationTime(false);
    }
  };

  const onSendTestNotification = async () => {
    if (Platform.OS === "web") {
      notify(t('ok'), t('onlyOnPhone'));
      return;
    }

    if (isSendingTestNotification) {
      return;
    }

    try {
      setIsSendingTestNotification(true);
      const hasPermission = await requestNotificationsPermission();

      if (!hasPermission) {
        notify(t('notificationsTitle'),
          t('noPermissionAndroid'),
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
          title: t('testNotifTitle'),
          body: t('testNotifBody'),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
          channelId: Platform.OS === "android" ? "trash-reminders" : undefined,
        },
      });

      notify(t('ok'), t('testNotification'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('failedTestSchedule');
      notify(t('error'), message);
    } finally {
      setIsSendingTestNotification(false);
    }
  };

  const onClearAllEvents = async () => {
    if (isClearingAllEvents) {
      return;
    }

    setIsClearingAllEvents(true);

    try {
      if (Platform.OS !== "web") {
        try {
          await Notifications.cancelAllScheduledNotificationsAsync();
        } catch {
          // best-effort
        }
      }

      if (!isAuthenticated) {
        setEvents([]);
        await writeLocalEvents([]);
        setShowClearAllModal(false);
        setShowMenuModal(false);
        notify(t('ok'), t('clearAllDone'));
        return;
      }

      const firestore = db;
      if (!firestore || !currentHouseholdId || !userUid) {
        notify(t('error'), t('noHouseholdError'));
        return;
      }

      const eventsRef = collection(
        doc(firestore, "households", currentHouseholdId),
        "events",
      );
      const q = query(eventsRef, where("createdByUid", "==", userUid));
      const snapshot = await getDocs(q);
      const userEventIds = new Set(snapshot.docs.map((docSnap) => docSnap.id));

      await Promise.all(
        snapshot.docs.map((docSnap) =>
          deleteDoc(
            doc(firestore, "households", currentHouseholdId, "events", docSnap.id),
          ),
        ),
      );

      setEvents((previous) =>
        previous.filter((item) => !userEventIds.has(item.id)),
      );
      setShowClearAllModal(false);
      setShowMenuModal(false);
      notify(t('ok'), t('clearAllDone'));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('clearAllFailed');
      notify(t('error'), message);
    } finally {
      setIsClearingAllEvents(false);
    }
  };

  if (!isFirebaseConfigured) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: theme.pageBg }]}
        contentContainerStyle={[
          styles.containerContent,
          { paddingTop: topContentInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* {isDevBuild && (
          <Text style={styles.versionBadge}>{appVersionLabel}</Text>
        )} */}
        <View
          style={[
            styles.headerCard,
            { backgroundColor: theme.cardBg, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.title, { color: theme.textPrimary }]}>
            {t('firebaseConfigTitle')}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            {t('firebaseConfigSubtitle')}
          </Text>
        </View>
      </ScrollView>
    );
  }

  if (isMainContentLoading) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.pageBg, justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={[styles.loaderText, { color: theme.textMuted, marginTop: 12 }]}>
          {t('loadingNotifications')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.pageBg }]}>
      {/* {isDevBuild && (
        <Text style={styles.versionBadge}>{appVersionLabel}</Text>
      )} */}
      <ScrollView
        contentContainerStyle={[
          styles.containerContent,
          { paddingTop: topContentInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={[
              styles.hamburgerButton,
              { backgroundColor: theme.buttonBg, borderColor: theme.border },
            ]}
            onPress={() => setShowMenuModal(true)}
          >
            <Text style={[styles.hamburgerIcon, { color: theme.textPrimary }]}>
              ☰
            </Text>
          </TouchableOpacity>
          <Text style={[styles.topBarTitle, { color: theme.textPrimary }]}>
            {t('topBarTitle')}
          </Text>
        </View>

        <View
          style={[styles.card, { backgroundColor: theme.panelBg, borderColor: theme.border }]}
        >
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}> 
            {t('calendarSection')}
          </Text>
          <Calendar
            key={`calendar-${themeName}`}
            onDayPress={onCalendarDayPress}
            markedDates={markedDates}
            markingType="custom"
            firstDay={1}
            minDate={todayKey}
            hideExtraDays
            enableSwipeMonths
            monthFormat="MMM yyyy"
            renderArrow={(direction) => (
              <View
                style={[
                  styles.calendarArrow,
                  { borderColor: theme.border, backgroundColor: theme.buttonBg },
                ]}
              >
                <Text style={[styles.calendarArrowText, { color: theme.textPrimary }]}
                >
                  {direction === "left" ? "‹" : "›"}
                </Text>
              </View>
            )}
            theme={{
              calendarBackground: isLight ? "#ffffff" : theme.cardBg,
              textSectionTitleColor:
                isLight ? "#475569" : theme.textMuted,
              dayTextColor: isLight ? "#0f172a" : theme.textPrimary,
              monthTextColor: isLight ? "#0f172a" : theme.textPrimary,
              arrowColor: theme.accent,
              todayTextColor: theme.accent,
              selectedDayTextColor: theme.onPrimary,
              textDisabledColor:
                isLight ? "#94a3b8" : theme.textMuted,
              textDayFontWeight: "600",
              textMonthFontWeight: "700",
              textDayHeaderFontWeight: "600",
              textDayFontSize: 14,
              textMonthFontSize: 16,
              textDayHeaderFontSize: 12,
              arrowStyle: {
                padding: 4,
              },
              "stylesheet.day.basic": {
                base: {
                  color: isLight ? "#0f172a" : theme.textPrimary,
                  fontWeight: "600",
                  backgroundColor: isLight ? "#ffffff" : "transparent",
                  width: CALENDAR_DAY_SIZE,
                  height: CALENDAR_DAY_SIZE,
                  alignItems: "center",
                  justifyContent: "center",
                },
                today: {
                  color: theme.accent,
                  fontWeight: "800",
                },
                disabledText: {
                  color: theme.textMuted,
                },
              },
              "stylesheet.calendar.main": {
                container: {
                  backgroundColor:
                    isLight ? "#ffffff" : theme.cardBg,
                },
                monthView: {
                  backgroundColor: isLight ? "#ffffff" : theme.cardBg,
                },
                week: {
                  marginTop: 4,
                  marginBottom: 4,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  backgroundColor: isLight ? "#ffffff" : theme.cardBg,
                },
                dayContainer: {
                  flex: 1,
                  alignItems: "center",
                },
              },
              "stylesheet.calendar.header": {
                header: {
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingTop: 6,
                  paddingBottom: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                  marginBottom: 6,
                  paddingHorizontal: 0,
                  gap: 6,
                  backgroundColor:
                    isLight ? "#ffffff" : theme.cardBg,
                },
                headerContainer: {
                  flex: 1,
                  minWidth: 0,
                  flexDirection: "row",
                  justifyContent: "center",
                  alignItems: "center",
                },
                monthText: {
                  color: isLight ? "#0f172a" : theme.textPrimary,
                  fontWeight: "700",
                  textAlign: "center",
                  alignSelf: "center",
                  flex: 1,
                  flexShrink: 1,
                  minWidth: 0,
                  margin: 0,
                  marginHorizontal: 2,
                },
                dayHeader: {
                  color: isLight ? "#475569" : theme.textMuted,
                  fontWeight: "600",
                  textTransform: "uppercase",
                },
              },
            } as any}
            style={[
              styles.calendar,
              {
                backgroundColor: isLight ? "#ffffff" : theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          />

          <Text style={[styles.selectedDateLabel, { color: theme.textMuted }]}> 
            {t('clickToAdd')}
          </Text>
        </View>

        <View
          style={[styles.card, { backgroundColor: theme.panelBg, borderColor: theme.border }]}
        >
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}> 
            {t('scheduledPickups')}
          </Text>
          {isEventsLoading ? (
            <View style={styles.loaderBox}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={[styles.loaderText, { color: theme.textMuted }]}
              >
                {t('loadingNotifications')}
              </Text>
            </View>
          ) : (
            <SectionList
              sections={groupedEvents}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={[styles.muted, { color: theme.textMuted }]}> 
                  {t('noEvents')}
                </Text>
              }
              renderSectionHeader={({ section }) => (
                <Text style={[styles.sectionHeader, { color: theme.textPrimary }]}> 
                  {section.title}
                </Text>
              )}
              renderItem={({ item }) => {
                const locale = language === "pl" ? "pl-PL" : "en-US";
                const dayLabel = formatDayLabel(
                  item.date,
                  locale,
                  language === "pl",
                );

                return (
                  <View
                    style={[
                      styles.eventRowCompact,
                      { backgroundColor: theme.cardBg, borderColor: theme.border },
                    ]}
                  >
                    <View style={styles.eventContent}>
                      <Text
                        style={[styles.eventTextCompact, { color: theme.textPrimary }]}
                      >
                        {dayLabel}
                      </Text>
                      <Text style={[styles.eventMetaText, { color: theme.textMuted }]}> 
                        {item.wasteType}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.deleteButton, { backgroundColor: theme.dangerBg }]}
                      onPress={() => onDeleteEvent(item)}
                    >
                      <Text
                        style={[styles.deleteButtonText, { color: theme.dangerText, textTransform: "lowercase" }]}
                      >
                        {t('delete')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
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
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.cardBg, borderColor: theme.border },
            ]}
          >
            {isDevBuild && importRawText ? (
              <TouchableOpacity
                style={[styles.importRawToggle, { backgroundColor: theme.buttonBg }]}
                onPress={() => setShowImportRaw((prev) => !prev)}
              >
                <Text style={[styles.importRawToggleText, { color: theme.textPrimary }]}> 
                  {showImportRaw ? t('importHideRaw') : t('importShowRaw')}
                </Text>
              </TouchableOpacity>
            ) : null}
            {isDevBuild && showImportRaw && importRawText ? (
              <View style={styles.importRawBlock}>
                <Text style={[styles.importRawLabel, { color: theme.textMuted }]}> 
                  {t('importRawLabel')}
                </Text>
                <ScrollView
                  style={styles.importRawScroll}
                  contentContainerStyle={styles.importRawContent}
                >
                  <Text style={[styles.importRawText, { color: theme.textSecondary }]}> 
                    {importRawText}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}> 
              {t('addTrashTitle')}
            </Text>
            <Text style={[styles.modalSubtitle, { color: theme.textMuted }]}> 
              {t('dateLabel')}{eventDate}
            </Text>

            <TouchableOpacity
              style={[
                styles.dropdownTrigger,
                { borderColor: theme.border, backgroundColor: theme.inputBg },
              ]}
              onPress={() =>
                setIsWasteTypeDropdownOpen((previous) => !previous)
              }
            >
              <Text style={[styles.dropdownTriggerText, { color: theme.textPrimary }]}> 
                {selectedWasteType}
              </Text>
              <Text style={[styles.dropdownChevron, { color: theme.textMuted }]}> 
                {isWasteTypeDropdownOpen ? "▴" : "▾"}
              </Text>
            </TouchableOpacity>

            {isWasteTypeDropdownOpen ? (
              <View
                style={[
                  styles.dropdownList,
                  { borderColor: theme.border, backgroundColor: theme.pageBg },
                ]}
              >
                {WASTE_TYPES[language].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.dropdownItem,
                      { borderBottomColor: theme.border },
                    ]}
                    onPress={() => {
                      setSelectedWasteType(type);
                      if (type !== OTHER_WASTE_LABEL) {
                        setCustomWasteType("");
                      }
                      setIsWasteTypeDropdownOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        { color: theme.textSecondary },
                        selectedWasteType === type &&
                          [styles.dropdownItemTextSelected, { color: theme.accent }],
                      ]}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {selectedWasteType === OTHER_WASTE_LABEL ? (
              <TextInput
                value={customWasteType}
                onChangeText={setCustomWasteType}
                placeholder={t('otherPlaceholder')}
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.input,
                  { borderColor: theme.border, backgroundColor: theme.inputBg, color: theme.textPrimary },
                ]}
              />
            ) : null}

            {modalError ? (
              <Text style={styles.modalError}>{modalError}</Text>
            ) : null}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  isSavingEvent && styles.disabledButton,
                ]}
                onPress={onConfirmWasteType}
                disabled={isSavingEvent}
              >
                <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>
                  {isSavingEvent ? t('saving') : t('save')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: theme.buttonBg }]}
                onPress={() => {
                  setShowWasteModal(false);
                  setIsWasteTypeDropdownOpen(false);
                }}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.textPrimary }]}> 
                  {t('cancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showImportModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowImportModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.cardBg, borderColor: theme.border },
            ]}
          >
            {isDevBuild && importRawText ? (
              <TouchableOpacity
                style={[styles.importRawToggle, { backgroundColor: theme.buttonBg }]}
                onPress={() => setShowImportRaw((prev) => !prev)}
              >
                <Text style={[styles.importRawToggleText, { color: theme.textPrimary }]}> 
                  {showImportRaw ? t('importHideRaw') : t('importShowRaw')}
                </Text>
              </TouchableOpacity>
            ) : null}
            {isDevBuild && showImportRaw && importRawText ? (
              <View style={styles.importRawBlock}>
                <Text style={[styles.importRawLabel, { color: theme.textMuted }]}> 
                  {t('importRawLabel')}
                </Text>
                <ScrollView
                  style={styles.importRawScroll}
                  contentContainerStyle={styles.importRawContent}
                >
                  <Text style={[styles.importRawText, { color: theme.textSecondary }]}> 
                    {importRawText}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
            <View style={styles.importReviewHeader}>
              <Text style={[styles.importReviewTitle, { color: theme.textPrimary }]}> 
                {t('importReviewTitle')}
              </Text>
              <Text style={[styles.importReviewHint, { color: theme.textMuted }]}> 
                {t('importScrollHint')}
              </Text>
            </View>
            <View
              style={[
                styles.importListShell,
                { borderColor: theme.border, backgroundColor: theme.panelBg },
              ]}
            >
              <ScrollView
                style={styles.importList}
                contentContainerStyle={styles.importListContent}
                showsVerticalScrollIndicator
                persistentScrollbar
              >
                {groupedImportItems.map((section) => (
                  <View key={section.key} style={styles.importSection}>
                    <Text
                      style={[styles.importSectionTitle, { color: theme.textPrimary }]}
                    >
                      {section.title}
                    </Text>
                    <View style={styles.importGrid}>
                      {section.items.map((item, index) => {
                        const day = parseDateKey(item.date).day;
                        const cardColor = getWasteTypeColor(item.wasteType);
                        const cardTextColor = getContrastTextColor(cardColor);

                        return (
                          <View
                            key={`${item.date}-${index}`}
                            style={[styles.importCard, { backgroundColor: cardColor }]}
                          >
                            <Text
                              style={[
                                styles.importCardTypeTop,
                                { color: cardTextColor },
                              ]}
                            >
                              {item.wasteType}
                            </Text>
                            <Text
                              style={[styles.importCardDay, { color: cardTextColor }]}
                            >
                              {day || "—"}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <View
                pointerEvents="none"
                style={[
                  styles.importListScrollCue,
                  { borderTopColor: theme.border, backgroundColor: theme.cardBg },
                ]}
              >
                <Text style={[styles.importListScrollCueText, { color: theme.textMuted }]}> 
                  {t('importScrollHint')}
                </Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  isSavingImports && styles.disabledButton,
                ]}
                onPress={onSaveImportedEvents}
                disabled={isSavingImports}
              >
                <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}> 
                  {isSavingImports ? t('importSaving') : t('importSaveAll')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: theme.buttonBg }]}
                onPress={() => setShowImportModal(false)}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.textPrimary }]}> 
                  {t('cancel')}
                </Text>
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
            style={[
              styles.menuPanel,
              { backgroundColor: theme.cardBg, borderRightColor: theme.border },
            ]}
            contentContainerStyle={styles.menuPanelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.menuHeader}>
              <Text style={[styles.menuTitle, { color: theme.textPrimary }]}> 
                {t('account')}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('closeSidebar')}
                style={[
                  styles.menuCloseButton,
                  { backgroundColor: theme.buttonBg, borderColor: theme.border },
                ]}
                onPress={() => setShowMenuModal(false)}
              >
                <Text style={[styles.menuCloseText, { color: theme.textPrimary }]}>x</Text>
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.menuUserBox,
                { backgroundColor: theme.panelBg, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.menuUserLabel, { color: theme.textMuted }]}> 
                {t('settingsTitle')}
              </Text>
              <View style={styles.menuSettingsRow}>
                <Text style={[styles.menuSettingLabel, { color: theme.textPrimary }]}> 
                  {t('themeLabel')}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.themeToggle,
                    { backgroundColor: theme.buttonBg, borderColor: theme.border },
                  ]}
                  onPress={toggleTheme}
                >
                  <Text style={[styles.themeToggleIcon, { color: theme.textPrimary }]}> 
                    {themeName === "dark" ? "☀" : "☾"}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.menuSettingsRow}>
                <Text style={[styles.menuSettingLabel, { color: theme.textPrimary }]}> 
                  {t('languageLabel')}
                </Text>
                <View style={styles.langSwitch}>
                  <TouchableOpacity onPress={() => setLanguage('pl')}>
                    <Text
                      style={[
                        styles.langOption,
                        { color: theme.textMuted },
                        language === 'pl' && [styles.langOptionSelected, { color: theme.textPrimary }],
                      ]}
                    >
                      PL
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setLanguage('en')}>
                    <Text
                      style={[
                        styles.langOption,
                        { color: theme.textMuted },
                        language === 'en' && [styles.langOptionSelected, { color: theme.textPrimary }],
                      ]}
                    >
                      EN
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            {isAuthenticated ? (
            <View
              style={[
                styles.menuUserBox,
                { backgroundColor: theme.panelBg, borderColor: theme.border },
              ]}
            >
              <View style={styles.menuLabelRow}>
                <Text style={[styles.menuUserLabel, { color: theme.textMuted }]}> 
                  {t('householdCode')}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.infoButton,
                    { borderColor: theme.border, backgroundColor: theme.buttonBg },
                  ]}
                  onPress={() =>
                    setShowHouseholdHelp((previous) => !previous)
                  }
                >
                  <Text style={[styles.infoButtonText, { color: theme.textPrimary }]}> 
                    i
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.menuSecretCode, { color: theme.accent }]}> 
                {householdSecretCode || "—"}
              </Text>
              {showHouseholdHelp ? (
                <Text style={[styles.tooltipText, { color: theme.textMuted }]}> 
                  {t('householdTooltip')}
                </Text>
              ) : null}
            </View>
            ) : null}

            <View
              style={[
                styles.menuUserBox,
                { backgroundColor: theme.panelBg, borderColor: theme.border },
              ]}
            >
              <View style={styles.menuLabelRow}>
                <Text style={[styles.menuUserLabel, { color: theme.textMuted }]}> 
                  {t('importMenuTitle')}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.infoButton,
                    { borderColor: theme.border, backgroundColor: theme.buttonBg },
                  ]}
                  onPress={() =>
                    setShowImportHelp((previous) => !previous)
                  }
                >
                  <Text style={[styles.infoButtonText, { color: theme.textPrimary }]}> 
                    i
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.muted, { color: theme.textMuted }]}> 
                {t('importMenuHint')}
              </Text>
              {showImportHelp ? (
                <Text style={[styles.tooltipText, { color: theme.textMuted }]}> 
                  {t('importHelpText')}
                </Text>
              ) : null}
              {!isAiAvailable ? (
                <Text style={[styles.tooltipText, { color: theme.textMuted }]}> 
                  {t('importMissingEndpoint')}
                </Text>
              ) : null}
              <View style={styles.menuActionSpacing}>
                <TouchableOpacity
                  style={[
                    styles.menuActionButton,
                    styles.menuActionButtonPrimary,
                    { backgroundColor: theme.primary },
                    (!isAiAvailable || isImporting) && styles.disabledButton,
                  ]}
                  onPress={onPickImportFile}
                  disabled={!isAiAvailable || isImporting}
                >
                  <View style={styles.menuActionContent}>
                    <View style={[styles.menuActionBadge, { backgroundColor: "rgba(255, 255, 255, 0.18)" }]}>
                      <Text style={[styles.menuActionBadgeText, { color: theme.onPrimary }]}>IMG</Text>
                    </View>
                    <View style={styles.menuActionTextWrap}>
                      <Text style={[styles.menuActionEyebrow, { color: theme.onPrimary }]}>
                        {t('importActionHint')}
                      </Text>
                      <Text style={[styles.menuActionTitle, { color: theme.onPrimary }]}> 
                        {isImporting ? t('importProcessing') : t('importMenuButton')}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
              {typeof importProgress === "number" ? (
                <View style={styles.importProgressBlock}>
                  <Text style={[styles.importProgressLabel, { color: theme.textMuted }]}> 
                    {t('importProgressLabel')}
                  </Text>
                  <View
                    style={[
                      styles.importProgressTrack,
                      { backgroundColor: theme.inputBg, borderColor: theme.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.importProgressFill,
                        { width: `${Math.round(importProgress * 100)}%`, backgroundColor: theme.accent },
                      ]}
                    />
                  </View>
                  <Text style={[styles.importProgressValue, { color: theme.textSecondary }]}> 
                    {Math.round(importProgress * 100)}%
                  </Text>
                </View>
              ) : null}
              {importError ? (
                <Text style={styles.modalError}>{importError}</Text>
              ) : null}
            </View>
            <View
              style={[
                styles.menuUserBox,
                { backgroundColor: theme.panelBg, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.menuUserLabel, { color: theme.textMuted }]}> 
                {t('reminderTime')}
              </Text>
              <Text style={[styles.menuSectionHint, { color: theme.textMuted }]}> 
                {t('reminderTimeHint')}
              </Text>
              <TextInput
                value={notificationTimeInput}
                onChangeText={setNotificationTimeInput}
                placeholder={t('timePlaceholder')}
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.menuInput,
                  { borderColor: theme.border, backgroundColor: theme.inputBg, color: theme.textPrimary },
                ]}
              />
              <View style={styles.menuActionSpacing}>
                <TouchableOpacity
                  style={[
                    styles.menuActionButton,
                    styles.menuActionButtonSoft,
                    { backgroundColor: theme.primary },
                    isSavingNotificationTime && styles.disabledButton,
                  ]}
                  onPress={onSaveNotificationTime}
                  disabled={isSavingNotificationTime}
                >
                  <View style={styles.menuActionContent}>
                    <View style={[styles.menuActionBadge, { backgroundColor: "rgba(255, 255, 255, 0.18)" }]}>
                      <Text style={[styles.menuActionBadgeText, { color: theme.onPrimary }]}>HH</Text>
                    </View>
                    <View style={styles.menuActionTextWrap}>
                      <Text style={[styles.menuActionEyebrow, { color: theme.onPrimary }]}> 
                        {t('saveTimeActionHint')}
                      </Text>
                      <Text style={[styles.menuActionTitle, { color: theme.onPrimary }]}> 
                        {isSavingNotificationTime
                          ? t('saving')
                          : t('saveTime')}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
            <View
              style={[
                styles.menuUserBox,
                { backgroundColor: theme.panelBg, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.menuUserLabel, { color: theme.textMuted }]}> 
                {t('clearAllTitle')}
              </Text>
              <Text style={[styles.menuSectionHint, { color: theme.textMuted }]}> 
                {t('clearAllBody')}
              </Text>
              <View style={styles.menuActionSpacing}>
                <TouchableOpacity
                  style={[styles.menuDangerButton, { backgroundColor: theme.dangerBg, borderColor: theme.dangerText }]}
                  onPress={() => {
                    setHasAcknowledgedClearAll(false);
                    setShowClearAllModal(true);
                  }}
                >
                  <Text style={[styles.menuDangerButtonText, { color: theme.dangerText }]}> 
                    {t('clearAllButton')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.menuSaveButton, { backgroundColor: theme.buttonBg }]}
              onPress={() => {
                setFeedbackError("");
                setShowFeedbackModal(true);
              }}
            >
              <Text style={[styles.menuSaveText, { color: theme.textPrimary }]}> 
                {t('feedbackButton')}
              </Text>
            </TouchableOpacity>
            {isAuthenticated ? (
              <TouchableOpacity
                style={[styles.menuLogoutButton, { backgroundColor: theme.dangerBg }]}
                onPress={async () => {
                  setShowMenuModal(false);
                  await onLogout();
                }}
              >
                <Text style={[styles.menuLogoutText, { color: theme.dangerText }]}> 
                  {t('logout')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
          <TouchableOpacity
            style={styles.menuBackdrop}
            onPress={() => setShowMenuModal(false)}
          />
        </View>
      </Modal>

      <Modal
        visible={showClearAllModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowClearAllModal(false);
          setHasAcknowledgedClearAll(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.cardBg, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}> 
              {t('clearAllTitle')}
            </Text>
            <Text style={[styles.modalSubtitle, { color: theme.textMuted }]}> 
              {t('clearAllBody')}
            </Text>

            <TouchableOpacity
              style={[
                styles.confirmNoticeBox,
                { borderColor: theme.border, backgroundColor: theme.inputBg },
              ]}
              onPress={() =>
                setHasAcknowledgedClearAll((previous) => !previous)
              }
            >
              <View
                style={[
                  styles.confirmCheckbox,
                  { borderColor: hasAcknowledgedClearAll ? theme.dangerText : theme.border },
                  hasAcknowledgedClearAll && { backgroundColor: theme.dangerBg },
                ]}
              >
                {hasAcknowledgedClearAll ? (
                  <Text style={[styles.confirmCheckboxMark, { color: theme.dangerText }]}>x</Text>
                ) : null}
              </View>
              <Text style={[styles.confirmNoticeText, { color: theme.textPrimary }]}> 
                {t('clearAllAcknowledge')}
              </Text>
            </TouchableOpacity>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.dangerButton,
                  { backgroundColor: theme.dangerBg },
                  (!hasAcknowledgedClearAll || isClearingAllEvents) && styles.disabledButton,
                ]}
                onPress={onClearAllEvents}
                disabled={!hasAcknowledgedClearAll || isClearingAllEvents}
              >
                <Text style={[styles.dangerButtonText, { color: theme.dangerText }]}> 
                  {isClearingAllEvents ? t('saving') : t('clearAllButton')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: theme.buttonBg }]}
                onPress={() => {
                  setShowClearAllModal(false);
                  setHasAcknowledgedClearAll(false);
                }}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.textPrimary }]}> 
                  {t('cancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showFeedbackModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFeedbackModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.cardBg, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}> 
              {t('feedbackTitle')}
            </Text>
            <TextInput
              value={feedbackSubject}
              onChangeText={setFeedbackSubject}
              placeholder={t('feedbackSubjectPlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { borderColor: theme.border, backgroundColor: theme.inputBg, color: theme.textPrimary },
              ]}
            />
            <TextInput
              value={feedbackMessage}
              onChangeText={setFeedbackMessage}
              placeholder={t('feedbackMessagePlaceholder')}
              placeholderTextColor={theme.textMuted}
              multiline
              style={[
                styles.feedbackInput,
                { borderColor: theme.border, backgroundColor: theme.inputBg, color: theme.textPrimary },
              ]}
            />
            {feedbackError ? (
              <Text style={styles.modalError}>{feedbackError}</Text>
            ) : null}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  isSendingFeedback && styles.disabledButton,
                ]}
                onPress={onSendFeedback}
                disabled={isSendingFeedback}
              >
                <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}> 
                  {isSendingFeedback ? t('saving') : t('feedbackSend')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: theme.buttonBg }]}
                onPress={() => setShowFeedbackModal(false)}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.textPrimary }]}> 
                  {t('cancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
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
    paddingBottom: 40,
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
  langSwitch: {
    flexDirection: "row",
    gap: 6,
  },
  themeToggle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  themeToggleIcon: {
    fontSize: 14,
    fontWeight: "700",
  },
  langOption: {
    color: "#94a3b8",
    fontWeight: "600",
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  langOptionSelected: {
    color: "#f8fafc",
    textDecorationLine: "underline",
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
  importButton: {
    marginTop: 8,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  importButtonText: {
    fontWeight: "700",
  },
  importProgressBlock: {
    marginTop: 10,
    gap: 6,
  },
  importProgressLabel: {
    fontSize: 12,
  },
  importProgressTrack: {
    height: 8,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  importProgressFill: {
    height: 8,
    borderRadius: 999,
  },
  importProgressValue: {
    fontSize: 12,
    fontWeight: "600",
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 6,
  },
  calendar: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 10,
    paddingBottom: 8,
    paddingTop: 6,
    paddingHorizontal: 0,
    width: "100%",
    alignSelf: "stretch",
  },
  calendarArrow: {
    width: 22,
    height: 22,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarArrowText: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 14,
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
  googleButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  googleButtonText: {
    fontWeight: "700",
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
  eventRowCompact: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eventContent: {
    flex: 1,
  },
  eventText: {
    fontWeight: "600",
    color: "#f8fafc",
  },
  eventTextCompact: {
    fontWeight: "700",
    fontSize: 15,
  },
  eventMetaText: {
    marginTop: 2,
    fontSize: 12,
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
    maxHeight: "88%",
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
  feedbackInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 120,
    textAlignVertical: "top",
    marginBottom: 10,
  },
  importRawToggle: {
    alignSelf: "flex-end",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  importRawToggleText: {
    fontSize: 11,
    fontWeight: "700",
  },
  importReviewHeader: {
    marginBottom: 8,
    gap: 4,
  },
  importReviewTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  importReviewHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  importListShell: {
    maxHeight: 290,
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 10,
  },
  importList: {
    maxHeight: 252,
  },
  importListContent: {
    gap: 10,
    padding: 12,
    paddingBottom: 14,
  },
  importListScrollCue: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  importListScrollCueText: {
    fontSize: 11,
    textAlign: "center",
    fontWeight: "600",
  },
  importRawBlock: {
    marginBottom: 10,
    gap: 6,
  },
  importRawLabel: {
    fontSize: 12,
  },
  importRawScroll: {
    maxHeight: 140,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  importRawContent: {
    padding: 8,
  },
  importRawText: {
    fontSize: 12,
    lineHeight: 16,
  },
  importSection: {
    gap: 8,
  },
  importSectionTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  importGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  importCard: {
    width: 72,
    height: 72,
    borderRadius: 12,
    padding: 8,
    alignItems: "center",
    justifyContent: "space-between",
  },
  importCardTypeTop: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    textAlign: "center",
  },
  importCardDay: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 26,
  },
  menuOverlay: {
    flex: 1,
    flexDirection: "row",
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.6)",
  },
  menuPanel: {
    width: "78%",
    maxWidth: 320,
    backgroundColor: "#0f172a",
    borderRightWidth: 1,
    borderRightColor: "#1f2937",
    paddingTop: 44,
    paddingHorizontal: 16,
  },
  menuPanelContent: {
    gap: 14,
    paddingBottom: 72,
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  menuTitle: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
  },
  menuCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  menuCloseText: {
    fontSize: 18,
    lineHeight: 18,
    fontWeight: "700",
  },
  menuUserBox: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#111827",
  },
  menuLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  menuSettingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  menuSettingLabel: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  infoButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  infoButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  tooltipText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
  },
  menuSectionHint: {
    marginBottom: 0,
    fontSize: 12,
    lineHeight: 17,
  },
  menuActionSpacing: {
    marginTop: 12,
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
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#0b1220",
    color: "#e5e7eb",
    marginTop: 10,
    fontSize: 15,
    fontWeight: "600",
  },
  menuSaveButton: {
    backgroundColor: "#1d4ed8",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  menuSaveText: {
    color: "#dbeafe",
    fontWeight: "700",
  },
  menuActionButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "stretch",
  },
  menuActionButtonPrimary: {
    shadowColor: "#020617",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  menuActionButtonSoft: {
    shadowColor: "#020617",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  menuActionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  menuActionBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuActionBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  menuActionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  menuActionEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    opacity: 0.78,
    marginBottom: 1,
    textTransform: "uppercase",
  },
  menuActionTitle: {
    fontSize: 14,
    fontWeight: "800",
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
  menuDangerButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  menuDangerButtonText: {
    fontWeight: "800",
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
  confirmNoticeBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  confirmCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCheckboxMark: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 14,
  },
  confirmNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  dangerButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  dangerButtonText: {
    fontWeight: "800",
  },
});
