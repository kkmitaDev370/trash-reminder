import React, { useEffect, useState } from 'react';
import {
  Button,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';

type Reminder = {
  id: string;
  date: string;
  type: string;
  time: string;
};

type NotificationsModule = typeof import('expo-notifications');

export default function App() {
  const [collectionDate, setCollectionDate] = useState<string | null>(null); // data odbioru śmieci (YYYY-MM-DD)
  const [wasteType, setWasteType] = useState('Zmieszane');
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [notificationsApi, setNotificationsApi] = useState<NotificationsModule | null>(null);
  const [reminderTime, setReminderTime] = useState(() => {
    const d = new Date();
    d.setHours(19, 0, 0, 0); // domyślnie 19:00 dzień wcześniej
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const isExpoGo = Constants.appOwnership === 'expo';

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
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
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

  const onChangeTime = (_event: DateTimePickerEvent, selected?: Date) => {
    const current = selected || reminderTime;
    if (Platform.OS !== 'ios') {
      setShowTimePicker(false);
    }
    setReminderTime(current);
  };

  const onDayPress = (day: { dateString: string }) => {
    setPendingDate(day.dateString);
    setShowTypeModal(true);
  };

  const onConfirmType = async () => {
    if (pendingDate) {
      setCollectionDate(pendingDate);
      await scheduleTrashReminder(pendingDate, wasteType, reminderTime);
    }
    setShowTimePicker(false);
    setShowTypeModal(false);
  };

  const onCancelType = () => {
    setPendingDate(null);
    setShowTimePicker(false);
    setShowTypeModal(false);
  };

  const scheduleTrashReminder = async (dateString: string, type: string, time: Date) => {
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
    const collection = new Date(year, month - 1, day);

    const trigger = new Date(collection);
    trigger.setDate(trigger.getDate() - 1); // dzień wcześniej
    trigger.setHours(time.getHours(), time.getMinutes(), 0, 0);

    if (trigger <= new Date()) {
      alert(
        'Wybrany czas przypomnienia jest w przeszłości. Wybierz późniejszą datę/godzinę.'
      );
      return;
    }

    const id = await notificationsApi.scheduleNotificationAsync({
      content: {
        title: `Jutro odbiór: ${type} 🗑️`,
        body: `Jutro (${dateString}) jest odbiór: ${type}. Przygotuj worki i wystaw je wieczorem.`,
      },
      trigger,
    });

    setReminders((prev) => [
      ...prev,
      {
        id,
        date: dateString,
        type,
        time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    alert('Ustawiono przypomnienie dzień wcześniej przed odbiorem śmieci.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Przypomnienia o wyrzucaniu śmieci</Text>
      <Text style={styles.subtitle}>
        Zaznacz w kalendarzu dzień odbioru śmieci. My przypomnimy Ci dzień
        wcześniej.
      </Text>

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
          calendarBackground: '#020617',
          dayTextColor: '#e5e7eb',
          monthTextColor: '#e5e7eb',
          arrowColor: '#22c55e',
          todayTextColor: '#38bdf8',
        }}
        style={styles.calendar}
      />

      <View style={styles.section}>
        <Text style={styles.label}>Dodane przypomnienia:</Text>
        {reminders.length === 0 ? (
          <Text style={styles.emptyText}>Brak dodanych przypomnień.</Text>
        ) : (
          reminders.map((item) => (
            <View key={item.id} style={styles.reminderItem}>
              <Text style={styles.reminderTitle}>{item.type}</Text>
              <Text style={styles.reminderMeta}>
                {item.date} • {item.time}
              </Text>
            </View>
          ))
        )}
      </View>

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
              </Picker>
            </View>
            <View style={styles.timePickerSection}>
              <Text style={styles.label}>Godzina przypomnienia (dzień wcześniej):</Text>
              <Button
                title={reminderTime.toLocaleTimeString()}
                onPress={() => setShowTimePicker(true)}
                color="#22c55e"
              />
              {showTimePicker && (
                <DateTimePicker
                  value={reminderTime}
                  mode="time"
                  is24Hour
                  display="default"
                  onChange={onChangeTime}
                />
              )}
            </View>
            <View style={styles.modalActions}>
              <Button title="Anuluj" onPress={onCancelType} color="#64748b" />
              <Button title="Zapisz" onPress={onConfirmType} color="#22c55e" />
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
    backgroundColor: '#020617',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f9fafb',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 16,
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
    marginBottom: 8,
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
  },
  reminderTitle: {
    color: '#f8fafc',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  reminderMeta: {
    color: '#94a3b8',
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
  timePickerSection: {
    marginTop: 16,
  },
  modalActions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
