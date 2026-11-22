/**
 * @reachbell/vue — Vue 3 bindings for the ReachBell SDK.
 *
 *   import { createApp } from 'vue';
 *   import { ReachBellPlugin } from '@reachbell/vue';
 *
 *   createApp(App).use(ReachBellPlugin, { apiKey: 'rb_live_…', autoPrompt: true });
 *
 *   // Anywhere in a component setup():
 *   const { prompt, identify, permission, isReady } = useReachBell();
 *
 * The plugin initialises the underlying SDK exactly once (the SDK's own
 * idempotency guard handles double-init via HMR), exposes the same
 * surface as the React wrapper, and tracks Notification permission as
 * a reactive ref.
 *
 * Initialising the SDK and touching reactive state are kept apart:
 * prompt/identify/tag may init from setup(), but `permission` and
 * `isReady` only change after the root app has mounted and hydration has
 * finished (nextTick + a frame; in Nuxt, after `app:suspense:resolve`),
 * so SSR hydration — including async Suspense boundaries — sees the same
 * values the server rendered.
 */
import { inject, nextTick, onMounted, ref, type App, type InjectionKey, type Ref } from 'vue';
import {
  ReachBell,
  type ReachBellConfig,
  type SubscribeResult,
  type ApiResult,
  type IdentifyOptions,
  type ToastOptions,
  type BannerOptions,
  type NotificationCenterOptions,
  type NotificationHistoryItem,
} from '@reachbell/sdk';

export interface ReachBellApi {
  /** Has the SDK's bootstrap settled (success OR failure)? */
  isReady:    Ref<boolean>;
  /** Current Notification permission state — null on the server / first render. */
  permission: Ref<NotificationPermission | null>;
  prompt:     () => Promise<SubscribeResult>;
  /** Link the subscription to your user id; `null` unlinks it (logout). */
  identify:   (externalId: string | null, opts?: IdentifyOptions) => Promise<ApiResult>;
  tag:        (tags: string[]) => Promise<ApiResult>;
  showToast:  (opts: ToastOptions) => () => void;
  showBanner: (opts: BannerOptions) => () => void;
  showNotificationCenter: (opts?: NotificationCenterOptions) => () => void;
  /** Re-read the browser permission into `permission` (shared by every consumer). */
  refreshPermission: () => NotificationPermission | null;
  /** Direct access to the underlying SDK if you need it. */
  sdk:        typeof ReachBell;
}

const KEY: InjectionKey<ReachBellApi> = Symbol('ReachBell');

/** Per-install "hydration is over" check, used by useNotificationPermission(). */
const hydratedFor = new WeakMap<ReachBellApi, () => boolean>();

export interface ReachBellPluginOptions extends Omit<ReachBellConfig, 'force'> {}

/** True in development builds (bundlers inline `process.env.NODE_ENV`). */
function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false; // no bundler / no `process`: treat as production
  }
}

/** Minimal shape of Nuxt's app (`app.$nuxt`) used to wait for hydration. */
interface NuxtLike {
  isHydrating?: boolean;
  hooks?: { hookOnce?: (name: string, fn: () => void) => unknown };
}

/**
 * Run `fn` once hydration is over. Nuxt resolves async Suspense boundaries
 * after app.mount() returns, so wait for its `app:suspense:resolve` hook
 * when it is hydrating; otherwise (and afterwards) wait a tick plus a frame.
 */
function afterHydration(app: App, fn: () => void): void {
  const later = () => {
    void nextTick(() => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
      else setTimeout(fn, 0);
    });
  };
  const nuxt = ((app as unknown as { $nuxt?: NuxtLike }).$nuxt
    ?? (app.config?.globalProperties as { $nuxt?: NuxtLike } | undefined)?.$nuxt);
  if (nuxt?.isHydrating && typeof nuxt.hooks?.hookOnce === 'function') {
    try {
      nuxt.hooks.hookOnce('app:suspense:resolve', later);
      return;
    } catch { /* fall through to the generic path */ }
  }
  later();
}

/**
 * Vue plugin — install once at the app root.
 */
