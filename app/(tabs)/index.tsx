import { MiniMap } from '@/components/MiniMap';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const OVERLAY_HEIGHT = 142;

// ─── Types ───────────────────────────────────────────────────────────────────

type AppState = 'permissions' | 'camera' | 'capturing' | 'preview';

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

interface GpsSnapshot {
  location: LocationData;
  address: string;
  timestamp: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatDate(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatLat(v: number): string {
  return `${Math.abs(v).toFixed(6)}°  ${v >= 0 ? 'N' : 'S'}`;
}

function formatLon(v: number): string {
  return `${Math.abs(v).toFixed(6)}°  ${v >= 0 ? 'E' : 'W'}`;
}

// ─── GPS Overlay Panel ────────────────────────────────────────────────────────

interface OverlayPanelProps {
  location: LocationData | null;
  address: string;
  timestamp: Date;
}

function GpsOverlayPanel({ location, address, timestamp }: OverlayPanelProps) {
  return (
    <View style={overlayStyles.panel}>
      {/* Mini Map */}
      <View style={overlayStyles.mapWrapper}>
        {location ? (
          <MiniMap latitude={location.latitude} longitude={location.longitude} size={110} />
        ) : (
          <View style={overlayStyles.mapLoading}>
            <ActivityIndicator color="#4ECDC4" />
          </View>
        )}
        {/* GPS accuracy badge */}
        {location?.accuracy != null && (
          <View style={overlayStyles.accuracyBadge}>
            <Text style={overlayStyles.accuracyText}>
              ±{Math.round(location.accuracy)}m
            </Text>
          </View>
        )}
      </View>

      {/* Data columns */}
      <View style={overlayStyles.dataCol}>
        {/* Address */}
        <View style={overlayStyles.addressRow}>
          <Text style={overlayStyles.pinIcon}>📍</Text>
          <Text style={overlayStyles.addressText} numberOfLines={2}>
            {address || 'Acquiring location…'}
          </Text>
        </View>

        <View style={overlayStyles.divider} />

        {/* Coordinates */}
        <View style={overlayStyles.coordGrid}>
          <View style={overlayStyles.coordBlock}>
            <Text style={overlayStyles.coordLabel}>LAT</Text>
            <Text style={overlayStyles.coordValue}>
              {location ? formatLat(location.latitude) : '—'}
            </Text>
          </View>
          <View style={overlayStyles.coordBlock}>
            <Text style={overlayStyles.coordLabel}>LON</Text>
            <Text style={overlayStyles.coordValue}>
              {location ? formatLon(location.longitude) : '—'}
            </Text>
          </View>
        </View>

        <View style={overlayStyles.divider} />

        {/* DateTime */}
        <View style={overlayStyles.dateTimeRow}>
          <Text style={overlayStyles.dateText}>{formatDate(timestamp)}</Text>
          <Text style={overlayStyles.timeText}>{formatTime(timestamp)}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CameraScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationGranted, setLocationGranted] = useState(false);
  const [mediaGranted, setMediaGranted] = useState(false);

  const [appState, setAppState] = useState<AppState>('permissions');
  const [location, setLocation] = useState<LocationData | null>(null);
  const [address, setAddress] = useState('');
  const [now, setNow] = useState(new Date());
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [composedUri, setComposedUri] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GpsSnapshot | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const capturedOnce = useRef(false);

  const cameraRef = useRef<CameraView>(null);
  const previewRef = useRef<View>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const shutterScale = useRef(new Animated.Value(1)).current;

  const insets = useSafeAreaInsets();

  // ── Clock ──
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Immersive mode (Android only) ──
  // Hides the software navigation bar. On swipe from edge it briefly reappears
  // then auto-hides again after a short period of inactivity.
  // Uses dynamic import so the app doesn't crash if the package isn't installed yet.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let mounted = true;

    (async () => {
      try {
        const NavBar = await import('expo-navigation-bar');
        if (!mounted) return;
        // setBehaviorAsync is not supported with edgeToEdgeEnabled — setVisibilityAsync alone
        // is sufficient; the edge-to-edge system handles gesture-reveal automatically.
        await NavBar.setVisibilityAsync('hidden');
      } catch {
        // expo-navigation-bar not installed — skip silently
      }
    })();

    return () => {
      mounted = false;
      import('expo-navigation-bar')
        .then(NavBar => NavBar.setVisibilityAsync('visible'))
        .catch(() => { });
    };
  }, []);

