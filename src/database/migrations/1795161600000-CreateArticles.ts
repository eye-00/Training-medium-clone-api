
import {
    type MigrationInterface,
    type QueryRunner,
} from 'typeorm';

export class CreateArticles1795161600000
    implements MigrationInterface {
    public async up(
        queryRunner: QueryRunner,
    ): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE \`articles\` (
        \`id\` varchar(36) NOT NULL,
        \`slug\` varchar(255) NOT NULL,
        \`title\` varchar(255) NOT NULL,
        \`description\` text NOT NULL,
        \`body\` longtext NOT NULL,
        \`author_id\` varchar(36) NOT NULL,

        \`created_at\` datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6),

        \`updated_at\` datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),

        PRIMARY KEY (\`id\`),

        UNIQUE INDEX \`uq_articles_slug\`
          (\`slug\`),

        INDEX \`idx_articles_created_id\`
          (\`created_at\`, \`id\`),

        INDEX \`idx_articles_author_created_id\`
          (\`author_id\`, \`created_at\`, \`id\`),

        CONSTRAINT \`fk_articles_author\`
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
            'DROP TABLE `articles`;',
        );
    }
}
