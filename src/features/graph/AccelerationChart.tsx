import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { colors, radius, spacing, typography } from '@/theme';
import type { BiteEvent } from '@/types';

export interface AccelChartPoint {
  t: number;
  dynamic: number;
  threshold: number;
}

interface AccelerationChartProps {
  points: AccelChartPoint[];
  bites?: BiteEvent[];
  height?: number;
}

const PADDING = { top: 12, right: 12, bottom: 8, left: 12 };
const MIN_Y_MAX = 0.3; // keep a sensible scale when the signal is tiny

/**
 * Real-time acceleration graph. Plots the Kalman-filtered dynamic magnitude
 * against the adaptive detection threshold, and marks detected bites as dots
 * coloured by size (small = blue, big = orange). Paths are built as raw SVG `d`
 * strings for cheap re-rendering of ~300-point windows.
 */
function AccelerationChart({ points, bites = [], height = 220 }: AccelerationChartProps) {
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== width) setWidth(w);
  };

  const geom = useMemo(() => {
    const innerW = Math.max(0, width - PADDING.left - PADDING.right);
    const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);
    if (points.length < 2 || innerW <= 0) {
      return { dynamicPath: '', thresholdPath: '', marks: [], yMax: MIN_Y_MAX, innerH, innerW };
    }

    const tStart = points[0]!.t;
    const tEnd = points[points.length - 1]!.t;
    const tSpan = Math.max(1, tEnd - tStart);

    let yMax = MIN_Y_MAX;
    for (const p of points) {
      if (p.dynamic > yMax) yMax = p.dynamic;
      if (p.threshold > yMax) yMax = p.threshold;
    }
    yMax *= 1.15; // headroom

    const xOf = (t: number) => PADDING.left + ((t - tStart) / tSpan) * innerW;
    const yOf = (v: number) => PADDING.top + innerH - (v / yMax) * innerH;

    let dynamicPath = '';
    let thresholdPath = '';
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const cmd = i === 0 ? 'M' : 'L';
      dynamicPath += `${cmd}${xOf(p.t).toFixed(1)} ${yOf(p.dynamic).toFixed(1)}`;
      thresholdPath += `${cmd}${xOf(p.t).toFixed(1)} ${yOf(p.threshold).toFixed(1)}`;
    }

    const marks = bites
      .filter((b) => b.timestamp >= tStart && b.timestamp <= tEnd)
      .map((b) => ({
        id: b.id,
        cx: xOf(b.timestamp),
        cy: yOf(Math.min(b.peakMagnitude, yMax)),
        color: b.size === 'big' ? colors.big : colors.small,
      }));

    return { dynamicPath, thresholdPath, marks, yMax, innerH, innerW };
  }, [points, bites, width, height]);

  return (
    <View style={styles.container}>
      <View style={[styles.chart, { height }]} onLayout={onLayout}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {/* baseline (zero) axis */}
            <Line
              x1={PADDING.left}
              y1={PADDING.top + geom.innerH}
              x2={width - PADDING.right}
              y2={PADDING.top + geom.innerH}
              stroke={colors.border}
              strokeWidth={1}
            />
            {geom.thresholdPath !== '' && (
              <Path
                d={geom.thresholdPath}
                stroke={colors.textMuted}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                fill="none"
              />
            )}
            {geom.dynamicPath !== '' && (
              <Path d={geom.dynamicPath} stroke={colors.primary} strokeWidth={2} fill="none" />
            )}
            {geom.marks.map((m) => (
              <Circle
                key={m.id}
                cx={m.cx}
                cy={m.cy}
                r={5}
                fill={m.color}
                stroke={colors.bg}
                strokeWidth={1.5}
              />
            ))}
          </Svg>
        )}
        {points.length < 2 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Waiting for sensor data…</Text>
          </View>
        )}
      </View>

      <View style={styles.legend}>
        <LegendItem color={colors.primary} label="Acceleration (g)" />
        <LegendItem color={colors.textMuted} label="Threshold" dashed />
        <LegendItem color={colors.small} label="Small bite" dot />
        <LegendItem color={colors.big} label="Big bite" dot />
        <Text style={styles.scale}>max {geom.yMax.toFixed(2)}g</Text>
      </View>
    </View>
  );
}

function LegendItem({
  color,
  label,
  dashed,
  dot,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  dot?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          dot ? styles.legendDot : styles.legendLine,
          { backgroundColor: color, opacity: dashed ? 0.7 : 1 },
        ]}
      />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chart: {
    width: '100%',
    justifyContent: 'center',
  },
  empty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    ...typography.caption,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendLine: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: colors.textMuted,
    ...typography.caption,
  },
  scale: {
    color: colors.textMuted,
    ...typography.caption,
    marginLeft: 'auto',
  },
});

export default AccelerationChart;
