import { defineConfig } from 'vitest/config';

// Deliberately a separate file rather than a `test` key inside vite.config.ts:
// vitest.config.ts takes full precedence when present, so the production build
// config stays untouched by anything test-related (no React/Tailwind plugins
// loaded to run these, and no chance of a test option changing `vite build`).
//
// environment: 'node' because every module covered here is pure logic —
// layout math, graph walks, formatting. Nothing mounts a component or touches
// the DOM, so there is no jsdom dependency to install or keep current. The
// two chart hooks are tested through their extracted pure cores
// (computeVisibleGraph / computeReportingChain), not through React.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
