import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },

    test: {
        globals: true,
        root: './',

        // Each case owns the dedicated database until afterEach truncates it.
        maxWorkers: 1,
        hookTimeout: 25000,
        isolate: true,
        fileParallelism: false,
        maxConcurrency: 1,
        setupFiles: ['test/helpers/e2e.setup.ts'],

        include: [
            'test/auth-flow.e2e-spec.ts',
            'test/auth-response-exposure.e2e-spec.ts',
            'test/auth-password-validation.e2e-spec.ts',
            'test/username-validation.e2e-spec.ts',
            'test/profile-update.e2e-spec.ts',
            'test/public-profile.e2e-spec.ts',
            'test/follow-flow.e2e-spec.ts',
            'test/avatar-flow.e2e-spec.ts',

            'test/article-create.e2e-spec.ts',
            'test/article-storage-validation.e2e-spec.ts',
            'test/article-update.e2e-spec.ts',
            'test/article-delete.e2e-spec.ts',
            'test/article-list.e2e-spec.ts',
            'test/article-favorite.e2e-spec.ts',
            'test/article-feed.e2e-spec.ts',
            'test/article-tags.e2e-spec.ts',
            'test/article-concurrency.e2e-spec.ts',

            'test/comment-create.e2e-spec.ts',
            'test/comment-list.e2e-spec.ts',
            'test/comment-delete.e2e-spec.ts',
            'test/comment-concurrency.e2e-spec.ts',
        ],
    },
});
