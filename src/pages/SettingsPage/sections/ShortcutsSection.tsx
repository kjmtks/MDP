import React, { useState } from 'react';
import { Chip, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';
import { ACTIONS, ACTIONS_BY_SCOPE, SCOPE_LABELS, type ShortcutScope, type ActionDef } from '../../../features/settings/shortcuts/registry';
import { resolveKeys, findConflicts, prettyCombo } from '../../../features/settings/shortcuts/matcher';
import { ShortcutCapture } from '../ShortcutCapture';

const SCOPES: ShortcutScope[] = ['global', 'editor', 'slideshow', 'presenter', 'manipulation'];

export const ShortcutsSection: React.FC = () => {
  const { settings, update, resetShortcut } = useAppSettings();
  const [capture, setCapture] = useState<string | null>(null);
  const conflicts = findConflicts(settings);

  const setKeys = (a: ActionDef, keys: string[]) =>
    update({ shortcuts: { ...settings.shortcuts, [a.id]: keys } });

  const addCombo = (a: ActionDef, combo: string) => {
    const cur = resolveKeys(a, settings);
    if (!cur.includes(combo)) setKeys(a, [...cur, combo]);
  };
  const removeCombo = (a: ActionDef, combo: string) => {
    const cur = resolveKeys(a, settings).filter((c) => c !== combo);
    if (cur.length === 0) resetShortcut(a.id); // emptying reverts to default
    else setKeys(a, cur);
  };

  return (
    <div>
      <h2 className="settings-section-title">Shortcuts</h2>
      <p className="settings-section-desc">Rebind keyboard shortcuts. Saved per workspace. A combo bound to two actions in the same group is highlighted.</p>

      {SCOPES.map((scope) => (
        <div key={scope} className="settings-field">
          <div className="settings-field-label">{SCOPE_LABELS[scope]}</div>
          <table className="shortcut-table">
            <tbody>
              {ACTIONS_BY_SCOPE[scope].map((a) => {
                const keys = resolveKeys(a, settings);
                const overridden = !!settings.shortcuts[a.id];
                return (
                  <tr key={a.id}>
                    <td className="shortcut-label">{a.label}</td>
                    <td className="shortcut-keys">
                      {a.immutable ? (
                        <span className="shortcut-fixed">{a.defaultKeys.join(' ')} (fixed)</span>
                      ) : (
                        keys.map((k) => {
                          const conflict = (conflicts.get(`${scope}::${k}`)?.length ?? 0) > 1;
                          return (
                            <Chip
                              key={k}
                              size="small"
                              label={prettyCombo(k)}
                              color={conflict ? 'warning' : undefined}
                              variant={conflict ? 'filled' : 'outlined'}
                              onDelete={keys.length <= 1 ? undefined : () => removeCombo(a, k)}
                              sx={{ mr: 0.5, mb: 0.5, color: conflict ? undefined : 'var(--app-text)', borderColor: 'var(--app-border-strong)' }}
                            />
                          );
                        })
                      )}
                    </td>
                    <td className="shortcut-actions">
                      {!a.immutable && (
                        <>
                          <Tooltip title="Add binding">
                            <IconButton size="small" onClick={() => setCapture(a.id)} sx={{ color: 'var(--app-text-muted)' }}><AddIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          {overridden && (
                            <Tooltip title="Reset to default">
                              <IconButton size="small" onClick={() => resetShortcut(a.id)} sx={{ color: 'var(--app-text-muted)' }}><RestartAltIcon fontSize="small" /></IconButton>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <ShortcutCapture
        open={!!capture}
        onCancel={() => setCapture(null)}
        onCapture={(combo) => {
          const a = ACTIONS.find((x) => x.id === capture);
          if (a) addCombo(a, combo);
          setCapture(null);
        }}
      />
    </div>
  );
};
