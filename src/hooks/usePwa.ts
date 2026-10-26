import { useCallback, useEffect, useRef, useState } from 'react';
import { player } from '../services/player';

const canAutoUpdate = () =>
  document.visibilityState === 'visible' &&
  !player.state.playing &&
  !document.querySelector('dialog[open], form, [aria-busy="true"]') &&
  !document.activeElement?.closest('input, textarea, select, [contenteditable="true"]');

export function useRegisterSW() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const applyUpdate = useRef(false);
  const updating = useRef(false);

  const updateServiceWorker = useCallback(async (reloadPage = true, automatically = false) => {
    const current = registration.current;
    if (!current?.waiting || updating.current) return;
    updating.current = true;
    try {
      await player.persist();
      if (automatically && !canAutoUpdate()) return;
      applyUpdate.current = reloadPage;
      current.waiting?.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      console.error('No se pudo guardar la reproducción antes de actualizar:', error);
    } finally {
      updating.current = false;
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV || !['https:', 'http:'].includes(location.protocol)) return;
    if (!('serviceWorker' in navigator)) return;
    let mounted = true;
    let observed: ServiceWorker | null = null;
    let current: ServiceWorkerRegistration | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checking = false;
    let hadController = !!navigator.serviceWorker.controller;
    let controllerReplaced = false;
    let reloading = false;
    const scheduleUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!mounted || !canAutoUpdate()) return;
        if (controllerReplaced && !reloading) {
          reloading = true;
          void player
            .persist()
            .then(() => {
              if (mounted && canAutoUpdate()) location.reload();
              else reloading = false;
            })
            .catch(() => {
              reloading = false;
            });
        } else if (current?.waiting) void updateServiceWorker(true, true);
      }, 2000);
    };
    const checkForUpdate = () => {
      scheduleUpdate();
      if (!current || checking || !navigator.onLine || document.visibilityState !== 'visible')
        return;
      checking = true;
      void current
        .update()
        .catch(() => {
          // Offline, captive portals and transient server errors can be retried later.
        })
        .finally(() => {
          checking = false;
        });
    };
    const stateChanged = () => {
      if (!mounted || !observed) return;
      if (observed.state === 'installed' && navigator.serviceWorker.controller) {
        setNeedRefresh(true);
        scheduleUpdate();
      }
      if (observed.state === 'activated') setOfflineReady(true);
    };
    const updateFound = () => {
      observed?.removeEventListener('statechange', stateChanged);
      observed = current?.installing || null;
      observed?.addEventListener('statechange', stateChanged);
    };
    const controllerChanged = () => {
      if (applyUpdate.current && !player.state.playing && document.visibilityState === 'visible') {
        applyUpdate.current = false;
        location.reload();
      } else if (hadController) {
        // Another open window may have activated the update. Reload this one
        // only when idle, so its music is not interrupted.
        controllerReplaced = true;
        setNeedRefresh(true);
        scheduleUpdate();
      }
      hadController = true;
    };
    let wasPlaying = player.state.playing;
    const unsubscribe = player.subscribe(() => {
      if (wasPlaying === player.state.playing) return;
      wasPlaying = player.state.playing;
      scheduleUpdate();
    });
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
    window.addEventListener('online', checkForUpdate);
    window.addEventListener('focus', checkForUpdate);
    window.addEventListener('pageshow', checkForUpdate);
    document.addEventListener('visibilitychange', checkForUpdate);
    const interval = setInterval(checkForUpdate, 60_000);
    void navigator.serviceWorker
      .register(new URL('./sw.js', document.baseURI).href, { scope: './', updateViaCache: 'none' })
      .then((value) => {
        if (!mounted) return;
        current = value;
        registration.current = value;
        if (value.waiting) setNeedRefresh(true);
        if (value.active) setOfflineReady(true);
        value.addEventListener('updatefound', updateFound);
        if (value.installing) updateFound();
        checkForUpdate();
      })
      .catch((error: unknown) => {
        console.error('No se pudo preparar Devnify para abrir offline:', error);
      });
    return () => {
      mounted = false;
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe();
      observed?.removeEventListener('statechange', stateChanged);
      current?.removeEventListener('updatefound', updateFound);
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
      window.removeEventListener('online', checkForUpdate);
      window.removeEventListener('focus', checkForUpdate);
      window.removeEventListener('pageshow', checkForUpdate);
      document.removeEventListener('visibilitychange', checkForUpdate);
    };
  }, [updateServiceWorker]);
  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    offlineReady: [offlineReady, setOfflineReady] as const,
    updateServiceWorker,
  };
}
