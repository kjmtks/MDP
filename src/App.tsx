import { useEffect, useState } from 'react';
import EditorPage from './pages/EditorPage';
import PresenterPage from './pages/PresenterPage';
import RemotePage from './pages/RemotePage';
import CapturePage from './features/remote/capture/CapturePage';
import { SettingsPage } from './pages/SettingsPage';
import { NotificationHost } from './components/error/NotificationHost';
import { ErrorBoundary } from './components/ErrorBoundary';

function CurrentPage() {
  const path = window.location.pathname;
  const hash = window.location.hash;

  if (hash.includes('#/capture')) return <CapturePage />;
  if (path === '/presenter' || hash.includes('#/presenter')) return <PresenterPage />;
  if (path === '/remote' || hash.includes('#/remote')) return <RemotePage />;

  // Main window: the editor stays mounted (preserving tabs/state) and the
  // full-screen Settings page overlays on top when navigated to.
  const settingsOpen = path === '/settings' || hash.includes('#/settings');
  return (
    <>
      <EditorPage />
      {settingsOpen && <SettingsPage />}
    </>
  );
}

export default function AppRouter() {
  // Re-render the router on in-app navigation (hash/popstate) so the Settings
  // overlay opens/closes without a reload.
  const [, force] = useState(0);
  useEffect(() => {
    const onNav = () => force((n) => n + 1);
    window.addEventListener('hashchange', onNav);
    window.addEventListener('popstate', onNav);
    return () => {
      window.removeEventListener('hashchange', onNav);
      window.removeEventListener('popstate', onNav);
    };
  }, []);

  // Final safety net: if a page throws during render, show a recoverable message
  // instead of a blank white window. Keyed on the URL so navigating clears it.
  return (
    <>
      <ErrorBoundary
        label="This view"
        resetKeys={[window.location.pathname, window.location.hash]}
        fallback={(error, reset) => (
          <div style={{
            position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
            background: 'var(--app-bg-app, #1e1e1e)', color: 'var(--app-text, #eee)',
            font: '14px/1.6 system-ui, sans-serif', textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
            <div style={{ maxWidth: 560, opacity: 0.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {error.message || String(error)}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="button" onClick={reset} style={{
                padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--app-border-strong, #444)',
                background: 'var(--app-bg-elevated, #2d2d2d)', color: 'var(--app-text, #eee)',
              }}>Try again</button>
              <button type="button" onClick={() => window.location.reload()} style={{
                padding: '7px 16px', borderRadius: 6, cursor: 'pointer', border: 'none',
                background: 'var(--app-accent, #3b82f6)', color: '#fff',
              }}>Reload</button>
            </div>
          </div>
        )}
      >
        <CurrentPage />
      </ErrorBoundary>
      <NotificationHost />
    </>
  );
}
