import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Collapse, Snackbar, Alert, Tooltip,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { NOTIFY_EVENT, CONFIRM_EVENT, CHOICE_EVENT, reportError, resolveConfirm, resolveChoice, type AppNotification, type ConfirmRequest, type ChoiceRequest } from './errorReporter';

const IGNORE = /ResizeObserver loop|Script error\.?$/i;

export function NotificationHost() {
  const [queue, setQueue] = useState<AppNotification[]>([]);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [choiceReq, setChoiceReq] = useState<ChoiceRequest | null>(null);
  const [detailOpenId, setDetailOpenId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const current = queue[0] ?? null;
  const showDetail = current != null && detailOpenId === current.id;
  const copied = current != null && copiedId === current.id;

  useEffect(() => {
    const handler = (e: Event) => {
      const n = (e as CustomEvent<AppNotification>).detail;
      if (!n) return;
      if (n.severity === 'error' || n.severity === 'warning') {
        setQueue(prev => [...prev, n]);
      } else {
        setToast(n);
      }
    };
    const confirmHandler = (e: Event) => {
      const req = (e as CustomEvent<ConfirmRequest>).detail;
      if (req) setConfirmReq(req);
    };
    const choiceHandler = (e: Event) => {
      const req = (e as CustomEvent<ChoiceRequest>).detail;
      if (req) setChoiceReq(req);
    };
    window.addEventListener(NOTIFY_EVENT, handler);
    window.addEventListener(CONFIRM_EVENT, confirmHandler);
    window.addEventListener(CHOICE_EVENT, choiceHandler);
    return () => {
      window.removeEventListener(NOTIFY_EVENT, handler);
      window.removeEventListener(CONFIRM_EVENT, confirmHandler);
      window.removeEventListener(CHOICE_EVENT, choiceHandler);
    };
  }, []);

  const answerConfirm = useCallback((result: boolean) => {
    setConfirmReq(prev => {
      if (prev) resolveConfirm(prev.id, result);
      return null;
    });
  }, []);

  const answerChoice = useCallback((value: string | null) => {
    setChoiceReq(prev => {
      if (prev) resolveChoice(prev.id, value);
      return null;
    });
  }, []);

  useEffect(() => {
    let last = '';
    let lastAt = 0;
    const guard = (message: string, detail: unknown) => {
      if (IGNORE.test(message)) return;
      const now = Date.now();
      if (message === last && now - lastAt < 3000) return;
      last = message;
      lastAt = now;
      reportError(message, { detail });
    };
    const onError = (e: ErrorEvent) => guard(e.message || 'Unexpected error', e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      guard(message || 'Unhandled promise rejection', reason);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const close = useCallback(() => setQueue(prev => prev.slice(1)), []);

  const copy = useCallback(async () => {
    if (!current) return;
    const report = [
      `[${current.severity.toUpperCase()}] ${current.title}`,
      current.message,
      current.detail ? `\n${current.detail}` : '',
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(report);
      setCopiedId(current.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  }, [current]);

  const isWarning = current?.severity === 'warning';

  return (
    <>
      <Dialog open={!!current} onClose={close} maxWidth="sm" fullWidth>
        {current && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
              {isWarning
                ? <WarningAmberIcon color="warning" />
                : <ErrorOutlineIcon color="error" />}
              {current.title}
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {current.message}
              </Typography>
              {current.detail && (
                <Box sx={{ mt: 2 }}>
                  <Button
                    size="small"
                    onClick={() => setDetailOpenId(showDetail ? null : current.id)}
                    startIcon={<ExpandMoreIcon sx={{ transform: showDetail ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
                    sx={{ textTransform: 'none', color: 'text.secondary' }}
                  >
                    {showDetail ? 'Hide details' : 'Show details'}
                  </Button>
                  <Collapse in={showDetail}>
                    <Box
                      component="pre"
                      sx={{
                        mt: 1, p: 1.5, m: 0, maxHeight: 240, overflow: 'auto', borderRadius: 1,
                        bgcolor: '#1e1e1e', color: '#d4d4d4', fontSize: '0.75rem',
                        fontFamily: 'Consolas, Monaco, monospace', whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word', userSelect: 'text',
                      }}
                    >
                      {current.detail}
                    </Box>
                  </Collapse>
                </Box>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Tooltip title="Copy error details for reporting">
                <Button
                  onClick={copy}
                  startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
                  color={copied ? 'success' : 'inherit'}
                  sx={{ textTransform: 'none', mr: 'auto' }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </Tooltip>
              <Button onClick={close} variant="contained">Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity === 'info' ? 'info' : 'success'} variant="filled" onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>

      <Dialog open={!!confirmReq} onClose={() => answerConfirm(false)} maxWidth="sm" fullWidth>
        {confirmReq && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
              {confirmReq.severity === 'warning'
                ? <WarningAmberIcon color="warning" />
                : <HelpOutlineIcon color="primary" />}
              {confirmReq.title}
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {confirmReq.message}
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => answerConfirm(false)} sx={{ textTransform: 'none' }}>{confirmReq.cancelText}</Button>
              <Button onClick={() => answerConfirm(true)} variant="contained" sx={{ textTransform: 'none' }}>{confirmReq.confirmText}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog open={!!choiceReq} onClose={() => answerChoice(null)} maxWidth="sm" fullWidth>
        {choiceReq && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
              {choiceReq.severity === 'warning'
                ? <WarningAmberIcon color="warning" />
                : <HelpOutlineIcon color="primary" />}
              {choiceReq.title}
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {choiceReq.message}
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
              {choiceReq.options.map(opt => (
                <Button
                  key={opt.value}
                  onClick={() => answerChoice(opt.value)}
                  variant={opt.variant ?? 'text'}
                  color={opt.color ?? 'primary'}
                  sx={{ textTransform: 'none' }}
                >
                  {opt.label}
                </Button>
              ))}
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
