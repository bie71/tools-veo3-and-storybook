// Lightweight GA4 event wrapper
export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

function isDebug(): boolean {
  const env = (import.meta as any).env || {};
  try {
    const host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return true;
  } catch {}
  return env?.VITE_GA_DEBUG === '1';
}

function logIfEnabled(kind: 'event' | 'page_view', name: string, params: AnalyticsParams) {
  const env = (import.meta as any).env || {};
  if (env?.VITE_SHOW_ANALYTICS_LOG === '1') {
    // eslint-disable-next-line no-console
    console.debug(`[GA ${kind}]`, name, params);
  }
}

export function trackEvent(eventName: string, params?: AnalyticsParams) {
  try {
    const gtag = (window as any).gtag as undefined | ((...args: any[]) => void);
    if (!gtag) return;
    const payload = { ...(params || {}) } as AnalyticsParams;
    if (isDebug()) (payload as any).debug_mode = true;
    logIfEnabled('event', eventName, payload);
    gtag('event', eventName, payload);
  } catch {}
}

export function trackPageView(path: string, title?: string, tabOrGroup?: string) {
  try {
    const gtag = (window as any).gtag as undefined | ((...args: any[]) => void);
    if (!gtag) return;
    const payload: AnalyticsParams = {
      page_title: title || document.title,
      page_path: path,
      page_location: window.location.origin + path,
      // Help distinguish which view this is
      content_group: tabOrGroup,
      tab: tabOrGroup,
      page_category: tabOrGroup,
    };
    if (isDebug()) (payload as any).debug_mode = true;
    logIfEnabled('page_view', 'page_view', payload);
    gtag('event', 'page_view', payload);
  } catch {}
}
