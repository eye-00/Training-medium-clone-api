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
      'test/avatar-flow.e2e-spec.ts',
      'test/article-create.e2e-spec.ts',
      'test/article-update.e2e-spec.ts',
      'test/article-delete.e2e-spec.ts',
      'test/article-list.e2e-spec.ts',
      'test/article-favorite.e2e-spec.ts',
      'test/article-feed.e2e-spec.ts',
      'test/article-tags.e2e-spec.ts',
      'test/article-concurrency.e2e-spec.ts',
    ],
  },
});
