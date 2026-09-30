import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import type { WorkspaceFont, MdpFontDefaults, FontRequirement, FontRequirementStatus } from './fontTypes';
import { buildFontFaceCss, buildFontDefaultsCss, cssSignature } from './fontCss';
import { applyFontCss, fontFileUrl, isFontInstalledLocally, setFontState } from './fontRuntime';
import { mergeRequirements, requirementStatuses } from './fontRequirements';

// The active deck's workspace fonts: every package in its `.mdp` chain (nearest
// wins) turned into @font-face rules, plus the folder's default-font variables.
// Applied to THIS document and published (fontRuntime) for the other surfaces.
// Also the fonts the chain DECLARES (requirements.json) and where each stands on
// this computer. Re-fetched when the tree or the scope changes, like the theme list.
export function useWorkspaceFonts(scopeDirs: string[], fileTree: unknown, defaults: MdpFontDefaults) {
  const [fonts, setFonts] = useState<WorkspaceFont[]>([]);
  const [declared, setDeclared] = useState<{ scope: string; fonts: FontRequirement[]; errors: { path: string; error: string }[] }>(
    { scope: '', fonts: [], errors: [] },
  );
  const listKeyRef = useRef('');
  const declaredKeyRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    const scope = scopeDirs.join('\n');
    apiClient.getFonts(scopeDirs)
      .then((list) => {
        if (cancelled || !Array.isArray(list)) return;
        // A tree refresh usually returns the same packages — keep the old array so
        // nothing downstream (CSS, the slide re-parse) churns.
        const key = JSON.stringify(list.map((f) => [f.family, f.category, f.faces.map((x) => [x.path, x.version, x.weight, x.style, x.unicodeRange])]));
        if (key === listKeyRef.current) return;
        listKeyRef.current = key;
        setFonts(list);
      })
      .catch((e) => console.error('Failed to load workspace fonts', e));
    apiClient.getFontRequirements(scopeDirs)
      .then((files) => {
        if (cancelled || !Array.isArray(files)) return;
        const merged = mergeRequirements(files);
        const key = `${scope}\n${JSON.stringify(merged)}`;
        if (key === declaredKeyRef.current) return;
        declaredKeyRef.current = key;
        setDeclared({ scope, ...merged });
      })
      .catch((e) => console.error('Failed to load font requirements', e));
    return () => { cancelled = true; };
  }, [scopeDirs, fileTree]);

  const { body = '', heading = '', mono = '' } = defaults;
  const fontCss = useMemo(
    () => [buildFontFaceCss(fonts, fontFileUrl), buildFontDefaultsCss({ body, heading, mono }, fonts, declared.fonts)]
      .filter(Boolean).join('\n'),
    [fonts, body, heading, mono, declared.fonts],
  );

  useEffect(() => {
    applyFontCss(document, fontCss);
    setFontState(fontCss);
  }, [fontCss]);

  // Declared fonts vs. what is here: a `.mdp` package, the OS, or nothing.
  const requirements: FontRequirementStatus[] = useMemo(
    () => requirementStatuses(declared.fonts, fonts, (family) => isFontInstalledLocally(family)),
    [declared.fonts, fonts],
  );

  return {
    fonts,
    fontCss,
    fontSignature: useMemo(() => cssSignature(fontCss), [fontCss]),
    requirements,
    requirementErrors: declared.errors,
    // The scope the declarations were read for (they arrive after a scope change).
    requirementsScope: declared.scope,
  };
}
