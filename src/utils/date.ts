// Date & Time Utility for AARVI Messenger
// Ensures UTC storage on server and local timezone formatting on client

export function formatMessageTime(isoDate?: string, rawTimestamp?: string): string {
  if (isoDate) {
    const d = new Date(isoDate);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  }

  if (rawTimestamp) {
    const d = new Date(rawTimestamp);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(rawTimestamp.trim())) {
      return rawTimestamp.trim();
    }
  }

  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatFullDateTime(isoDate?: string): string {
  if (!isoDate) return new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
