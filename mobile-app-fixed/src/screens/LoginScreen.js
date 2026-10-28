// src/screens/LoginScreen.js
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Image } from 'react-native';
const T = {
  bg:     '#1C1C1E',
  card:   '#2C2C2E',
  border: '#3A3A3C',
  yellow: '#FFD60A',
  gray:   '#8E8E93',
  white:  '#FFFFFF',
  red:    '#FF453A',
  input:  '#3A3A3C',
};

export default function LoginScreen() {
  const { login, loading, error } = useAuth();
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [focused,  setFocused]    = useState(null);

  const handleLogin = () => {
    if (!username.trim() || !password.trim() || !storeCode.trim()) return;
    login(username.trim(), password, storeCode.trim());
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Header ── */}
      <View style={s.header}>
        {/* Logo circle */}
        <View style={s.logoCircle}>
  <Image
    source={require('../../assets/logo.png')}
    style={s.logoImage}
    resizeMode="contain"
  />
</View>

        {/* Brand */}
        <Text style={s.brand}>YNOT</Text>
<Text style={s.brandSub}>Software Solution</Text>

        {/* Yellow accent line */}
        <View style={s.accentLine} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Card ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Welcome Back</Text>
          <Text style={s.cardSub}>Sign in to your account</Text>

          {/* Username */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>USERNAME</Text>
            <View style={[s.inputWrap, focused === 'user' && s.inputFocused]}>
              <Text style={s.inputIcon}>👤</Text>
              <TextInput
                style={s.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter username"
                placeholderTextColor={T.gray}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setFocused('user')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Store Code */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>STORE CODE</Text>
            <View style={[s.inputWrap, focused === 'store' && s.inputFocused]}>
              <Text style={s.inputIcon}>🏬</Text>
              <TextInput
                style={s.input}
                value={storeCode}
                onChangeText={setStoreCode}
                placeholder="e.g. YNOT01"
                placeholderTextColor={T.gray}
                autoCapitalize="characters"
                autoCorrect={false}
                onFocus={() => setFocused('store')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Password */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>PASSWORD</Text>
            <View style={[s.inputWrap, focused === 'pass' && s.inputFocused]}>
              <Text style={s.inputIcon}>🔒</Text>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor={T.gray}
                secureTextEntry={!showPass}
                onFocus={() => setFocused('pass')}
                onBlur={() => setFocused(null)}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPass(v => !v)} style={s.eyeBtn}>
                <Text style={s.inputIcon}>{showPass ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Error */}
          {error ? (
            <View style={s.errBox}>
              <Text style={s.errText}>⚠️  {error}</Text>
            </View>
          ) : null}

          {/* Login button */}
          <TouchableOpacity
            style={[s.loginBtn, (loading || !username || !password || !storeCode) && s.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading || !username || !password}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={s.loginBtnText}>Sign In  →</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={s.footer}>YNOT Software Solution © 2025</Text>
        <Text style={s.footer2}>SalesDB · SQL Server v15.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },

  // Header
  header: {
    backgroundColor: '#000',
    paddingTop: 72, paddingBottom: 48,
    alignItems: 'center',
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
  },
  logoCircle: {
  width: 100,
  height: 100,
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 16,
  backgroundColor: '#000',
},
 logoImage: {
  width: 110,
  height: 110,
},
  brand:      { fontSize: 30, fontWeight: '900', color: T.white, letterSpacing: 1 },
  brandSub:   { fontSize: 13, color: T.yellow, marginTop: 4, fontWeight: '700', letterSpacing: 0.5 },
  accentLine: { width: 60, height: 3, backgroundColor: T.yellow, borderRadius: 2, marginTop: 16 },

  // Scroll & card
  scroll: { padding: 20, paddingTop: 0 },
  card: {
    backgroundColor: T.card,
    borderRadius: 20, padding: 24,
    marginTop: -24,
    borderWidth: 1, borderColor: T.border,
  },
  cardTitle: { fontSize: 22, fontWeight: '800', color: T.white, marginBottom: 4 },
  cardSub:   { fontSize: 13, color: T.gray, marginBottom: 24 },

  // Fields
  fieldWrap:    { marginBottom: 16 },
  fieldLabel:   { fontSize: 10, fontWeight: '800', color: T.gray, letterSpacing: 1.2, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.input, borderRadius: 10,
    borderWidth: 1.5, borderColor: T.border, paddingHorizontal: 12,
  },
  inputFocused: { borderColor: T.yellow },
  inputIcon:    { fontSize: 16, marginRight: 8 },
  input:        { flex: 1, paddingVertical: 14, fontSize: 15, color: T.white },
  eyeBtn:       { padding: 4 },

  // Error
  errBox: {
    backgroundColor: '#3A1A1A', borderRadius: 10,
    padding: 12, marginBottom: 16,
    borderLeftWidth: 3, borderLeftColor: T.red,
  },
  errText: { color: T.red, fontSize: 13, fontWeight: '600' },

  // Button
  loginBtn: {
    backgroundColor: T.yellow,
    borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.4 },
  loginBtnText: { color: '#000', fontWeight: '900', fontSize: 16, letterSpacing: 0.8 },

  footer:  { textAlign: 'center', color: T.gray, fontSize: 12, marginTop: 28, fontWeight: '600' },
  footer2: { textAlign: 'center', color: '#555', fontSize: 11, marginTop: 4 },
});