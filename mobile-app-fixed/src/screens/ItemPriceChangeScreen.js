// src/screens/ItemPriceChangeScreen.js
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, ActivityIndicator, FlatList, Keyboard,
} from 'react-native';
import { searchItems, updateItemPrice } from '../services/api';
import { PrimaryButton, EmptyState } from '../components/shared';
import { Colors, Spacing, Radius, Shadow } from '../theme';

export default function ItemPriceChangeScreen({ navigation }) {
  const [query, setQuery]           = useState('');
  const [searching, setSearching]   = useState(false);
  const [results, setResults]       = useState([]);
  const [searched, setSearched]     = useState(false);
  const [error, setError]           = useState(null);

  const [selected, setSelected]     = useState(null); // the item being edited
  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice]       = useState('');
  const [mrp, setMrp]                   = useState('');
  const [saving, setSaving]         = useState(false);
  const [savedMsg, setSavedMsg]     = useState(null);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true);
    setSearched(true);
    setError(null);
    setSelected(null);
    setSavedMsg(null);
    try {
      const { items } = await searchItems(q);
      setResults(items || []);
    } catch (e) {
      setError(e.message || 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const pick = (item) => {
    setSelected(item);
    setSellingPrice(item.SellingPrice != null ? String(item.SellingPrice) : '');
    setCostPrice(item.CostPrice != null ? String(item.CostPrice) : '');
    setMrp(item.mrp != null ? String(item.mrp) : '');
    setSavedMsg(null);
  };

  const parsedOrNull = (s) => {
    if (s === '' || s == null) return null;
    const n = Number(s);
    return isNaN(n) ? undefined : n; // undefined = invalid, caller checks
  };

  const canSave = () => {
    if (!selected) return false;
    const vals = [parsedOrNull(sellingPrice), parsedOrNull(costPrice), parsedOrNull(mrp)];
    if (vals.some((v) => v === undefined)) return false; // something isn't a valid number
    if (vals.some((v) => typeof v === 'number' && v < 0)) return false;
    return true;
  };

  const save = async () => {
    if (!selected || !canSave()) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await updateItemPrice(selected.Barcode, {
        sellingPrice: parsedOrNull(sellingPrice),
        costPrice: parsedOrNull(costPrice),
        mrp: parsedOrNull(mrp),
      });
      setSavedMsg('Saved. This will reach the till on the next sync (usually within a few minutes).');
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />

      <View style={[s.topBar, Shadow.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Item Price Change</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Search box ── */}
        <View style={[s.searchRow, Shadow.card]}>
          <TextInput
            style={s.searchInput}
            placeholder="Scan or type barcode / item name"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={doSearch}
            returnKeyType="search"
            autoCapitalize="none"
          />
          <TouchableOpacity style={s.searchBtn} onPress={doSearch} activeOpacity={0.85}>
            {searching
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.searchBtnText}>Search</Text>}
          </TouchableOpacity>
        </View>

        {/* ── Error ── */}
        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>⚠️  {error}</Text>
          </View>
        )}

        {/* ── Results list (hidden once one is picked) ── */}
        {!selected && searched && !searching && (
          results.length === 0 ? (
            <EmptyState icon="🔍" message="No matching items found for your store." />
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => String(item.Id)}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity style={[s.resultCard, Shadow.card]} onPress={() => pick(item)} activeOpacity={0.85}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.resultName} numberOfLines={1}>{item.Name}</Text>
                    <Text style={s.resultBarcode}>{item.Barcode}</Text>
                  </View>
                  <Text style={s.resultPrice}>RM {Number(item.SellingPrice || 0).toFixed(2)}</Text>
                </TouchableOpacity>
              )}
            />
          )
        )}

        {/* ── Edit form for the selected item ── */}
        {selected && (
          <View style={[s.editCard, Shadow.card]}>
            <View style={s.editHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.editName}>{selected.Name}</Text>
                <Text style={s.editBarcode}>{selected.Barcode}</Text>
              </View>
              <TouchableOpacity onPress={() => { setSelected(null); setSavedMsg(null); }}>
                <Text style={s.changeItemText}>Change item</Text>
              </TouchableOpacity>
            </View>

            <PriceField label="Selling Price" value={sellingPrice} onChangeText={setSellingPrice} />
            <PriceField label="Cost Price" value={costPrice} onChangeText={setCostPrice} />
            <PriceField label="MRP" value={mrp} onChangeText={setMrp} />

            {savedMsg ? (
              <View style={s.successBox}>
                <Text style={s.successText}>✅ {savedMsg}</Text>
              </View>
            ) : null}

            <PrimaryButton
              label="Save"
              onPress={save}
              loading={saving}
              disabled={!canSave()}
              style={{ marginTop: Spacing.md }}
            />
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

function PriceField({ label, value, onChangeText }) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.fieldInputWrap}>
        <Text style={s.fieldPrefix}>RM</Text>
        <TextInput
          style={s.fieldInput}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={Colors.textMuted}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  topBar: {
    backgroundColor: Colors.primary,
    paddingTop: 52, paddingBottom: 16,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { width: 60 },
  backText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  title: { color: '#fff', fontWeight: '800', fontSize: 16 },

  scroll: { padding: Spacing.md },

  searchRow: {
    flexDirection: 'row', gap: 8,
    backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    padding: Spacing.sm, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: {
    flex: 1, fontSize: 14, color: Colors.textPrimary,
    paddingHorizontal: Spacing.sm, paddingVertical: 10,
  },
  searchBtn: {
    backgroundColor: Colors.accent, borderRadius: Radius.sm,
    paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  errorBox: {
    backgroundColor: '#FFF0EE', borderRadius: Radius.md,
    padding: Spacing.md, borderLeftWidth: 4, borderLeftColor: Colors.danger,
    marginBottom: Spacing.md,
  },
  errorText: { color: Colors.danger, fontSize: 13, fontWeight: '600' },

  resultCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  resultName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  resultBarcode: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  resultPrice: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },

  editCard: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  editHeaderRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: Spacing.md, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  editName: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  editBarcode: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  changeItemText: { fontSize: 12, fontWeight: '700', color: Colors.primaryDark },

  fieldWrap: { marginBottom: Spacing.md },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, marginBottom: 6, letterSpacing: 0.5 },
  fieldInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
  },
  fieldPrefix: { fontSize: 13, fontWeight: '700', color: Colors.textMuted, marginRight: 6 },
  fieldInput: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.textPrimary, paddingVertical: 12 },

  successBox: {
    backgroundColor: '#E8F5E9', borderRadius: Radius.sm,
    padding: Spacing.sm, marginTop: Spacing.sm,
  },
  successText: { color: '#2E7D32', fontSize: 12, fontWeight: '600' },
});