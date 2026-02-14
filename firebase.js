import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const normalizeEnvValue = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }

  if (normalized.toUpperCase() === 'XXX') {
    return '';
  }

  return normalized;
};

const firebaseConfig = {
  apiKey: normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_API_KEY),
  authDomain: normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_APP_ID),
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let app;
export let auth = null;
export let db = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

export const registerUser = (email, password) => {
  if (!auth) {
    throw new Error('Firebase nie jest skonfigurowany.');
  }

  return createUserWithEmailAndPassword(auth, email, password);
};

export const loginUser = (email, password) => {
  if (!auth) {
    throw new Error('Firebase nie jest skonfigurowany.');
  }

  return signInWithEmailAndPassword(auth, email, password);
};
