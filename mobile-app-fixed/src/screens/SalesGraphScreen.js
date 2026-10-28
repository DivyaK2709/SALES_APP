// src/screens/SalesGraphScreen.js
// Stacked bar chart — Sales (green) + Cost (orange) + Profit (light green)

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Dimensions, StatusBar,
  PanResponder,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { fetchSales } from '../services/api';
import { useAuth } from '../context/AuthContext'; // ✅ Added

const CCODE    = 1;
const SCREEN_W = Dimensions.get('window').width;
const CHART_H  = 220;
const BAR_W    = 36;
const BAR_GAP  = 20;
const Y_AXIS_W = 48;
const GRID_LINES = 5;

const C = {
  bg:'#F0F2F5', card:'#FFFFFF', border:'#E8ECF0',
  text:'#1A1A2E', muted:'#9CA3AF',
  barSales:'#16A34A', barCost:'#F97316', barProfit:'#86EFAC',
  green:'#16A34A', red:'#EF4444', gridLine:'#E5E7EB', tooltip:'#1E293B',
};

const fmtISO     = (d) => { try { return d.toISOString().split('T')[0]; } catch { return '2025-01-01'; } };
const fmtDisplay = (d) => { try { return d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' }); } catch { return ''; } };
const fmtCurrency = (v) => {
  const n = parseFloat(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `RM ${(n/1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `RM ${(n/1_000).toFixed(1)}K`;
  return `RM ${n.toFixed(0)}`;
};
const fmtShort = (v) => {
  const n = parseFloat(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n/1_000).toFixed(0)}K`;
  return `${Math.round(Math.abs(n))}`;
};
const fmtDateLabel = (invdate) => {
  const d = new Date(invdate);
  return d.toLocaleDateString('en-MY', { day:'numeric', month:'short' });
};

function KCard({ label, value, color, icon, sub }) {
  return (
    <View style={[kc.card, { borderLeftColor:color }]}>
      <Text style={kc.icon}>{icon}</Text>
      <Text style={[kc.val, { color }]} numberOfLines={1} adjustsFontSizeToFit>{fmtCurrency(value)}</Text>
      <Text style={kc.lbl}>{label}</Text>
      {sub ? <Text style={[kc.sub, { color }]}>{sub}</Text> : null}
    </View>
  );
}
const kc = StyleSheet.create({
  card: { flex:1, backgroundColor:C.card, borderRadius:14, padding:12, borderLeftWidth:4, borderWidth:1, borderColor:C.border, margin:4, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:8, elevation:3 },
  icon: { fontSize:20, marginBottom:6 },
  val:  { fontSize:14, fontWeight:'800', color:C.text },
  lbl:  { fontSize:9, color:C.muted, fontWeight:'700', letterSpacing:0.8, marginTop:3 },
  sub:  { fontSize:10, fontWeight:'700', marginTop:2 },
});

function StackedBarChart({ data }) {
  const [tooltip, setTooltip] = useState(null);
  const scrollOffsetX = useRef(0);
  if (!data || data.length === 0) return null;

  const maxVal  = Math.max(...data.map(r => Math.abs(r.amt)+Math.abs(r.cost)+Math.abs(r.profit)), 1);
  const niceMax = Math.ceil(maxVal/1000)*1000 || maxVal;
  const gridVals = Array.from({ length:GRID_LINES+1 }, (_,i) => Math.round((niceMax/GRID_LINES)*(GRID_LINES-i)));
  const totalBarW = BAR_W + BAR_GAP;
  const chartW    = data.length*totalBarW + Y_AXIS_W + 16;
  const barPx     = (val) => Math.max(0, (Math.abs(val)/niceMax)*CHART_H);

  const getIndex = (touchX) => {
    const relX = touchX + scrollOffsetX.current - Y_AXIS_W;
    return Math.max(0, Math.min(Math.floor(relX/totalBarW), data.length-1));
  };
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant:   (e) => setTooltip(getIndex(e.nativeEvent.locationX)),
    onPanResponderMove:    (e) => setTooltip(getIndex(e.nativeEvent.locationX)),
    onPanResponderRelease: ()  => setTimeout(() => setTooltip(null), 3000),
  });

  return (
    <View>
      {tooltip !== null && data[tooltip] && (
        <View style={tt.box}>
          <Text style={tt.date}>{fmtDateLabel(data[tooltip].invdate)}</Text>
          {[
            { color:C.barSales,  label:'Sales',  val:data[tooltip].amt    },
            { color:C.barCost,   label:'Cost',   val:data[tooltip].cost   },
            { color:C.barProfit, label:'Profit', val:data[tooltip].profit },
          ].map(item => (
            <View key={item.label} style={tt.row}>
              <View style={[tt.dot, { backgroundColor:item.color }]} />
              <Text style={tt.lbl}>{item.label}</Text>
              <Text style={tt.val}>{fmtCurrency(item.val)}</Text>
            </View>
          ))}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollOffsetX.current = e.nativeEvent.contentOffset.x; }}>
        <View style={[ch.wrap, { width:chartW, height:CHART_H+40 }]} {...panResponder.panHandlers}>
          {gridVals.map((val, i) => (
            <View key={i} style={[ch.gridRow, { top:(i/GRID_LINES)*CHART_H }]}>
              <Text style={ch.yLabel}>{fmtShort(val)}</Text>
              <View style={ch.gridLine} />
            </View>
          ))}
          <View style={ch.barsArea}>
            {data.map((row, i) => {
              const salesH  = barPx(row.amt);
              const costH   = barPx(row.cost);
              const profitH = barPx(Math.abs(row.profit));
              const isSel   = tooltip === i;
              return (
                <View key={row.invdate+i} style={[ch.barGroup, { width:totalBarW }]}>
                  <View style={[ch.stackWrap, { height:CHART_H }]}>
                    <View style={ch.stack}>
                      <View style={[ch.segment, { height:profitH, backgroundColor:row.profit>=0?C.barProfit:C.red, borderTopLeftRadius:6, borderTopRightRadius:6, opacity:isSel?1:0.9 }]} />
                      <View style={[ch.segment, { height:costH, backgroundColor:C.barCost, opacity:isSel?1:0.9 }]} />
                      <View style={[ch.segment, { height:salesH, backgroundColor:C.barSales, borderBottomLeftRadius:4, borderBottomRightRadius:4, opacity:isSel?1:0.9 }]} />
                    </View>
                    {isSel && <View style={[ch.selHighlight, { height:CHART_H }]} />}
                  </View>
                  <Text style={ch.xLabel} numberOfLines={1}>{fmtDateLabel(row.invdate)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={ch.legend}>
        {[{color:C.barProfit,label:'Profit'},{color:C.barCost,label:'Cost'},{color:C.barSales,label:'Sales'}].map(l => (
          <View key={l.label} style={ch.legItem}>
            <View style={[ch.legDot, { backgroundColor:l.color }]} />
            <Text style={ch.legText}>{l.label}</Text>
          </View>
        ))}
      </View>
      <Text style={ch.hint}>Drag on chart to see values</Text>
    </View>
  );
}

const tt = StyleSheet.create({
  box:  { backgroundColor:C.tooltip, borderRadius:12, padding:14, marginBottom:12, shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.2, shadowRadius:8, elevation:6 },
  date: { fontSize:13, fontWeight:'800', color:'#fff', marginBottom:8 },
  row:  { flexDirection:'row', alignItems:'center', marginBottom:4 },
  dot:  { width:8, height:8, borderRadius:4, marginRight:8 },
  lbl:  { fontSize:12, color:'#94A3B8', flex:1 },
  val:  { fontSize:13, fontWeight:'700', color:'#fff' },
});
const ch = StyleSheet.create({
  wrap:        { position:'relative' },
  gridRow:     { position:'absolute', left:0, right:0, flexDirection:'row', alignItems:'center' },
  yLabel:      { width:Y_AXIS_W-8, fontSize:10, color:C.muted, textAlign:'right', marginRight:8 },
  gridLine:    { flex:1, height:1, borderWidth:0.5, borderColor:C.gridLine, borderStyle:'dashed' },
  barsArea:    { position:'absolute', left:Y_AXIS_W, right:0, bottom:26, top:0, flexDirection:'row', alignItems:'flex-end' },
  barGroup:    { alignItems:'center', justifyContent:'flex-end' },
  stackWrap:   { justifyContent:'flex-end', width:BAR_W, position:'relative' },
  stack:       { width:BAR_W, justifyContent:'flex-end', overflow:'hidden', borderRadius:6 },
  segment:     { width:BAR_W },
  selHighlight:{ position:'absolute', top:0, left:0, right:0, backgroundColor:'rgba(22,163,74,0.08)', borderRadius:6 },
  xLabel:      { fontSize:10, color:C.muted, marginTop:6, textAlign:'center', width:BAR_W+BAR_GAP },
  legend:      { flexDirection:'row', justifyContent:'center', gap:24, marginTop:10 },
  legItem:     { flexDirection:'row', alignItems:'center', gap:7 },
  legDot:      { width:12, height:12, borderRadius:6 },
  legText:     { fontSize:13, color:C.muted, fontWeight:'500' },
  hint:        { textAlign:'center', fontSize:11, color:C.muted, marginTop:8, fontStyle:'italic' },
});

export default function SalesGraphScreen({ navigation }) {
  const { user } = useAuth(); // ✅ Called at TOP LEVEL
  const today = new Date();

  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear()-1, 0, 1));
  const [toDate,   setToDate]   = useState(new Date());
  const [showFrom, setShowFrom] = useState(false);
  const [showTo,   setShowTo]   = useState(false);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [errMsg,   setErrMsg]   = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setData(null); setErrMsg(null);
    try {
      const uCode = user?.uniqueCode || 'YNOT001'; // ✅ Used from component scope
      const rows  = await fetchSales(fmtISO(fromDate), fmtISO(toDate), CCODE, uCode);
      if (!Array.isArray(rows)) { setErrMsg('Invalid response from server.'); return; }
      const normalised = rows
        .map(r => ({
          invdate: String(r.invdate||'').split('T')[0],
          amt:     parseFloat(r.amt)  || 0,
          cost:    parseFloat(r.cost) || 0,
          profit:  (parseFloat(r.amt)||0) - (parseFloat(r.cost)||0),
        }))
        .filter(r => r.invdate)
        .sort((a,b) => a.invdate.localeCompare(b.invdate));
      setData(normalised);
    } catch (e) {
      setErrMsg(e.message || 'Failed to fetch data.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, user]); // ✅ user in dependency array

  const totAmt    = data ? data.reduce((s,r) => s+r.amt,  0) : 0;
  const totCost   = data ? data.reduce((s,r) => s+r.cost, 0) : 0;
  const totProfit = totAmt - totCost;
  const margin    = totAmt > 0 ? ((totProfit/totAmt)*100).toFixed(1) : '0';
  const ready     = !loading && data && data.length > 0;

  const onChangeFrom = (_,sel) => { setShowFrom(Platform.OS==='ios'); if(sel) setFromDate(sel); };
  const onChangeTo   = (_,sel) => { setShowTo(Platform.OS==='ios');   if(sel) setToDate(sel); };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Sales Analytics</Text>
          <Text style={s.headerSub}>{user?.name || 'YNOT Software Solution'}</Text>
        </View>
        <View style={{ width:64 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.card}>
          <Text style={s.secLabel}>DATE RANGE</Text>
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
          {showFrom && (
            Platform.OS === 'web'
              ? <input type="date" value={fmtISO(fromDate)} max={fmtISO(today)}
                  onChange={(e) => { if(e.target.value) setFromDate(new Date(e.target.value)); setShowFrom(false); }}
                  style={{ padding:8, fontSize:14, borderRadius:8, border:'1px solid #E8ECF0', marginBottom:10, width:'100%' }} autoFocus />
              : <DateTimePicker value={fromDate} mode="date" display="default" onChange={onChangeFrom} maximumDate={toDate} />
          )}
          {showTo && (
            Platform.OS === 'web'
              ? <input type="date" value={fmtISO(toDate)} min={fmtISO(fromDate)} max={fmtISO(today)}
                  onChange={(e) => { if(e.target.value) setToDate(new Date(e.target.value)); setShowTo(false); }}
                  style={{ padding:8, fontSize:14, borderRadius:8, border:'1px solid #E8ECF0', marginBottom:10, width:'100%' }} autoFocus />
              : <DateTimePicker value={toDate} mode="date" display="default" onChange={onChangeTo} minimumDate={fromDate} maximumDate={today} />
          )}
          <TouchableOpacity style={[s.genBtn, loading && { opacity:0.5 }]} onPress={fetchData} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.genBtnText}>Generate Report →</Text>}
          </TouchableOpacity>
        </View>

        {errMsg && <View style={s.errBox}><Text style={s.errText}>⚠️ {errMsg}</Text></View>}
        {loading && (
          <View style={s.loadBox}>
            <ActivityIndicator size="large" color={C.barSales} />
            <Text style={s.loadText}>Fetching from SalesDB…</Text>
          </View>
        )}
        {!loading && data && data.length === 0 && (
          <View style={s.emptyBox}>
            <Text style={{ fontSize:42 }}>🔍</Text>
            <Text style={s.emptyText}>No records found.{'\n'}Try a different date range.</Text>
          </View>
        )}
        {ready && (
          <>
            <View style={s.totalBanner}>
              <View>
                <Text style={s.totalLabel}>Total Sales</Text>
                <Text style={s.totalVal}>{fmtCurrency(totAmt)}</Text>
              </View>
              <View style={[s.changeBadge, { backgroundColor: totProfit>=0 ? '#DCFCE7' : '#FEE2E2' }]}>
                <Text style={[s.changeText, { color: totProfit>=0 ? C.green : C.red }]}>
                  {totProfit>=0 ? '▲' : '▼'} {margin}% margin
                </Text>
              </View>
            </View>
            <View style={s.kpiRow}>
              <KCard label="SALES"  value={totAmt}    color={C.barSales}                       icon="💰" />
              <KCard label="COST"   value={totCost}   color={C.barCost}                        icon="🏷️" />
              <KCard label="PROFIT" value={totProfit} color={totProfit>=0 ? C.green : C.red}   icon="📈" sub={`${margin}%`} />
            </View>
            <View style={s.chartCard}>
              <Text style={s.chartTitle}>Daily Breakdown</Text>
              <Text style={s.chartSub}>{fmtDisplay(fromDate)} – {fmtDisplay(toDate)}</Text>
              <StackedBarChart data={data} />
            </View>
            <View style={s.tableCard}>
              <Text style={s.secLabel}>DAILY RECORDS</Text>
              <View style={[s.tRow, s.tHead]}>
                <Text style={[s.tCell, s.tDate, s.tHd]}>DATE</Text>
                <Text style={[s.tCell, s.tHd, { color:C.barSales }]}>SALES</Text>
                <Text style={[s.tCell, s.tHd, { color:C.barCost  }]}>COST</Text>
                <Text style={[s.tCell, s.tHd, { color:C.green    }]}>PROFIT</Text>
              </View>
              {data.map((row, i) => (
                <View key={row.invdate+i} style={[s.tRow, i%2===1 && s.tAlt]}>
                  <Text style={[s.tCell, s.tDate]}>{row.invdate}</Text>
                  <Text style={[s.tCell, { color:C.barSales, fontWeight:'700' }]}>{fmtShort(row.amt)}</Text>
                  <Text style={[s.tCell, { color:C.barCost,  fontWeight:'700' }]}>{fmtShort(row.cost)}</Text>
                  <Text style={[s.tCell, { color:row.profit>=0?C.green:C.red, fontWeight:'700' }]}>
                    {row.profit<0?'-':''}{fmtShort(Math.abs(row.profit))}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height:48 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex:1, backgroundColor:C.bg },
  header: { backgroundColor:C.card, paddingTop:52, paddingBottom:16, paddingHorizontal:16, flexDirection:'row', alignItems:'flex-end', borderBottomWidth:1, borderBottomColor:C.border, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:8, elevation:4 },
  backBtn:      { width:64 },
  backText:     { color:C.barSales, fontSize:14, fontWeight:'700' },
  headerCenter: { flex:1, alignItems:'center' },
  headerTitle:  { fontSize:17, fontWeight:'900', color:C.text },
  headerSub:    { fontSize:11, color:C.muted, marginTop:2 },
  scroll:    { padding:16 },
  card:      { backgroundColor:C.card, borderRadius:16, padding:16, marginBottom:12, borderWidth:1, borderColor:C.border, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2 },
  secLabel:  { fontSize:10, color:C.muted, fontWeight:'700', letterSpacing:1.5, marginBottom:10 },
  dateRow:   { flexDirection:'row', alignItems:'center', gap:8, marginBottom:12 },
  datePill:  { flex:1, backgroundColor:C.bg, borderRadius:10, padding:10, borderWidth:1.5, borderColor:C.border },
  dpLabel:   { fontSize:9, color:C.muted, fontWeight:'700', letterSpacing:0.8, marginBottom:3 },
  dpVal:     { fontSize:13, color:C.text, fontWeight:'600' },
  arrow:     { color:C.muted, fontSize:18 },
  genBtn:    { backgroundColor:C.barSales, borderRadius:12, paddingVertical:14, alignItems:'center' },
  genBtnText:{ color:'#fff', fontWeight:'800', fontSize:15 },
  errBox:    { backgroundColor:'#FEE2E2', borderRadius:12, padding:14, borderLeftWidth:3, borderLeftColor:C.red, marginBottom:12 },
  errText:   { color:C.red, fontSize:13, fontWeight:'600' },
  loadBox:   { alignItems:'center', paddingVertical:40, gap:12 },
  loadText:  { color:C.muted, fontSize:14 },
  emptyBox:  { alignItems:'center', paddingVertical:48, gap:10 },
  emptyText: { color:C.muted, fontSize:14, textAlign:'center', lineHeight:22 },
  totalBanner: { backgroundColor:C.card, borderRadius:16, padding:16, flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8, borderWidth:1, borderColor:C.border, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2 },
  totalLabel:  { fontSize:13, color:C.muted, fontWeight:'600' },
  totalVal:    { fontSize:26, fontWeight:'900', color:C.text, marginTop:2 },
  changeBadge: { borderRadius:20, paddingVertical:6, paddingHorizontal:14 },
  changeText:  { fontSize:13, fontWeight:'700' },
  kpiRow:      { flexDirection:'row', marginHorizontal:-4, marginBottom:8 },
  chartCard:   { backgroundColor:C.card, borderRadius:16, padding:16, marginBottom:12, borderWidth:1, borderColor:C.border, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2 },
  chartTitle:  { fontSize:16, fontWeight:'800', color:C.text },
  chartSub:    { fontSize:12, color:C.muted, marginTop:2, marginBottom:12 },
  tableCard:   { backgroundColor:C.card, borderRadius:16, padding:16, borderWidth:1, borderColor:C.border, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2, overflow:'hidden' },
  tRow:  { flexDirection:'row', paddingVertical:10, paddingHorizontal:4 },
  tAlt:  { backgroundColor:'#F8FAFC' },
  tHead: { borderBottomWidth:1, borderBottomColor:C.border, marginBottom:4 },
  tCell: { flex:1, fontSize:12, color:C.text, textAlign:'right' },
  tDate: { flex:1.6, textAlign:'left', color:C.muted, fontSize:11 },
  tHd:   { fontWeight:'800', fontSize:10, letterSpacing:0.8, color:C.muted },
}); 