
import {
    type MigrationInterface,
    type QueryRunner,
} from 'typeorm';

export class CreateArticleRelations1795165200000
    implements MigrationInterface {
    public async up(
        queryRunner: QueryRunner,
    ): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE \`tags\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(100) NOT NULL,

        PRIMARY KEY (\`id\`),

        UNIQUE INDEX \`uq_tags_name\`
          (\`name\`)
      ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
        COLLATE=utf8mb4_unicode_ci;
    `);

        await queryRunner.query(`
      CREATE TABLE \`article_tags\` (
        \`article_id\` varchar(36) NOT NULL,
        \`tag_id\` varchar(36) NOT NULL,

        PRIMARY KEY (\`article_id\`, \`tag_id\`),

        INDEX \`idx_article_tags_tag_article\`
          (\`tag_id\`, \`article_id\`),

        CONSTRAINT \`fk_article_tags_article\`
          FOREIGN KEY (\`article_id\`)
          REFERENCES \`articles\` (\`id\`)
          ON DELETE CASCADE,

        CONSTRAINT \`fk_article_tags_tag\`
          FOREIGN KEY (\`tag_id\`)
          REFERENCES \`tags\` (\`id\`)
          ON DELETE CASCADE
      ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
        COLLATE=utf8mb4_unicode_ci;
    `);

        await queryRunner.query(`
      CREATE TABLE \`article_favorites\` (
        \`user_id\` varchar(36) NOT NULL,
        \`article_id\` varchar(36) NOT NULL,

        \`created_at\` datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6),

        PRIMARY KEY (\`user_id\`, \`article_id\`),

        INDEX \`idx_article_favorites_article_user\`
          (\`article_id\`, \`user_id\`),

        CONSTRAINT \`fk_article_favorites_user\`
          FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`)
          ON DELETE CASCADE,

        CONSTRAINT \`fk_article_favorites_article\`
          FOREIGN KEY (\`article_id\`)
          REFERENCES \`articles\` (\`id\`)
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
            'DROP TABLE `article_favorites`;',
        );

        await queryRunner.query(
            'DROP TABLE `article_tags`;',
        );

        await queryRunner.query(
            'DROP TABLE `tags`;',
        );
    }
}
