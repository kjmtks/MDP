import React, { useEffect, useState } from 'react';
import { Button, ToggleButton, ToggleButtonGroup } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { apiClient, isElectron } from '../../../api/apiClient';
import { reportError } from '../../../components/error/errorReporter';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';

type McpInfo = { running: boolean; port: number; serverPath: string; exePath: string; isPackaged: boolean };
type HostId = 'claude-desktop' | 'claude-code' | 'cursor' | 'vscode';
type HostCfg = { supported: boolean; path?: string; exists?: boolean; text?: string; hasEntry?: boolean; invalid?: boolean; subset?: boolean };

// Hosts whose config is a global JSON file MDP can read + write directly (Claude
// Code = user scope in ~/.claude.json). Claude Code / VS Code that aren't here stay
// copy-only.
const REGISTERABLE: HostId[] = ['claude-desktop', 'cursor', 'claude-code'];
const HOST_LABEL: Record<HostId, string> = { 'claude-desktop': 'Claude Desktop', 'claude-code': 'Claude Code', cursor: 'Cursor', vscode: 'VS Code (Claude)' };

const hostToggleSx = {
  textTransform: 'none', fontSize: '0.78rem', py: 0.4, color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-subtle)',
  '&.Mui-selected': { color: 'var(--app-accent-contrast, #fff)', bgcolor: 'var(--app-accent)' },
  '&.Mui-selected:hover': { bgcolor: 'color-mix(in srgb, var(--app-accent) 85%, black)' },
};

// The stdio proxy launch spec (same for every host): dev = plain node; packaged =
// the MDP executable running as node (the proxy file ships asar-unpacked).
const launchOf = (info: McpInfo) => info.isPackaged
  ? { command: info.exePath, args: [info.serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } as Record<string, string> }
  : { command: 'node', args: [info.serverPath], env: undefined as Record<string, string> | undefined };

function snippetFor(host: HostId, info: McpInfo): { text: string; hint: string } {
  const l = launchOf(info);
  const server = { command: l.command, args: l.args, ...(l.env ? { env: l.env } : {}) };
  switch (host) {
    case 'claude-desktop':
      return {
        text: JSON.stringify({ mcpServers: { mdp: server } }, null, 2),
        hint: 'Add to claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config), then restart Claude Desktop.',
      };
    case 'claude-code': {
      const envFlag = l.env ? Object.entries(l.env).map(([k, v]) => `--env ${k}=${v} `).join('') : '';
      return {
        text: `claude mcp add mdp ${envFlag}-- "${l.command}" "${l.args[0]}"`,
        hint: 'Run in a terminal. Add -s user after "add" to enable it for every project (default: the current project only).',
      };
    }
    case 'cursor':
      return {
        text: JSON.stringify({ mcpServers: { mdp: server } }, null, 2),
        hint: 'Save as ~/.cursor/mcp.json (global) or .cursor/mcp.json inside a project.',
      };
    case 'vscode':
      return {
        text: JSON.stringify({ mcpServers: { mdp: { type: 'stdio', ...server } } }, null, 2),
        hint: 'Save as .mcp.json in your workspace ROOT (for the Claude Code extension / CLI in VS Code). Reload the window / start a new Claude session and APPROVE the project MCP server when prompted. (Not VS Code / GitHub Copilot — that uses a different .vscode/mcp.json with a "servers" key and is not targeted here.)',
      };
  }
}

