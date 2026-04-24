import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useReport } from '../context/ReportContext';
import { getIncidentReportById, getLatestIncidentReport, listIncidentReports } from '../services/reportStorage';

const formatTimestamp = (isoString) => {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  } catch {
    return '';
  }
};

function InlineVideoPlayer({ videoUrl }) {
  const player = useVideoPlayer(videoUrl, (instance) => {
    instance.play();
  });

  return (
    <VideoView
      style={styles.video}
      player={player}
      nativeControls
      contentFit="contain"
      allowsFullscreen
      allowsPictureInPicture
    />
  );
}

export default function VideoEvidenceScreen({ navigation, route }) {
  const initialIncidentId = route?.params?.incidentId || '';
  const initialVideoUrl = route?.params?.videoUrl || '';
  const showAll = Boolean(route?.params?.showAll);

  const { latestReport } = useReport();

  const [incidentId, setIncidentId] = useState(initialIncidentId);
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState([]);
  const [error, setError] = useState('');

  const [playerVisible, setPlayerVisible] = useState(false);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState('');

  const loadVideos = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      if (showAll) {
        const all = await listIncidentReports();
        const reports = Array.isArray(all?.data) ? all.data : [];

        // Fallback: include in-memory latestReport if storage is empty.
        if (!reports.length && latestReport?.incidentId) {
          reports.push(latestReport);
        }

        const unsorted = reports.reduce((acc, report) => {
          const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
          const reportIncidentId = String(report?.incidentId || '').trim() || 'unknown';

          const next = evidence
            .filter((item) => item?.type === 'video' && item?.url)
            .map((item, index) => {
              const uploadedAt = item.timestamp || report.createdAt || new Date().toISOString();
              return {
                id: `${reportIncidentId}-${index}-${uploadedAt}`,
                url: item.url,
                incidentId: reportIncidentId,
                label: item.label || `Video Evidence #${index + 1}`,
                uploadedAt,
              };
            });

          return acc.concat(next);
        }, []);

        const videoItems = unsorted.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));

        if (!videoItems.length) {
          setError('No saved videos yet. Trigger SOS to record evidence.');
          setVideos([]);
          return;
        }

        if (incidentId) {
          setVideos([
            ...videoItems.filter((v) => v.incidentId === incidentId),
            ...videoItems.filter((v) => v.incidentId !== incidentId),
          ]);
        } else {
          setVideos(videoItems);
        }

        return;
      }

      let report = null;

      if (incidentId) {
        const stored = await getIncidentReportById(incidentId);
        report = stored?.data || null;
      } else if (latestReport?.incidentId) {
        report = latestReport;
        setIncidentId(latestReport.incidentId);
      } else {
        const latest = await getLatestIncidentReport();
        report = latest?.data || null;
        if (report?.incidentId) {
          setIncidentId(report.incidentId);
        }
      }

      if (!report) {
        setError('No report found yet. Trigger SOS to generate one.');
        setVideos([]);
        return;
      }

      const evidence = Array.isArray(report.evidence) ? report.evidence : [];
      const videoItems = evidence
        .filter((item) => item?.type === 'video' && item?.url)
        .map((item, index) => ({
          id: `${report.incidentId || 'report'}-${index}`,
          url: item.url,
          incidentId: String(report?.incidentId || '').trim(),
          label: item.label || `Video Evidence #${index + 1}`,
          uploadedAt: item.timestamp || report.createdAt || new Date().toISOString(),
        }));

      setVideos(videoItems);
    } catch (e) {
      setError(e?.message || 'Failed to load videos.');
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [incidentId, latestReport, initialVideoUrl, showAll]);

  useEffect(() => {
    if (initialVideoUrl) {
      setError('');
      setVideos([
        {
          id: 'direct',
          url: initialVideoUrl,
          label: 'Video Evidence',
          uploadedAt: new Date().toISOString(),
        },
      ]);
      setSelectedVideoUrl(initialVideoUrl);
      setPlayerVisible(true);
      setLoading(false);
      return;
    }

    loadVideos();
  }, [loadVideos, initialVideoUrl]);

  const headerSubtitle = useMemo(() => {
    if (initialVideoUrl && !incidentId) return 'Direct video link';
    if (showAll) return 'All saved incidents';
    if (!incidentId) return 'Latest incident';
    return `Incident: ${incidentId.slice(0, 8)}…`;
  }, [incidentId, initialVideoUrl, showAll]);

  const openPlayer = (url) => {
    setSelectedVideoUrl(url);
    setPlayerVisible(true);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => openPlayer(item.url)}
    >
      <View style={styles.thumbnail}>
        <Ionicons name="play-circle" size={40} color="#fff" />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.title}>{item.label || 'Incident Evidence Video'}</Text>
        <Text style={styles.meta}>
          {formatTimestamp(item.uploadedAt)}
          {item.incidentId ? `  •  ${String(item.incidentId).slice(0, 8)}...` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#ccc" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#fbf9ff" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('IncidentReport'))}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Video Evidence</Text>
          <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>
        </View>
        <TouchableOpacity onPress={loadVideos} style={styles.refreshButton} activeOpacity={0.8}>
          <Ionicons name="refresh" size={20} color="#7b57d1" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7b57d1" />
          <Text style={styles.centerText}>Loading videos…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={24} color="#ea5455" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : videos.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="videocam-outline" size={28} color="#8f8f96" />
          <Text style={styles.centerText}>No video evidence yet.</Text>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal visible={playerVisible} animationType="slide" onRequestClose={() => setPlayerVisible(false)}>
        <SafeAreaView style={styles.playerContainer} edges={['top', 'left', 'right']}>
          <View style={styles.playerHeader}>
            <TouchableOpacity onPress={() => setPlayerVisible(false)} style={styles.playerClose}>
              <Ionicons name="close" size={24} color="#111" />
            </TouchableOpacity>
            <Text style={styles.playerTitle}>Playing</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.playerBody}>
            {selectedVideoUrl ? (
              <InlineVideoPlayer videoUrl={selectedVideoUrl} />
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbf9ff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: { padding: 4 },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f2ebff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, marginLeft: 12, marginRight: 12 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111' },
  headerSubtitle: { marginTop: 2, fontSize: 12, color: '#8f8f96', fontWeight: '600' },

  list: { paddingHorizontal: 20, paddingBottom: 30 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#14092c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 2,
    marginBottom: 14,
    gap: 12,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#7b57d1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1 },
  title: { fontSize: 14, fontWeight: '800', color: '#111' },
  meta: { marginTop: 6, fontSize: 12, color: '#8f8f96', fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  centerText: { color: '#8f8f96', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  errorText: { color: '#ea5455', fontSize: 13, fontWeight: '700', textAlign: 'center' },

  playerContainer: { flex: 1, backgroundColor: '#fff' },
  playerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  playerClose: { padding: 6 },
  playerTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  playerBody: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
});
