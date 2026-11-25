import {
    type MigrationInterface,
    type QueryRunner,
} from 'typeorm';

export class CreateComments1795500000000
    implements MigrationInterface {
    public async up(
        queryRunner: QueryRunner,
    ): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE \`comments\` (
                \`id\` int unsigned NOT NULL AUTO_INCREMENT,

                \`article_id\` varchar(36) NOT NULL,
                \`author_id\` varchar(36) NOT NULL,

                \`body\` text NOT NULL,

                \`created_at\` datetime(6) NOT NULL
                    DEFAULT CURRENT_TIMESTAMP(6),

                \`updated_at\` datetime(6) NOT NULL
                    DEFAULT CURRENT_TIMESTAMP(6)
                    ON UPDATE CURRENT_TIMESTAMP(6),

                PRIMARY KEY (\`id\`),

                INDEX \`idx_comments_article_created_id\`
                    (\`article_id\`, \`created_at\`, \`id\`),

                INDEX \`idx_comments_author\`
                    (\`author_id\`),

                CONSTRAINT \`fk_comments_article\`
                    FOREIGN KEY (\`article_id\`)
                    REFERENCES \`articles\` (\`id\`)
                    ON DELETE CASCADE,

                CONSTRAINT \`fk_comments_author\`
                    FOREIGN KEY (\`author_id\`)
                    REFERENCES \`users\` (\`id\`)
                    ON DELETE CASCADE

            ) ENGINE=InnoDB
                DEFAULT CHARSET=utf8mb4
                COLLATE=utf8mb4_unicode_ci;
        `);
    }

    public async down(
        queryRunner: QueryRunner,
    ): Promise<void> {
        await queryRunner.query(
            'DROP TABLE `comments`;',
        );
    }
}