// Settings → MCP: opt-in switch for the local MCP control bridge, plus a
// ready-made Claude Desktop config snippet pointing at the stdio proxy
// (app/mcp-server.cjs). Everything runs on 127.0.0.1 with a per-session token.
export const McpSection: React.FC = () => {
  const { settings, update } = useAppSettings();
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [host, setHost] = useState<HostId>('claude-desktop');
  const [copied, setCopied] = useState(false);

  const [hostCfg, setHostCfg] = useState<HostCfg | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);

  // A user-picked config-file path for the current host overrides the platform
  // guess. Persisted per host in settings so it's remembered across sessions.
  const pathOverride = settings.mcpHostConfigPaths?.[host] || undefined;
  const setPathOverride = (p: string | undefined) => {
    const next = { ...(settings.mcpHostConfigPaths || {}) };
    if (p) next[host] = p; else delete next[host];
    update({ mcpHostConfigPaths: next });
  };

  const refresh = () => { apiClient.getMcpInfo().then(setInfo).catch(() => {}); };
  useEffect(() => { refresh(); }, []);
  // The bridge starts/stops asynchronously after the toggle — re-read shortly after.
  useEffect(() => { const t = setTimeout(refresh, 400); return () => clearTimeout(t); }, [settings.mcpEnabled]);

  // Load the host's current config file (registerable hosts only), from the
  // user-chosen path if set, else the platform default.
  const loadHostCfg = () => { apiClient.mcpGetHostConfig(host, pathOverride).then(setHostCfg).catch(() => setHostCfg(null)); };
  useEffect(() => {
    setRegistered(false);
    if (REGISTERABLE.includes(host)) loadHostCfg(); else setHostCfg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, pathOverride]);

  const chooseFile = async () => {
    try {
      const r = await apiClient.mcpPickHostConfig(host);
      if (!r.canceled && r.path) setPathOverride(r.path); // triggers reload via effect
      else if (r.error) reportError(r.error);
    } catch (e) { reportError('Could not open the file picker.', { detail: e }); }
  };

  const register = async () => {
    setRegistering(true);
    try {
      const r = await apiClient.mcpRegisterHost(host, pathOverride);
      if (r.success) { setRegistered(true); loadHostCfg(); setTimeout(() => setRegistered(false), 3000); }
      else reportError(r.error || 'Could not write the config file.');
    } finally { setRegistering(false); }
  };

  const snip = info ? snippetFor(host, info) : null;
  const registerable = REGISTERABLE.includes(host) && hostCfg?.supported;

  const copy = async () => {
    if (!snip) return;
    try { await navigator.clipboard.writeText(snip.text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* selectable below */ }
  };

  if (!isElectron()) {
    return (
      <div>
        <h2 className="settings-section-title">MCP (Claude Desktop)</h2>
        <p className="settings-section-desc">MCP integration is available in the desktop (Electron) app only.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="settings-section-title">MCP (Claude Desktop)</h2>
      <p className="settings-section-desc">
        Let an MCP host such as Claude Desktop author and inspect your slides: it can read the slide
        format and your modules/themes, read existing decks (to imitate your style), write and edit
        decks live in the editor, check each slide for overflow / sparseness, and render slides as
        images. Everything runs locally on 127.0.0.1 with a per-session token.
      </p>

      <div className="settings-field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={settings.mcpEnabled} onChange={(e) => update({ mcpEnabled: e.target.checked })} />
          <span style={{ color: 'var(--app-text-strong)', fontWeight: 600 }}>Enable MCP integration</span>
        </label>
        <div className="settings-field-hint">
          Status: {info?.running ? `running on 127.0.0.1:${info.port}` : 'stopped'}. While enabled, any local
          process that can read your user folder can control MDP through the bridge — leave this off if you
          don't use it.
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Connect a host</div>
        <div className="settings-field-hint">
          The same stdio server works with any MCP host. Pick yours; MDP must be running with MCP
          enabled (above) for the tools to work.
        </div>
        <ToggleButtonGroup exclusive size="small" value={host} onChange={(_, v) => v && setHost(v)} sx={{ mt: 0.5, mb: 1 }}>
          <ToggleButton value="claude-desktop" sx={hostToggleSx}>Claude Desktop</ToggleButton>
          <ToggleButton value="claude-code" sx={hostToggleSx}>Claude Code</ToggleButton>
          <ToggleButton value="cursor" sx={hostToggleSx}>Cursor</ToggleButton>
          <ToggleButton value="vscode" sx={hostToggleSx}>VS Code (Claude)</ToggleButton>
        </ToggleButtonGroup>

        {registerable ? (
          <>
            <div className="settings-field-hint">
              Config file: <code>{hostCfg!.path}</code> {pathOverride ? '(you chose this file)' : '(default location — guessed)'}
              {' — '}
              {!hostCfg!.exists
                ? 'not created yet; Register will create it.'
                : hostCfg!.invalid
                  ? '⚠ this file is not valid JSON — fix it manually first.'
                  : hostCfg!.hasEntry
                    ? 'MDP is already registered here; Register overwrites that entry (other servers are kept).'
                    : 'MDP is not registered yet.'}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 6px' }}>
              <Button variant="text" size="small" onClick={chooseFile}
                sx={{ textTransform: 'none', color: 'var(--app-text-secondary)' }}>
                Choose config file…
              </Button>
              {pathOverride && (
                <Button variant="text" size="small" onClick={() => setPathOverride(undefined)}
                  sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>
                  Use default location
                </Button>
              )}
            </div>
            <div className="settings-field-hint" style={{ marginTop: 0 }}>
              If the path above isn't where your {HOST_LABEL[host]} config actually lives, click <b>Choose config
              file…</b> and pick it yourself (in {HOST_LABEL[host]}, open Settings → Developer → Edit Config to
              locate it). MDP will read and register into the file you pick.
            </div>
            {hostCfg!.subset && (
              <div className="settings-field-hint">
                Showing only the <code>mcpServers</code> section — the rest of this file (your Claude Code
                history and login) is left untouched, and a <code>.mdp-backup</code> copy is saved before writing.
              </div>
            )}
            {hostCfg!.exists && !hostCfg!.invalid && (
              <pre className="settings-about-pre" style={{ whiteSpace: 'pre-wrap', maxHeight: 220 }}>{hostCfg!.text}</pre>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                variant="contained" size="small"
                startIcon={registered ? <CheckCircleOutlineIcon /> : undefined}
                onClick={register}
                disabled={registering || (hostCfg!.exists && hostCfg!.invalid)}
                sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}
              >
                {registered ? 'Registered' : registering ? 'Writing…' : hostCfg!.hasEntry ? 'Re-register (overwrite)' : 'Register'}
              </Button>
              <Button variant="text" size="small" startIcon={<ContentCopyIcon />} onClick={copy} disabled={!snip}
                sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>
                {copied ? 'Copied!' : 'Copy snippet instead'}
              </Button>
            </div>
            <div className="settings-field-hint" style={{ marginTop: 6 }}>
              {host === 'claude-code'
                ? 'Start a new Claude Code session to load MDP (verify with: claude mcp list).'
                : `Restart ${HOST_LABEL[host]} after registering to load MDP.`}
            </div>
          </>
        ) : (
          <>
            <div className="settings-field-hint">{snip?.hint || ''}</div>
            <pre className="settings-about-pre" style={{ whiteSpace: 'pre-wrap', maxHeight: 220 }}>{snip?.text || 'Loading…'}</pre>
            <Button variant="outlined" size="small" startIcon={<ContentCopyIcon />} onClick={copy} disabled={!snip}
              sx={{ textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </>
        )}
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Creating modules / themes / effects</div>
        <div className="settings-field-hint">
          An AI can author new workspace assets (write_asset). A module can carry a <code>&lt;script&gt;</code>
          that runs inside MDP, so by default MDP asks you to review each one before saving.
        </div>
        <ToggleButtonGroup
          exclusive size="small" sx={{ mt: 0.5 }}
          value={settings.mcpAssetWrite}
          onChange={(_, v) => v && update({ mcpAssetWrite: v })}
        >
          <ToggleButton value="confirm" sx={hostToggleSx}>Ask me to confirm</ToggleButton>
          <ToggleButton value="auto" sx={hostToggleSx}>Allow automatically</ToggleButton>
        </ToggleButtonGroup>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Available tools</div>
        <div className="settings-field-hint">
          get_slide_spec (format + module/effect indexes) · get_module_spec / get_effect_spec (full spec for chosen ones) · find_modules · suggest_modules / suggest_effects (recommend by content/mood) · list_decks / read_deck (also for style imitation) ·
          write_deck / append_slide / replace_slide (edits open decks live, unsaved) · list_modules / read_module ·
          list_themes · get_active_deck / open_deck / goto_slide / insert_at_cursor ·
          measure_slides (overflow &amp; fill check, low token) · lint_deck (design/consistency advisories) · render_slide_image (visual check, higher token).
        </div>
      </div>
    </div>
  );
};
