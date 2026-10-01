import React, { useState, useSyncExternalStore } from 'react';
import { Button, IconButton, LinearProgress, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MovieIcon from '@mui/icons-material/Movie';
import {
  cancelAllVideos, cancelVideo, clearFinishedVideos, getVideoJobs, subscribeVideoJobs, type VideoJob,
} from './videoQueue';

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function statusText(j: VideoJob): string {
  switch (j.status) {
    case 'queued': return 'Waiting';
    case 'running': {
      const p = j.progress;
      if (!p || p.stage === 'prepare') return p?.total ? `Synthesizing the narration ${p.done} / ${p.total}…` : 'Preparing…';
      if (p.stage === 'finish') return 'Finishing the file…';
      if (p.stage === 'record') return `Recording the auto-play · line ${p.done} / ${p.total} · ${clock(p.seconds)}`;
      return `Narrating and rendering ${p.done} / ${p.total} · ${clock(p.seconds)} of video`;
    }
    case 'done': return `Done · ${clock(j.result?.seconds || 0)} → ${j.result?.path.split('/').pop() || ''}`;
    case 'failed': return `Failed: ${j.error || 'unknown error'}`;
    default: return 'Cancelled';
  }
}

// The video export queue, floating bottom-right while it has anything to show.
// Hiding it keeps the jobs running; queueing another brings it back.
export const VideoQueuePanel: React.FC<{ onOpen: (path: string) => void }> = ({ onOpen }) => {
  const jobs = useSyncExternalStore(subscribeVideoJobs, getVideoJobs);
  const [hiddenAt, setHiddenAt] = useState(0);
  const newest = jobs.reduce((n, j) => Math.max(n, j.addedAt), 0);
  if (!jobs.length || newest <= hiddenAt) return null;
  const anyActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const anyFinished = jobs.some((j) => j.status !== 'queued' && j.status !== 'running');
  const btn = { textTransform: 'none', minWidth: 0, fontSize: 12, py: 0 } as const;

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, width: 380, maxHeight: '50vh', overflowY: 'auto', zIndex: 1250,
      background: 'var(--app-bg-elevated)', color: 'var(--app-text)', border: '1px solid var(--app-border)',
      borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,.35)', padding: '8px 10px', fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <MovieIcon fontSize="small" style={{ color: 'var(--app-text-muted)' }} />
        <b style={{ flex: 1 }}>Video export</b>
        {anyActive && <Button size="small" color="error" sx={btn} onClick={cancelAllVideos}>Cancel all</Button>}
        {anyFinished && <Button size="small" sx={btn} onClick={clearFinishedVideos}>Clear finished</Button>}
        <Tooltip title={anyActive ? 'Hide (the export keeps running)' : 'Hide'}>
          <IconButton size="small" onClick={() => setHiddenAt(newest)}><CloseIcon fontSize="small" /></IconButton>
        </Tooltip>
      </div>
      {jobs.map((j) => {
        const p = j.progress;
        const running = j.status === 'running';
        return (
          <div key={j.id} style={{ padding: '6px 0', borderTop: '1px solid var(--app-border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.deckPath}>{j.title}</span>
              {j.status === 'done' && j.result && (
                <Button size="small" sx={btn} onClick={() => onOpen(j.result!.path)}>Play</Button>
              )}
              {(j.status === 'queued' || running) && (
                <Button size="small" color="error" sx={btn} onClick={() => cancelVideo(j.id)}>Cancel</Button>
              )}
            </div>
            <div style={{ fontSize: 12, marginTop: 2, color: j.status === 'failed' ? '#f87171' : 'var(--app-text-muted)', wordBreak: 'break-word' }}>
              {statusText(j)}
            </div>
            {running && (
              <LinearProgress sx={{ mt: 0.5 }}
                variant={p && p.stage !== 'finish' && p.total ? 'determinate' : 'indeterminate'}
                value={p && p.total ? (p.done / p.total) * 100 : 0} />
            )}
          </div>
        );
      })}
    </div>
  );
};
