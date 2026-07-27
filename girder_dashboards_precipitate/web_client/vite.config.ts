import { resolve } from 'path';

import { defineConfig } from 'vite';
import { compileClient } from 'pug';

function pugPlugin() {
  return {
    name: 'pug',
    transform(src: string, id: string) {
      if (id.endsWith('.pug')) {
        return {
          code: `${compileClient(src, { filename: id, compileDebug: false })}\nexport default template`,
          map: null,
        };
      }
    },
  };
}

// Neither Girder core nor girder-dashboards is bundled. Both are on the page at
// runtime as the `girder` global (`girder.plugins.dashboards` for the latter),
// injected before this bundle's script runs. Chart.js *is* bundled — it is this
// dashboard's own dependency and nothing else on the page provides it.
export default defineConfig({
  plugins: [pugPlugin()],
  build: {
    sourcemap: !process.env.SKIP_SOURCE_MAPS,
    lib: {
      entry: resolve(__dirname, 'main.js'),
      name: 'GirderPluginDashboardsPrecipitate',
      fileName: 'girder-plugin-dashboards-precipitate',
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'style.css';
          }
          return '[name].[ext]';
        },
      },
    },
  },
});
