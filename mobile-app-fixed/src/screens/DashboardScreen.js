// src/screens/DashboardScreen.js
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, StatusBar, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { fetchTodaySales, fetchMonthSales } from '../services/api';
import { KpiCard, SectionHeader, EmptyState } from '../components/shared';
import { Colors, Spacing, Radius, Shadow } from '../theme';

const CCODE = 1; // single store

const fmt = (v) => {
  if (v >= 1_000_000) return `RM ${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `RM ${(v / 1_000).toFixed(1)}K`;
  return `RM ${v.toFixed(0)}`;
};

const pct = (profit, amt) =>
  amt > 0 ? `${((profit / amt) * 100).toFixed(1)}% margin` : '—';

function sumRows(rows) {
  const amt    = rows.reduce((s, r) => s + (parseFloat(r.amt)  || 0), 0);
  const cost   = rows.reduce((s, r) => s + (parseFloat(r.cost) || 0), 0);
  const profit = amt - cost;
  return { amt, cost, profit };
}

export default function DashboardScreen({ navigation }) {
  const { user, logout }          = useAuth();
  const [today, setToday]         = useState(null);
  const [month, setMonth]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [tRows, mRows] = await Promise.all([
        fetchTodaySales(CCODE),
        fetchMonthSales(CCODE),
      ]);
      setToday(sumRows(tRows));
      setMonth(sumRows(mRows));
    } catch (e) {
      setError(e.message || 'Failed to load data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(true); };

  const nowStr = new Date().toLocaleDateString('en-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />

      {/* ── Top bar ── */}
      <View style={[s.topBar, Shadow.header]}>
        <View>
          <Text style={s.greeting}>Hello, {user?.username || 'Manager'} 👋</Text>
          <Text style={s.date}>{nowStr}</Text>
        </View>
        <TouchableOpacity onPress={logout} style={s.logoutBtn}>
          <Text style={s.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Store badge ── */}
        <View style={s.storeBadge}>
          <Text style={s.storeEmoji}>🏪</Text>
          <View>
          <Text style={s.storeName}>{user?.name || 'FreshMart'}</Text>
<Text style={s.storeCode}>Code: {user?.uniqueCode || 'YNOT001'}</Text>
          </View>
          <View style={s.onlineDot} />
        </View>

        {/* ── Loading ── */}
        {loading && (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.loadingText}>Loading sales data…</Text>
          </View>
        )}

        {/* ── Error ── */}
        {!loading && error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>⚠️  {error}</Text>
            <TouchableOpacity onPress={() => load()} style={s.retryBtn}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Today's KPIs ── */}
        {!loading && today && (
          <>
            <SectionHeader title="TODAY'S PERFORMANCE" />
            <View style={s.kpiRow}>
              <KpiCard
                label="SALES"
                value={fmt(today.amt)}
                icon="💰"
                accent={Colors.chartAmt}
              />
              <KpiCard
                label="COST"
                value={fmt(today.cost)}
                icon="🏷️"
                accent={Colors.chartCost}
              />
              <KpiCard
                label="PROFIT"
                value={fmt(today.profit)}
                sub={pct(today.profit, today.amt)}
                icon="📈"
                accent={Colors.chartProfit}
              />
            </View>
          </>
        )}

        {/* ── Monthly KPIs ── */}
        {!loading && month && (
          <>
            <SectionHeader title="THIS MONTH" />
            <View style={s.kpiRow}>
              <KpiCard
                label="SALES"
                value={fmt(month.amt)}
                icon="🗓️"
                accent={Colors.chartAmt}
              />
              <KpiCard
                label="COST"
                value={fmt(month.cost)}
                icon="🧾"
                accent={Colors.chartCost}
              />
              <KpiCard
                label="PROFIT"
                value={fmt(month.profit)}
                sub={pct(month.profit, month.amt)}
                icon="✅"
                accent={Colors.chartProfit}
              />
            </View>
          </>
        )}

       {/* ── Quick Actions ── */}
{!loading && (
  <>
    <SectionHeader title="QUICK ACTIONS" />
    <View style={s.actionsGrid}>
      <TouchableOpacity
        style={[s.actionCard, Shadow.card]}
        onPress={() => navigation.navigate('SalesGraph')}
        activeOpacity={0.85}
      >
        <View style={[s.actionIcon, { backgroundColor: Colors.primaryPale }]}>
          <Text style={{ fontSize: 28 }}>📊</Text>
        </View>
        <Text style={s.actionLabel}>Sales Graph</Text>
        <Text style={s.actionSub}>Daily bar chart analysis</Text>
        <View style={[s.actionArrow, { backgroundColor: Colors.primary }]}>
          <Text style={s.actionArrowText}>→</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.actionCard, Shadow.card]}
        onPress={onRefresh}
        activeOpacity={0.85}
      >
        <View style={[s.actionIcon, { backgroundColor: '#FFF7E6' }]}>
          <Text style={{ fontSize: 28 }}>🔄</Text>
        </View>
        <Text style={s.actionLabel}>Refresh Data</Text>
        <Text style={s.actionSub}>Pull latest from database</Text>
        <View style={[s.actionArrow, { backgroundColor: Colors.accent }]}>
          <Text style={s.actionArrowText}>↺</Text>
        </View>
      </TouchableOpacity>
    </View>

    {/* ── Second row ── */}
 {/* ── Second row ── */}
<View style={[s.actionsGrid, { marginTop: 12 }]}>
  <TouchableOpacity
    style={[s.actionCard, Shadow.card]}
    onPress={() => navigation.navigate('DayWiseSales')}
    activeOpacity={0.85}
  >
    <View style={[s.actionIcon, { backgroundColor: '#E8F5E9' }]}>
      <Text style={{ fontSize: 28 }}>🥧</Text>
    </View>
    <Text style={s.actionLabel}>Day Wise Sales</Text>
    <Text style={s.actionSub}>Weekly pie chart view</Text>
    <View style={[s.actionArrow, { backgroundColor: '#2E7D32' }]}>
      <Text style={s.actionArrowText}>→</Text>
    </View>
  </TouchableOpacity>

  <TouchableOpacity
    style={[s.actionCard, Shadow.card]}
    onPress={() => navigation.navigate('DeptWiseSales')}
    activeOpacity={0.85}
  >
    <View style={[s.actionIcon, { backgroundColor: '#EDE7F6' }]}>
      <Text style={{ fontSize: 28 }}>🏬</Text>
    </View>
    <Text style={s.actionLabel}>Dept Wise Sales</Text>
    <Text style={s.actionSub}>Department area chart</Text>
    <View style={[s.actionArrow, { backgroundColor: '#6A1B9A' }]}>
      <Text style={s.actionArrowText}>→</Text>
    </View>
  </TouchableOpacity>
</View>

{/* ── Third row ── */}
<View style={[s.actionsGrid, { marginTop: 12 }]}>
  <TouchableOpacity
    style={[s.actionCard, Shadow.card]}
    onPress={() => navigation.navigate('SalesPurchaseMargin')}
    activeOpacity={0.85}
  >
    <View style={[s.actionIcon, { backgroundColor: '#EEF2FF' }]}>
      <Text style={{ fontSize: 28 }}>📊</Text>
    </View>
    <Text style={s.actionLabel}>Sales vs Cost</Text>
    <Text style={s.actionSub}>Weekly margin overview</Text>
    <View style={[s.actionArrow, { backgroundColor: '#1A1A2E' }]}>
      <Text style={s.actionArrowText}>→</Text>
    </View>
  </TouchableOpacity>

  <TouchableOpacity
    style={[s.actionCard, Shadow.card]}
    onPress={() => navigation.navigate('ItemPriceChange')}
    activeOpacity={0.85}
  >
    <View style={[s.actionIcon, { backgroundColor: '#FFF3E0' }]}>
      <Text style={{ fontSize: 28 }}>🏷️</Text>
    </View>
    <Text style={s.actionLabel}>Item Price Change</Text>
    <Text style={s.actionSub}>Search item, update prices</Text>
    <View style={[s.actionArrow, { backgroundColor: '#E65100' }]}>
      <Text style={s.actionArrowText}>→</Text>
    </View>
  </TouchableOpacity>
</View>
  </>
)}
        {/* ── Info strip ── */}
        <View style={s.infoStrip}>
          <Text style={s.infoText}>🛢 Connected to SQL Server 15.0.4455</Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  // Top bar
  topBar: {
    backgroundColor: Colors.primary,
    paddingTop: 52, paddingBottom: 18,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  greeting: { fontSize: 18, fontWeight: '800', color: '#fff' },
  date:     { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  logoutBtn:{ backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Radius.full, paddingVertical: 6, paddingHorizontal: 14 },
  logoutText:{ color: '#fff', fontSize: 12, fontWeight: '700' },

  scroll: { padding: Spacing.md },

  // Store badge
  storeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
    ...Shadow.card,
  },
  storeEmoji: { fontSize: 32 },
  storeName:  { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  storeCode:  { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  onlineDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success, marginLeft: 'auto' },

  // Loading / error
  loadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  loadingText: { color: Colors.textMuted, fontSize: 14 },
  errorBox: {
    backgroundColor: '#FFF0EE', borderRadius: Radius.md,
    padding: Spacing.md, borderLeftWidth: 4, borderLeftColor: Colors.danger,
    gap: 10,
  },
  errorText: { color: Colors.danger, fontSize: 13, fontWeight: '600' },
  retryBtn:  { backgroundColor: Colors.danger, borderRadius: Radius.sm, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // KPI row
  kpiRow: { flexDirection: 'row', marginHorizontal: -Spacing.xs },

  // Action cards
  actionsGrid: { flexDirection: 'row', gap: 12 },
  actionCard: {
    flex: 1, backgroundColor: Colors.bgCard,
    borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  actionIcon:  { width: 52, height: 52, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  actionLabel: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary, marginBottom: 3 },
  actionSub:   { fontSize: 11, color: Colors.textMuted, lineHeight: 15 },
  actionArrow: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm, alignSelf: 'flex-end' },
  actionArrowText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Info strip
  infoStrip: {
    backgroundColor: Colors.primaryPale, borderRadius: Radius.sm,
    padding: Spacing.sm, marginTop: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  infoText: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', fontWeight: '600' },
});