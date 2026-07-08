import React from 'react';

// A resettable React error boundary. Any throw during the render of its children is
// caught and shown as an inline fallback INSTEAD of unmounting the whole app (which
// is what produced the dreaded blank white screen on a stray `---` / bad directive).
//
// `resetKeys` lets the boundary self-heal: when any value in the array changes (e.g.
// the edited markdown), the error state clears and the children are re-rendered — so
// as soon as the user fixes the typo, the preview comes back on its own.

interface Props {
  children: React.ReactNode;
  // Human label for what failed, shown in the fallback (e.g. "Slide preview").
  label?: string;
  // Re-render the children (clear the error) whenever any of these change.
  resetKeys?: unknown[];
  // Optional custom fallback; receives the error and a manual reset callback.
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  // Called once when an error is caught (for logging / telemetry).
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State { error: Error | null }

const arraysDiffer = (a?: unknown[], b?: unknown[]): boolean => {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
  return false;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Never let logging itself throw.
    try {
      console.error(`[MDP] ${this.props.label || 'UI'} error:`, error, info?.componentStack);
      this.props.onError?.(error, info);
    } catch { /* ignore */ }
  }

  componentDidUpdate(prev: Props) {
    // Self-heal: when the reset keys change (e.g. the markdown was edited), drop the
    // error so the children get another chance to render.
    if (this.state.error && arraysDiffer(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        style={{
          margin: 16, padding: '16px 18px', borderRadius: 8,
          border: '1px solid var(--app-danger, #f04747)',
          background: 'color-mix(in srgb, var(--app-danger, #f04747) 10%, transparent)',
          color: 'var(--app-text, #eee)', font: '13px/1.6 system-ui, sans-serif',
          maxWidth: 640,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          {this.props.label || 'Something'} couldn’t be displayed
        </div>
        <div style={{ opacity: 0.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </div>
        <div style={{ opacity: 0.7, marginTop: 8, fontSize: 12 }}>
          Check the markup around this point — editing usually recovers automatically.
        </div>
        <button
          type="button"
          onClick={this.reset}
          style={{
            marginTop: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--app-border-strong, #444)',
            background: 'var(--app-bg-elevated, #2d2d2d)', color: 'var(--app-text, #eee)',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
