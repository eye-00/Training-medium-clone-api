import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    createTestApp,
    closeTestApp,
} from './test-app.helper.js';

const mocks = vi.hoisted(() => ({
    createTestingModule: vi.fn(),
    compile: vi.fn(),
    createNestApplication: vi.fn(),
    moduleClose: vi.fn(),

    setGlobalPrefix: vi.fn(),
    useBodyParser: vi.fn(),
    use: vi.fn(),
    useGlobalPipes: vi.fn(),
    get: vi.fn(),
    init: vi.fn(),
    listen: vi.fn(),
    getHttpServer: vi.fn(),
    close: vi.fn(),

    query: vi.fn(),
}));

vi.mock('@nestjs/testing', () => ({
    Test: {
        createTestingModule:
            mocks.createTestingModule,
    },
}));

vi.mock('../../src/app.module.js', () => ({
    AppModule: class MockAppModule { },
}));

const SERVER_UUID =
    '11111111-2222-4333-8444-555555555555';

const TEST_ENV = {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_DATABASE: 'medium_clone_test',
    DB_USERNAME: 'medium_test_user',
    REDIS_URL: 'redis://127.0.0.1:6380/1',
    DB_TEST_SERVER_UUID: SERVER_UUID,
};

function validIdentity() {
    return {
        db: 'medium_clone_test',
        dbUser: 'medium_test_user@%',
        serverUuid: SERVER_UUID,
    };
}

const fakeServer = {};

const fakeDatabase = {
    query: mocks.query,
};

const fakeApp = {
    setGlobalPrefix: mocks.setGlobalPrefix,
    useBodyParser: mocks.useBodyParser,
    use: mocks.use,
    useGlobalPipes: mocks.useGlobalPipes,
    get: mocks.get,
    init: mocks.init,
    listen: mocks.listen,
    getHttpServer: mocks.getHttpServer,
    close: mocks.close,
};

const fakeModule = {
    createNestApplication:
        mocks.createNestApplication,
    close: mocks.moduleClose,
};

