# @reachbell/vue

Vue 3 plugin + composables for the [ReachBell](https://reachbell.com) SDK.

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
  const r = await prompt.value();
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
| `useReachBell()` | Composable. Returns `{ isReady, permission, prompt, identify, tag, sdk }`. The first two are reactive refs. |
| `useNotificationPermission()` | Convenience composable. Returns `{ permission, refresh }` for components that only care about the permission state. |

`prompt() / identify() / tag()` are thin wrappers around `@reachbell/sdk`. See the SDK docs for return shapes.

The plugin is SSR-safe — `Notification` and `window` are only touched after the app mounts in the browser.

## License

MIT © DotSpheres Technologies Pvt Ltd
