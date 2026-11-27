import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema.js';

function validEnvironment() {
    return {
        NODE_ENV: 'test',
        PORT: '3000',
        DB_HOST: '127.0.0.1',
        DB_PORT: '3307',
        DB_USERNAME: 'medium_test_user',
        DB_PASSWORD: 'unit-test-password',
        DB_DATABASE: 'medium_clone_test',
        REDIS_URL: 'redis://127.0.0.1:6380/1',
        JWT_SECRET: 'unit-test-only-secret-not-for-production',
    };
}

describe('JWT environment configuration', () => {
    it('accepts a valid JWT secret', () => {
        const env = validEnvironment();
        const result = envSchema.safeParse(env);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.JWT_SECRET).toBe(env.JWT_SECRET);
        }
    });

    it.each([
        { description: 'short secret', secret: 'short-secret' },
        { description: 'whitespace-only secret', secret: ' '.repeat(32) },
        {
            description: 'example placeholder',
            secret: 'REPLACE_WITH_A_SECURE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
        },
        {
            description: 'test example placeholder',
            secret: 'REPLACE_WITH_A_SECURE_RANDOM_TEST_SECRET_AT_LEAST_32_CHARACTERS',
        },
        {
            description: 'surrounding whitespace',
            secret: ' unit-test-only-secret-not-for-production ',
        },
    ])('rejects $description', ({ secret }) => {
        const result = envSchema.safeParse({
            ...validEnvironment(),
            JWT_SECRET: secret,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ path: ['JWT_SECRET'] }),
                ]),
            );
        }
    });

    it('rejects a missing JWT secret', () => {
        const result = envSchema.safeParse({
            ...validEnvironment(),
            JWT_SECRET: undefined,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ path: ['JWT_SECRET'] }),
                ]),
            );
        }
    });
});