  // ── Permissions + location ──
  // NOTE: MediaLibrary permission is intentionally NOT requested here.
  // Requesting it on startup triggers the Android 13+ photo picker UI.
  // It is requested lazily the first time a photo needs to be saved.
  useEffect(() => {
    (async () => {
      const cam = await requestCameraPermission();
      const loc = await Location.requestForegroundPermissionsAsync();

      setLocationGranted(loc.granted);

      if (cam.granted && loc.granted) {
        setAppState('camera');
        startWatch();
      } else if (cam.granted) {
        setAppState('camera');
      }
    })();

    return () => {
      locationSub.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWatch = useCallback(async () => {
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 1 },
      async (loc) => {
        const coords: LocationData = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
        };
        setLocation(coords);

        try {
          const [geo] = await Location.reverseGeocodeAsync(coords);
          if (geo) {
            const parts = [geo.name, geo.street, geo.subregion ?? geo.district, geo.city, geo.region]
              .filter(Boolean);
            setAddress(parts.join(', '));
          }
        } catch {
          // silent — address stays as is
        }
      },
    );
    locationSub.current = sub;
  }, []);

  // ── Capture ──
  const animateShutter = useCallback(() => {
    Animated.sequence([
      Animated.timing(shutterScale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.timing(shutterScale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();

    // Flash
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [shutterScale, flashAnim]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || appState !== 'camera') return;

    animateShutter();
    setAppState('capturing');

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.92 });

      const snap: GpsSnapshot = {
        location: location ?? { latitude: 0, longitude: 0, accuracy: null },
        address,
        timestamp: new Date(),
      };

      setSnapshot(snap);
      setCapturedUri(photo.uri);
      setComposedUri(null);
      setSaveMsg('');
      capturedOnce.current = false;
      setAppState('preview');
    } catch {
      setAppState('camera');
      Alert.alert('Capture Failed', 'Could not take photo. Please try again.');
    }
  }, [appState, location, address, animateShutter]);

  // ── After preview image loads → compose + save ──
  const handleImageLoad = useCallback(async () => {
    if (capturedOnce.current) return;
    capturedOnce.current = true;

    // Let the layout settle
    await new Promise(r => setTimeout(r, 400));

    if (!previewRef.current) return;

    setIsSaving(true);
    try {
      const uri = await captureRef(previewRef, { format: 'jpg', quality: 0.92 });
      setComposedUri(uri);

      // Android 13+ (API 33+): WRITE_EXTERNAL_STORAGE is deprecated — saveToLibraryAsync
      // works without any permission. Attempt the save first; if it throws (older Android
      // without permission), then request permission and retry once.
      try {
        await MediaLibrary.saveToLibraryAsync(uri);
        setMediaGranted(true);
        setSaveMsg('✓  Saved to Gallery');
      } catch {
        // Save failed — likely older Android that needs explicit permission
        const perm = await MediaLibrary.requestPermissionsAsync();
        setMediaGranted(perm.granted);
        if (perm.granted) {
          await MediaLibrary.saveToLibraryAsync(uri);
          setSaveMsg('✓  Saved to Gallery');
        } else {
          setSaveMsg('⚠  Gallery permission denied');
        }
      }
    } catch (e) {
      setSaveMsg('⚠  Could not save');
      console.error('ViewShot/save error:', e);
    } finally {
      setIsSaving(false);
    }
  }, []);

