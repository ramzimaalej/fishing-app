/**
 * Dependency-free sensitivity slider built from View + PanResponder.
 * Maps touch X across the track to a value in [0, 1], snapped to STEP.
 */
import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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

/**
 * Snap to STEP, then round away binary-float noise.
 *
 * Math.round(n / 0.05) * 0.05 yields values like 0.35000000000000003, which then
 * fail equality checks and render as "35.00000000000001%" once formatted.
 */
const snap = (n: number): number => Number((Math.round(n / STEP) * STEP).toFixed(2));

export default function SensitivitySlider({ value, onChange }: Props) {
  const { t } = useTranslation();
  const widthRef = useRef(0);
  /** Track-relative x where the drag began. */
  const startXRef = useRef(0);
  /** Last value handed upwards, so identical steps don't re-notify. */
  const lastSentRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
  };

  const emit = (trackX: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const next = clamp01(snap(trackX / w));
    // Only 21 distinct values exist at STEP = 0.05, so de-duplicating here turns
    // ~60 store writes per second into at most one per step crossed. Each write
    // persists to AsyncStorage and retunes every live detector, so this matters.
    if (next === lastSentRef.current) return;
    lastSentRef.current = next;
    onChangeRef.current(next);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // CAPTURE, so the track claims the gesture before the thumb child can.
        // Without this the thumb becomes the touch target and `locationX` is
        // measured against its 26px width instead of the track's — the cause of
        // the Android flicker this replaced.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (evt) => {
          startXRef.current = evt.nativeEvent.locationX;
          emit(startXRef.current);
        },
        // Uses gestureState.dx rather than locationX: dx is a page-space delta
        // from the touch start, so it stays correct no matter which view the
        // finger happens to be over as it moves.
        onPanResponderMove: (_evt, gestureState) => {
          emit(startXRef.current + gestureState.dx);
        },
      }),
    [],
  );

  // Keep the de-dupe latch in step with an externally changed value (e.g. the
  // settings Reset button), or the next drag to that same value would be eaten.
  if (value !== lastSentRef.current && Math.abs(value - lastSentRef.current) > STEP / 2) {
    lastSentRef.current = value;
  }

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
        <Text style={styles.endLabel}>{t('settings.sensitivityLow')}</Text>
        <Text style={styles.endLabel}>{t('settings.sensitivityHigh')}</Text>
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
