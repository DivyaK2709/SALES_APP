// src/screens/DeptWiseSalesScreen.js
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, Dimensions, PanResponder,
} from 'react-native';
import { fetchDeptWiseSales } from '../services/api';
import { useAuth } from '../context/AuthContext';

const { width: SCREEN_W } = Dimensions.get('window');
const CCODE   = 1;
const CHART_H = 240;
const Y_AXIS_W = 52;
const BAR_W   = 44;
const BAR_GAP = 16;
const POINT_R = 5;

const T = {
  bg:'#F0F2F5', card:'#FFFFFF', border:'#E8ECF0',
  text:'#1A1A2E', muted:'#9CA3AF', header:'#1B6B35',
  yellow:'#FFD60A', lineAmt:'#2D3DE8', lineCost:'#EF4444',
  lineProfit:'#22C55E', grid:'#E5E7EB', tooltip:'#1E293B',
};

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

function LineSegment({ x1, y1, x2, y2, color, strokeWidth = 2.5 }) {
  const dx = x2-x1, dy = y2-y1;
  const length = Math.sqrt(dx*dx + dy*dy);
  const angle  = Math.atan2(dy, dx) * (180/Math.PI);
  return (
    <View style={{
      position:'absolute', left:x1, top:y1,
      width:length, height:strokeWidth,
      backgroundColor:color, borderRadius:strokeWidth,
      transform:[{ rotate:`${angle}deg` }],
      transformOrigin:'0 50%',
    }} />
  );
}

function AreaChart({ data, metric, color, maxVal, chartW }) {
  if (!data || data.length < 2) return null;
  const points = data.map((d, i) => {
    const val = parseFloat(d[metric]) || 0;
    const x   = Y_AXIS_W + i*(BAR_W+BAR_GAP) + BAR_W/2;
    const y   = CHART_H - Math.max(4, (Math.abs(val)/maxVal)*(CHART_H-20));
    return { x, y, val };
  });
  return (
    <View style={{ position:'absolute', top:0, left:0, width:chartW, height:CHART_H }}>
      {points.slice(0,-1).map((pt, i) => (
        <LineSegment key={i} x1={pt.x} y1={pt.y} x2={points[i+1].x} y2={points[i+1].y} color={color} strokeWidth={2.5} />
      ))}
      {points.map((pt, i) => (
        <View key={i} style={{
          position:'absolute', left:pt.x-POINT_R, top:pt.y-POINT_R,
          width:POINT_R*2, height:POINT_R*2, borderRadius:POINT_R,
          backgroundColor:color, borderWidth:2, borderColor:'#fff',
        }} />
      ))}
    </View>
  );
}

