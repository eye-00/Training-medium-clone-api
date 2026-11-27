
import {
    MigrationInterface,
    QueryRunner,
} from 'typeorm';

export class CreateAttachments1794908400000
    implements MigrationInterface {
    public async up(
        queryRunner: QueryRunner,
    ): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE \`attachments\` (
        \`id\` varchar(36) NOT NULL,
        \`owner_type\` varchar(32) NOT NULL,
        \`owner_id\` varchar(36) NOT NULL,
        \`kind\` varchar(32) NOT NULL,
        \`original_name\` varchar(255) NOT NULL,
        \`storage_key\` varchar(255) NOT NULL,
        \`mime_type\` varchar(100) NOT NULL,
        \`size_bytes\` int unsigned NOT NULL,
        \`visibility\` varchar(16) NOT NULL
          DEFAULT 'public',
        \`created_at\` datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6),

        PRIMARY KEY (\`id\`),

        UNIQUE INDEX \`uq_attachments_storage_key\`
          (\`storage_key\`),

        INDEX \`idx_attachments_owner\`
          (\`owner_type\`, \`owner_id\`, \`kind\`),

        CONSTRAINT \`ck_attachments_size\`
          CHECK (\`size_bytes\` > 0),

        CONSTRAINT \`ck_attachments_visibility\`
          CHECK (\`visibility\` IN ('public', 'private'))
      )
      ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);
    }

    public async down(
        queryRunner: QueryRunner,
    ): Promise<void> {
        await queryRunner.query(
            'DROP TABLE `attachments`;',
        );
    }
}
