import React, { useMemo } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';

interface MiniMapProps {
  latitude: number;
  longitude: number;
  size?: number;
}

const ZOOM = 15;

function lon2tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function lat2tileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

export function MiniMap({ latitude, longitude, size = 110 }: MiniMapProps) {
  const { tileUrl, markerLeft, markerTop } = useMemo(() => {
    const tx = lon2tileX(longitude, ZOOM);
    const ty = lat2tileY(latitude, ZOOM);
    const tileUrl = `https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`;

    const pow2 = Math.pow(2, ZOOM);
    const xFrac = ((longitude + 180) / 360) * pow2 - tx;
    const latRad = (latitude * Math.PI) / 180;
    const yFrac =
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * pow2 - ty;

    return {
      tileUrl,
      markerLeft: Math.max(4, Math.min(size - 4, xFrac * size)),
      markerTop: Math.max(4, Math.min(size - 4, yFrac * size)),
    };
  }, [latitude, longitude, size]);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Image
        source={{
          uri: tileUrl,
          headers: { 'User-Agent': 'GPS-Solar-Camera/1.0 (site-inspection)' },
        }}
        style={{ width: size, height: size }}
        resizeMode="stretch"
      />
      {/* Accuracy ring */}
      <View
        style={[
          styles.markerRing,
          {
            left: markerLeft - 10,
            top: markerTop - 10,
          },
        ]}
      />
      {/* Centre dot */}
      <View
        style={[
          styles.markerDot,
          {
            left: markerLeft - 4,
            top: markerTop - 4,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(78, 205, 196, 0.5)',
    backgroundColor: '#1a1a2e',
  },
  markerRing: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 59, 48, 0.7)',
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
  },
  markerDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
});
