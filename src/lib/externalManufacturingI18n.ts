import type { TFunction } from 'i18next';
import arExternalJobs from '../locales/ar/externalJobs.json';

// The existing API sends Arabic messages. Map known lifecycle messages to stable
// translation keys without changing its contract or translating user-entered notes.
const messageKeys = new Map(Object.entries(arExternalJobs)
  .filter(([key]) => key.startsWith('lifecycle.errors.'))
  .map(([key, message]) => [message, key]));

export function manufacturingError(error: unknown, t: TFunction<'externalJobs'>): string {
  const message = error instanceof Error ? error.message : '';
  const key = messageKeys.get(message);
  if (key) return t(key);
  return message && !/[\u0600-\u06ff]/.test(message) ? message : t('lifecycle.requestFailed');
}

export function translateManufacturingMessage(message: string, t: TFunction<'externalJobs'>): string {
  const key = messageKeys.get(message);
  return key ? t(key) : message;
}
