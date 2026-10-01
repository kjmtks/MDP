import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, CircularProgress, FormControlLabel, MenuItem, Switch, TextField, ThemeProvider, createTheme,
} from '@mui/material';
import { apiClient } from '../../api/apiClient';
import type { AppSettings } from '../settings/types';
import {
  IRODORI_VOICE_ID, OPENAI_VOICES, SshBastionError, deleteIrodoriVoice, designIrodoriVoice, forgetSshBastionHostKey,
  inspectSpeechServer, isAbortError, referenceVoicesUsed, saveIrodoriVoice, setSshBastionSecret, speechModelFor,
  speechProfileKey, speechServerOf, sshBastionInfo, sshBastionSupported, trustSshBastionHostKey,
  type SpeechProfile, type SpeechServer, type SpeechServerInfo, type SshBastion, type SshBastionInfo, type SshBastionProblem,
} from './ttsService';
import { VoiceCalibrationDialog } from './VoiceCalibrationDialog';

type Tts = AppSettings['tts'];

// A voice designed from the caption, waiting to be auditioned and then locked in.
interface Sample { wav: Uint8Array; url: string }

// The Voice menu's entry for a server's own default voice (stored as '').
const SERVER_DEFAULT = '__server-default__';

// Which server a connection's findings belong to: the URL, the key and the route.
const connectionStamp = (s: SpeechServer): string =>
  `${speechProfileKey(s)}|${s.apiKey || ''}|${s.ssh ? `${s.ssh.user}@${s.ssh.host}:${s.ssh.port}` : ''}`;

// Which /etc/ssh/ssh_host_<x>_key.pub on the bastion holds a key of this type.
const hostKeyFile = (keyType = ''): string =>
  /ecdsa/.test(keyType) ? 'ecdsa' : /rsa/.test(keyType) ? 'rsa' : /dss/.test(keyType) ? 'dsa' : 'ed25519';