function DeptLineChart({ data }) {
  const [tooltip, setTooltip] = useState(null);
  const scrollOffX = useRef(0);
  if (!data || data.length === 0) return null;

  const allVals = data.flatMap(d => [
    Math.abs(parseFloat(d.amt)||0),
    Math.abs(parseFloat(d.cost)||0),
    Math.abs((parseFloat(d.amt)||0)-(parseFloat(d.cost)||0)),
  ]);
  const maxVal  = Math.max(...allVals, 1);
  const niceMax = Math.ceil(maxVal/1000)*1000 || maxVal;
  const chartW  = Y_AXIS_W + data.length*(BAR_W+BAR_GAP) + 20;

  const getIndex = (touchX) => {
    const relX = touchX + scrollOffX.current - Y_AXIS_W;
    return Math.max(0, Math.min(Math.round(relX/(BAR_W+BAR_GAP)), data.length-1));
  };
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: (e) => setTooltip(getIndex(e.nativeEvent.locationX)),
    onPanResponderMove:  (e) => setTooltip(getIndex(e.nativeEvent.locationX)),
    onPanResponderRelease: () => setTimeout(() => setTooltip(null), 3000),
  });

  const gridVals   = [1,0.75,0.5,0.25,0].map(f => Math.round(niceMax*f));
  const profitData = data.map(d => ({ ...d, profit:(parseFloat(d.amt)||0)-(parseFloat(d.cost)||0) }));

  return (
    <View>
      {tooltip !== null && data[tooltip] && (
        <View style={lc.tooltip}>
          <Text style={lc.ttTitle} numberOfLines={1}>
            📍 {data[tooltip].name || `Dept ${data[tooltip].DepartmentId}`}
          </Text>
          <View style={lc.ttGrid}>
            {[
              { label:'Sales',  val:data[tooltip].amt,  color:T.lineAmt    },
              { label:'Cost',   val:data[tooltip].cost, color:T.lineCost   },
              { label:'Profit', val:(parseFloat(data[tooltip].amt)||0)-(parseFloat(data[tooltip].cost)||0), color:T.lineProfit },
            ].map(item => (
              <View key={item.label} style={lc.ttItem}>
                <View style={[lc.ttDot, { backgroundColor:item.color }]} />
                <Text style={lc.ttLabel}>{item.label}</Text>
                <Text style={[lc.ttVal, { color:item.color }]}>{fmtCurrency(item.val)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollOffX.current = e.nativeEvent.contentOffset.x; }}>
        <View style={[lc.chartWrap, { width:chartW, height:CHART_H+40 }]} {...pan.panHandlers}>
          {gridVals.map((val, i) => {
            const yPos = (i/(gridVals.length-1))*CHART_H;
            return (
              <View key={i} style={[lc.gridRow, { top:yPos }]}>
                <Text style={lc.yLabel}>{fmtShort(val)}</Text>
                <View style={lc.gridLine} />
              </View>
            );
          })}
          <AreaChart data={data}       metric="amt"    color={T.lineAmt}    maxVal={niceMax} chartW={chartW} />
          <AreaChart data={data}       metric="cost"   color={T.lineCost}   maxVal={niceMax} chartW={chartW} />
          <AreaChart data={profitData} metric="profit" color={T.lineProfit} maxVal={niceMax} chartW={chartW} />
          {tooltip !== null && data[tooltip] && (
            <View style={[lc.selLine, { left:Y_AXIS_W+tooltip*(BAR_W+BAR_GAP)+BAR_W/2, height:CHART_H }]} />
          )}
          <View style={[lc.xRow, { width:chartW }]}>
            <View style={{ width:Y_AXIS_W }} />
            {data.map((d, i) => (
              <View key={i} style={{ width:BAR_W+BAR_GAP, alignItems:'center' }}>
                <Text style={lc.xLabel} numberOfLines={2}>
                  {(d.name||`D${d.DepartmentId}`).substring(0,8)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <View style={lc.legend}>
        {[
          { color:T.lineAmt,    label:'Sales'  },
          { color:T.lineCost,   label:'Cost'   },
          { color:T.lineProfit, label:'Profit' },
        ].map(l => (
          <View key={l.label} style={lc.legItem}>
            <View style={[lc.legLine, { backgroundColor:l.color }]} />
            <View style={[lc.legDot,  { backgroundColor:l.color }]} />
            <Text style={lc.legText}>{l.label}</Text>
          </View>
        ))}
      </View>
      <Text style={lc.hint}>👆 Drag to inspect department values</Text>
    </View>
  );
}

const lc = StyleSheet.create({
  tooltip:   { backgroundColor:T.tooltip, borderRadius:12, padding:14, marginBottom:12, borderWidth:1, borderColor:T.yellow },
  ttTitle:   { fontSize:13, fontWeight:'800', color:T.yellow, marginBottom:10 },
  ttGrid:    { flexDirection:'row', justifyContent:'space-between' },
  ttItem:    { alignItems:'center', flex:1 },
  ttDot:     { width:8, height:8, borderRadius:4, marginBottom:4 },
  ttLabel:   { fontSize:10, color:'#94A3B8', marginBottom:2 },
  ttVal:     { fontSize:12, fontWeight:'800' },
  chartWrap: { position:'relative' },
  gridRow:   { position:'absolute', left:0, right:0, flexDirection:'row', alignItems:'center' },
  yLabel:    { width:Y_AXIS_W-6, fontSize:9, color:T.muted, textAlign:'right', marginRight:6 },
  gridLine:  { flex:1, height:1, borderWidth:0.5, borderColor:T.grid, borderStyle:'dashed' },
  selLine:   { position:'absolute', top:0, width:1.5, backgroundColor:'rgba(45,61,232,0.3)' },
  xRow:      { position:'absolute', bottom:0, flexDirection:'row', alignItems:'flex-start' },
  xLabel:    { fontSize:9, color:T.muted, textAlign:'center', lineHeight:12 },
  legend:    { flexDirection:'row', justifyContent:'center', gap:24, marginTop:14 },
  legItem:   { flexDirection:'row', alignItems:'center', gap:6 },
  legLine:   { width:20, height:2.5, borderRadius:2 },
  legDot:    { width:8, height:8, borderRadius:4 },
  legText:   { fontSize:12, color:T.muted, fontWeight:'600' },
  hint:      { textAlign:'center', fontSize:11, color:T.muted, marginTop:6, fontStyle:'italic' },
});

function KCard({ label, value, color, icon }) {
  return (
    <View style={[kc.card, { borderTopColor:color }]}>
      <Text style={kc.icon}>{icon}</Text>
      <Text style={[kc.val, { color }]} numberOfLines={1} adjustsFontSizeToFit>{fmtCurrency(value)}</Text>
      <Text style={kc.lbl}>{label}</Text>
    </View>
  );
}
const kc = StyleSheet.create({
  card: { flex:1, backgroundColor:T.card, borderRadius:12, padding:10, borderTopWidth:3, borderWidth:1, borderColor:T.border, alignItems:'center', margin:4, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:6, elevation:3 },
  icon: { fontSize:18, marginBottom:4 },
  val:  { fontSize:13, fontWeight:'800', color:T.text },
  lbl:  { fontSize:9, color:T.muted, fontWeight:'700', letterSpacing:0.8, marginTop:2, textAlign:'center' },
});

const DEPT_COLORS = ['#2D3DE8','#EF4444','#22C55E','#F59E0B','#8B5CF6','#06B6D4','#EC4899','#10B981','#F97316','#6366F1'];

function DeptTableRow({ row, index, totalAmt }) {
  const amt    = parseFloat(row.amt)  || 0;
  const cost   = parseFloat(row.cost) || 0;
  const qty    = parseFloat(row.Qty)  || 0;
  const profit = amt - cost;
  const pct    = totalAmt > 0 ? ((amt/totalAmt)*100).toFixed(1) : '0';
  const color  = DEPT_COLORS[index % DEPT_COLORS.length];
  const barW   = totalAmt > 0 ? (amt/totalAmt)*(SCREEN_W-80) : 0;
  return (
    <View style={tr.row}>
      <View style={tr.header}>
        <View style={[tr.dot, { backgroundColor:color }]} />
        <Text style={tr.name} numberOfLines={1}>{row.name || `Dept ${row.DepartmentId}`}</Text>
        <Text style={tr.pct}>{pct}%</Text>
      </View>
      <View style={tr.barBg}>
        <View style={[tr.barFill, { width:barW, backgroundColor:color }]} />
      </View>
      <View style={tr.stats}>
        <Text style={tr.stat}>💰 {fmtCurrency(amt)}</Text>
        <Text style={tr.stat}>📦 {qty.toFixed(0)} qty</Text>
        <Text style={[tr.stat, { color: profit>=0 ? T.lineProfit : T.lineCost }]}>📈 {fmtCurrency(profit)}</Text>
      </View>
      <View style={tr.divider} />
    </View>
  );
}
const tr = StyleSheet.create({
  row:    { marginBottom:12 },
  header: { flexDirection:'row', alignItems:'center', gap:8, marginBottom:6 },
  dot:    { width:12, height:12, borderRadius:6 },
  name:   { flex:1, fontSize:13, fontWeight:'700', color:T.text },
  pct:    { fontSize:12, fontWeight:'700', color:T.muted },
  barBg:  { height:8, backgroundColor:T.border, borderRadius:4, overflow:'hidden', marginBottom:6 },
  barFill:{ height:8, borderRadius:4 },
  stats:  { flexDirection:'row', justifyContent:'space-between' },
  stat:   { fontSize:11, color:T.muted, fontWeight:'600' },
  divider:{ height:1, backgroundColor:T.border, marginTop:10 },
});

export default function DeptWiseSalesScreen({ navigation }) {
  const { user } = useAuth(); // ✅ Called at TOP LEVEL

  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [sortBy,  setSortBy]  = useState('amt');
  const [view,    setView]    = useState('chart');

  const now  = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to   = now.toISOString().split('T')[0];

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const uCode = user?.uniqueCode || 'YNOT001'; // ✅ Used from component scope
      const rows  = await fetchDeptWiseSales(from, to, CCODE, uCode);
      if (!Array.isArray(rows)) throw new Error('Invalid data from server');
      setData(rows);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [user]); // ✅ user in dependency array

  useEffect(() => { load(); }, [load]);

  const sorted      = [...data].sort((a,b) => (parseFloat(b[sortBy])||0)-(parseFloat(a[sortBy])||0));
  const totalAmt    = data.reduce((s,r) => s+(parseFloat(r.amt)||0), 0);
  const totalCost   = data.reduce((s,r) => s+(parseFloat(r.cost)||0), 0);
  const totalQty    = data.reduce((s,r) => s+(parseFloat(r.Qty)||0), 0);
  const totalProfit = totalAmt - totalCost;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={T.header} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex:1 }}>
          <Text style={s.title}>Department Wise Sales</Text>
          <Text style={s.subtitle}>{from} → {to} · {user?.name || ''}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={T.header} />
            <Text style={s.loadText}>Loading department data…</Text>
          </View>
        )}
        {!loading && error && (
          <View style={s.errBox}>
            <Text style={s.errText}>⚠️ {error}</Text>
            <TouchableOpacity onPress={load} style={s.retryBtn}>
              <Text style={s.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loading && !error && data.length > 0 && (
          <>
            <View style={s.kpiRow}>
              <KCard label="TOTAL SALES"  value={totalAmt}    color={T.lineAmt}    icon="💰" />
              <KCard label="TOTAL COST"   value={totalCost}   color={T.lineCost}   icon="🏷️" />
              <KCard label="TOTAL PROFIT" value={totalProfit} color={T.lineProfit} icon="📈" />
            </View>
            <View style={s.viewToggle}>
              {[{key:'chart',label:'📈 Line Chart'},{key:'table',label:'📋 Table View'}].map(v => (
                <TouchableOpacity key={v.key} style={[s.viewBtn, view===v.key && s.viewBtnActive]} onPress={() => setView(v.key)}>
                  <Text style={[s.viewBtnTxt, view===v.key && s.viewBtnTxtActive]}>{v.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {view === 'chart' && (
              <View style={s.chartCard}>
                <Text style={s.chartTitle}>Sales · Cost · Profit by Department</Text>
                <Text style={s.chartSub}>Drag chart to inspect values</Text>
                <DeptLineChart data={sorted} />
              </View>
            )}
            {view === 'table' && (
              <>
                <View style={s.tabs}>
                  {[{key:'amt',label:'By Sales'},{key:'Qty',label:'By Qty'},{key:'cost',label:'By Cost'}].map(t => (
                    <TouchableOpacity key={t.key} style={[s.tab, sortBy===t.key && s.tabActive]} onPress={() => setSortBy(t.key)}>
                      <Text style={[s.tabTxt, sortBy===t.key && s.tabTxtActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.tableCard}>
                  {sorted.map((row, i) => <DeptTableRow key={i} row={row} index={i} totalAmt={totalAmt} />)}
                </View>
              </>
            )}
          </>
        )}
        {!loading && !error && data.length === 0 && (
          <View style={s.center}>
            <Text style={{ fontSize:40 }}>📭</Text>
            <Text style={s.emptyText}>No department data found</Text>
          </View>
        )}
        <View style={{ height:40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex:1, backgroundColor:T.bg },
  header: { backgroundColor:T.header, paddingTop:52, paddingBottom:16, paddingHorizontal:20, flexDirection:'row', alignItems:'flex-end', gap:12, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.15, shadowRadius:8, elevation:8 },
  backBtn:  { paddingRight:8, paddingBottom:2 },
  backText: { color:'#fff', fontSize:15, fontWeight:'700' },
  title:    { color:'#fff', fontSize:18, fontWeight:'900' },
  subtitle: { color:'rgba(255,255,255,0.7)', fontSize:11, marginTop:2 },
  scroll:    { padding:16 },
  center:    { alignItems:'center', paddingVertical:60, gap:12 },
  loadText:  { color:T.muted, fontSize:14 },
  emptyText: { color:T.muted, fontSize:15, marginTop:8 },
  errBox:    { backgroundColor:'#FEE2E2', borderRadius:12, padding:14, borderLeftWidth:3, borderLeftColor:T.lineCost, gap:10 },
  errText:   { color:T.lineCost, fontSize:13, fontWeight:'600' },
  retryBtn:  { backgroundColor:T.lineCost, borderRadius:8, paddingVertical:8, paddingHorizontal:16, alignSelf:'flex-start' },
  retryTxt:  { color:'#fff', fontWeight:'700', fontSize:13 },
  kpiRow:    { flexDirection:'row', marginHorizontal:-4, marginBottom:12 },
  viewToggle:      { flexDirection:'row', gap:10, marginBottom:12 },
  viewBtn:         { flex:1, paddingVertical:10, borderRadius:10, backgroundColor:T.card, alignItems:'center', borderWidth:1, borderColor:T.border },
  viewBtnActive:   { backgroundColor:T.header, borderColor:T.header },
  viewBtnTxt:      { fontSize:13, fontWeight:'700', color:T.muted },
  viewBtnTxtActive:{ color:'#fff' },
  chartCard:  { backgroundColor:T.card, borderRadius:16, padding:16, borderWidth:1, borderColor:T.border, marginBottom:12, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2 },
  chartTitle: { fontSize:15, fontWeight:'800', color:T.text },
  chartSub:   { fontSize:11, color:T.muted, marginTop:2, marginBottom:12, fontStyle:'italic' },
  tabs:       { flexDirection:'row', gap:8, marginBottom:10 },
  tab:        { flex:1, paddingVertical:8, borderRadius:8, backgroundColor:T.card, alignItems:'center', borderWidth:1, borderColor:T.border },
  tabActive:    { backgroundColor:T.header, borderColor:T.header },
  tabTxt:       { fontSize:12, fontWeight:'700', color:T.muted },
  tabTxtActive: { color:'#fff' },
  tableCard:  { backgroundColor:T.card, borderRadius:16, padding:16, borderWidth:1, borderColor:T.border, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:8, elevation:2 },
});