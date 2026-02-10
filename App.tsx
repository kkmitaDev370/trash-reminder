import React, { useEffect, useState } from 'react';
import {
  Button,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { Picker } from '@react-native-picker/picker';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import type {
  NotificationBehavior,
  NotificationTriggerInput,
} from 'expo-notifications';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebaseConfig';
import AuthScreen from './AuthScreen';

type Reminder = {
  id: string;
  date: string;
  type: string;
  time: string;
  userId: string;
  shareWith?: string[];
  notificationId?: string;
};

type NotificationsModule = typeof import('expo-notifications');

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [collectionDate, setCollectionDate] = useState<string | null>(null);
  const [wasteType, setWasteType] = useState('Zmieszane');
  const [customWasteType, setCustomWasteType] = useState('');
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [notificationsApi, setNotificationsApi] = useState<NotificationsModule | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const isExpoGo = Constants.appOwnership === 'expo';

  // Obsługa autentykacji
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Poproś o uprawnienia do powiadomień
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (Platform.OS === 'android' && isExpoGo) {
        setPermissionStatus('expo-go');
        return;
      }

      const Notifications = await import('expo-notifications');

      if (!mounted) {
        return;
      }

      Notifications.setNotificationHandler({
        handleNotification: async (): Promise<NotificationBehavior> => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      const { status } = await Notifications.requestPermissionsAsync();
      setNotificationsApi(Notifications);
      setPermissionStatus(status);
    })();

    return () => {
      mounted = false;
    };
  }, [isExpoGo]);

  // Pobieranie przypomnień z Firestore
  useEffect(() => {
    if (!user) {
      setReminders([]);
      return;
    }

    const q = query(
      collection(db, 'reminders'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: Reminder[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as Reminder);
      });
      setReminders(items);
    });

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    NavigationBar.setButtonStyleAsync('dark');
  }, []);


  const onDayPress = (day: { dateString: string }) => {
    setPendingDate(day.dateString);
    setShowTypeModal(true);
  };

  const onConfirmType = async () => {
    if (pendingDate) {
      setCollectionDate(pendingDate);
      const resolvedType = wasteType === 'Inne' ? customWasteType.trim() : wasteType;
      if (!resolvedType) {
        alert('Wpisz własny rodzaj śmieci.');
        return;
      }
      await scheduleTrashReminder(pendingDate, resolvedType);
    }
    setShowTypeModal(false);
  };

  const onCancelType = () => {
    setPendingDate(null);
    setShowTypeModal(false);
  };

  const scheduleTrashReminder = async (dateString: string, type: string) => {
    if (!dateString) {
      alert('Wybierz w kalendarzu datę odbioru śmieci.');
      return;
    }

    if (permissionStatus === 'expo-go') {
      alert(
        'Powiadomienia nie działają w Expo Go na Androidzie. Użyj development build lub APK z EAS Build.'
      );
      return;
    }

    if (permissionStatus !== 'granted') {
      alert('Brak uprawnień do wysyłania powiadomień.');
      return;
    }

    if (!notificationsApi) {
      alert('Powiadomienia nie są gotowe. Spróbuj ponownie za chwilę.');
      return;
    }

    // collectionDate (dzień odbioru) -> notyfikacja dzień wcześniej o wybranej godzinie
    const [year, month, day] = dateString.split('-').map(Number);
    const collectionDay = new Date(year, month - 1, day);

    const trigger = new Date(collectionDay);
    trigger.setDate(trigger.getDate() - 1); // dzień wcześniej
    trigger.setHours(19, 0, 0, 0);

    if (trigger <= new Date()) {
      alert(
        'Wybrany czas przypomnienia jest w przeszłości. Wybierz późniejszą datę/godzinę.'
      );
      return;
    }

    const notificationId = await notificationsApi.scheduleNotificationAsync({
      content: {
        title: `Jutro odbiór: ${type} 🗑️`,
        body: `Jutro (${dateString}) jest odbiór: ${type}. Przygotuj worki i wystaw je wieczorem.`,
      },
      trigger: { date: trigger } as NotificationTriggerInput,
    });

    // Zapisz do Firestore
    if (user) {
      await addDoc(collection(db, 'reminders'), {
        date: dateString,
        type,
        time: '19:00',
        userId: user.uid,
        notificationId,
        shareWith: [],
        createdAt: new Date().toISOString(),
      });
    }

    alert('Ustawiono przypomnienie dzień wcześniej przed odbiorem śmieci.');
  };

  const handleDeleteReminder = async (reminder: Reminder) => {
    Alert.alert(
      'Usuń przypomnienie',
      `Czy na pewno chcesz usunąć przypomnienie o odbiorze: ${reminder.type}?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'reminders', reminder.id));
              if (reminder.notificationId && notificationsApi) {
                await notificationsApi.cancelScheduledNotificationAsync(reminder.notificationId);
              }
            } catch (error) {
              alert('Błąd usuwania przypomnienia');
            }
          },
        },
      ]
    );
  };

  const handleShareReminder = (reminder: Reminder) => {
    setSelectedReminder(reminder);
    setShareEmail('');
    setShowShareModal(true);
  };

  const confirmShare = async () => {
    if (!selectedReminder || !shareEmail.trim()) {
      alert('Wpisz adres email użytkownika');
      return;
    }

    try {
      const reminderRef = doc(db, 'reminders', selectedReminder.id);
      const currentShareWith = selectedReminder.shareWith || [];
      await updateDoc(reminderRef, {
        shareWith: [...currentShareWith, shareEmail.trim()],
      });
      alert(`Udostępniono przypomnienie dla ${shareEmail}`);
      setShowShareModal(false);
    } catch (error) {
      alert('Błąd udostępniania');
    }
  };

  const handleLogout = async () => {
    Alert.alert('Wyloguj się', 'Czy na pewno chcesz się wylogować?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Wyloguj',
        onPress: async () => {
          await signOut(auth);
        },
      },
    ]);
  };

  if (authLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" backgroundColor="#0b1220" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="#0b1220" />
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Śmieci — przypomnienia</Text>
            <Text style={styles.userEmail}>{user.email || 'Anonimowy'}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Wyloguj</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          Wybierz datę odbioru, a my ustawimy przypomnienie dzień wcześniej.
        </Text>
      </View>

      <ScrollView>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Kalendarz odbiorów</Text>
          <Calendar
            onDayPress={onDayPress}
            markedDates={
              collectionDate
                ? {
                    [collectionDate]: {
                      selected: true,
                      selectedColor: '#22c55e',
                    },
                  }
                : {}
            }
            theme={{
              calendarBackground: 'transparent',
              dayTextColor: '#e5e7eb',
              monthTextColor: '#e5e7eb',
              arrowColor: '#22c55e',
              todayTextColor: '#38bdf8',
            }}
            style={styles.calendar}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Dodane przypomnienia</Text>
          {reminders.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Brak przypomnień</Text>
              <Text style={styles.emptyText}>Kliknij datę w kalendarzu, aby dodać.</Text>
            </View>
          ) : (
            reminders.map((item) => (
              <View key={item.id} style={styles.reminderItem}>
                <View style={styles.reminderBadge} />
                <View style={styles.reminderContent}>
                  <Text style={styles.reminderTitle}>{item.type}</Text>
                  <Text style={styles.reminderMeta}>
                    {item.date} • {item.time}
                  </Text>
                  {item.shareWith && item.shareWith.length > 0 && (
                    <Text style={styles.sharedWith}>
                      Udostępniono: {item.shareWith.join(', ')}
                    </Text>
                  )}
                </View>
                <View style={styles.reminderActions}>
                  <TouchableOpacity
                    onPress={() => handleShareReminder(item)}
                    style={styles.actionButton}
                  >
                    <Text style={styles.actionButtonText}>📤</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeleteReminder(item)}
                    style={styles.actionButton}
                  >
                    <Text style={styles.actionButtonText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showTypeModal}
        transparent
        animationType="fade"
        onRequestClose={onCancelType}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Wybierz rodzaj śmieci</Text>
            <Text style={styles.modalSubtitle}>{pendingDate}</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={wasteType}
                onValueChange={(value) => setWasteType(value)}
                dropdownIconColor="#e5e7eb"
                style={styles.picker}
              >
                <Picker.Item label="Zmieszane" value="Zmieszane" />
                <Picker.Item label="Plastik i metal" value="Plastik i metal" />
                <Picker.Item label="Papier" value="Papier" />
                <Picker.Item label="Szkło" value="Szkło" />
                <Picker.Item label="Bio" value="Bio" />
                <Picker.Item label="Gabaryty" value="Gabaryty" />
                <Picker.Item label="Elektrośmieci" value="Elektrośmieci" />
                <Picker.Item label="Inne" value="Inne" />
              </Picker>
            </View>
            {wasteType === 'Inne' && (
              <View style={styles.customInputSection}>
                <Text style={styles.label}>Własny rodzaj:</Text>
                <TextInput
                  value={customWasteType}
                  onChangeText={setCustomWasteType}
                  placeholder="Np. tekstylia"
                  placeholderTextColor="#64748b"
                  style={styles.customInput}
                />
              </View>
            )}
            <View style={styles.modalActions}>
              <Button title="Anuluj" onPress={onCancelType} color="#64748b" />
              <Button title="Zapisz" onPress={onConfirmType} color="#22c55e" />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showShareModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShareModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Udostępnij przypomnienie</Text>
            <Text style={styles.modalSubtitle}>
              {selectedReminder?.type} - {selectedReminder?.date}
            </Text>
            <TextInput
              value={shareEmail}
              onChangeText={setShareEmail}
              placeholder="Email użytkownika"
              placeholderTextColor="#64748b"
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.customInput}
            />
            <View style={styles.modalActions}>
              <Button title="Anuluj" onPress={() => setShowShareModal(false)} color="#64748b" />
              <Button title="Udostępnij" onPress={confirmShare} color="#22c55e" />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#0b1220',
  },
  header: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1f2937',
  },
  logoutText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  userEmail: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  cardTitle: {
    color: '#e5e7eb',
    fontWeight: '600',
    marginBottom: 8,
  },
  calendar: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  section: {
    marginTop: 20,
  },
  label: {
    color: '#e5e7eb',
    marginBottom: 10,
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontWeight: '600',
    marginBottom: 4,
  },
  emptyText: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  reminderItem: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reminderBadge: {
    width: 10,
    height: 40,
    borderRadius: 999,
    backgroundColor: '#22c55e',
  },
  reminderContent: {
    flex: 1,
  },
  reminderTitle: {
    color: '#f8fafc',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  reminderMeta: {
    color: '#94a3b8',
    fontSize: 12,
  },
  sharedWith: {
    color: '#38bdf8',
    fontSize: 11,
    marginTop: 4,
  },
  reminderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#1f2937',
  },
  actionButtonText: {
    fontSize: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  modalSubtitle: {
    color: '#94a3b8',
    marginBottom: 12,
  },
  pickerContainer: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
    overflow: 'hidden',
  },
  picker: {
    color: '#e5e7eb',
  },
  customInputSection: {
    marginTop: 16,
  },
  customInput: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e5e7eb',
    backgroundColor: '#0f172a',
  },
  modalActions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
