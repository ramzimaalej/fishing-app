/**
 * Dependency-free sensitivity slider built from View + PanResponder.
 * Maps touch X across the track to a value in [0, 1], snapped to 0.05 steps.
 */
import React, { useMemo, useRef } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

interface Props {
  value: number;
  onChange: (v: number) => void;
}

const THUMB = 26;
const STEP = 0.05;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const snap = (n: number): number => Math.round(n / STEP) * STEP;

export default function SensitivitySlider({ value, onChange }: Props) {
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const w = widthRef.current;
          if (w > 0) onChangeRef.current(clamp01(snap(evt.nativeEvent.locationX / w)));
        },
        onPanResponderMove: (evt) => {
          const w = widthRef.current;
          if (w > 0) onChangeRef.current(clamp01(snap(evt.nativeEvent.locationX / w)));
        },
      }),
    [],
  );

  const pct = clamp01(value);

  return (
    <View style={styles.container}>
      <View
        style={styles.track}
        onLayout={onLayout}
        hitSlop={{ top: 16, bottom: 16 }}
        {...responder.panHandlers}
      >
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
        <View
          style={[
            styles.thumb,
            // Keep the thumb within the track edges.
            { left: `${pct * 100}%`, marginLeft: -THUMB / 2 },
          ]}
        />
      </View>
      <View style={styles.labels}>
        <Text style={styles.endLabel}>Low</Text>
        <Text style={styles.endLabel}>High</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    marginVertical: THUMB / 2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.text,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  endLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
