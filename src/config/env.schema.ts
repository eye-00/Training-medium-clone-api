import { z } from 'zod';

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
    JWT_SECRET: z.string().min(32),
})
.passthrough();
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;