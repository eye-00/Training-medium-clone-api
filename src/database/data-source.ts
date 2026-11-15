import  'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseEnvSchema } from '../config/env.schema.js';
import { createDatabaseOptions } from './database.options.js';

const config = databaseEnvSchema.parse(process.env);
export default new DataSource(
    createDatabaseOptions(config),
);