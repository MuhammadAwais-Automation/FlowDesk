import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { getCachedTheme } from './lib/theme'
import './index.css'

// Synchronous, before React mounts — avoids a flash of the wrong theme on
// cold start. useThemeStore.init() (in App.tsx) still runs afterward to
// resolve the real setting/System value; this is just the cached guess.
const cachedTheme = getCachedTheme()
if (cachedTheme) {
  document.documentElement.setAttribute('data-theme', cachedTheme)
  document.documentElement.style.colorScheme = cachedTheme
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
