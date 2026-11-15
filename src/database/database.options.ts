import {join} from 'node:path';
import type {DataSourceOptions} from 'typeorm';
import type {DatabaseEnv} from '../config/env.schema.js';

export function createDatabaseOptions(
    config: DatabaseEnv,
): DataSourceOptions {
    return {
        type: 'mysql',
        host: config.DB_HOST,
        port: config.DB_PORT,
        username: config.DB_USERNAME,
        password: config.DB_PASSWORD,
        database: config.DB_DATABASE,

        entities: [join(import.meta.dirname, '..', '**', '*.entity.js')],
        migrations: [join(import.meta.dirname, 'migrations', '*.js')],
        migrationsTableName: 'migrations',

        synchronize: false,
        migrationsRun: false,
        logging: false,
    };
}