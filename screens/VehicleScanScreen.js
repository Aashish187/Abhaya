import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import vehicleObservationAPI from '../services/vehicleObservations';
import vehicleProfiles from '../assets/vehicleProfiles.json';

const vehicleDetailFields = [
  ['plateNumber', 'Plate Number'],
  ['driverName', 'Driver Name'],
  ['driverPhone', 'Driver Phone'],
];

const highlightFields = [
  ['plateNumber', 'Plate Number'],
  ['identificationMark', 'Visible Mark'],
  ['driverName', 'Driver'],
  ['driverPhone', 'Phone'],
];

const normalizeValue = (value) => String(value || '').trim().toLowerCase();
const isNoPlateRecord = (item) =>
  Boolean(item?.noPlate) || /no plate/i.test(String(item?.plateNumber || item?.vehicleDetails?.plateNumber || ''));

const findVehicleProfile = (item) => {
  if (isNoPlateRecord(item)) {
    return null;
  }

  const profileId = normalizeValue(item.profileId || item.vehicleDetails?.profileId);
  const type = normalizeValue(item.vehicleType);
  const brand = normalizeValue(item.vehicleBrand);
  const model = normalizeValue(item.vehicleModel);
  const color = normalizeValue(item.vehicleColor);

  return (
    vehicleProfiles.find((profile) => normalizeValue(profile.profileId) === profileId) ||
    vehicleProfiles.find(
      (profile) =>
        normalizeValue(profile.vehicleType) === type &&
        normalizeValue(profile.vehicleBrand) === brand &&
        normalizeValue(profile.vehicleModel) === model &&
        normalizeValue(profile.vehicleColor) === color
    ) ||
    vehicleProfiles.find(
      (profile) =>
        normalizeValue(profile.vehicleType) === type &&
        normalizeValue(profile.vehicleBrand) === brand &&
        normalizeValue(profile.vehicleModel) === model
    ) ||
    vehicleProfiles.find(
      (profile) =>
        normalizeValue(profile.vehicleType) === type &&
        normalizeValue(profile.vehicleBrand) === brand
    ) ||
    vehicleProfiles.find((profile) => normalizeValue(profile.vehicleType) === type) ||
    null
  );
};

const enrichVehicleRecord = (item) => {
  const profile = findVehicleProfile(item);

  if (!profile) {
    return item;
  }

  return {
    ...profile,
    ...item,
    vehicleDetails: {
      ...profile,
      ...(item.vehicleDetails || {}),
      profileId: item.profileId || item.vehicleDetails?.profileId || profile.profileId,
      plateNumber: item.plateNumber || item.vehicleDetails?.plateNumber || profile.plateNumber,
      driverName: item.driverName || item.vehicleDetails?.driverName || profile.driverName,
      driverPhone: item.driverPhone || item.vehicleDetails?.driverPhone || profile.driverPhone,
      ownerName: item.ownerName || item.vehicleDetails?.ownerName || profile.ownerName,
      operatorName: item.operatorName || item.vehicleDetails?.operatorName || profile.operatorName,
      registrationZone:
        item.registrationZone || item.vehicleDetails?.registrationZone || profile.registrationZone,
      fuelType: item.fuelType || item.vehicleDetails?.fuelType || profile.fuelType,
      seatingCapacity:
        item.seatingCapacity || item.vehicleDetails?.seatingCapacity || profile.seatingCapacity,
      vehicleCondition:
        item.vehicleCondition ||
        item.vehicleDetails?.vehicleCondition ||
        profile.vehicleCondition,
      identificationMark:
        item.identificationMark ||
        item.vehicleDetails?.identificationMark ||
        profile.identificationMark,
    },
    profileId: item.profileId || profile.profileId,
    plateNumber: item.plateNumber || profile.plateNumber,
    driverName: item.driverName || profile.driverName,
    driverPhone: item.driverPhone || profile.driverPhone,
    ownerName: item.ownerName || profile.ownerName,
    operatorName: item.operatorName || profile.operatorName,
    registrationZone: item.registrationZone || profile.registrationZone,
    fuelType: item.fuelType || profile.fuelType,
    seatingCapacity: item.seatingCapacity || profile.seatingCapacity,
    vehicleCondition: item.vehicleCondition || profile.vehicleCondition,
    identificationMark: item.identificationMark || profile.identificationMark,
  };
};

const formatDate = (value) => {
  if (!value) return 'Recent';

  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'Recent';
  }
};

