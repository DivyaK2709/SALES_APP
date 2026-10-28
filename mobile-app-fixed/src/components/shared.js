// src/components/shared.js
// Reusable UI building blocks used across all screens

import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Colors, Spacing, Radius, Shadow } from '../theme';

// ─── KPI Card ────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, sub, accent, icon }) {
  return (
    <View style={[kpi.card, Shadow.card]}>
      <View style={[kpi.iconWrap, { backgroundColor: accent + '18' }]}>
        <Text style={kpi.icon}>{icon}</Text>
      </View>
      <Text style={kpi.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={kpi.label}>{label}</Text>
      {sub ? <Text style={[kpi.sub, { color: accent }]}>{sub}</Text> : null}
    </View>
  );
}

const kpi = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    margin: Spacing.xs,
    minWidth: 100,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  icon:  { fontSize: 22 },
  value: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary, marginBottom: 2 },
  label: { fontSize: 10, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.8, textAlign: 'center' },
  sub:   { fontSize: 11, fontWeight: '700', marginTop: 3 },
});

// ─── Section Header ──────────────────────────────────────────────────────────
export function SectionHeader({ title, right }) {
  return (
    <View style={sh.row}>
      <View style={sh.pill} />
      <Text style={sh.title}>{title}</Text>
      {right && <View style={sh.rightSlot}>{right}</View>}
    </View>
  );
}
const sh = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm, marginTop: Spacing.lg },
  pill:     { width: 4, height: 18, borderRadius: 2, backgroundColor: Colors.primary, marginRight: Spacing.sm },
  title:    { fontSize: 14, fontWeight: '800', color: Colors.textPrimary, letterSpacing: 0.5, flex: 1 },
  rightSlot:{ },
});

// ─── Primary Button ──────────────────────────────────────────────────────────
export function PrimaryButton({ label, onPress, loading, disabled, style }) {
  return (
    <TouchableOpacity
      style={[btn.base, (disabled || loading) && btn.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.82}
    >
      {loading
        ? <ActivityIndicator color="#fff" />
        : <Text style={btn.label}>{label}</Text>}
    </TouchableOpacity>
  );
}
const btn = StyleSheet.create({
  base:     { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.55 },
  label:    { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.6 },
});

// ─── Metric Toggle Pill ──────────────────────────────────────────────────────
export function MetricToggle({ options, active, onChange }) {
  return (
    <View style={mt.row}>
      {options.map(o => (
        <TouchableOpacity
          key={o.key}
          style={[mt.pill, active === o.key && { backgroundColor: o.color }]}
          onPress={() => onChange(o.key)}
          activeOpacity={0.8}
        >
          <View style={[mt.dot, { backgroundColor: active === o.key ? '#fff' : o.color }]} />
          <Text style={[mt.label, active === o.key && { color: '#fff' }]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
const mt = StyleSheet.create({
  row:   { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: Radius.full, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border },
  dot:   { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
});

// ─── Empty State ─────────────────────────────────────────────────────────────
export function EmptyState({ icon = '📊', message }) {
  return (
    <View style={es.wrap}>
      <Text style={es.icon}>{icon}</Text>
      <Text style={es.msg}>{message}</Text>
    </View>
  );
}
const es = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  icon: { fontSize: 42 },
  msg:  { fontSize: 14, color: Colors.textMuted, textAlign: 'center', maxWidth: 220 },
});

// ─── Date Pill Button ────────────────────────────────────────────────────────
export function DatePill({ label, value, onPress }) {
  return (
    <TouchableOpacity style={dp.wrap} onPress={onPress} activeOpacity={0.8}>
      <Text style={dp.lbl}>{label}</Text>
      <Text style={dp.val}>📅 {value}</Text>
    </TouchableOpacity>
  );
}
const dp = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radius.sm, padding: Spacing.sm, borderWidth: 1.5, borderColor: Colors.border },
  lbl:  { fontSize: 10, color: Colors.textMuted, fontWeight: '600', marginBottom: 3, letterSpacing: 0.5 },
  val:  { fontSize: 13, color: Colors.textPrimary, fontWeight: '600' },
});
