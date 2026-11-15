// Offline test helper for Node >= 22.15: resolve source .js imports to adjacent .ts.
// Use with --experimental-transform-types --import ./scripts/register-local-ts.mjs.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
      const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return nextResolve(ts.href, context);
    }
    return nextResolve(specifier, context);
  },
});
