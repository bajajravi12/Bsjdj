import { Chat, User, Message } from '../types';

export const emptyUser: User = {
  id: '',
  name: '',
  username: '',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
  status: 'offline',
  bio: '',
  isVerified: false,
};

export const sampleUsers: User[] = [];

export const initialChats: Chat[] = [];

export const initialMessagesMap: Record<string, Message[]> = {};
