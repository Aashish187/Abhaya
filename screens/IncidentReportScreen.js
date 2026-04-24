import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import { incidentAPI } from '../services/api';
import { saveIncidentReport } from '../services/reportStorage';

const RECORD_SECONDS = 10;
const MAX_VIDEO_BYTES = 3 * 1024 * 1024;
const EMAIL_FAILURE_MESSAGE =
  'Report saved, but emergency email could not be sent. Check backend Gmail settings in backend/.env.';

const createIncidentId = () =>
  `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const formatResolvedAddress = (result) => {
  if (!result) {
    return '';
  }

  const primary = [result.name, result.street].filter(Boolean).join(', ');
  const secondary = [
    result.district,
    result.city,
    result.subregion,
    result.region,
    result.postalCode,
    result.country,
  ].filter(Boolean);

  return [primary, secondary.join(', ')].filter(Boolean).join(', ');
};

export default function IncidentReportScreen({ navigation, route }) {
  const { user } = useAuth();
  const { setLatestReport } = useReport();
  const displayName = user?.displayName || user?.name || 'Priya Sharma';
  const phone =
    user?.phone || user?.phoneNumber || user?.mobile || user?.contact || '98XXXXXX90';

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef(null);
  const autoStartedRef = useRef(false);
  const reportRef = useRef(null);

  const [incidentId, setIncidentId] = useState('');
  const [recorderVisible, setRecorderVisible] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | preparing | recording | uploading | success
  const [flowError, setFlowError] = useState('');

  const closeRecorder = () => {
    try {
      cameraRef.current?.stopRecording?.();
    } catch {}
    setRecorderVisible(false);
    setPhase('idle');
  };

  const triggerEvidence = async ({ triggerType = 'SOS' } = {}) => {
    setFlowError('');

    const cameraGranted =
      cameraPermission?.granted || (await requestCameraPermission())?.granted;

    if (!cameraGranted) {
      Alert.alert('Camera Permission Needed', 'Allow camera access to record evidence video.');
      return;
    }

    const micGranted =
      micPermission?.granted || (await requestMicPermission())?.granted;

    if (!micGranted) {
      Alert.alert(
        'Microphone Permission Needed',
        'Allow microphone access to record video with audio.'
      );
      return;
    }

    const createdAt = new Date().toISOString();
    const generatedIncidentId = createIncidentId();
    let liveLocation = {
      lat: null,
      lng: null,
      address: 'Current location unavailable',
    };

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission?.granted) {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        const results = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        liveLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          address:
            formatResolvedAddress(Array.isArray(results) ? results[0] : null) ||
            'Live location captured',
        };
      }
    } catch {}

    reportRef.current = {
      incidentId: generatedIncidentId,
      createdAt,
      status: 'ACTIVE',
      user: {
        name: displayName || 'Demo User',
        phone: phone || '0000000000',
      },
      location: {
        lat: liveLocation.lat,
        lng: liveLocation.lng,
        address: liveLocation.address,
      },
      trigger: {
        type: triggerType,
        riskScore: 'HIGH',
      },
      evidence: [],
      timeline: ['SOS triggered'],
      notification: {
        sent: false,
      },
    };

    setIncidentId(generatedIncidentId);

    setRecorderVisible(true);
    setPhase('preparing');
  };

  useEffect(() => {
    const shouldAutoStart = Boolean(route?.params?.autoStartEvidence);
    const triggerType = route?.params?.triggerType || 'SOS';

    if (!shouldAutoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    triggerEvidence({ triggerType });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.autoStartEvidence, route?.params?.triggerType]);

  useEffect(() => {
    const run = async () => {
      if (!recorderVisible || phase !== 'preparing') return;

      try {
        setPhase('recording');

        // Give the camera view a moment to mount before recording.
        await new Promise((resolve) => setTimeout(resolve, 350));

        const camera = cameraRef.current;
        if (!camera?.recordAsync) {
          throw new Error('Camera is not ready. Please try again.');
        }

        reportRef.current = {
          ...(reportRef.current || {}),
          timeline: [...(reportRef.current?.timeline || []), 'Recording started'],
        };

        const stopTimer = setTimeout(() => {
          try {
            camera.stopRecording?.();
          } catch {}
        }, RECORD_SECONDS * 1000);

        const recordPromise = camera.recordAsync({
          maxDuration: RECORD_SECONDS,
          maxFileSize: MAX_VIDEO_BYTES,
        });
        const videoResult = await recordPromise;
        clearTimeout(stopTimer);

        const uri = videoResult?.uri;
        if (!uri) {
          throw new Error('Recording failed (no video uri).');
        }

        reportRef.current = {
          ...(reportRef.current || {}),
          timeline: [...(reportRef.current?.timeline || []), 'Recording stopped'],
        };

        setPhase('uploading');

        const upload = await incidentAPI.uploadVideoToCloudinary(uri);
        if (!upload?.success || !upload?.data?.url) {
          throw new Error(upload?.error || 'Failed to upload video.');
        }

        const evidenceTimestamp = new Date().toISOString();
        const updatedReport = {
          ...(reportRef.current || {}),
          evidence: [
            ...(reportRef.current?.evidence || []),
            {
              type: 'video',
              url: upload.data.url,
              timestamp: evidenceTimestamp,
            },
          ],
          timeline: [...(reportRef.current?.timeline || []), 'Video uploaded'],
        };

        const emailResult = await incidentAPI.sendEmergencyEmail(updatedReport);
        const finalReport = {
          ...updatedReport,
          notification: { sent: Boolean(emailResult?.success) },
        };

        await saveIncidentReport(finalReport);
        await setLatestReport(finalReport);

        setPhase('success');
        await new Promise((resolve) => setTimeout(resolve, 650));

        closeRecorder();
        navigation.replace('ReportDetails', {
          incidentId: finalReport.incidentId,
          report: finalReport,
        });

        setTimeout(() => {
          if (emailResult?.success) {
            Alert.alert('Success', 'Emergency alert sent via email');
          } else {
            Alert.alert(
              'Email Not Sent',
              emailResult?.error || EMAIL_FAILURE_MESSAGE
            );
          }
        }, 350);
      } catch (e) {
        setFlowError(e?.message || 'Evidence generation failed.');
        setPhase('idle');
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderVisible, phase]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#fbf9ff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home'))}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Incident Report</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.reportCard}>
          {/* Title Section */}
          <View style={styles.sectionHeader}>
            <View style={styles.iconCircleRed}>
              <Ionicons name="clipboard" size={18} color="#fff" />
            </View>
            <View>
              <Text style={styles.reportTitle}>ABHAYA INCIDENT REPORT</Text>
              <Text style={styles.reportDate}>Date: 18 Apr 2026 | 11:42 PM</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* User Info */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="person" size={16} color="#4da6ff" />
              <Text style={styles.sectionTitle}>User Information</Text>
            </View>
            <Text style={styles.dataPrimary}>{displayName}</Text>
            <Text style={styles.dataSecondary}>Mobile: 98XXXXXX90</Text>
          </View>

          <View style={styles.dividerLight} />

          {/* Vehicle Info */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="car" size={16} color="#ed5565" />
              <Text style={styles.sectionTitle}>Vehicle Details</Text>
            </View>
            <Text style={styles.dataPrimary}>MH12 AB 1234</Text>
            <Text style={styles.dataSecondary}>Driver: Ramesh Kumar</Text>
            <Text style={styles.dataSecondary}>License: Valid ✅</Text>
          </View>

          <View style={styles.dividerLight} />

          {/* Location */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="location" size={16} color="#ed5565" />
              <Text style={styles.sectionTitle}>Last Known Location</Text>
            </View>
            <Text style={styles.dataPrimary}>Lat: 21.14 | Long: 79.08</Text>
            <TouchableOpacity style={styles.mapLink}>
              <Ionicons name="map" size={14} color="#7b57d1" />
              <Text style={styles.mapLinkText}>View on Map</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dividerLight} />

          {/* Evidence */}
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="folder" size={16} color="#f8d664" />
              <Text style={styles.sectionTitle}>Evidence Files</Text>
            </View>
            
            <TouchableOpacity
              style={styles.evidenceFile}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('VideoEvidence', { incidentId, showAll: true })}
            >
              <View style={styles.evidenceIconWrap}>
                <Ionicons name="eye" size={14} color="#7b57d1" />
              </View>
              <Text style={styles.evidenceName}>Video Evidence</Text>
              <Text style={styles.evidenceMeta}>View</Text>
            </TouchableOpacity>

            <View style={styles.evidenceFile}>
              <View style={styles.evidenceIconWrap}>
                <Ionicons name="map-outline" size={14} color="#7b57d1" />
              </View>
              <Text style={styles.evidenceName}>Route Timeline</Text>
              <Text style={styles.evidenceMeta}>View</Text>
            </View>
          </View>

          {/* Risk Score */}
          <View style={styles.riskBadge}>
            <Text style={styles.riskBadgeText}>Risk Score</Text>
            <View style={styles.riskBadgeValueWrap}>
              <Text style={styles.riskBadgeValue}>HIGH</Text>
              <View style={styles.riskDot} />
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <TouchableOpacity style={[styles.actionBtn, styles.btnRed]}>
          <Ionicons name="share-social" size={18} color="#fff" />
          <Text style={styles.btnText}>Share with Police</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, styles.btnGreen]}>
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.btnText}>Saved to Cloud ✅</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionBtn, styles.btnPurple]}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.btnText}>Download Report</Text>
        </TouchableOpacity>
        
      </ScrollView>

      <Modal visible={recorderVisible} transparent animationType="fade" onRequestClose={closeRecorder}>
        <View style={styles.recorderBackdrop}>
          <View style={styles.recorderCard}>
            <View style={styles.recorderHeader}>
              <View style={styles.recorderTitleRow}>
                <Ionicons name="radio-button-on" size={14} color="#ea5455" />
                <Text style={styles.recorderTitle}>Recording Evidence</Text>
              </View>
              <TouchableOpacity onPress={closeRecorder} style={styles.recorderClose} activeOpacity={0.85}>
                <Ionicons name="close" size={18} color="#111" />
              </TouchableOpacity>
            </View>

            <View style={styles.cameraWrap}>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                mode="video"
                videoQuality="480p"
              />
              <View style={styles.cameraOverlay}>
                <View style={styles.cameraOverlayPill}>
                  <Text style={styles.cameraOverlayText}>
                    {phase === 'recording'
                      ? `Recording… (${RECORD_SECONDS}s)`
                      : phase === 'uploading'
                        ? 'Uploading to cloud…'
                        : phase === 'success'
                          ? 'Report generated'
                          : 'Preparing camera…'}
                  </Text>
                  {phase === 'uploading' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : null}
                </View>
              </View>
            </View>

            {flowError ? <Text style={styles.flowError}>{flowError}</Text> : null}
            {!flowError ? (
              <Text style={styles.recorderHint}>
                Auto-stops after {RECORD_SECONDS} seconds. Keep the app in foreground.
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbf9ff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111' },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  
  reportCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, shadowColor: '#14092c', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.05, shadowRadius: 20, elevation: 4, marginBottom: 24, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconCircleRed: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ea4335', justifyContent: 'center', alignItems: 'center' },
  reportTitle: { fontSize: 15, fontWeight: '800', color: '#111' },
  reportDate: { fontSize: 12, color: '#8f8f96', marginTop: 2 },
  
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 20 },
  dividerLight: { height: 1, backgroundColor: '#f5f5f5', marginVertical: 16 },
  
  section: {},
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 13, color: '#8f8f96', fontWeight: '500' },
  dataPrimary: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 4 },
  dataSecondary: { fontSize: 13, color: '#666', marginBottom: 2 },
  
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  mapLinkText: { fontSize: 13, color: '#7b57d1', fontWeight: '700' },
  
  evidenceFile: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f4fb', padding: 14, borderRadius: 16, marginBottom: 10 },
  evidenceIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#eaddff', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  evidenceName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#111' },
  evidenceMeta: { fontSize: 12, color: '#8f8f96' },
  
  riskBadge: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ffeaea', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, marginTop: 10 },
  riskBadgeText: { fontSize: 13, color: '#666' },
  riskBadgeValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskBadgeValue: { fontSize: 14, fontWeight: '800', color: '#ea4335' },
  riskDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ea4335' },
  
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18, borderRadius: 16, marginBottom: 12 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnRed: { backgroundColor: '#ea5455' },
  btnGreen: { backgroundColor: '#4caf50' },
  btnPurple: { backgroundColor: '#7b57d1' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eaddff' },
  btnGhostText: { color: '#7b57d1', fontSize: 15, fontWeight: '800' },

  recorderBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  recorderCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  recorderHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  recorderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recorderTitle: { fontSize: 14, fontWeight: '900', color: '#111' },
  recorderClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2ebff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraWrap: { height: 360, backgroundColor: '#000' },
  cameraOverlay: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' },
  cameraOverlayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  cameraOverlayText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  recorderHint: { paddingHorizontal: 16, paddingVertical: 12, color: '#8f8f96', fontSize: 12, fontWeight: '700' },
  flowError: { paddingHorizontal: 16, paddingVertical: 12, color: '#ea5455', fontSize: 12, fontWeight: '800' },
});
