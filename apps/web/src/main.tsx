import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Theme first: every component consumes --ab-* tokens.
import '@abyss-harness/client-ui-theme'
import { applyTheme, getInitialTheme } from '@abyss-harness/client-ui-theme'
import { App } from '@abyss-harness/client-ui-renderer'

// Apply the persisted theme before first render.
applyTheme(getInitialTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
