export type UserStatus = 'online' | 'offline' | 'away' | 'typing';

export interface User {
  id: string;
  name: string;
  username: string;
  avatar: string;
  status: UserStatus;
  lastSeen?: string;
  bio?: string;
  isVerified?: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  users: string[]; // user ids
}

export interface Message {
  id: string;
  clientMsgId?: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isoDate: string;
  createdAt?: string;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  isSecret?: boolean;
  selfDestructSeconds?: number;
  expiresAt?: number; // Epoch ms when message vanishes
  mediaUrl?: string;
  mediaType?: 'image' | 'voice' | 'file' | 'location';
  fileName?: string;
  fileSize?: string;
  voiceDuration?: number; // seconds
  replyToId?: string;
  replyToText?: string;
  reactions?: Reaction[];
  isEdited?: boolean;
  isPinned?: boolean;
  isEncrypted: boolean;
}

export interface Chat {
  id: string;
  name: string;
  avatar: string;
  isGroup: boolean;
  isSecret: boolean;
  unreadCount: number;
  pinned: boolean;
  pinnedMessageId?: string;
  lastMessage?: Message;
  members: User[];
  isTyping?: boolean;
  typingText?: string;
  selfDestructTimer?: number; // in seconds (0 = off)
  encryptionFingerprint: string;
  onlineCount?: number;
}

export interface AppSettings {
  theme: 'dark' | 'midnight' | 'emerald';
  wallpaper: 'default' | 'gradient' | 'navy' | 'vault';
  fontSize: 'small' | 'medium' | 'large';
  notifications: boolean;
}

export interface CallState {
  active: boolean;
  chatId: string | null;
  contactName: string;
  contactAvatar: string;
  type: 'audio' | 'video';
  status: 'calling' | 'connected' | 'ended';
  isMuted: boolean;
  isVideoOff: boolean;
  durationSeconds: number;
}
