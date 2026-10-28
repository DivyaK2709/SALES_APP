import React, { createContext, useContext, useState } from 'react';
import { setAuthToken, clearAuthToken, setUniqueCode, login as apiLogin } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const login = async (username, password, storeCode) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiLogin(username, password, storeCode);
      setAuthToken(data.token);
      setUniqueCode(data.user?.uniqueCode || data.user?.UniqueCode || 'YNOT001');
      setUser(data.user);
      return true;
    } catch (e) {
      setError(e.message || 'Login failed.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearAuthToken();
    setUniqueCode('YNOT001');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);