import { z } from 'zod';

const JWT_SECRET_PLACEHOLDERS = [
    'REPLACE_WITH_A_SECURE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
    'REPLACE_WITH_A_SECURE_RANDOM_TEST_SECRET_AT_LEAST_32_CHARACTERS',
];

export const databaseEnvSchema = z.object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_DATABASE: z.string().min(1),
})
export const envSchema = databaseEnvSchema
.extend({
    NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

    PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3000),

    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32)
    .refine((secret) => secret.trim() === secret, {
        message: 'JWT_SECRET must not contain surrounding whitespace',
    })
    .refine((secret) => !JWT_SECRET_PLACEHOLDERS.includes(secret), {
        message: 'JWT_SECRET must not use the example placeholder',
    }),
})
.passthrough();
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
