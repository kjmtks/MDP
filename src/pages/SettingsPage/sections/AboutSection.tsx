import React, { useEffect, useState } from 'react';
import { apiClient } from '../../../api/apiClient';
import licensesText from '../../../../public/ThirdPartyNotices.txt?raw';
import mdpIcon from '../../../assets/icon-filled.svg';

export const AboutSection: React.FC = () => {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiClient.getAppVersion().then((v) => { if (!cancelled) setVersion(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <h2 className="settings-section-title">About</h2>
      <p className="settings-section-desc">Version information and third-party licenses.</p>

      <div className="settings-field" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src={mdpIcon} alt="MDP" style={{ width: 44, height: 44 }} />
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: 1 }}>MDP</div>
          <div style={{ color: 'var(--app-text-muted)', fontSize: '0.85rem' }}>
            Version {version || '…'}
          </div>
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Third-party licenses</div>
        <pre className="settings-about-pre">{licensesText || 'Cannot find license information.'}</pre>
      </div>
    </div>
  );
};
