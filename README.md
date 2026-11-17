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
| `useReachBell()` | Composable. Returns `{ isReady, permission, prompt, identify, tag, showToast, showBanner, showNotificationCenter, sdk }`. `isReady` and `permission` are reactive refs; the rest are plain functions. `permission` follows the browser permission, including changes made by the SDK's auto-prompt or bell widget where `navigator.permissions` is supported. |
| `useNotificationPermission()` | Convenience composable. Returns `{ permission, refresh }` for components that only care about the permission state. |

`prompt() / identify() / tag()` are thin wrappers around `@reachbell/sdk`. See the SDK docs for return shapes.

The plugin is SSR-safe: the SDK is initialised and `Notification` is read only after the app mounts in the browser, so `permission` is `null` and `isReady` is `false` on the server and during hydration, and the first client render matches the server HTML.

## License

MIT © DotSpheres Technologies Pvt Ltd
