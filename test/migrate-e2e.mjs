import { MigrationExecutor } from 'typeorm';
import {
    acquireE2eDatabaseLock,
    assertDedicatedE2eEnvironment,
    verifyDedicatedE2eDatabase,
} from './helpers/dedicated-e2e-database.ts';

const expectedUuid = assertDedicatedE2eEnvironment();
const { default: dataSource } = await import('../dist/database/data-source.js');
await dataSource.initialize();
try {
    const runner = dataSource.createQueryRunner();
    try {
        await runner.connect();
        await verifyDedicatedE2eDatabase(runner, expectedUuid);
        await acquireE2eDatabaseLock(runner);
        const migrations = new MigrationExecutor(dataSource, runner);
        const applied = await migrations.executePendingMigrations();
        console.log(`Applied ${applied.length} migration(s) to the dedicated E2E database.`);
    } finally {
        await runner.release();
    }
} finally {
    await dataSource.destroy();
}
