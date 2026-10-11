import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
