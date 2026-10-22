// The one API client for the panel. Requests go to /api/*, which next.config.ts rewrites to the
// backend, so the browser never calls the API cross-origin.
import { createApiClient } from '@eventseva/app-shared';
import { createSessionStore } from './session';

export const sessionStore = createSessionStore(() => (typeof window === 'undefined' ? null : window.sessionStorage));

/** Full page load to the login screen, so no state from the old session survives. */
export function goToLogin(reason?: 'expired') {
  if (typeof window === 'undefined') return;
  const here = window.location.pathname + window.location.search;
  const params = new URLSearchParams();
  if (reason) params.set('reason', reason);
  if (here !== '/' && !here.startsWith('/login')) params.set('next', here);
  const query = params.toString();
  window.location.replace(`/login${query ? `?${query}` : ''}`);
}

export const api = createApiClient({
  baseUrl: '/api',
  tokens: sessionStore.tokens,
  // Admin tokens are never refreshed: a 401 clears the session and this sends the admin to login.
  canRefresh: false,
  onSessionEnded: () => goToLogin('expired'),
});

/** Ends the token on the server too (best effort), so a copied token stops working. */
export async function logout() {
  await api.post('/v1/admin/logout').catch(() => undefined);
  sessionStore.clear();
  if (typeof window !== 'undefined') window.location.replace('/login');
}

export const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || null;
