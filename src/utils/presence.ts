// Presence Utility: Formats online status and last seen timestamps
import { parseUtcDate } from './date';

export function formatLastSeen(status?: string, lastSeen?: string | number): {
  text: string;
  isOnline: boolean;
} {
  if (status === 'online') {
    return { text: 'Online', isOnline: true };
  }

  if (!lastSeen) {
    return { text: 'Offline', isOnline: false };
  }

  if (typeof lastSeen === 'string' && (lastSeen.toLowerCase() === 'just now' || lastSeen === 'Just now')) {
    return { text: 'Last seen just now', isOnline: false };
  }

  const date = parseUtcDate(lastSeen);
  if (!date) {
    return {
      text: typeof lastSeen === 'string' ? (lastSeen.startsWith('Last seen') ? lastSeen : `Last seen ${lastSeen}`) : 'Offline',
      isOnline: false,
    };
  }

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  if (diffSecs < 60) {
    return { text: 'Last seen just now', isOnline: false };
  }

  if (diffMins < 60) {
    return {
      text: diffMins === 1 ? 'Last seen 1 minute ago' : `Last seen ${diffMins} minutes ago`,
      isOnline: false,
    };
  }

  const isSameDay =
    now.getDate() === date.getDate() &&
    now.getMonth() === date.getMonth() &&
    now.getFullYear() === date.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

  if (isSameDay) {
    return {
      text: `Last seen today at ${timeStr}`,
      isOnline: false,
    };
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getDate() === date.getDate() &&
    yesterday.getMonth() === date.getMonth() &&
    yesterday.getFullYear() === date.getFullYear();

  if (isYesterday) {
    return { text: `Last seen yesterday at ${timeStr}`, isOnline: false };
  }

  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return { text: `Last seen ${dateStr} at ${timeStr}`, isOnline: false };
}