describe('Test Application Lifecycle', () => {
    beforeEach(() => {
        vi.resetAllMocks();

        for (const [key, value] of Object.entries(
            TEST_ENV,
        )) {
            vi.stubEnv(key, value);
        }

        mocks.createTestingModule.mockReturnValue({
            compile: mocks.compile,
        });

        mocks.compile.mockResolvedValue(fakeModule);

        mocks.createNestApplication
            .mockReturnValue(fakeApp);

        mocks.get.mockReturnValue(fakeDatabase);

        mocks.getHttpServer.mockReturnValue(
            fakeServer,
        );

        mocks.query.mockResolvedValue([
            validIdentity(),
        ]);

        mocks.init.mockResolvedValue(fakeApp);
        mocks.listen.mockResolvedValue(fakeServer);
        mocks.close.mockResolvedValue(undefined);
        mocks.moduleClose.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('creates a verified standard test application', async () => {
        const context = await createTestApp();

        expect(context.app).toBe(fakeApp);
        expect(context.server).toBe(fakeServer);
        expect(context.db).toBe(fakeDatabase);

        expect(context.identity)
            .toEqual(validIdentity());

        expect(Object.isFrozen(context)).toBe(true);

        expect(mocks.setGlobalPrefix)
            .toHaveBeenCalledWith('api');

        expect(mocks.createNestApplication)
            .toHaveBeenCalledWith({ bodyParser: false });
        expect(mocks.useBodyParser.mock.calls).toEqual([
            ['json'], ['urlencoded', { extended: true }],
        ]);
        expect(mocks.use).toHaveBeenCalledOnce();

        expect(mocks.useGlobalPipes)
            .toHaveBeenCalledTimes(1);

        expect(mocks.query)
            .toHaveBeenCalledTimes(1);

        expect(mocks.init)
            .toHaveBeenCalledTimes(1);

        expect(mocks.listen)
            .not.toHaveBeenCalled();

        expect(
            mocks.query.mock.invocationCallOrder[0],
        ).toBeLessThan(
            mocks.init.mock.invocationCallOrder[0]!,
        );

        expect(mocks.close)
            .not.toHaveBeenCalled();
    });

    it('starts a verified application on an ephemeral loopback port', async () => {
        const context = await createTestApp({
            listen: true,
        });

        expect(context.server).toBe(fakeServer);

        expect(mocks.listen)
            .toHaveBeenCalledWith(
                0,
                '127.0.0.1',
            );

        expect(mocks.init)
            .not.toHaveBeenCalled();

        expect(
            mocks.query.mock.invocationCallOrder[0],
        ).toBeLessThan(
            mocks.listen.mock.invocationCallOrder[0]!,
        );
    });

    it('rejects unsafe environments before compiling AppModule', async () => {
        vi.stubEnv('DB_DATABASE', 'medium_clone');

        await expect(
            createTestApp(),
        ).rejects.toThrow('Unsafe E2E environment');

        expect(mocks.createTestingModule)
            .not.toHaveBeenCalled();

        expect(mocks.compile)
            .not.toHaveBeenCalled();

        expect(mocks.query)
            .not.toHaveBeenCalled();
    });

    it('closes the application when database identity verification fails', async () => {
        mocks.query.mockResolvedValue([{
            ...validIdentity(),
            serverUuid: 'different-server',
        }]);

        await expect(
            createTestApp({ listen: true }),
        ).rejects.toThrow(
            'E2E database identity verification failed',
        );

        expect(mocks.init)
            .not.toHaveBeenCalled();

        expect(mocks.listen)
            .not.toHaveBeenCalled();

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);

        expect(mocks.moduleClose)
            .not.toHaveBeenCalled();
    });

    it('closes the application when the database identity query fails', async () => {
        const error = new Error(
            'Database query failed',
        );

        mocks.query.mockRejectedValue(error);

        await expect(
            createTestApp(),
        ).rejects.toBe(error);

        expect(mocks.init)
            .not.toHaveBeenCalled();

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('closes the application when initialization fails', async () => {
        const error = new Error(
            'Application initialization failed',
        );

        mocks.init.mockRejectedValue(error);

        await expect(
            createTestApp(),
        ).rejects.toBe(error);

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('closes the testing module when application creation fails', async () => {
        const error = new Error(
            'Application creation failed',
        );

        mocks.createNestApplication
            .mockImplementation(() => {
                throw error;
            });

        await expect(
            createTestApp(),
        ).rejects.toBe(error);

        expect(mocks.moduleClose)
            .toHaveBeenCalledTimes(1);

        expect(mocks.close)
            .not.toHaveBeenCalled();
    });

    it('re-verifies database identity before running cleanup', async () => {
        const context = await createTestApp();

        const cleanup = vi.fn()
            .mockResolvedValue(undefined);

        await closeTestApp(context, cleanup);

        expect(mocks.query)
            .toHaveBeenCalledTimes(2);

        expect(cleanup)
            .toHaveBeenCalledWith(context);

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);

        expect(
            mocks.query.mock.invocationCallOrder[1],
        ).toBeLessThan(
            cleanup.mock.invocationCallOrder[0]!,
        );

        expect(
            cleanup.mock.invocationCallOrder[0],
        ).toBeLessThan(
            mocks.close.mock.invocationCallOrder[0]!,
        );
    });

    it('skips cleanup when the actual database identity changes', async () => {
        const context = await createTestApp();

        mocks.query.mockResolvedValue([{
            ...validIdentity(),
            serverUuid: 'different-server',
        }]);

        const cleanup = vi.fn();

        await expect(
            closeTestApp(context, cleanup),
        ).rejects.toThrow(
            'E2E database identity verification failed',
        );

        expect(cleanup)
            .not.toHaveBeenCalled();

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('closes the application even when cleanup fails', async () => {
        const context = await createTestApp();

        const error = new Error('Cleanup failed');

        const cleanup = vi.fn()
            .mockRejectedValue(error);

        await expect(
            closeTestApp(context, cleanup),
        ).rejects.toBe(error);

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('preserves both cleanup and application close failures', async () => {
        const context = await createTestApp();

        const cleanupError = new Error(
            'Cleanup failed',
        );

        const closeError = new Error(
            'Application close failed',
        );

        const cleanup = vi.fn()
            .mockRejectedValue(cleanupError);

        mocks.close.mockRejectedValue(closeError);

        const result = closeTestApp(
            context,
            cleanup,
        );

        await expect(result)
            .rejects.toBeInstanceOf(AggregateError);

        await expect(result)
            .rejects.toMatchObject({
                errors: [
                    cleanupError,
                    closeError,
                ],
            });

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('closes the application without a cleanup callback', async () => {
        const context = await createTestApp();

        await closeTestApp(context);

        expect(mocks.query)
            .toHaveBeenCalledTimes(1);

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('closes the application when listening fails', async () => {
        const error = new Error(
            'Application listening failed',
        );

        mocks.listen.mockRejectedValue(error);

        await expect(
            createTestApp({ listen: true }),
        ).rejects.toBe(error);

        expect(mocks.listen)
            .toHaveBeenCalledWith(0, '127.0.0.1');

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);

        expect(mocks.moduleClose)
            .not.toHaveBeenCalled();
    });

    it('preserves the original error when module compilation fails', async () => {
        const error = new Error(
            'Testing module compilation failed',
        );

        mocks.compile.mockRejectedValue(error);

        await expect(
            createTestApp(),
        ).rejects.toBe(error);

        expect(mocks.createNestApplication)
            .not.toHaveBeenCalled();

        expect(mocks.close)
            .not.toHaveBeenCalled();

        expect(mocks.moduleClose)
            .not.toHaveBeenCalled();
    });

    it('preserves both initialization and close failures', async () => {
        const initError = new Error(
            'Application initialization failed',
        );

        const closeError = new Error(
            'Application close failed',
        );

        mocks.init.mockRejectedValue(initError);
        mocks.close.mockRejectedValue(closeError);

        const result = createTestApp();

        await expect(result)
            .rejects.toBeInstanceOf(AggregateError);

        await expect(result)
            .rejects.toMatchObject({
                errors: [
                    initError,
                    closeError,
                ],
            });

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('skips cleanup when the expected database UUID changes', async () => {
        const context = await createTestApp();

        vi.stubEnv(
            'DB_TEST_SERVER_UUID',
            '99999999-2222-4333-8444-555555555555',
        );

        const cleanup = vi.fn();

        await expect(
            closeTestApp(context, cleanup),
        ).rejects.toThrow(
            'E2E database identity changed during execution',
        );

        expect(cleanup)
            .not.toHaveBeenCalled();

        expect(mocks.query)
            .toHaveBeenCalledTimes(1);

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);
    });

    it('propagates application close failures without a cleanup callback', async () => {
        const context = await createTestApp();

        const error = new Error(
            'Application close failed',
        );

        mocks.close.mockRejectedValue(error);

        await expect(
            closeTestApp(context),
        ).rejects.toBe(error);

        expect(mocks.close)
            .toHaveBeenCalledTimes(1);

        expect(mocks.query)
            .toHaveBeenCalledTimes(1);
    });

    it('configures the testing module before compilation', async () => {
        const configureModule = vi.fn();

        await createTestApp({
            configureModule,
        });

        expect(configureModule)
            .toHaveBeenCalledTimes(1);

        expect(configureModule)
            .toHaveBeenCalledWith(
                mocks.createTestingModule.mock.results[0]!.value,
            );

        expect(
            configureModule.mock.invocationCallOrder[0],
        ).toBeLessThan(
            mocks.compile.mock.invocationCallOrder[0]!,
        );
    });

    it('does not compile when module configuration fails', async () => {
        const error = new Error(
            'Module configuration failed',
        );

        const configureModule = vi.fn(() => {
            throw error;
        });

        await expect(
            createTestApp({
                configureModule,
            }),
        ).rejects.toBe(error);

        expect(mocks.compile)
            .not.toHaveBeenCalled();

        expect(mocks.createNestApplication)
            .not.toHaveBeenCalled();
    });
    it('rejects the development Redis database before compiling AppModule', async () => {
        vi.stubEnv(
            'REDIS_URL',
            'redis://127.0.0.1:6380/0',
        );

        await expect(
            createTestApp(),
        ).rejects.toThrow(
            'Unsafe E2E environment: invalid REDIS_URL',
        );

        expect(mocks.createTestingModule)
            .not.toHaveBeenCalled();

        expect(mocks.compile)
            .not.toHaveBeenCalled();
    });

});
