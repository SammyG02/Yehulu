import { Navigate, Route, Routes } from 'react-router'
import { Analytics } from '@vercel/analytics/react'
import { Capacitor } from '@capacitor/core'
import { AppShell } from './components/layout/AppShell.jsx'
import ActivityPage from './pages/ActivityPage.jsx'
import GrowthPage from './pages/GrowthPage.jsx'
import HomePage from './pages/HomePage.jsx'
import PrivacyPage from './pages/PrivacyPage.jsx'
import SettingsLayout from './pages/settings/SettingsLayout.jsx'
import { SETTINGS_SECTIONS } from './pages/settings/sections.js'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="privacy" element={<PrivacyPage />} />
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="growth" element={<GrowthPage />} />
          <Route path="settings" element={<SettingsLayout />}>
            {SETTINGS_SECTIONS.map(({ path, Component }) => (
              <Route key={path} path={path} element={<Component />} />
            ))}
            <Route path="*" element={<Navigate to="/settings" replace />} />
          </Route>
          <Route path="account" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {!Capacitor.isNativePlatform() && <Analytics />}
    </>
  )
}
