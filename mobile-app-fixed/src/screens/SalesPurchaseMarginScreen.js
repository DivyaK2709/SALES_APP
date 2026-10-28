// src/screens/SalesPurchaseMarginScreen.js
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Dimensions, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { fetchSalesPurchaseMargin } from '../services/api';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');
const CCODE = 1;

// ─── Theme ───────────────────────────────────────────────────────────────────
const T = {
  bg:      '#F0F2F5',
  card:    '#FFFFFF',
  border:  '#E8ECF0',
  text:    '#1A1A2E',
  muted:   '#9CA3AF',
  sales:   '#18CAF7',  // Cyan  — Sales
  cost:    '#FF8D11',  // Orange — Cost
  margin:  '#7B006B',  // Purple — Margin
  header:  '#1A1A2E',
};

const fmtCurrency = (v) => {
  const n = parseFloat(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `RM ${(n/1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `RM ${(n/1_000).toFixed(1)}K`;
  return `RM ${n.toFixed(0)}`;
};

const fmtISO     = (d) => { try { return d.toISOString().split('T')[0]; } catch { return ''; } };
const fmtDisplay = (d) => { try { return d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' }); } catch { return ''; } };

// ─── Treemap Bar ──────────────────────────────────────────────────────────────
function TreeBar({ label, value, color, maxVal, icon, pct }) {
  const barW = maxVal > 0 ? Math.max(0.05, value/maxVal) * (width - 80) : 0;
  return (
    <View style={tb.wrap}>
      <View style={tb.labelRow}>
        <Text style={tb.icon}>{icon}</Text>
        <Text style={tb.label}>{label}</Text>
        <Text style={[tb.value, { color }]}>{fmtCurrency(value)}</Text>
        {pct !== undefined && <Text style={tb.pct}>{pct}%</Text>}
      </View>
      <View style={tb.barBg}>
        <View style={[tb.barFill, { width: barW, backgroundColor: color }]}>
          <Text style={tb.barLabel}>{fmtCurrency(value)}</Text>
        </View>
      </View>
    </View>
  );
}
const tb = StyleSheet.create({
  wrap:     { marginBottom: 16 },
  labelRow: { flexDirection:'row', alignItems:'center', marginBottom:8, gap:8 },
  icon:     { fontSize:20 },
  label:    { flex:1, fontSize:14, fontWeight:'800', color:'#1A1A2E' },
  value:    { fontSize:14, fontWeight:'900' },
  pct:      { fontSize:12, color:'#9CA3AF', fontWeight:'600', marginLeft:4 },
  barBg:    { height:44, backgroundColor:'#E8ECF0', borderRadius:10, overflow:'hidden' },
  barFill:  { height:44, borderRadius:10, justifyContent:'center', paddingLeft:12 },
  barLabel: { color:'#fff', fontSize:13, fontWeight:'800' },
});

// ─── Date Range Quick Buttons ─────────────────────────────────────────────────
const getWeekRange = () => {
  const now  = new Date();
  const day  = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const from = new Date(now.setDate(diff));
  return { from, to: new Date() };
};
const getMonthRange = () => {
  const now  = new Date();
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date() };
};
const getYearRange = () => {
  const now = new Date();
  return { from: new Date(now.getFullYear(), 0, 1), to: new Date() };
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SalesPurchaseMarginScreen({ navigation }) {
  const { user } = useAuth();

  const [fromDate, setFromDate] = useState(getWeekRange().from);
  const [toDate,   setToDate]   = useState(new Date());
  const [showFrom, setShowFrom] = useState(false);
  const [showTo,   setShowTo]   = useState(false);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [activeRange, setActiveRange] = useState('Week');

  const load = useCallback(async (from, to) => {
    setLoading(true); setError(null);
    try {
      const uCode = user?.uniqueCode || 'YNOT001';
      const rows  = await fetchSalesPurchaseMargin(
        fmtISO(from), fmtISO(to), CCODE, uCode
      );
      if (!Array.isArray(rows)) throw new Error('Invalid data');
      // Map to object
      const result = {};
      rows.forEach(r => { result[r.category] = parseFloat(r.amt) || 0; });
      setData(result);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(fromDate, toDate); }, []);

  const handleRange = (label, from, to) => {
    setActiveRange(label);
    setFromDate(from);
    setToDate(to);
    load(from, to);
  };

  const onChangeFrom = (_, sel) => {
    setShowFrom(Platform.OS === 'ios');
    if (sel) { setFromDate(sel); load(sel, toDate); }
  };
  const onChangeTo = (_, sel) => {
    setShowTo(Platform.OS === 'ios');
    if (sel) { setToDate(sel); load(fromDate, sel); }
  };

  const sales  = data?.Sales  || 0;
  const cost   = data?.Cost   || 0;
  const margin = data?.Margin || 0;
  const maxVal = Math.max(sales, cost, margin, 1);
  const marginPct = sales > 0 ? ((margin/sales)*100).toFixed(1) : '0';

  const RANGES = [
    { label:'Week',  ...getWeekRange()  },
    { label:'Month', ...getMonthRange() },
    { label:'Year',  ...getYearRange()  },
  ];

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={T.header} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex:1 }}>
          <Text style={s.title}>Sales · Cost · Margin</Text>
          <Text style={s.subtitle}>{user?.name || 'Overview'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Quick Range Buttons */}
        <View style={s.rangeRow}>
          {RANGES.map(r => (
            <TouchableOpacity
              key={r.label}
              style={[s.rangeBtn, activeRange===r.label && s.rangeBtnActive]}
              onPress={() => handleRange(r.label, r.from, r.to)}
            >
              <Text style={[s.rangeTxt, activeRange===r.label && s.rangeTxtActive]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[s.rangeBtn, activeRange==='Custom' && s.rangeBtnActive]}
            onPress={() => { setActiveRange('Custom'); setShowFrom(true); }}
          >
            <Text style={[s.rangeTxt, activeRange==='Custom' && s.rangeTxtActive]}>Custom</Text>
          </TouchableOpacity>
        </View>

        {/* Date display */}
        <View style={s.dateRow}>
          <TouchableOpacity style={s.datePill} onPress={() => setShowFrom(true)}>
            <Text style={s.dpLabel}>FROM</Text>
            <Text style={s.dpVal}>📅 {fmtDisplay(fromDate)}</Text>
          </TouchableOpacity>
          <Text style={s.arrow}>→</Text>
          <TouchableOpacity style={s.datePill} onPress={() => setShowTo(true)}>
            <Text style={s.dpLabel}>TO</Text>
            <Text style={s.dpVal}>📅 {fmtDisplay(toDate)}</Text>
          </TouchableOpacity>
        </View>

        {/* Date Pickers */}
        {showFrom && (
          Platform.OS === 'web'
            ? <input type="date" value={fmtISO(fromDate)}
                onChange={(e) => { if(e.target.value) { const d=new Date(e.target.value); setFromDate(d); load(d,toDate); } setShowFrom(false); }}
                style={{ padding:8, fontSize:14, borderRadius:8, border:'1px solid #E8ECF0', marginBottom:10, width:'100%' }} autoFocus />
            : <DateTimePicker value={fromDate} mode="date" display="default" onChange={onChangeFrom} maximumDate={toDate} />
        )}
        {showTo && (
          Platform.OS === 'web'
            ? <input type="date" value={fmtISO(toDate)} min={fmtISO(fromDate)}
                onChange={(e) => { if(e.target.value) { const d=new Date(e.target.value); setToDate(d); load(fromDate,d); } setShowTo(false); }}
                style={{ padding:8, fontSize:14, borderRadius:8, border:'1px solid #E8ECF0', marginBottom:10, width:'100%' }} autoFocus />
            : <DateTimePicker value={toDate} mode="date" display="default" onChange={onChangeTo} minimumDate={fromDate} maximumDate={new Date()} />
        )}

        {/* Loading */}
        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={T.sales} />
            <Text style={s.loadText}>Loading data…</Text>
          </View>
        )}

        {/* Error */}
        {!loading && error && (
          <View style={s.errBox}>
            <Text style={s.errText}>⚠️ {error}</Text>
            <TouchableOpacity onPress={() => load(fromDate, toDate)} style={s.retryBtn}>
              <Text style={s.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Data */}
        {!loading && !error && data && (
          <>
            {/* Summary Cards */}
            <View style={s.cardRow}>
              <View style={[s.summCard, { borderTopColor: T.sales }]}>
                <Text style={s.summIcon}>💰</Text>
                <Text style={[s.summVal, { color: T.sales }]}>{fmtCurrency(sales)}</Text>
                <Text style={s.summLabel}>SALES</Text>
              </View>
              <View style={[s.summCard, { borderTopColor: T.cost }]}>
                <Text style={s.summIcon}>🏷️</Text>
                <Text style={[s.summVal, { color: T.cost }]}>{fmtCurrency(cost)}</Text>
                <Text style={s.summLabel}>COST</Text>
              </View>
              <View style={[s.summCard, { borderTopColor: T.margin }]}>
                <Text style={s.summIcon}>📈</Text>
                <Text style={[s.summVal, { color: T.margin }]}>{fmtCurrency(margin)}</Text>
                <Text style={s.summLabel}>MARGIN</Text>
              </View>
            </View>

            {/* Margin % Banner */}
            <View style={[s.marginBanner, { backgroundColor: margin >= 0 ? '#F0FFF4' : '#FFF0EE' }]}>
              <Text style={s.marginBannerLabel}>Profit Margin</Text>
              <Text style={[s.marginBannerVal, { color: margin >= 0 ? T.margin : '#EF4444' }]}>
                {marginPct}%
              </Text>
              <Text style={s.marginBannerSub}>
                {margin >= 0 ? '✅ Profitable' : '❌ Loss'}
              </Text>
            </View>

            {/* Treemap Bars */}
            <View style={s.chartCard}>
              <Text style={s.chartTitle}>📊 Overview</Text>
              <Text style={s.chartSub}>{fmtDisplay(fromDate)} → {fmtDisplay(toDate)}</Text>

              <View style={{ marginTop: 16 }}>
                <TreeBar
                  label="Sales"
                  value={sales}
                  color={T.sales}
                  maxVal={maxVal}
                  icon="💰"
                />
                <TreeBar
                  label="Cost of Goods"
                  value={cost}
                  color={T.cost}
                  maxVal={maxVal}
                  icon="🏷️"
                  pct={sales > 0 ? ((cost/sales)*100).toFixed(1) : '0'}
                />
                <TreeBar
                  label="Sales Margin"
                  value={margin}
                  color={T.margin}
                  maxVal={maxVal}
                  icon="📈"
                  pct={marginPct}
                />
              </View>
            </View>

            {/* Detail Table */}
            <View style={s.tableCard}>
              <Text style={s.chartTitle}>📋 Breakdown</Text>
              {[
                { label:'Total Sales',        value:sales,           color:T.sales,  icon:'💰' },
                { label:'Cost of Goods Sold', value:cost,            color:T.cost,   icon:'🏷️' },
                { label:'Gross Margin',       value:margin,          color:T.margin, icon:'📈' },
                { label:'Margin %',           value:`${marginPct}%`, color:T.margin, icon:'%', isText:true },
              ].map((row, i) => (
                <View key={i} style={[s.tableRow, i%2===1 && s.tableRowAlt]}>
                  <Text style={s.tableIcon}>{row.icon}</Text>
                  <Text style={s.tableLabel}>{row.label}</Text>
                  <Text style={[s.tableVal, { color:row.color }]}>
                    {row.isText ? row.value : fmtCurrency(row.value)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height:40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex:1, backgroundColor:T.bg },
  header: {
    backgroundColor:T.header, paddingTop:52, paddingBottom:16,
    paddingHorizontal:20, flexDirection:'row', alignItems:'flex-end', gap:12,
    shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.15, shadowRadius:8, elevation:8,
  },
  backBtn:  { paddingRight:8, paddingBottom:2 },
  backText: { color:'#fff', fontSize:15, fontWeight:'700' },
  title:    { color:'#fff', fontSize:18, fontWeight:'900' },
  subtitle: { color:'rgba(255,255,255,0.7)', fontSize:11, marginTop:2 },

  scroll: { padding:16 },
  center: { alignItems:'center', paddingVertical:60, gap:12 },
  loadText:{ color:T.muted, fontSize:14 },

  rangeRow: { flexDirection:'row', gap:8, marginBottom:12 },
  rangeBtn: { flex:1, paddingVertical:8, borderRadius:20, backgroundColor:T.card, alignItems:'center', borderWidth:1, borderColor:T.border },
  rangeBtnActive: { backgroundColor:T.header, borderColor:T.header },
  rangeTxt:       { fontSize:12, fontWeight:'700', color:T.muted },
  rangeTxtActive: { color:'#fff' },

  dateRow:  { flexDirection:'row', alignItems:'center', gap:8, marginBottom:12 },
  datePill: { flex:1, backgroundColor:T.card, borderRadius:10, padding:10, borderWidth:1, borderColor:T.border },
  dpLabel:  { fontSize:9, color:T.muted, fontWeight:'700', letterSpacing:0.8, marginBottom:3 },
  dpVal:    { fontSize:12, color:T.text, fontWeight:'600' },
  arrow:    { color:T.muted, fontSize:18 },

  errBox:   { backgroundColor:'#FEE2E2', borderRadius:12, padding:14, borderLeftWidth:3, borderLeftColor:'#EF4444', gap:10 },
  errText:  { color:'#EF4444', fontSize:13, fontWeight:'600' },
  retryBtn: { backgroundColor:'#EF4444', borderRadius:8, paddingVertical:8, paddingHorizontal:16, alignSelf:'flex-start' },
  retryTxt: { color:'#fff', fontWeight:'700', fontSize:13 },

  cardRow:  { flexDirection:'row', gap:8, marginBottom:12 },
  summCard: {
    flex:1, backgroundColor:T.card, borderRadius:12, padding:12,
    alignItems:'center', borderTopWidth:3, borderWidth:1, borderColor:T.border,
    shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:6, elevation:2,
  },
  summIcon:  { fontSize:20, marginBottom:6 },
  summVal:   { fontSize:13, fontWeight:'900', marginBottom:4 },
  summLabel: { fontSize:9, color:T.muted, fontWeight:'700', letterSpacing:0.8 },

  marginBanner: {
    borderRadius:12, padding:16, marginBottom:12,
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
    borderWidth:1, borderColor:T.border,
  },
  marginBannerLabel: { fontSize:13, fontWeight:'700', color:T.text },
  marginBannerVal:   { fontSize:28, fontWeight:'900' },
  marginBannerSub:   { fontSize:12, color:T.muted, fontWeight:'600' },

  chartCard: {
    backgroundColor:T.card, borderRadius:16, padding:16, marginBottom:12,
    borderWidth:1, borderColor:T.border,
    shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2,
  },
  chartTitle: { fontSize:15, fontWeight:'800', color:T.text },
  chartSub:   { fontSize:11, color:T.muted, marginTop:2, fontStyle:'italic' },

  tableCard: {
    backgroundColor:T.card, borderRadius:16, padding:16,
    borderWidth:1, borderColor:T.border,
    shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2,
  },
  tableRow:    { flexDirection:'row', alignItems:'center', paddingVertical:12, gap:10 },
  tableRowAlt: { backgroundColor:'#F8FAFC', borderRadius:8 },
  tableIcon:   { fontSize:18, width:28 },
  tableLabel:  { flex:1, fontSize:13, fontWeight:'600', color:T.text },
  tableVal:    { fontSize:14, fontWeight:'900' },
});