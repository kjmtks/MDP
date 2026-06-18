import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/app-theme.css'
import App from './App'
import { AppSettingsProvider } from './features/settings/AppSettingsContext'
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/atom-one-dark.css';
import QRCode from 'qrcode';

// Expose KaTeX (bundled, offline-safe) so module <script>s can typeset math in
// DOM they inject as raw HTML — that HTML bypasses the markdown KaTeX extension,
// so e.g. the `references` module typesets `$…$` in its element itself.
(window as unknown as { katex?: unknown; renderMathInElement?: unknown }).katex = katex;
(window as unknown as { renderMathInElement?: unknown }).renderMathInElement = renderMathInElement;

// Expose a SYNCHRONOUS QR matrix builder (bundled `qrcode`, offline-safe) so the
// `qr` module can emit an inline SVG at render time — no per-instance script, so
// it appears in thumbnails / PDF export / presenter too. Returns a flat 0/1 grid.
(window as unknown as { mdpCreateQR?: unknown }).mdpCreateQR = (
  text: string,
  opts?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
): { size: number; data: number[] } => {
  const qr = QRCode.create(String(text), opts || {});
  return { size: qr.modules.size, data: Array.from(qr.modules.data) };
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppSettingsProvider>
      <App />
    </AppSettingsProvider>
  </StrictMode>,
)