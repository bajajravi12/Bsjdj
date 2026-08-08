// Avatar Utility: Generates initial-letter avatars with consistent deterministic colors

const AVATAR_COLORS = [
  '#059669', // Emerald
  '#2563eb', // Blue
  '#7c3aed', // Purple
  '#db2777', // Pink
  '#d97706', // Amber
  '#0891b2', // Cyan
  '#0d9488', // Teal
  '#4f46e5', // Indigo
  '#ea580c', // Orange
  '#65a30d', // Lime
  '#0284c7', // Sky
  '#c026d3', // Fuchsia
];

export function getInitials(name: string): string {
  if (!name || !name.trim()) return 'U';
  const cleanName = name.trim();
  const parts = cleanName.split(/\s+/);
  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }
  const firstInitial = parts[0][0] || '';
  const lastInitial = parts[parts.length - 1][0] || '';
  return (firstInitial + lastInitial).toUpperCase();
}

export function getAvatarColor(key: string): string {
  if (!key) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function generateInitialsAvatarSvg(name: string, keyForColor?: string): string {
  const initials = getInitials(name);
  const color = getAvatarColor(keyForColor || name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="100%" height="100%" rx="64" fill="${color}"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="52" fill="#ffffff">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function isPlaceholderAvatar(avatarUrl?: string): boolean {
  if (!avatarUrl || !avatarUrl.trim()) return true;
  if (
    avatarUrl.includes('images.unsplash.com') ||
    avatarUrl.includes('photo-1534528741775-53994a69daeb') ||
    avatarUrl.includes('photo-1494790108377') ||
    avatarUrl.includes('photo-1507003211169') ||
    avatarUrl.includes('photo-1517841905240') ||
    avatarUrl.includes('photo-1500648767791')
  ) {
    return true;
  }
  return false;
}

export function getDisplayAvatar(name: string, avatarUrl?: string, userKey?: string): string {
  if (avatarUrl && !isPlaceholderAvatar(avatarUrl)) {
    return avatarUrl;
  }
  return generateInitialsAvatarSvg(name, userKey || name);
}
