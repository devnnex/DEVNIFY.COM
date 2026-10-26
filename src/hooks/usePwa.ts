import { useCallback, useEffect, useRef, useState } from 'react';

export function useRegisterSW() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const applyUpdate = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV || !['https:', 'http:'].includes(location.protocol)) return;
    if (!('serviceWorker' in navigator)) return;
    let mounted = true;
    let observed: ServiceWorker | null = null;
    let current: ServiceWorkerRegistration | undefined;
    const stateChanged = () => {
      if (!mounted || !observed) return;
      if (observed.state === 'installed' && navigator.serviceWorker.controller)
        setNeedRefresh(true);
      if (observed.state === 'activated') setOfflineReady(true);
    };
    const updateFound = () => {
      observed?.removeEventListener('statechange', stateChanged);
      observed = current?.installing || null;
      observed?.addEventListener('statechange', stateChanged);
    };
    const controllerChanged = () => {
      if (applyUpdate.current) location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
    void navigator.serviceWorker
      .register(new URL('./sw.js', document.baseURI).href, { scope: './' })
      .then((value) => {
        if (!mounted) return;
        current = value;
        registration.current = value;
        if (value.waiting) setNeedRefresh(true);
        if (value.active) setOfflineReady(true);
        value.addEventListener('updatefound', updateFound);
        if (value.installing) updateFound();
      })
      .catch((error: unknown) => {
        console.error('No se pudo preparar Devnify para abrir offline:', error);
      });
    return () => {
      mounted = false;
      observed?.removeEventListener('statechange', stateChanged);
      current?.removeEventListener('updatefound', updateFound);
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
    };
  }, []);

  const updateServiceWorker = useCallback(async (reloadPage = true) => {
    const current = registration.current;
    if (!current?.waiting) return;
    applyUpdate.current = reloadPage;
    current.waiting.postMessage({ type: 'SKIP_WAITING' });
  }, []);
  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    offlineReady: [offlineReady, setOfflineReady] as const,
    updateServiceWorker,
  };
}
