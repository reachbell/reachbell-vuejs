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
 * `isReady` only change after the root app has mounted, so SSR
 * hydration sees the same values the server rendered.
 */
import { inject, onMounted, ref, type App, type InjectionKey, type Ref } from 'vue';
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
  /** Direct access to the underlying SDK if you need it. */
  sdk:        typeof ReachBell;
}

const KEY: InjectionKey<ReachBellApi> = Symbol('ReachBell');

export interface ReachBellPluginOptions extends Omit<ReachBellConfig, 'force'> {}

/**
 * Vue plugin — install once at the app root.
 */
export const ReachBellPlugin = {
  install(app: App, options: ReachBellPluginOptions) {
    const isReady    = ref(false);
    const permission = ref<NotificationPermission | null>(null);

    let initialised = false;
    let mounted = false;
    let readySettled = false;
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
     * Init the SDK only — no reactive writes, so it is safe from setup()
     * during hydration. Skipped on the server and without an apiKey.
     */
    const initSdk = () => {
      if (initialised || typeof window === 'undefined' || !options?.apiKey) return;
      initialised = true;
      ReachBell.init(options);
      ReachBell.ready
        .catch(() => { /* SDK warnOnce already fired */ })
        .finally(() => {
          readySettled = true;
          if (mounted && !disposed) markReady();
        });
    };

    /** Runs once, after the root app has mounted (client only). */
    const onAppMounted = () => {
      if (mounted) return;
      mounted = true;
      initSdk();
      syncPermission();
      watchPermission();
      if (readySettled) markReady();
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
      unmount();
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
      sdk:      ReachBell,
    };

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
  const { permission } = useReachBell();
  const refresh = () => {
    if (typeof Notification !== 'undefined') {
      permission.value = Notification.permission;
    }
    return permission.value;
  };
  // onMounted is a no-op during SSR.
  onMounted(refresh);
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