  // ── Share ──
  const handleShare = useCallback(async () => {
    const uri = composedUri ?? capturedUri;
    if (!uri) return;

    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share Site Photo' });
      } else {
        Alert.alert('Not available', 'Sharing is not available on this device.');
      }
    } catch {
      Alert.alert('Share Failed', 'Could not share the image.');
    }
  }, [composedUri, capturedUri]);

  // ── Retake ──
  const handleRetake = useCallback(() => {
    setCapturedUri(null);
    setComposedUri(null);
    setSnapshot(null);
    setSaveMsg('');
    setIsSaving(false);
    capturedOnce.current = false;
    setAppState('camera');
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER: permissions gate
  // ─────────────────────────────────────────────────────────────────────────
  if (!cameraPermission?.granted) {
    return (
      <View style={styles.permContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />
        <View style={styles.permIcon}>
          <Image source={require('@/assets/images/favicon.png')} style={{ width: 150, height: 150, borderRadius: 14 }} resizeMode="contain" />
        </View>
        <Text style={styles.permTitle}>GPS Camera</Text>
        <Text style={styles.permSub}>Solar Site Investigation</Text>
        <Text style={styles.permDesc}>
          Camera, Location & Photo Library access is required to capture
          geo-tagged site images.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestCameraPermission}>
          <Text style={styles.permBtnText}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER: main UI
  // ─────────────────────────────────────────────────────────────────────────
  const bottomPad = Math.max(insets.bottom, 20);
  const isCameraMode = appState === 'camera' || appState === 'capturing';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Camera / Preview layer (ViewShot target in preview) ── */}
      {isCameraMode ? (
        <View style={StyleSheet.absoluteFill}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
          />
          {/* Live overlay — display only, not captured */}
          <View
            style={[styles.overlayWrapper, { height: OVERLAY_HEIGHT }]}
            pointerEvents="none">
            <GpsOverlayPanel location={location} address={address} timestamp={now} />
          </View>
        </View>
      ) : appState === 'preview' && capturedUri ? (
        /* ViewShot wraps image + frozen overlay */
        <View ref={previewRef} style={StyleSheet.absoluteFill} collapsable={false}>
          <Image
            source={{ uri: capturedUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onLoad={handleImageLoad}
          />
          <View
            style={[styles.overlayWrapper, { height: OVERLAY_HEIGHT }]}
            pointerEvents="none">
            <GpsOverlayPanel
              location={snapshot?.location ?? null}
              address={snapshot?.address ?? ''}
              timestamp={snapshot?.timestamp ?? new Date()}
            />
          </View>
        </View>
      ) : null}

      {/* ── Flash animation ── */}
      <Animated.View
        style={[styles.flashOverlay, { opacity: flashAnim }]}
        pointerEvents="none"
      />

      {/* ── Action layer (NOT captured by ViewShot) ── */}
      <View style={styles.actionLayer} pointerEvents="box-none">
        {/* CAMERA: shutter button — sits directly above the GPS overlay */}
        {appState === 'camera' && (
          <View style={[styles.shutterAbove, { bottom: OVERLAY_HEIGHT }]}>
            <TouchableOpacity
              onPress={handleCapture}
              activeOpacity={0.85}
              accessibilityLabel="Capture photo">
              <Animated.View style={[styles.shutterOuter, { transform: [{ scale: shutterScale }] }]}>
                <View style={styles.shutterInner} />
              </Animated.View>
            </TouchableOpacity>
          </View>
        )}

        {/* CAPTURING: spinner — same position as shutter */}
        {appState === 'capturing' && (
          <View style={[styles.shutterAbove, { bottom: OVERLAY_HEIGHT + bottomPad + 12 }]}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        )}

        {/* PREVIEW: save status + Share / Retake */}
        {appState === 'preview' && (
          <View style={[styles.previewActions, { paddingBottom: bottomPad }]}>
            {/* Save badge */}
            <View style={styles.saveBadge}>
              {isSaving ? (
                <View style={styles.saveBadgeInner}>
                  <ActivityIndicator color="#4ECDC4" size="small" />
                  <Text style={styles.saveBadgeText}>  Saving…</Text>
                </View>
              ) : saveMsg ? (
                <View style={styles.saveBadgeInner}>
                  <Text style={styles.saveBadgeText}>{saveMsg}</Text>
                </View>
              ) : null}
            </View>

            {/* Buttons */}
            <View style={styles.previewButtons}>
              <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
                <Text style={styles.retakeBtnText}>↺  Retake</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shareBtn, !capturedUri && styles.btnDisabled]}
                onPress={handleShare}
                disabled={!capturedUri}>
                <Text style={styles.shareBtnText}>⬆  Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Overlay styles ───────────────────────────────────────────────────────────

const overlayStyles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
    backgroundColor: 'rgba(6, 6, 18, 0.82)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(78, 205, 196, 0.3)',
  },
  mapWrapper: {
    position: 'relative',
  },
  mapLoading: {
    width: 110,
    height: 110,
    borderRadius: 10,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(78, 205, 196, 0.4)',
  },
  accuracyBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  accuracyText: {
    color: '#4ECDC4',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dataCol: {
    flex: 1,
    justifyContent: 'space-between',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  pinIcon: {
    fontSize: 11,
    marginTop: 1,
  },
  addressText: {
    flex: 1,
    color: '#e8e8e8',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 4,
  },
  coordGrid: {
    gap: 4,
  },
  coordBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coordLabel: {
    color: '#4ECDC4',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    width: 24,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  coordValue: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.3,
  },
  dateTimeRow: {
    gap: 1,
  },
  dateText: {
    color: '#b0b0c8',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  timeText: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
});

// ─── Screen styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },

  // Overlay sits at the absolute bottom of the camera/preview layer
  overlayWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
  },

  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 50,
  },

  // Action layer floats above everything, does not intercept touches on camera
  actionLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },

  // ── Shutter — floats above the GPS overlay, no background ──
  shutterAbove: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 3,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4ECDC4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 12,
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
  },

  // ── Preview actions ──
  previewActions: {
    paddingTop: 12,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
    gap: 12,
  },
  saveBadge: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
  },
  saveBadgeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(78, 205, 196, 0.15)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(78,205,196,0.35)',
  },
  saveBadgeText: {
    color: '#4ECDC4',
    fontSize: 13,
    fontWeight: '600',
  },
  previewButtons: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
  },
  retakeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
  },
  retakeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  shareBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#4ECDC4',
    alignItems: 'center',
    shadowColor: '#4ECDC4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  shareBtnText: {
    color: '#0a1628',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  btnDisabled: {
    opacity: 0.4,
  },

  // ── Permission screen ──
  permContainer: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permIcon: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: 'rgba(78,205,196,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(78,205,196,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  permTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  permSub: {
    color: '#4ECDC4',
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 28,
  },
  permDesc: {
    color: '#8888aa',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 40,
  },
  permBtn: {
    backgroundColor: '#4ECDC4',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 16,
    shadowColor: '#4ECDC4',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
  },
  permBtnText: {
    color: '#0a1628',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
