import { useEffect, useState } from 'react';
import EditorPage from './pages/EditorPage';
import PresenterPage from './pages/PresenterPage';
import RemotePage from './pages/RemotePage';
import CapturePage from './features/remote/capture/CapturePage';
import { SettingsPage } from './pages/SettingsPage';
import { NotificationHost } from './components/error/NotificationHost';

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

  return (
    <>
      <CurrentPage />
      <NotificationHost />
    </>
  );
}
