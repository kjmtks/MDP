import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/app-theme.css'
import App from './App'
import { AppSettingsProvider } from './features/settings/AppSettingsContext'
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/atom-one-dark.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppSettingsProvider>
      <App />
    </AppSettingsProvider>
  </StrictMode>,
)