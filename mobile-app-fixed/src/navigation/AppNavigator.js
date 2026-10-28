// src/navigation/AppNavigator.js
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';

import LoginScreen          from '../screens/LoginScreen';
import DashboardScreen      from '../screens/DashboardScreen';
import SalesGraphScreen     from '../screens/SalesGraphScreen';
import DayWiseSalesScreen   from '../screens/DayWiseSalesScreen';
import DeptWiseSalesScreen  from '../screens/DeptWiseSalesScreen';
import SalesPurchaseMarginScreen from '../screens/SalesPurchaseMarginScreen';
import ItemPriceChangeScreen from '../screens/ItemPriceChangeScreen'; // NEW
const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { user } = useAuth();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {user ? (
          <>
            <Stack.Screen name="Dashboard"      component={DashboardScreen}     />
            <Stack.Screen name="SalesGraph"     component={SalesGraphScreen}    />
            <Stack.Screen name="DayWiseSales"   component={DayWiseSalesScreen}  />
            <Stack.Screen name="DeptWiseSales"  component={DeptWiseSalesScreen} />
            <Stack.Screen name="SalesPurchaseMargin" component={SalesPurchaseMarginScreen} />
            <Stack.Screen name="ItemPriceChange" component={ItemPriceChangeScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}