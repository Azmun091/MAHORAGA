import { useEffect, useState } from 'react';

/**
 * Hook to register and manage the service worker for PWA functionality.
 * Registers the service worker on mount and provides status information.
 */
export function useServiceWorker() {
  const [isRegistered, setIsRegistered] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Only run in browser and if service workers are supported
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.log('[SW] Service workers not supported');
      return;
    }

    const registerServiceWorker = async () => {
      try {
        // Check if already registered
        const existingRegistration = await navigator.serviceWorker.getRegistration('/mahoraga/');
        
        if (existingRegistration) {
          setRegistration(existingRegistration);
          setIsRegistered(true);
          console.log('[SW] Service worker already registered');
          return;
        }

        // Register the service worker
        const reg = await navigator.serviceWorker.register('/mahoraga/sw.js', {
          scope: '/mahoraga/',
        });

        setRegistration(reg);
        setIsRegistered(true);
        console.log('[SW] Service worker registered successfully');

        // Handle updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New service worker available');
                // Optionally show a notification to the user to refresh
              }
            });
          }
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to register service worker');
        setError(error);
        console.error('[SW] Service worker registration failed:', error);
      }
    };

    registerServiceWorker();
  }, []);

  return { isRegistered, registration, error };
}