export const ReachBellPlugin = {
  install(app: App, options: ReachBellPluginOptions) {
    const isReady    = ref(false);
    const permission = ref<NotificationPermission | null>(null);

    let initialised = false;
    let mounted = false;
    /** Hydration finished: reactive state may change from here on. */
    let hydrated = false;
    let readySettled = false;
    let trackedReady: Promise<void> | null = null;
    let permissionStatus: PermissionStatus | null = null;
    let disposed = false;

    const syncPermission = () => {
      if (typeof Notification !== 'undefined') permission.value = Notification.permission;
    };

    const watchPermission = () => {
      if (typeof navigator === 'undefined' || !navigator.permissions || typeof navigator.permissions.query !== 'function') return;
      try {
        navigator.permissions
          .query({ name: 'notifications' })
          .then((status) => {
            if (disposed || typeof status.addEventListener !== 'function') return;
            permissionStatus = status;
            status.addEventListener('change', syncPermission);
          })
          .catch(() => {});
      } catch {}
    };

    const markReady = () => {
      isReady.value = true;
      syncPermission();
    };

    /**
     * Follow the SDK's current boot promise. A (force) re-init swaps it and
     * dispatches `reachbell:init`, which resets isReady until the new boot
     * settles. Also follows an SDK the app initialised itself. On an
     * uninitialised SDK `ready` rejects; that is ignored (the next init
     * retries). Only writes reactive state once hydration is over, or to
     * reset an isReady that is already true.
     */
    const trackReady = () => {
      if (typeof window === 'undefined' || disposed) return;
      let ready: Promise<void>;
      try {
        ready = ReachBell.ready;
      } catch {
        return;
      }
      if (ready === trackedReady) return;
      trackedReady = ready;
      readySettled = false;
      if (isReady.value) isReady.value = false;
      const settle = () => {
        if (trackedReady !== ready) return;
        readySettled = true;
        if (hydrated && !disposed) markReady();
      };
      ready.then(settle, () => {
        // Our own init failed: the SDK warned-once already, but boot settled.
        if (initialised) settle();
        else if (trackedReady === ready) trackedReady = null;
      });
    };

    /**
     * Init the SDK only — no reactive writes, so it is safe from setup()
     * during hydration. Skipped on the server and without an apiKey.
     */
    const initSdk = () => {
      if (initialised || typeof window === 'undefined' || !options?.apiKey) return;
      initialised = true;
      ReachBell.init(options);
      trackReady();
    };

    const onReInit = () => trackReady();
    if (typeof window !== 'undefined') window.addEventListener('reachbell:init', onReInit);

    /** Runs once, after the root app has mounted (client only). */
    const onAppMounted = () => {
      if (mounted) return;
      mounted = true;
      initSdk();
      trackReady();
      // The first reactive writes wait until hydration (incl. Suspense) is done.
      afterHydration(app, () => {
        if (disposed) return;
        hydrated = true;
        syncPermission();
        watchPermission();
        if (readySettled) markReady();
      });
    };

    // Root-only, one-shot hook: app.mount() is client-side (SSR renders
    // with renderToString) and returns after the whole tree has mounted or
    // hydrated — no global mixin on every component needed.
    const mount = app.mount.bind(app);
    app.mount = ((...args: Parameters<App['mount']>) => {
      const instance = mount(...args);
      onAppMounted();
      return instance;
    }) as App['mount'];

    const unmount = app.unmount.bind(app);
    app.unmount = () => {
      disposed = true;
      permissionStatus?.removeEventListener('change', syncPermission);
      permissionStatus = null;
      if (typeof window !== 'undefined') window.removeEventListener('reachbell:init', onReInit);
      unmount();
    };

    // Installed after app.mount(): our mount hook will never run.
    if (app._container) {
      if (isDev()) {
        // eslint-disable-next-line no-console
        console.warn('[ReachBell] ReachBellPlugin was installed after app.mount(). Call app.use(ReachBellPlugin, …) before mounting.');
      }
      onAppMounted();
    }

    const refreshPermission = (): NotificationPermission | null => {
      syncPermission();
      return permission.value;
    };

    const prompt = async (): Promise<SubscribeResult> => {
      initSdk();
      const r = await ReachBell.prompt();
      // prompt() needs a user gesture, so we're past hydration by now.
      syncPermission();
      return r;
    };

    const api: ReachBellApi = {
      isReady,
      permission,
      prompt,
      // Like prompt(), make sure the SDK is initialised so calls made from
      // setup() (before any component has mounted) don't fail with
      // sdk_not_initialized. Init only: no permission sync during setup().
      identify: (externalId: string | null, opts?: IdentifyOptions) => { initSdk(); return ReachBell.identify(externalId, opts); },
      tag:      (tags: string[]) => { initSdk(); return ReachBell.tag(tags); },
      showToast:  (opts: ToastOptions) => ReachBell.showToast(opts),
      showBanner: (opts: BannerOptions) => ReachBell.showBanner(opts),
      showNotificationCenter: (opts?: NotificationCenterOptions) => ReachBell.showNotificationCenter(opts),
      refreshPermission,
      sdk:      ReachBell,
    };

    hydratedFor.set(api, () => hydrated);
    app.provide(KEY, api);
  },
};

/**
 * Access the ReachBell client + reactive state from any component
 * underneath the app that installed ReachBellPlugin.
 */
export function useReachBell(): ReachBellApi {
  const api = inject(KEY);
  if (!api) {
    throw new Error('useReachBell() called without ReachBellPlugin. Did you forget app.use(ReachBellPlugin)?');
  }
  return api;
}

/**
 * Convenience composable that returns only the permission ref + a
 * manual refresh — useful for components that don't need the full
 * client surface.
 */
export function useNotificationPermission() {
  const api = useReachBell();
  const { permission, refreshPermission: refresh } = api;
  // onMounted is a no-op during SSR. While the app is still hydrating the
  // plugin syncs `permission` itself once hydration is over, so only
  // components mounted after that refresh on mount.
  onMounted(() => {
    if (hydratedFor.get(api)?.() !== false) refresh();
  });
  return { permission, refresh };
}

export type {
  ReachBellConfig,
  SubscribeResult,
  ApiResult,
  IdentifyOptions,
  ToastOptions,
  BannerOptions,
  NotificationCenterOptions,
  NotificationHistoryItem,
} from '@reachbell/sdk';
