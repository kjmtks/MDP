import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import { apiClient } from '../../../api/apiClient';
import { loadedModules, isModuleDisabled } from '../../../features/modules/moduleManager';
import { loadedEffects } from '../../../features/effects/effectManager';
import { buildSlideSpecPrompt } from '../../../features/ai/slideSpecPrompt';
import type { ThemeOption } from '../../../types';

// Settings → "AI prompt": assemble ONE English prompt (built-in slide format spec
// + every installed theme / animation effect / module describing itself) for
// pasting into a generative AI so it can author `.slide.md` files. Copy or
// download; the preview shows exactly what will be handed over.
export const AiSpecSection: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    // The prompt reflects the ACTIVE deck's `.mdp` scope: modules/effects are the
    // scope-loaded live registries (minus disabled ones), and themes are fetched for
    // the same scope (published by the editor).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopeDirs = (window as any).__mdpScopeDirs as string[] | undefined;
    let themes: ThemeOption[] = [];
    try { themes = await apiClient.getThemes(scopeDirs); } catch { /* themes optional */ }
    const modules = Object.values(loadedModules).map((m) => m.config).filter((c) => !isModuleDisabled(c.name));
    const effects = Object.values(loadedEffects).map((e) => e.config);
    setPrompt(buildSlideSpecPrompt(modules, { effects, themes }));
    setCopied(false);
  }, []);

  // Build once on open (modules/effects are already loaded in the editor session).
  useEffect(() => { generate(); }, [generate]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the user can still select the preview */ }
  };

  const download = () => {
    const blob = new Blob([prompt], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mdp-slide-spec.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const moduleCount = Object.keys(loadedModules).filter((n) => !isModuleDisabled(n)).length;
  const effectCount = Object.keys(loadedEffects).length;

  return (
    <div>
      <h2 className="settings-section-title">AI prompt</h2>
      <p className="settings-section-desc">
        A single English prompt that teaches a generative AI how to write MDP
        slides — the built-in slide format plus every installed theme, animation
        effect, and module (each describing itself). Copy it and paste it before
        your request to the AI.
      </p>

      <div className="settings-field" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained" size="small" startIcon={<ContentCopyIcon />} onClick={copy}
          sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)', '&:hover': { bgcolor: 'var(--app-accent)' } }}
        >
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </Button>
        <Button
          variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={download}
          sx={{ textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}
        >
          Download .md
        </Button>
        <Button
          variant="text" size="small" startIcon={<RefreshIcon />} onClick={generate}
          sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}
        >
          Regenerate
        </Button>
        <span style={{ color: 'var(--app-text-disabled)', fontSize: '0.8rem' }}>
          {moduleCount} module{moduleCount === 1 ? '' : 's'}, {effectCount} effect{effectCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Preview</div>
        <pre className="settings-about-pre" style={{ maxHeight: 460, whiteSpace: 'pre-wrap' }}>{prompt || 'Generating…'}</pre>
      </div>
    </div>
  );
};
