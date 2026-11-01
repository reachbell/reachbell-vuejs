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
 */
import { inject, onMounted, ref, type App, type InjectionKey, type Ref } from 'vue';
import {
  ReachBell,
  type ReachBellConfig,
  type SubscribeResult,
  type ApiResult,
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
  identify:   (externalId: string) => Promise<ApiResult>;
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

    // The SDK's own idempotency guard makes double-init a no-op, but the
    // refs only need to update once per app instance.
    let initialised = false;

    const ensureBootstrap = () => {
      if (initialised) return;
      initialised = true;

      ReachBell.init(options);

      if (typeof Notification !== 'undefined') {
        permission.value = Notification.permission;
      }

      ReachBell.ready
        .catch(() => { /* SDK warnOnce already fired */ })
        .finally(() => { isReady.value = true; });
    };

    // Bootstrap on the next tick rather than synchronously so SSR-rendered
    // apps don't crash on `window` access during install.
    if (typeof window !== 'undefined') ensureBootstrap();

    const prompt = async (): Promise<SubscribeResult> => {
      ensureBootstrap();
      const r = await ReachBell.prompt();
      if (typeof Notification !== 'undefined') permission.value = Notification.permission;
      return r;
    };

    const api: ReachBellApi = {
      isReady,
      permission,
      prompt,
      identify: (externalId: string) => ReachBell.identify(externalId),
      tag:      (tags: string[]) => ReachBell.tag(tags),
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
  ToastOptions,
  BannerOptions,
  NotificationCenterOptions,
  NotificationHistoryItem,
} from '@reachbell/sdk';
