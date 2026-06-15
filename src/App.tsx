import EditorPage from './pages/EditorPage';
import PresenterPage from './pages/PresenterPage';
import RemotePage from './pages/RemotePage';
import CapturePage from './features/remote/capture/CapturePage';
import { NotificationHost } from './components/error/NotificationHost';

function CurrentPage() {
  const path = window.location.pathname;
  const hash = window.location.hash;

  if (hash.includes('#/capture')) return <CapturePage />;
  if (path === '/presenter' || hash.includes('#/presenter')) return <PresenterPage />;
  if (path === '/remote' || hash.includes('#/remote')) return <RemotePage />;

  return <EditorPage />;
}

export default function AppRouter() {
  return (
    <>
      <CurrentPage />
      <NotificationHost />
    </>
  );
}