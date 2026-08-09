// Date & Time Utility for AARVI Messenger
// Ensures UTC storage on server and local timezone formatting on client

export function parseUtcDate(dateStr?: string | number | null): Date | null {
  if (!dateStr) return null;
  if (typeof dateStr === 'number') return new Date(dateStr);
  let str = String(dateStr).trim();
  if (!str) return null;

  // If numeric timestamp string e.g. "1786126735000"
  if (/^\d{10,13}$/.test(str)) {
    return new Date(Number(str));
  }

  // If SQL datetime "YYYY-MM-DD HH:MM:SS" without T/Z
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(str)) {
    str = str.replace(' ', 'T') + 'Z';
  }

  // If ISO string without timezone offset (e.g. "2026-08-08T18:18:55")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
    str += 'Z';
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function formatMessageTime(isoDate?: string, rawTimestamp?: string, createdAt?: string): string {
  const dateVal = isoDate || createdAt || rawTimestamp;
  if (dateVal) {
    const d = parseUtcDate(dateVal);
    if (d) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  }

  if (rawTimestamp && /^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(rawTimestamp.trim())) {
    return rawTimestamp.trim();
  }

  return '';
}

export function formatFullDateTime(isoDate?: string): string {
  if (!isoDate) return new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const d = parseUtcDate(isoDate);
  if (!d) return isoDate;
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

