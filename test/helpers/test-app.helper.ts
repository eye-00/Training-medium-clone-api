import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';

import {
    Test,
    type TestingModule,
    type TestingModuleBuilder,
} from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Server } from 'node:http';

import { DataSource } from 'typeorm';
import { configureBodyParser } from '../../src/config/body-parser.js';

import {
    assertSafeTestEnvironment,
    verifyTestDatabaseIdentity,
    type VerifiedDatabaseIdentity,
} from './database-safety.helper.js';

export type TestAppOptions = Readonly<{
    listen?: boolean;
    configureModule?: (
        builder: TestingModuleBuilder,
    ) => void;
}>;

export type TestAppContext = Readonly<{
    app: INestApplication;
    server: Server;
    db: DataSource;
    identity: VerifiedDatabaseIdentity;
}>;

type TestAppCleanup = (
    context: TestAppContext,
) => Promise<void>;

/**
 * Releases resources while preserving the original
 * failure if resource cleanup also fails.
 */
async function closeAfterFailure(
    close: () => Promise<void>,
    originalError: unknown,
): Promise<never> {
    try {
        await close();
    } catch (closeError: unknown) {
        throw new AggregateError(
            [originalError, closeError],
            'Test application operation and cleanup failed',
        );
    }

    throw originalError;
}

/**
 * Creates an isolated and verified NestJS E2E application.
 *
 * No test context is returned until environment and
 * database identity verification have succeeded.
 */
export async function createTestApp(
    options: TestAppOptions = {},
): Promise<TestAppContext> {
    const expectedServerUuid =
        assertSafeTestEnvironment();

    let moduleRef: TestingModule | undefined;
    let app: INestApplication | undefined;

    try {
        // Load AppModule only after validating the environment.
        const { AppModule } = await import(
            '../../src/app.module.js'
        );

        const builder = Test.createTestingModule({
            imports: [AppModule],
        });

        options.configureModule?.(builder);

        moduleRef = await builder.compile();

        const expressApp = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
        app = expressApp;
        configureBodyParser(expressApp);

        app.setGlobalPrefix('api');

        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        );

        const db = app.get(DataSource);

        const identity =
            await verifyTestDatabaseIdentity(
                db,
                expectedServerUuid,
            );

        if (options.listen) {
            await app.listen(0, '127.0.0.1');
        } else {
            await app.init();
        }

        return Object.freeze({
            app,
            server: app.getHttpServer() as Server,
            db,
            identity,
        });
    } catch (error: unknown) {
        const resource = app ?? moduleRef;

        if (resource) {
            return closeAfterFailure(
                () => resource.close(),
                error,
            );
        }

        throw error;
    }
}

/**
 * Runs suite-specific cleanup only after re-verifying
 * the test environment and database identity.
 *
 * Always attempts to close the application.
 */
export async function closeTestApp(
    context: TestAppContext,
    cleanup?: TestAppCleanup,
): Promise<void> {
    try {
        if (cleanup) {
            const expectedServerUuid =
                assertSafeTestEnvironment();

            if (
                expectedServerUuid !==
                context.identity.serverUuid
            ) {
                throw new Error(
                    'E2E database identity changed during execution',
                );
            }

            await verifyTestDatabaseIdentity(
                context.db,
                expectedServerUuid,
            );

            await cleanup(context);
        }
    } catch (error: unknown) {
        return closeAfterFailure(
            () => context.app.close(),
            error,
        );
    }

    await context.app.close();
}
