export type Severity = 'error' | 'warning' | 'success' | 'info';

export interface AppNotification {
  id: number;
  severity: Severity;
  title: string;
  message: string;
  detail?: string;
}

export const NOTIFY_EVENT = 'mdp-notify';
export const CONFIRM_EVENT = 'mdp-confirm';
export const CHOICE_EVENT = 'mdp-choice';

let counter = 0;

export interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  severity: 'warning' | 'info';
}

const confirmResolvers = new Map<number, (result: boolean) => void>();

export function confirmDialog(
  message: string,
  options?: { title?: string; confirmText?: string; cancelText?: string; severity?: 'warning' | 'info' },
): Promise<boolean> {
  const id = ++counter;
  const request: ConfirmRequest = {
    id,
    title: options?.title ?? 'Confirm',
    message,
    confirmText: options?.confirmText ?? 'OK',
    cancelText: options?.cancelText ?? 'Cancel',
    severity: options?.severity ?? 'info',
  };
  return new Promise((resolve) => {
    confirmResolvers.set(id, resolve);
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: request }));
  });
}

export function resolveConfirm(id: number, result: boolean) {
  const resolver = confirmResolvers.get(id);
  if (resolver) {
    confirmResolvers.delete(id);
    resolver(result);
  }
}

export interface ChoiceOption {
  value: string;
  label: string;
  variant?: 'text' | 'outlined' | 'contained';
  color?: 'inherit' | 'primary' | 'error' | 'warning' | 'success';
}

export interface ChoiceRequest {
  id: number;
  title: string;
  message: string;
  severity: 'warning' | 'info';
  options: ChoiceOption[];
}

const choiceResolvers = new Map<number, (value: string | null) => void>();

export function choiceDialog(
  message: string,
  options: { title?: string; severity?: 'warning' | 'info'; options: ChoiceOption[] },
): Promise<string | null> {
  const id = ++counter;
  const request: ChoiceRequest = {
    id,
    title: options.title ?? 'Confirm',
    message,
    severity: options.severity ?? 'info',
    options: options.options,
  };
  return new Promise((resolve) => {
    choiceResolvers.set(id, resolve);
    window.dispatchEvent(new CustomEvent(CHOICE_EVENT, { detail: request }));
  });
}

export function resolveChoice(id: number, value: string | null) {
  const resolver = choiceResolvers.get(id);
  if (resolver) {
    choiceResolvers.delete(id);
    resolver(value);
  }
}

export function formatDetail(detail: unknown): string | undefined {
  if (detail === null || detail === undefined) return undefined;
  if (detail instanceof Error) {
    return `${detail.name}: ${detail.message}${detail.stack ? `\n\n${detail.stack}` : ''}`;
  }
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function dispatch(n: Omit<AppNotification, 'id'>) {
  const detail: AppNotification = { id: ++counter, ...n };
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail }));
}

export function reportError(
  message: string,
  options?: { detail?: unknown; title?: string; severity?: 'error' | 'warning' },
) {
  const severity = options?.severity ?? 'error';
  dispatch({
    severity,
    title: options?.title ?? (severity === 'warning' ? 'Warning' : 'Error'),
    message,
    detail: formatDetail(options?.detail),
  });
}

export function notify(
  message: string,
  options?: { title?: string; severity?: 'success' | 'info' },
) {
  dispatch({
    severity: options?.severity ?? 'success',
    title: options?.title ?? '',
    message,
  });
}
