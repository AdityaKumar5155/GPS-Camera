import { Tabs } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' }, // Full-screen camera — no tab bar
      }}>
      <Tabs.Screen name="index" options={{ title: 'Camera' }} />
    </Tabs>
  );
}
