// src/screens/DayWiseSalesScreen.js
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Dimensions,
} from 'react-native';
import { fetchDayWiseSales } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Colors, Spacing, Radius, Shadow } from '../theme';

const { width } = Dimensions.get('window');
const CCODE = 1;

const DAY_COLORS = {
  Mon: '#FF6384', Tue: '#36A2EB', Wed: '#FFCE56',
  Thu: '#4BC0C0', Fri: '#9966FF', Sat: '#FF9F40', Sun: '#C9CBCF',
};
const DAY_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const fmt = (v) => {
  const n = parseFloat(v) || 0;
  if (n >= 1_000_000) return `RM ${(n/1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `RM ${(n/1_000).toFixed(1)}K`;
  return `RM ${n.toFixed(0)}`;
};

const generateRanges = () => {
  const currentYear = new Date().getFullYear();
  const startYear   = 2023;
  const ranges = [];
  for (let yr = startYear; yr <= currentYear; yr++) {
    ranges.push({ label: `${yr}`, from: `${yr}-01-01`, to: `${yr}-12-31` });
  }
  ranges.push({ label: 'All', from: `${startYear}-01-01`, to: `${currentYear}-12-31` });
  return ranges;
};

function DonutChart({ data, total }) {
  const SIZE      = width * 0.58;
  const THICKNESS = SIZE * 0.18;
  if (!data || data.length === 0 || total === 0) return null;
  let cumulative = 0;
  const segments = data.map((row) => {
    const amt = parseFloat(row.amt) || 0;
    const pct = (amt / total) * 100;
    const seg = { ...row, pct, cumulative, color: DAY_COLORS[row.theDay] || '#999' };
    cumulative += pct;
    return seg;
  });
  return (
    <View style={{ alignItems: 'center', marginVertical: 20 }}>
      <View style={[pie.donut, { width: SIZE, height: SIZE, borderRadius: SIZE/2 }]}>
        {segments.map((seg, i) => {
          const rotate = (seg.cumulative / 100) * 360 - 90;
          return (
            <View key={i} style={[pie.segment, {
              width: SIZE, height: SIZE, borderRadius: SIZE/2,
              borderWidth: THICKNESS, borderColor: 'transparent',
              borderTopColor: seg.color,
              transform: [{ rotate: `${rotate}deg` }],
              opacity: 0.92,
            }]} />
          );
        })}
        <View style={[pie.center, {
          width: SIZE - THICKNESS*2.2,
          height: SIZE - THICKNESS*2.2,
          borderRadius: (SIZE - THICKNESS*2.2)/2,
        }]}>
          <Text style={pie.centerLabel}>Total</Text>
          <Text style={pie.centerVal}>{fmt(total)}</Text>
        </View>
      </View>
    </View>
  );
}

const pie = StyleSheet.create({
  donut:       { position: 'relative', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8ECF0' },
  segment:     { position: 'absolute' },
  center:      { position: 'absolute', backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  centerLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  centerVal:   { fontSize: 14, fontWeight: '900', color: Colors.textPrimary, marginTop: 2 },
});

export default function DayWiseSalesScreen({ navigation }) {
  const { user } = useAuth(); // ✅ Called at TOP LEVEL
  const RANGES       = generateRanges();
  const currentYear  = new Date().getFullYear();
  const defaultRange = RANGES.find(r => r.label === `${currentYear}`) || RANGES[RANGES.length - 2];

  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [activeRange, setActiveRange] = useState(defaultRange);

  const load = useCallback(async (from, to) => {
    setLoading(true); setError(null); setData([]);
    try {
      const uCode = user?.uniqueCode || 'YNOT001'; // ✅ Used from component scope
      const rows  = await fetchDayWiseSales(from, to, CCODE, uCode);
      if (!Array.isArray(rows)) throw new Error('Invalid data from server');
      if (rows.length === 0)    throw new Error('No data found for this period');
      const sorted = [...rows].sort(
        (a, b) => DAY_ORDER.indexOf(a.theDay) - DAY_ORDER.indexOf(b.theDay)
      );
      setData(sorted);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [user]); // ✅ user in dependency array

  useEffect(() => {
    load(activeRange.from, activeRange.to);
  }, [load]);

  const handleRangePress = (range) => {
    setActiveRange(range);
    load(range.from, range.to);
  };

  const total  = data.reduce((s, r) => s + (parseFloat(r.amt) || 0), 0);
  const maxAmt = data.length ? Math.max(...data.map(r => parseFloat(r.amt) || 0)) : 1;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />

      <View style={[s.header, Shadow.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Day Wise Sales</Text>
          <Text style={s.subtitle}>Breakdown by weekday · {user?.name || ''}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.rangeScroll}>
          {RANGES.map((r) => (
            <TouchableOpacity
              key={r.label}
              style={[s.rangeBtn, activeRange.label === r.label && s.rangeBtnActive]}
              onPress={() => handleRangePress(r)}
            >
              <Text style={[s.rangeTxt, activeRange.label === r.label && s.rangeTxtActive]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.loadText}>Loading sales data…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>⚠️ {error}</Text>
            <TouchableOpacity onPress={() => load(activeRange.from, activeRange.to)} style={s.retryBtn}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !error && data.length > 0 && (
          <>
            <View style={s.totalCard}>
              <Text style={s.totalLabel}>Total Sales · {activeRange.label}</Text>
              <Text style={s.totalValue}>{fmt(total)}</Text>
              <Text style={s.totalSub}>Across {data.length} weekdays</Text>
            </View>

            <View style={s.chartCard}>
              <Text style={s.chartTitle}>📊 Daywise Percentage</Text>
              <DonutChart data={data} total={total} />
              <View style={s.legendWrap}>
                {data.map((row, i) => {
                  const amt   = parseFloat(row.amt) || 0;
                  const pct   = total > 0 ? ((amt/total)*100).toFixed(1) : '0';
                  const color = DAY_COLORS[row.theDay] || '#999';
                  return (
                    <View key={i} style={s.legendItem}>
                      <View style={[s.legendDot, { backgroundColor: color }]} />
                      <Text style={s.legendDay}>{row.theDay}</Text>
                      <Text style={s.legendPct}>{pct}%</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={s.barCard}>
              <Text style={s.chartTitle}>💰 Sales by Day</Text>
              {data.map((row, i) => {
                const amt   = parseFloat(row.amt) || 0;
                const pct   = total > 0 ? ((amt/total)*100).toFixed(1) : '0';
                const barW  = maxAmt > 0 ? (amt/maxAmt)*(width-120) : 0;
                const color = DAY_COLORS[row.theDay] || '#999';
                return (
                  <View key={i} style={s.barRow}>
                    <View style={[s.dayDot, { backgroundColor: color }]} />
                    <Text style={s.dayLabel}>{row.theDay}</Text>
                    <View style={s.barBg}>
                      <View style={[s.barFill, { width: barW, backgroundColor: color }]} />
                    </View>
                    <View style={s.amtWrap}>
                      <Text style={s.amtText}>{fmt(amt)}</Text>
                      <Text style={s.pctText}>{pct}%</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={s.tableCard}>
              <Text style={s.chartTitle}>📋 Summary</Text>
              <View style={s.tableHead}>
                <Text style={[s.thCell, { flex: 1 }]}>DAY</Text>
                <Text style={[s.thCell, { flex: 2 }]}>AMOUNT</Text>
                <Text style={[s.thCell, { flex: 1 }]}>SHARE</Text>
              </View>
              {data.map((row, i) => {
                const amt   = parseFloat(row.amt) || 0;
                const pct   = total > 0 ? ((amt/total)*100).toFixed(1) : '0';
                const color = DAY_COLORS[row.theDay] || '#999';
                return (
                  <View key={i} style={[s.tableRow, i%2===1 && s.tableRowAlt]}>
                    <View style={{ flex:1, flexDirection:'row', alignItems:'center', gap:6 }}>
                      <View style={[s.dayDot, { backgroundColor: color }]} />
                      <Text style={s.tdDay}>{row.theDay}</Text>
                    </View>
                    <Text style={[s.tdCell, { flex:2, color, fontWeight:'800' }]}>{fmt(amt)}</Text>
                    <Text style={[s.tdCell, { flex:1 }]}>{pct}%</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.bg },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: 52, paddingBottom: 16,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row', alignItems: 'flex-end', gap: 12,
  },
  backBtn:  { paddingRight: 8, paddingBottom: 2 },
  backText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  title:    { color: '#fff', fontSize: 18, fontWeight: '800' },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  scroll:      { padding: Spacing.md },
  rangeScroll: { marginBottom: 14 },
  rangeBtn:       { paddingVertical:8, paddingHorizontal:18, borderRadius:20, marginRight:8, backgroundColor:Colors.bgCard, borderWidth:1, borderColor:Colors.border },
  rangeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rangeTxt:       { fontSize:13, fontWeight:'700', color:Colors.textMuted },
  rangeTxtActive: { color: '#fff' },
  center:    { alignItems:'center', paddingVertical:60, gap:12 },
  loadText:  { color: Colors.textMuted, fontSize: 14 },
  errorBox:  { backgroundColor:'#FFF0EE', borderRadius:Radius.md, padding:Spacing.md, borderLeftWidth:4, borderLeftColor:Colors.danger, gap:10 },
  errorText: { color: Colors.danger, fontSize:13, fontWeight:'600' },
  retryBtn:  { backgroundColor:Colors.danger, borderRadius:Radius.sm, paddingVertical:8, paddingHorizontal:16, alignSelf:'flex-start' },
  retryText: { color:'#fff', fontWeight:'700', fontSize:13 },
  totalCard:  { backgroundColor:Colors.primary, borderRadius:Radius.lg, padding:Spacing.lg, alignItems:'center', marginBottom:12, ...Shadow.card },
  totalLabel: { color:'rgba(255,255,255,0.8)', fontSize:12, fontWeight:'600' },
  totalValue: { color:'#fff', fontSize:30, fontWeight:'900', marginTop:4 },
  totalSub:   { color:'rgba(255,255,255,0.65)', fontSize:11, marginTop:4 },
  chartCard:  { backgroundColor:Colors.bgCard, borderRadius:Radius.lg, padding:Spacing.md, marginBottom:12, borderWidth:1, borderColor:Colors.border, alignItems:'center', ...Shadow.card },
  chartTitle: { fontSize:14, fontWeight:'800', color:Colors.textPrimary, marginBottom:4, alignSelf:'flex-start' },
  legendWrap: { flexDirection:'row', flexWrap:'wrap', justifyContent:'center', gap:10, marginTop:8 },
  legendItem: { flexDirection:'row', alignItems:'center', gap:5 },
  legendDot:  { width:10, height:10, borderRadius:5 },
  legendDay:  { fontSize:12, fontWeight:'700', color:Colors.textPrimary },
  legendPct:  { fontSize:11, color:Colors.textMuted },
  barCard:    { backgroundColor:Colors.bgCard, borderRadius:Radius.lg, padding:Spacing.md, marginBottom:12, borderWidth:1, borderColor:Colors.border, ...Shadow.card },
  barRow:     { flexDirection:'row', alignItems:'center', marginVertical:6, gap:8 },
  dayDot:     { width:10, height:10, borderRadius:5 },
  dayLabel:   { width:30, fontSize:13, fontWeight:'700', color:Colors.textPrimary },
  barBg:      { flex:1, height:12, backgroundColor:Colors.border, borderRadius:6, overflow:'hidden' },
  barFill:    { height:12, borderRadius:6 },
  amtWrap:    { alignItems:'flex-end', minWidth:72 },
  amtText:    { fontSize:12, fontWeight:'700', color:Colors.textPrimary },
  pctText:    { fontSize:10, color:Colors.textMuted },
  tableCard:    { backgroundColor:Colors.bgCard, borderRadius:Radius.lg, padding:Spacing.md, borderWidth:1, borderColor:Colors.border, ...Shadow.card },
  tableHead:    { flexDirection:'row', paddingVertical:8, borderBottomWidth:1, borderBottomColor:Colors.border, marginBottom:4 },
  thCell:       { fontSize:10, fontWeight:'800', color:Colors.textMuted, letterSpacing:0.8 },
  tableRow:     { flexDirection:'row', paddingVertical:10, alignItems:'center' },
  tableRowAlt:  { backgroundColor:Colors.divider, borderRadius:6 },
  tdDay:        { fontSize:13, fontWeight:'700', color:Colors.textPrimary },
  tdCell:       { fontSize:13, color:Colors.textPrimary, textAlign:'right' },
});