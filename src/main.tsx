import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled, so the app looks the same offline.
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/600.css'
import './styles/tokens.css'
import './index.css'
import App from './App.tsx'
import { applyTheme, useUIStore } from './store/uiStore'

// Before the first render, so a dark choice never flashes light at startup.
applyTheme(useUIStore.getState().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