export default function VehicleScanScreen({ navigation }) {
  const [imageAsset, setImageAsset] = useState(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState([]);

  const loadRecords = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setHistoryLoading(true);
    }

    try {
      const data = await vehicleObservationAPI.list();
      setRecords(data || []);
    } catch (error) {
      Alert.alert('Could Not Load', error.message || 'Failed to load vehicle scans.');
    } finally {
      setHistoryLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecords();
    }, [loadRecords])
  );

  const refreshRecords = () => {
    setRefreshing(true);
    loadRecords({ silent: true });
  };

  const pickImage = async (source) => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== 'granted') {
          Alert.alert('Camera Permission Needed', 'Allow camera access to scan a vehicle.');
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.status !== 'granted') {
          Alert.alert('Photos Permission Needed', 'Allow gallery access to upload a vehicle image.');
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              allowsEditing: false,
              quality: 1,
              base64: true,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false,
              quality: 1,
              base64: true,
            });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('Image Error', 'Could not read the selected image. Please try again.');
        return;
      }

      setImageAsset(asset);
    } catch (error) {
      Alert.alert('Image Error', error.message || 'Could not open camera or gallery.');
    }
  };

  const resetForm = () => {
    setImageAsset(null);
    setNote('');
  };

  const saveVehicleObservation = async () => {
    if (!imageAsset?.base64) {
      Alert.alert('Add Image', 'Scan or upload a vehicle image first.');
      return;
    }

    setLoading(true);

    try {
      const dataUrl = `data:${imageAsset.mimeType || 'image/jpeg'};base64,${imageAsset.base64}`;

      await vehicleObservationAPI.create({
        imageDataUrl: dataUrl,
        note: note.trim(),
      });

      Alert.alert('Saved', 'Vehicle details saved successfully.');

      resetForm();
      loadRecords({ silent: true });
    } catch (error) {
      Alert.alert('Save Failed', error.message || 'Could not save the vehicle scan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#fbf9ff" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home'))}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Vehicle Scan</Text>
        <TouchableOpacity onPress={refreshRecords} style={styles.refreshButton}>
          <Ionicons name="refresh" size={19} color="#7b57d1" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshRecords} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>Number plate scan</Text>
          <Text style={styles.heroTitle}>Scan a vehicle and view key details</Text>
          <Text style={styles.heroText}>
            Upload a clear vehicle image to view the essential details you need most:
            plate number, driver name, and driver phone.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionButton} onPress={() => pickImage('camera')}>
              <Ionicons name="camera-outline" size={18} color="#fff" />
              <Text style={styles.actionButtonText}>Scan With Camera</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryActionButton} onPress={() => pickImage('gallery')}>
              <Ionicons name="images-outline" size={18} color="#7b57d1" />
              <Text style={styles.secondaryActionText}>Upload From Phone</Text>
            </TouchableOpacity>
          </View>

          {imageAsset?.uri ? (
            <Image source={{ uri: imageAsset.uri }} style={styles.previewImage} />
          ) : (
            <View style={styles.emptyPreview}>
              <Ionicons name="image-outline" size={28} color="#b7aad8" />
              <Text style={styles.emptyPreviewText}>No image selected yet</Text>
            </View>
          )}

          <View style={styles.autoFillCard}>
            <View style={styles.autoFillIconWrap}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#7b57d1" />
            </View>
            <View style={styles.autoFillCopy}>
              <Text style={styles.autoFillTitle}>Focused result</Text>
              <Text style={styles.autoFillText}>
                Each scan keeps the result simple and focused on the most important vehicle details.
              </Text>
            </View>
          </View>

          <TextInput
            value={note}
            onChangeText={setNote}
            style={styles.noteInput}
            placeholder="Optional note like suspicious activity, route, sticker, missing plate, or direction"
            placeholderTextColor="#9f9bb2"
            multiline
          />

          <TouchableOpacity
            style={[styles.saveButton, loading && styles.buttonDisabled]}
            onPress={saveVehicleObservation}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                <Text style={styles.saveButtonText}>Save To Firebase</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent Vehicle Scans</Text>
          <Text style={styles.sectionSubtitle}>
            Review recent scans with the essential driver and plate details.
          </Text>

          {historyLoading ? (
            <View style={styles.centerWrap}>
              <ActivityIndicator size="large" color="#7b57d1" />
              <Text style={styles.centerText}>Loading saved scans...</Text>
            </View>
          ) : null}

          {!historyLoading && records.length === 0 ? (
            <View style={styles.centerWrap}>
              <Ionicons name="folder-open-outline" size={28} color="#c8bbeb" />
              <Text style={styles.centerText}>No saved vehicle scans yet.</Text>
            </View>
          ) : null}

          {!historyLoading &&
            records.map((record) => {
              const item = enrichVehicleRecord(record);

              return (
                <View key={item.id} style={styles.recordCard}>
                  <View style={styles.recordHeader}>
                    <View style={styles.recordTitleWrap}>
                      <Text style={styles.recordTitle}>
                        {item.vehicleType || 'Vehicle'} record
                      </Text>
                      <Text style={styles.recordTime}>{formatDate(item.createdAt)}</Text>
                    </View>
                    <View
                      style={[
                        styles.recordBadge,
                        isNoPlateRecord(item) && styles.noPlateBadge,
                      ]}
                    >
                      <Ionicons
                        name={isNoPlateRecord(item) ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                        size={13}
                        color={isNoPlateRecord(item) ? '#ef4444' : '#7b57d1'}
                      />
                      <Text
                        style={[
                          styles.recordBadgeText,
                          isNoPlateRecord(item) && styles.noPlateBadgeText,
                        ]}
                      >
                        {isNoPlateRecord(item) ? 'No Plate' : 'Saved'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.recordMeta}>
                    {[
                      item.vehicleType || 'Unknown type',
                      item.vehicleBrand || 'Unknown brand',
                      item.vehicleModel || 'Unknown model',
                      item.vehicleColor || 'Unknown color',
                    ].join(' | ')}
                  </Text>
                  {isNoPlateRecord(item) ? (
                    <Text style={styles.noPlateHint}>
                      This scan keeps only visible vehicle clues and avoids guessing a plate or driver.
                    </Text>
                  ) : null}
                  <View style={styles.highlightRow}>
                    {highlightFields.map(([key, label]) => {
                      const value = item[key] || item.vehicleDetails?.[key];

                      if (!value) {
                        return null;
                      }

                      return (
                        <View key={`${item.id}-${key}-highlight`} style={styles.highlightCard}>
                          <Text style={styles.highlightLabel}>{label}</Text>
                          <Text style={styles.highlightValue} numberOfLines={2}>
                            {String(value)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.detailsGrid}>
                    {vehicleDetailFields.map(([key, label]) => {
                      const value = item[key] || item.vehicleDetails?.[key];

                      if (!value) {
                        return null;
                      }

                      return (
                        <View key={`${item.id}-${key}`} style={styles.detailChip}>
                          <Text style={styles.detailLabel}>{label}</Text>
                          <Text style={styles.detailValue}>{String(value)}</Text>
                        </View>
                      );
                    })}
                  </View>
                  {item.note ? <Text style={styles.recordNote}>{item.note}</Text> : null}
                </View>
              );
            })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fbf9ff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
  },
  refreshButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f0e9ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#1f1533',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  heroEyebrow: {
    color: '#d8cff0',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroTitle: {
    marginTop: 8,
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  heroText: {
    marginTop: 8,
    color: '#d8cff0',
    lineHeight: 20,
    fontSize: 13,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#7b57d1',
    paddingVertical: 14,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#f1e9ff',
    paddingVertical: 14,
  },
  secondaryActionText: {
    color: '#7b57d1',
    fontSize: 13,
    fontWeight: '800',
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 20,
    marginTop: 14,
    backgroundColor: '#f2edf9',
  },
  emptyPreview: {
    marginTop: 14,
    height: 180,
    borderRadius: 20,
    backgroundColor: '#f7f3ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPreviewText: {
    marginTop: 8,
    color: '#8f8f96',
    fontWeight: '700',
  },
  autoFillCard: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#f3edff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  autoFillIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoFillCopy: {
    flex: 1,
  },
  autoFillTitle: {
    color: '#34235f',
    fontSize: 13,
    fontWeight: '800',
  },
  autoFillText: {
    marginTop: 4,
    color: '#5b4f83',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  noteInput: {
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: '#f7f3ff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#111',
    fontSize: 13,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#ef4444',
    paddingVertical: 14,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  sectionSubtitle: {
    marginTop: 6,
    color: '#8f8f96',
    fontSize: 13,
    lineHeight: 19,
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  centerText: {
    marginTop: 10,
    color: '#8f8f96',
    textAlign: 'center',
    fontWeight: '600',
  },
  recordCard: {
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: '#f9f7ff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#eee8fb',
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  recordTitleWrap: {
    flex: 1,
  },
  recordTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2d2150',
  },
  recordTime: {
    marginTop: 4,
    fontSize: 11,
    color: '#8f8f96',
    fontWeight: '700',
  },
  recordBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#efe8ff',
  },
  recordBadgeText: {
    color: '#7b57d1',
    fontSize: 11,
    fontWeight: '800',
  },
  noPlateBadge: {
    backgroundColor: '#fee2e2',
  },
  noPlateBadgeText: {
    color: '#ef4444',
  },
  recordMeta: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#5b4f83',
    lineHeight: 18,
  },
  noPlateHint: {
    marginTop: 8,
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  highlightRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  highlightCard: {
    flexGrow: 1,
    minWidth: '30%',
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  highlightLabel: {
    color: '#8f8f96',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  highlightValue: {
    marginTop: 5,
    color: '#22153f',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  detailChip: {
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ebe3ff',
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8f8f96',
    textTransform: 'uppercase',
  },
  detailValue: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#2d2150',
    lineHeight: 17,
  },
  recordNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#5c5b66',
    lineHeight: 18,
    fontWeight: '600',
  },
});
