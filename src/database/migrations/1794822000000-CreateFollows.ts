import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateFollows1794822000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE \`follows\` (
                \`follower_id\` varchar(36) NOT NULL,
                \`followed_id\` varchar(36) NOT NULL,
                \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

                PRIMARY KEY (\`follower_id\`, \`followed_id\`),
                INDEX \`idx_follows_followed_id\` (\`followed_id\`),

                CONSTRAINT \`fk_follows_follower\`
                FOREIGN KEY (\`follower_id\`)
                REFERENCES \`users\` (\`id\`)
                ON DELETE CASCADE,

                CONSTRAINT \`fk_follows_followed\`
                FOREIGN KEY (\`followed_id\`)
                REFERENCES \`users\` (\`id\`)
                ON DELETE CASCADE,

                CONSTRAINT \`ck_follows_not_self\`
                CHECK (\`follower_id\` <> \`followed_id\`)
            )
                ENGINE=InnoDB
                DEFAULT CHARSET=utf8mb4
                COLLATE=utf8mb4_unicode_ci;
                `);
    }
    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE `follows`;');
    }
}
