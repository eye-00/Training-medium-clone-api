import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: [
      'test/auth-flow.e2e-spec.ts',
      'test/profile-update.e2e-spec.ts',
      'test/public-profile.e2e-spec.ts',
      'test/follow-flow.e2e-spec.ts',
    ],
  },
});
