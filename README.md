# @reachbell/vue

Vue 3 plugin + composables for the [ReachBell](https://reachbell.com) SDK.

Full documentation: https://docs.reachbell.com

## Install

```bash
npm install @reachbell/vue @reachbell/sdk
```

## Quickstart

```ts
import { createApp } from 'vue';
import { ReachBellPlugin } from '@reachbell/vue';
import App from './App.vue';

createApp(App).use(ReachBellPlugin, {
  apiKey:     'rb_live_yourkey',
  autoPrompt: true,
}).mount('#app');
```

Anywhere inside a component's `setup()`:

```vue
<script setup lang="ts">
import { useReachBell } from '@reachbell/vue';

const { prompt, identify, permission, isReady } = useReachBell();

async function subscribe() {
  const r = await prompt();
  if (!r.success) console.warn('subscribe failed:', r.reason);
}
</script>

<template>
  <button v-if="permission !== 'granted'" :disabled="!isReady" @click="subscribe">
    Enable notifications
  </button>
  <span v-else>Subscribed ✓</span>
</template>
```

## API

| Export | Notes |
| --- | --- |
| `ReachBellPlugin` | Vue 3 plugin. Install with `app.use(ReachBellPlugin, { apiKey, autoPrompt, … })`. |
| `useReachBell()` | Composable. Returns `{ isReady, permission, prompt, identify, tag, showToast, showBanner, showNotificationCenter, refreshPermission, sdk }`. `isReady` and `permission` are reactive refs; the rest are plain functions. `permission` follows the browser permission, including changes made by the SDK's auto-prompt or bell widget where `navigator.permissions` is supported; `refreshPermission()` re-reads it. `isReady` goes back to `false` after `ReachBell.init({ ..., force: true })` until the new boot settles. |
| `useNotificationPermission()` | Convenience composable. Returns `{ permission, refresh }` for components that only care about the permission state. |

`prompt() / identify() / tag()` are thin wrappers around `@reachbell/sdk`. See the SDK docs for return shapes. They initialise the SDK on first use, so calling them from `setup()` works. `identify(null)` unlinks the user on logout, and `identify(id, { hash })` passes an identity-verification hash through to the SDK.

Requires `@reachbell/sdk` 1.1.0 or newer. Install the plugin before `app.mount()` (in development a `console.warn` flags a late install); without an `apiKey` the SDK is not initialised by the plugin, but `isReady` still follows an SDK your app initialised itself.

The plugin is SSR-safe: the SDK is initialised only in the browser (when the root app mounts, or earlier from a `prompt`/`identify`/`tag` call), and `Notification` is read only after the app mounts, so `permission` is `null` and `isReady` is `false` on the server and during hydration, and the first client render matches the server HTML. The first update waits until hydration is over — a tick plus an animation frame (or 50 ms, whichever comes first, so background tabs that pause animation frames still update) after mount, and in Nuxt until `app:suspense:resolve` — so async `<Suspense>` boundaries hydrate against the server values too. The plugin's `reachbell:init` window listener is only added once the app mounts and is removed on `app.unmount()` (also via `app.onUnmount` on Vue 3.5+), so an app that installs the plugin but is never mounted leaves nothing behind.

## License

MIT © DotSpheres Technologies Pvt Ltd
