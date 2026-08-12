// Native Browser Notification & Service Worker Manager for AARVI

let swRegistration: ServiceWorkerRegistration | null = null;

// Load notified message IDs from sessionStorage to maintain duplicate prevention across tab reloads
const initialNotifiedIds: string[] = (() => {
  if (typeof window === 'undefined') return [];
  try {
    const saved = sessionStorage.getItem('aarvi_notified_msg_ids');
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
})();

const notifiedMessageIds = new Set<string>(initialNotifiedIds);

function persistNotifiedIds() {
  if (typeof window === 'undefined') return;
  try {
    const arr = Array.from(notifiedMessageIds).slice(-500);
    sessionStorage.setItem('aarvi_notified_msg_ids', JSON.stringify(arr));
  } catch {}
}

export function markMessageAsNotified(messageId: string) {
  if (messageId) {
    notifiedMessageIds.add(messageId);
    persistNotifiedIds();
  }
}

export function isMessageNotified(messageId: string): boolean {
  return Boolean(messageId && notifiedMessageIds.has(messageId));
}

// Seed initial historic message IDs so loading chat history doesn't trigger alerts
export function seedHistoricMessageIds(messageIds: string[]) {
  if (!messageIds || !Array.isArray(messageIds)) return;
  messageIds.forEach((id) => {
    if (id) notifiedMessageIds.add(id);
  });
  persistNotifiedIds();
}

// Convert VAPID base64url public key to Uint8Array for PushManager
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Register Service Worker for PWA and background notifications
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    swRegistration = reg;
    console.log('[AARVI] Service Worker registered:', reg.scope);
    return reg;
  } catch (err) {
    console.warn('[AARVI] Service Worker registration failed:', err);
    return null;
  }
}

export function getSWRegistration(): ServiceWorkerRegistration | null {
  return swRegistration;
}

// Subscribe user browser to PushManager using VAPID keys and persist subscription on server
export async function subscribePushManager(authToken?: string): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[AARVI Push] PushManager is not supported in this browser environment.');
    return null;
  }

  // Only proceed if permission is already granted; do not prompt unprompted
  if (Notification.permission !== 'granted') {
    return null;
  }

  try {
    let reg = swRegistration;
    if (!reg) {
      reg = await registerServiceWorker();
    }
    if (!reg && 'serviceWorker' in navigator) {
      reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
    }
    if (!reg) {
      console.warn('[AARVI Push] Service worker registration not available.');
      return null;
    }

    // 1. Fetch VAPID public key from backend
    let vapidPublicKey = '';
    try {
      const res = await fetch('/api/push/vapid-key');
      if (res.ok) {
        const data = await res.json();
        vapidPublicKey = data.publicKey;
      }
    } catch (e) {
      console.warn('[AARVI Push] Failed to fetch VAPID key from backend, using fallback:', e);
    }

    if (!vapidPublicKey) {
      vapidPublicKey = 'BI_i_mvWL_HWGZ4dk-hodyqyi7bi5hR4hVIaHQDb3ZbEyE2oE2PVeAYy61D1F23EpOwGi-mzJk8sBbptgdB3dJQ';
    }

    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    // 2. Check existing subscription or create new
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      console.log('[AARVI Push] Created new PushSubscription:', subscription.endpoint);
    } else {
      console.log('[AARVI Push] Existing PushSubscription found:', subscription.endpoint);
    }

    // 3. Persist subscription on backend
    const token = authToken || localStorage.getItem('aarvi_token') || sessionStorage.getItem('aarvi_token');
    if (token && subscription) {
      const subJson = subscription.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ subscription: subJson }),
      }).then((r) => r.json()).then((data) => {
        console.log('[AARVI Push] Saved push subscription on backend:', data);
      }).catch((err) => {
        console.error('[AARVI Push] Failed to persist subscription on backend:', err);
      });
    }

    return subscription;
  } catch (err) {
    console.error('[AARVI Push] Error subscribing to PushManager:', err);
    return null;
  }
}

// Get current native notification permission
export function getNotificationPermissionStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

// Request Notification Permission from Browser via User Interaction and Subscribe to Web Push
export async function requestNotificationPermission(authToken?: string): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showNativeNotification('AARVI Messenger', {
        body: 'System notifications enabled! You will be notified when new messages arrive.',
        tag: 'aarvi-permission-granted',
      });
      // Subscribe to PushManager
      subscribePushManager(authToken).catch(() => {});
    }
    return permission;
  } catch (err) {
    console.error('[AARVI] Request notification permission error:', err);
    return Notification.permission;
  }
}

export interface ShowNotificationOptions {
  body: string;
  senderName?: string;
  avatarUrl?: string;
  chatId?: string;
  messageId?: string;
  tag?: string;
}

// Show Native Browser System Notification (Works on Desktop, Mobile Chrome, and PWA)
export async function showNativeNotification(title: string, options: ShowNotificationOptions): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  // Prevent duplicate notifications for the same message ID
  if (options.messageId) {
    if (notifiedMessageIds.has(options.messageId)) {
      return false;
    }
    notifiedMessageIds.add(options.messageId);
    persistNotifiedIds();
  }

  const notificationTag = options.tag || (options.chatId ? `aarvi-chat-${options.chatId}` : 'aarvi-msg');
  const icon = options.avatarUrl || '/icon.png';

  const notificationOptions: any = {
    body: options.body,
    icon,
    badge: icon,
    tag: notificationTag,
    data: {
      chatId: options.chatId,
      messageId: options.messageId,
    },
    vibrate: [100, 50, 100],
  };

  // 1. Prefer Service Worker showNotification (Required for Android Chrome & PWA background)
  try {
    let reg = swRegistration;
    if (!reg && 'serviceWorker' in navigator) {
      reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
    }
    if (!reg && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.getRegistration('/');
    }

    if (reg && reg.showNotification) {
      await reg.showNotification(title, notificationOptions);
      return true;
    }
  } catch (swErr) {
    console.warn('[AARVI] ServiceWorker showNotification failed, attempting fallback:', swErr);
  }

  // 2. Fallback to standard Notification constructor (Desktop Chrome only)
  try {
    const notif = new Notification(title, notificationOptions);
    notif.onclick = () => {
      try {
        window.focus();
      } catch {}
      if (options.chatId && typeof window !== 'undefined' && (window as any).__aarvi_openChat) {
        (window as any).__aarvi_openChat(options.chatId);
      }
    };
    return true;
  } catch (notifErr) {
    console.warn('[AARVI] Notification constructor fallback failed:', notifErr);
    return false;
  }
}


