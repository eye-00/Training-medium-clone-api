import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUsers1794392512675 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE \`users\` (
                \`id\` varchar(36) NOT NULL,
                \`email\` varchar(255) NOT NULL,
                \`username\` varchar(100) NOT NULL,
                \`password_hash\` varchar(255) NOT NULL,
                \`bio\` text NULL,
                \`image\` varchar(2048) NULL,
                \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

                UNIQUE INDEX \`uq_users_email\` (\`email\`),
                UNIQUE INDEX \`uq_users_username\` (\`username\`),

                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB
             DEFAULT CHARSET=utf8mb4
             COLLATE=utf8mb4_unicode_ci;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`users\`;`);
    }

}
