// src/services/api.js
import { API_BASE_URL } from '../config/env';

let _authToken  = null;
let _uniqueCode = 'YNOT001';

export const setAuthToken  = (token) => { _authToken  = token; };
export const clearAuthToken = () => { _authToken = null; _uniqueCode = 'YNOT001'; };
export const setUniqueCode = (code) => { _uniqueCode = code; };

const headers = () => ({
  'Content-Type': 'application/json',
  ..._authToken ? { Authorization: `Bearer ${_authToken}` } : {},
});

async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...headers(), ...options.headers },
    });
  } catch (networkErr) {
    console.error('FETCH THREW — url:', url, 'message:', networkErr.message, 'full:', networkErr);
    throw new Error(`Cannot reach server: ${networkErr.message}`);
  }

  const json = await res.json();

  if (!res.ok) {
    console.error("API ERROR:", json);
    throw new Error(json?.error || `HTTP ${res.status}`);
  }

  return json;
}

export const login = (username, password, storeCode) =>
  request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, uniqueCode: storeCode }),
  });

export const fetchSales = (fromDate, toDate, ccode = 1, uniqueCode = _uniqueCode) =>
  request(`/sales?fromDate=${fromDate}&toDate=${toDate}&ccode=${ccode}&uniqueCode=${uniqueCode}`);

export const fetchTodaySales = (ccode = 1) => {
  const today = new Date().toISOString().split('T')[0];
  return fetchSales(today, today, ccode);
};

export const fetchMonthSales = (ccode = 1) => {
  const now  = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to   = now.toISOString().split('T')[0];
  return fetchSales(from, to, ccode);
};
export const fetchSalesPurchaseMargin = (fromDate, toDate, ccode = 1, uniqueCode = _uniqueCode) =>
  request(`/salespurchasemargin?fromDate=${fromDate}&toDate=${toDate}&ccode=${ccode}&uniqueCode=${uniqueCode}`);
export const fetchDayWiseSales = (fromDate, toDate, ccode = 1, uniqueCode = _uniqueCode) =>
  request(`/daywisesales?fromDate=${fromDate}&toDate=${toDate}&ccode=${ccode}&uniqueCode=${uniqueCode}`);

export const fetchDeptWiseSales = (fromDate, toDate, ccode = 1, uniqueCode = _uniqueCode) =>
  request(`/deptwisesales?fromDate=${fromDate}&toDate=${toDate}&ccode=${ccode}&uniqueCode=${uniqueCode}`);

export const fetchCompanies = () =>
  request('/companies');

// ── Item price change (NEW) ────────────────────────────────────────────
// Both scoped server-side to the logged-in user's own store (uniqueCode
// comes from the JWT on the backend, not from anything sent here).

export const searchItems = (q) =>
  request(`/items/search?q=${encodeURIComponent(q)}`);

export const updateItemPrice = (barcode, { sellingPrice, costPrice, mrp }) =>
  request('/items/price', {
    method: 'PUT',
    body: JSON.stringify({ barcode, sellingPrice, costPrice, mrp }),
  });