// Settings of the 'openai' engine — any TTS server with OpenAI's speech API —
// shared by the rehearsal dialog and the narrated auto-play setup screen: server
// URL + Connect, API key, model, the voice to speak with, and how to speak.
// Connecting finds out what the server is: Irodori-TTS-Server (its /health reports
// the model runtime) or another one (OpenAI, Kokoro-FastAPI, openedai-speech…),
// and lists its models and voices where it has such lists.
//
// Irodori-TTS-Server's extensions appear only when it is the server. A Voice
// Design caption alone gives a different speaker on almost every line (see
// ttsService: "locking a designed voice"), so with no reference voice the panel
// offers: design one clip from the caption → audition it → register it on the
// server as a named voice → speak everything with that voice. With any other
// server the description goes out as OpenAI's `instructions`.
//
// The presenter's OWN voice — record a few sentences of the deck
// (VoiceCalibrationDialog), or register an existing recording — and removing a
// voice are offered only where the server registers voices in Irodori's way
// (`voiceRegistry`: Irodori, or kjai01's Chatterbox, which copies its form), and
// not when Irodori's loaded model is found to ignore reference voices
// (referenceVoicesUsed — asked once per checkpoint with a registered voice).
//
// Desktop app: the server can be reached THROUGH an SSH bastion, switched on and
// off here (off campus / on campus). Its password or key passphrase goes straight
// to the main process, which keeps it encrypted — this panel only learns whether
// one is stored. The first connection shows the bastion's host key to confirm.
export const SpeechServerControls: React.FC<{
  tts: Tts;
  patchTts: (p: Partial<Tts>) => void;
  /** The auto-play setup screen is always dark, whatever the app theme. */
  dark?: boolean;
  /** The deck's slides (raw markdown) — what to read when recording a voice. */
  slideRaws?: string[];
}> = ({ tts, patchTts, dark, slideRaws }) => {
  // 'loading' from the start: the panel connects as soon as the engine is picked.
  const [rawStatus, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  // What Connect found, and FOR WHICH server (URL, key, route). Change any of those
  // and the findings no longer apply: the panel reconnects by itself instead of
  // offering another server's voices.
  const [found, setFound] = useState<{ stamp: string; info: SpeechServerInfo | null } | null>(null);
  // The model a request uses when the settings name none (what the server lists).
  const [autoModel, setAutoModel] = useState('');
  // The last connection's SSH trouble, when the user can act on it here.
  const [sshProblem, setSshProblem] = useState<SshBastionProblem | null>(null);

  const server = useMemo(() => speechServerOf(tts), [tts]);
  const stamp = connectionStamp(server);
  const stale = !!found && found.stamp !== stamp;
  const info = found && !stale ? found.info : null;
  const status = stale ? 'loading' : rawStatus;
  const irodori = info?.kind === 'irodori';
  const canRegister = !!info?.voiceRegistry;

  // State is only set from the promise's callbacks, never synchronously. `srv`:
  // a server config newer than this render's (the bastion switch just flipped).
  const load = useCallback((then?: () => void, srv: SpeechServer = server) => {
    const at = connectionStamp(srv);
    void inspectSpeechServer(srv).then(
      (got) => {
        setFound({ stamp: at, info: got }); setError(''); setSshProblem(null); setStatus('ok');
        void speechModelFor({ ...tts, openaiModel: '' }).then(setAutoModel, () => setAutoModel(''));
        // This server's own choices: the ones remembered for it, or — the first
        // time here — the current ones where it has them (another server's voice
        // or model is not carried over: it would fail here).
        const key = speechProfileKey(srv);
        const saved = tts.openaiProfiles[key];
        const has = (v: string) => !v || !got.voices || got.voices.includes(v) || (got.kind === 'irodori' && v === 'none');
        const next: SpeechProfile = saved ?? {
          voice: has(tts.openaiVoice) ? tts.openaiVoice : '',
          model: !tts.openaiModel || !got.models.length || got.models.includes(tts.openaiModel) ? tts.openaiModel : '',
          instructions: tts.openaiInstructions,
        };
        const p: Partial<Tts> = {};
        if (next.voice !== tts.openaiVoice) p.openaiVoice = next.voice;
        if (next.model !== tts.openaiModel) p.openaiModel = next.model;
        if (next.instructions !== tts.openaiInstructions) p.openaiInstructions = next.instructions;
        if (!saved) p.openaiProfiles = { ...tts.openaiProfiles, [key]: next };
        if (Object.keys(p).length) patchTts(p);
        then?.();
      },
      (e: unknown) => {
        setFound({ stamp: at, info: null }); setStatus('error');
        setSshProblem(e instanceof SshBastionError ? e.problem : null);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [server, tts, patchTts]);
  const connect = () => { setStatus('loading'); setError(''); load(); };

  // The URL, key or route changed: connect again by itself once the typing stops.
  useEffect(() => {
    if (!stale) return undefined;
    const t = window.setTimeout(() => { setError(''); load(); }, 900);
    return () => window.clearTimeout(t);
  }, [stale, stamp, load]);

  // A choice made on the connected server is remembered for it (and only then:
  // not under a half-typed URL).
  const choose = (p: Partial<Pick<Tts, 'openaiVoice' | 'openaiModel' | 'openaiInstructions'>>) => {
    const key = info ? speechProfileKey(server) : '';
    const next: SpeechProfile = {
      voice: p.openaiVoice ?? tts.openaiVoice,
      model: p.openaiModel ?? tts.openaiModel,
      instructions: p.openaiInstructions ?? tts.openaiInstructions,
    };
    patchTts({ ...p, ...(key ? { openaiProfiles: { ...tts.openaiProfiles, [key]: next } } : {}) });
  };

  // ---- SSH bastion (desktop app) ------------------------------------------------
  const sshSupported = sshBastionSupported();
  const ssh = tts.openaiSsh;
  const [sshInfo, setSshInfo] = useState<SshBastionInfo | null>(null);
  const [secretDraft, setSecretDraft] = useState('');
  const [sshBusy, setSshBusy] = useState(false);
  const [sshError, setSshError] = useState('');
  const sshWho = `${ssh.host}|${ssh.port}|${ssh.user}|${ssh.keyPath}`;
  useEffect(() => {
    if (!sshSupported || !ssh.enabled) return undefined;
    let live = true;
    sshBastionInfo(ssh).then((i) => { if (live) setSshInfo(i); }, () => { if (live) setSshInfo(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sshSupported, ssh.enabled, sshWho]);

  const patchSsh = (p: Partial<SshBastion>) => {
    patchTts({ openaiSsh: { ...ssh, ...p } });
    if (p.host !== undefined || p.port !== undefined) setSshProblem(null);   // a fingerprint belongs to one host
  };
  // Flip the switch and reconnect at once — the way this computer reaches the
  // server has changed (home ↔ campus).
  const toggleSsh = (enabled: boolean) => {
    const next = { ...ssh, enabled };
    patchTts({ openaiSsh: next });
    setSshProblem(null); setSshError(''); setStatus('loading'); setError('');
    load(undefined, speechServerOf({ ...tts, openaiSsh: next }));
  };
  const sshStep = (op: Promise<SshBastionInfo>, then?: () => void) => {
    setSshBusy(true); setSshError('');
    op.then((i) => { setSshInfo(i); then?.(); }, (e: unknown) => setSshError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSshBusy(false));
  };
  const saveSecret = (value: string) =>
    sshStep(setSshBastionSecret(ssh.auth === 'password' ? 'password' : 'passphrase', ssh, value), () => setSecretDraft(''));
  const trustKey = () => {
    if (sshProblem?.fingerprint) sshStep(trustSshBastionHostKey(ssh, sshProblem.fingerprint), () => { setSshProblem(null); connect(); });
  };
  const forgetKey = () => sshStep(forgetSshBastionHostKey(ssh), () => { setSshProblem(null); connect(); });
  const browseKey = () => {
    void apiClient.pickFile({ title: 'Select your SSH private key', filters: [{ name: 'All files', extensions: ['*'] }] })
      .then((p) => { if (p) patchSsh({ keyPath: p }); });
  };
  const secretStored = ssh.auth === 'password' ? !!sshInfo?.hasPassword : !!sshInfo?.hasPassphrase;
  // The host key boxes below explain these two; the status line need not repeat them.
  const keyTrouble = sshProblem?.code === 'hostkey-unknown' || sshProblem?.code === 'hostkey-mismatch';

  // Try once when the engine is picked; after that Connect re-checks on demand.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // A server with a voice list and no voice chosen yet: take its first voice, so
  // what is spoken is what the panel shows. (Irodori's '' already means 'none',
  // and on another server with a voice registry '' is its own default voice.)
  useEffect(() => {
    if (info && !info.voiceRegistry && info.voices?.length && !tts.openaiVoice.trim()) choose({ openaiVoice: info.voices[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // ---- design → audition → lock (Irodori) ------------------------------------
  const [sample, setSample] = useState<Sample | null>(null);
  const [designing, setDesigning] = useState(false);
  const [designError, setDesignError] = useState('');
  const [name, setName] = useState('narrator');
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sampleRef = useRef<Sample | null>(null);
  // Closing the panel mid-design aborts the request, so the server stops as well.
  const designAbortRef = useRef<AbortController | null>(null);

  const play = (url: string) => {
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    void a.play().catch(() => { /* autoplay blocked: the Play button still works */ });
  };
  const dropSample = () => {
    audioRef.current?.pause();
    if (sampleRef.current) URL.revokeObjectURL(sampleRef.current.url);
    sampleRef.current = null;
    setSample(null);
  };
  useEffect(() => () => {
    designAbortRef.current?.abort();
    audioRef.current?.pause();
    if (sampleRef.current) URL.revokeObjectURL(sampleRef.current.url);
  }, []);

  const design = () => {
    setDesigning(true); setDesignError(''); setConfirmReplace(false);
    const ac = new AbortController();
    designAbortRef.current = ac;
    designIrodoriVoice(tts, ac.signal).then((wav) => {
      dropSample();
      const s = { wav, url: URL.createObjectURL(new Blob([wav.slice()], { type: 'audio/wav' })) };
      sampleRef.current = s;
      setSample(s);
      play(s.url);
    }, (e: unknown) => { if (!isAbortError(e)) setDesignError(e instanceof Error ? e.message : String(e)); })
      .finally(() => setDesigning(false));
  };

  const nameOk = IRODORI_VOICE_ID.test(name) && name.toLowerCase() !== 'none';
  const lock = (replace: boolean) => {
    if (!sample || !nameOk) return;
    setSaving(true); setDesignError('');
    saveIrodoriVoice(server, name, sample.wav, replace).then((res) => {
      if (res === 'exists') { setConfirmReplace(true); return; }
      setConfirmReplace(false);
      dropSample();
      // Re-read the list so the new voice is offered, then speak with it.
      load(() => choose({ openaiVoice: name }));
    }, (e: unknown) => setDesignError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  // ---- own voice: record / file, and removing a voice (voice registry) -----------
  const [calibrate, setCalibrate] = useState<'record' | 'file' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const onRegistered = (id: string) => load(() => choose({ openaiVoice: id }));
  const remove = (id: string) => {
    setRemoving(true); setRemoveError('');
    deleteIrodoriVoice(server, id).then(
      () => { setConfirmRemove(false); load(() => choose({ openaiVoice: irodori ? 'none' : '' })); },
      (e: unknown) => setRemoveError(e instanceof Error ? e.message : String(e)),
    ).finally(() => setRemoving(false));
  };

  // Irodori's '' means 'none' (no reference voice). On another server with a voice
  // registry '' is the server's own default voice — the request names OpenAI's
  // 'alloy', which kjai01's Chatterbox takes as its default — and is offered as such.
  const voice = tts.openaiVoice.trim() || (irodori ? 'none' : '');
  const voices = info?.voices ?? null;
  const defaultChoice = canRegister && !irodori;

  // ---- does Irodori's loaded model use reference voices? -----------------------
  // Asked (once per checkpoint) with a voice registered on the server — the chosen
  // one, else any; none registered yet = not known yet. The answer is kept with the
  // server and checkpoint it belongs to, so a reconnect elsewhere never shows it.
  const checkpoint = info?.health?.checkpoint || '';
  const refKey = irodori ? `${server.url}|${checkpoint}` : '';
  const probeVoice = useMemo(() => {
    const registered = irodori && voices ? voices.filter((v) => v !== 'none') : [];
    return registered.includes(voice) ? voice : registered[0] || '';
  }, [irodori, voices, voice]);
  const [refAnswer, setRefAnswer] = useState<{ key: string; used: boolean | null } | null>(null);
  useEffect(() => {
    if (!refKey || !probeVoice || status !== 'ok') return undefined;
    let live = true;
    referenceVoicesUsed(server, probeVoice).then(
      (used) => { if (live) setRefAnswer({ key: refKey, used }); },
      () => { if (live) setRefAnswer({ key: refKey, used: null }); },
    );
    return () => { live = false; };
  }, [refKey, probeVoice, status, server]);
  const refIgnored = !!refKey && refAnswer?.key === refKey && refAnswer.used === false;
  // Keep a saved voice the server no longer offers visible, so its absence is
  // noticed instead of silently becoming another voice.
  const options = useMemo(() => {
    const list = voices?.length ? voices : irodori ? ['none'] : [];
    const all = !voice || list.includes(voice) ? list : [...list, voice];
    return defaultChoice ? [SERVER_DEFAULT, ...all] : all;
  }, [voices, voice, irodori, defaultChoice]);
  const noRef = voice === 'none';
  const hasCaption = !!tts.openaiInstructions.trim();
  // Irodori takes one model (it rejects any other name): no field unless one is set.
  const showModel = !irodori || !!tts.openaiModel.trim();

  const muted = dark ? '#9aa0aa' : 'var(--app-text-muted)';
  const warn = '#f0a020';
  const btn = { textTransform: 'none', whiteSpace: 'nowrap' } as const;
  // The bastion password / key passphrase: typed here, sent once to the main
  // process (encrypted there), never kept in the settings or in this panel.
  const secretRow = (
    <>
      <TextField size="small" type="password" sx={{ flex: 1 }} autoComplete="new-password"
        label={ssh.auth === 'password' ? 'Password' : 'Key passphrase'}
        value={secretDraft} disabled={sshInfo?.encryption === false}
        onChange={(e) => setSecretDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && secretDraft && !sshBusy) saveSecret(secretDraft); }}
        placeholder={secretStored ? 'saved — type to replace'
          : ssh.auth === 'password' ? 'saved encrypted on this computer' : 'only if the key has one'} />
      <Button size="small" variant="outlined" sx={btn} disabled={!secretDraft || sshBusy} onClick={() => saveSecret(secretDraft)}>Save</Button>
      {secretStored && (
        <Button size="small" sx={{ ...btn, color: muted }} disabled={sshBusy} onClick={() => saveSecret('')}>Clear</Button>
      )}
    </>
  );
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <TextField size="small" label="Server URL" value={tts.openaiUrl} sx={{ flex: 1 }}
          onChange={(e) => patchTts({ openaiUrl: e.target.value })} placeholder="http://127.0.0.1:8088  ·  https://api.openai.com/v1"
          slotProps={{ htmlInput: { spellCheck: false } }} />
        <Button variant="outlined" size="small" onClick={connect} disabled={status === 'loading'} sx={{ ...btn, minWidth: 92 }}>
          {status === 'loading' ? <CircularProgress size={16} /> : 'Connect'}
        </Button>
      </div>

      {/* Sent as `Authorization: Bearer …` (Irodori: its IRODORI_API_KEY). Kept in
          the machine-local settings only; module scripts never see it. */}
      <TextField size="small" label="API key" type="password" value={tts.openaiApiKey}
        onChange={(e) => patchTts({ openaiApiKey: e.target.value.trim() })}
        placeholder="only if the server needs one"
        autoComplete="new-password" slotProps={{ htmlInput: { spellCheck: false } }} />

      {sshSupported && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -4 }}>
          <FormControlLabel sx={{ ml: 0 }}
            control={<Switch size="small" checked={ssh.enabled} onChange={(e) => toggleSsh(e.target.checked)} />}
            label={(
              <span style={{ fontSize: 13 }}>
                Connect through an SSH bastion
                {!ssh.enabled && ssh.host && (
                  <span style={{ color: muted }}> — {ssh.user || '?'}@{ssh.host}{ssh.port !== 22 ? `:${ssh.port}` : ''}</span>
                )}
              </span>
            )} />
          {ssh.enabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: `2px solid ${dark ? '#3a3f47' : 'var(--app-border-subtle)'}` }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <TextField size="small" label="Bastion host" value={ssh.host} sx={{ flex: 1 }} placeholder="gateway.example.ac.jp"
                  onChange={(e) => patchSsh({ host: e.target.value.trim() })} slotProps={{ htmlInput: { spellCheck: false } }} />
                <TextField size="small" label="Port" value={ssh.port} sx={{ width: 76 }}
                  onChange={(e) => patchSsh({ port: Math.min(65535, Number(e.target.value.replace(/\D/g, '')) || 22) })} />
                <TextField size="small" label="User" value={ssh.user} sx={{ width: 130 }}
                  onChange={(e) => patchSsh({ user: e.target.value.trim() })} slotProps={{ htmlInput: { spellCheck: false } }} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <TextField select size="small" label="Sign in with" value={ssh.auth} sx={{ width: 140, flexShrink: 0 }}
                  onChange={(e) => { patchSsh({ auth: e.target.value === 'password' ? 'password' : 'key' }); setSecretDraft(''); }}>
                  <MenuItem value="key">Key file</MenuItem>
                  <MenuItem value="password">Password</MenuItem>
                </TextField>
                {ssh.auth === 'key' ? (
                  <>
                    <TextField size="small" label="Private key" value={ssh.keyPath} sx={{ flex: 1 }} placeholder="~/.ssh/id_ed25519"
                      onChange={(e) => patchSsh({ keyPath: e.target.value })} slotProps={{ htmlInput: { spellCheck: false } }} />
                    <Button size="small" sx={btn} onClick={browseKey}>Browse…</Button>
                  </>
                ) : secretRow}
              </div>
              {ssh.auth === 'key' && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{secretRow}</div>}
              {sshInfo?.encryption === false && (
                <div style={{ fontSize: 12, color: warn }}>
                  This computer has no protected storage for secrets, so a password or passphrase cannot be saved — use a key file without a passphrase.
                </div>
              )}
              <div style={{ fontSize: 12, color: muted, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sshInfo?.hostKey ? (
                  <span>
                    Host key <code>{sshInfo.hostKey.fingerprint}</code> ({sshInfo.hostKey.keyType}) — trusted ·{' '}
                    <Button size="small" sx={{ ...btn, minWidth: 0, p: 0, fontSize: 12, verticalAlign: 'baseline' }}
                      disabled={sshBusy} onClick={forgetKey}>forget</Button>
                  </span>
                ) : <span>Host key not confirmed yet — Connect shows it.</span>}
                <span>The server URL is opened from the bastion: <code>127.0.0.1</code> there means the bastion itself.</span>
              </div>
              {sshProblem?.code === 'hostkey-unknown' && (
                <div style={{ fontSize: 12, color: warn, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    First connection to <b>{sshProblem.host}</b>. Check that this is the bastion’s host key — ask its
                    administrator, or run <code>ssh-keygen -lf /etc/ssh/ssh_host_{hostKeyFile(sshProblem.keyType)}_key.pub</code> there:
                  </div>
                  <code>{sshProblem.fingerprint} ({sshProblem.keyType})</code>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="small" variant="contained" sx={btn} disabled={sshBusy} onClick={trustKey}>Trust and connect</Button>
                    <Button size="small" sx={btn} disabled={sshBusy} onClick={() => setSshProblem(null)}>Cancel</Button>
                  </div>
                </div>
              )}
              {sshProblem?.code === 'hostkey-mismatch' && (
                <div style={{ fontSize: 12, color: '#f87171', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    <b>The bastion’s host key has changed.</b> Someone may be intercepting the connection — nothing was sent.
                    Only if its administrator replaced the key: forget the old one, then confirm the new one.
                  </div>
                  <div>Trusted: <code>{sshProblem.expected}</code><br />Now: <code>{sshProblem.fingerprint}</code></div>
                  <div>
                    <Button size="small" color="error" sx={btn} disabled={sshBusy} onClick={forgetKey}>Forget the old key</Button>
                  </div>
                </div>
              )}
              {sshError && <div style={{ fontSize: 12, color: '#f87171' }}>{sshError}</div>}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 12, color: status === 'error' ? '#f87171' : muted, marginTop: -4 }}>
        {status === 'error' && !keyTrouble && <>{error}{sshProblem ? '' : ' Start the TTS server, then Connect.'}</>}
        {status === 'ok' && info && (
          <>
            Connected{server.ssh ? <> via {server.ssh.host}</> : null}
            {info.health ? (
              <>
                {' · Irodori-TTS'}{info.health.checkpoint ? <> · <code>{info.health.checkpoint}</code></> : null}
                {' · '}
                {info.health.loaded ? 'model loaded'
                  : info.health.loading ? 'model loading…'
                    : 'model not loaded yet — the first line waits for it to load'}
              </>
            ) : (
              <>
                {' · OpenAI-compatible'}
                {info.models.length ? ` · ${info.models.length} model${info.models.length > 1 ? 's' : ''}` : ''}
                {info.voices ? ` · ${info.voices.length} voice${info.voices.length === 1 ? '' : 's'}` : ' · no voice list — type the voice name'}
              </>
            )}
          </>
        )}
        {status === 'loading' && 'Connecting…'}
      </div>

      {showModel && (
        <>
          <TextField size="small" label="Model" value={tts.openaiModel}
            onChange={(e) => choose({ openaiModel: e.target.value.trim() })}
            placeholder={autoModel ? `automatic — ${autoModel}` : 'automatic'}
            slotProps={{ htmlInput: { list: 'mdp-tts-models', spellCheck: false } }}
            helperText={tts.openaiModel.trim() ? undefined : 'Empty: the speech model the server lists (else tts-1).'} />
          <datalist id="mdp-tts-models">
            {(info?.models || []).map((m) => <option key={m} value={m} />)}
          </datalist>
        </>
      )}

      {voices || irodori ? (
        <TextField select size="small" label="Voice" value={defaultChoice && !voice ? SERVER_DEFAULT : voice}
          onChange={(e) => {
            const id = String(e.target.value);
            choose({ openaiVoice: id === SERVER_DEFAULT ? '' : id }); setConfirmRemove(false); setRemoveError('');
          }}>
          {options.map((id) => (
            <MenuItem key={id} value={id}>
              {id === SERVER_DEFAULT ? 'default — the server’s own voice'
                : id === 'none' && irodori ? 'none — no reference voice (Voice Design only)'
                  : voices && !voices.includes(id) ? `${id} (not on this server)`
                    : refIgnored ? `${id} (ignored by this model)` : id}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <>
          <TextField size="small" label="Voice" value={tts.openaiVoice}
            onChange={(e) => choose({ openaiVoice: e.target.value.trim() })}
            placeholder="alloy" slotProps={{ htmlInput: { list: 'mdp-tts-voices', spellCheck: false } }}
            helperText={tts.openaiVoice.trim() ? undefined : 'Empty: alloy. OpenAI’s voices are suggested; other servers name their own.'} />
          <datalist id="mdp-tts-voices">
            {OPENAI_VOICES.map((v) => <option key={v} value={v} />)}
          </datalist>
        </>
      )}

      {refIgnored && (
        <div style={{ fontSize: 12, color: warn, marginTop: -4 }}>
          The server’s model{checkpoint ? <> (<code>{checkpoint}</code>)</> : null} does not use reference voices: a
          registered voice is ignored and every line gets a different speaker. Registering voices is turned off here —
          switch the server to a model that takes a reference voice (Irodori-TTS v4 / v4.1).
        </div>
      )}

      {canRegister && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: -2 }}>
            {!refIgnored && (
              <>
                <Button size="small" variant="outlined" sx={btn} disabled={status !== 'ok'} onClick={() => setCalibrate('record')}>
                  🎙 Record my voice…
                </Button>
                <Button size="small" sx={btn} disabled={status !== 'ok'} onClick={() => setCalibrate('file')}>Use an audio file…</Button>
              </>
            )}
            <span style={{ flex: 1 }} />
            {!noRef && voices?.includes(voice) && (confirmRemove ? (
              <>
                <span style={{ fontSize: 12, color: warn }}>Remove “{voice}” from the server? Anyone else using it loses it too.</span>
                <Button size="small" color="error" sx={btn} disabled={removing} onClick={() => remove(voice)}>
                  {removing ? <CircularProgress size={14} /> : 'Remove'}
                </Button>
                <Button size="small" sx={btn} disabled={removing} onClick={() => setConfirmRemove(false)}>Keep</Button>
              </>
            ) : (
              <Button size="small" sx={{ ...btn, color: muted }} onClick={() => setConfirmRemove(true)}>Remove this voice…</Button>
            ))}
          </div>
          {removeError && <div style={{ fontSize: 12, color: '#f87171', marginTop: -4 }}>{removeError}</div>}
          {calibrate && (
            <VoiceCalibrationDialog mode={calibrate} tts={tts} slideRaws={slideRaws || []}
              onClose={() => setCalibrate(null)} onRegistered={onRegistered} />
          )}
        </>
      )}

      <TextField size="small" label={irodori ? 'Voice Design (caption)' : 'Instructions (optional)'} multiline minRows={2} maxRows={5}
        value={tts.openaiInstructions} onChange={(e) => choose({ openaiInstructions: e.target.value })}
        placeholder={irodori ? '例: 落ち着いた低めの男性の声。聞き取りやすい、丁寧な講義口調。' : '例: 落ち着いた、ゆっくりした講義口調で。'} />

      {!irodori ? (
        <div style={{ fontSize: 12, color: muted, marginTop: -4 }}>
          How to speak — sent as <code>instructions</code>, which gpt-4o-mini-tts follows; tts-1 and many other servers do not take it, so leave it empty for them.
        </div>
      ) : refIgnored ? null : !noRef ? (
        <div style={{ fontSize: 12, color: muted, marginTop: -4 }}>
          The reference voice sets who speaks; the caption (optional) steers emotion and delivery.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -2 }}>
          <div style={{ fontSize: 12, color: warn }}>
            {hasCaption
              ? 'Without a reference voice the speaker changes from line to line — the caption only says what KIND of voice. Make one voice from this description and lock it in:'
              : 'No reference voice and no caption: every line is spoken by a different random voice. Describe the voice above, then make it into a fixed voice here.'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" size="small" sx={btn} onClick={design}
              disabled={!hasCaption || status !== 'ok' || designing || saving}>
              {designing ? <><CircularProgress size={14} sx={{ mr: 1 }} />Designing…</>
                : sample ? 'Try another voice' : 'Create a voice from this description'}
            </Button>
            {sample && !designing && (
              <Button size="small" sx={btn} onClick={() => play(sample.url)}>▶ Play again</Button>
            )}
          </div>
          {sample && !designing && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" label="Save as" value={name} sx={{ width: 170 }}
                onChange={(e) => { setName(e.target.value.trim()); setConfirmReplace(false); }}
                error={!nameOk} helperText={nameOk ? undefined : 'letters, digits, - and _'} />
              {confirmReplace ? (
                <>
                  <span style={{ fontSize: 12, color: warn }}>“{name}” already exists on the server.</span>
                  <Button variant="contained" size="small" sx={btn} onClick={() => lock(true)} disabled={saving}>Replace it</Button>
                  <Button size="small" sx={btn} onClick={() => setConfirmReplace(false)} disabled={saving}>Cancel</Button>
                </>
              ) : (
                <Button variant="contained" size="small" sx={btn} onClick={() => lock(false)} disabled={saving || !nameOk}>
                  {saving ? <CircularProgress size={14} /> : 'Use this voice'}
                </Button>
              )}
            </div>
          )}
          {designError && <div style={{ fontSize: 12, color: '#f87171' }}>{designError}</div>}
        </div>
      )}
    </div>
  );

  // Dark variant: the auto-play overlay is dark regardless of the app theme. It
  // sits at z-index 3000, so menus and dialogs opened from here must go above it.
  const darkTheme = useMemo(() => createTheme({
    palette: { mode: 'dark' },
    zIndex: { modal: 3100, snackbar: 3150, tooltip: 3200 },
  }), []);
  return dark ? <ThemeProvider theme={darkTheme}>{body}</ThemeProvider> : body;
};
