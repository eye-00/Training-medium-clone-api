
import {
    type MigrationInterface,
    type QueryRunner,
} from 'typeorm';

export class NormalizeUserAvatarReference1794994800000
    implements MigrationInterface {
    public async up(
        queryRunner: QueryRunner,
    ): Promise<void> {
        // Refuse to silently convert unrecognized references.
        const rows = (await queryRunner.query(`
      SELECT COUNT(*) AS total
      FROM users u
      WHERE u.image IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM attachments a
          WHERE a.owner_type = 'user'
            AND a.owner_id = u.id
            AND a.kind = 'avatar'
            AND (
              u.image = a.id
              OR u.image = CONCAT('/api/avatars/', a.id)
            )
        )
    `)) as Array<{ total: string | number }>;

        if (Number(rows[0]?.total ?? 0) !== 0) {
            throw new Error(
                'Unrecognized avatar references found. Inspect users.image before migration.',
            );
        }

        await queryRunner.query(`
      UPDATE users u
      INNER JOIN attachments a
        ON a.owner_type = 'user'
        AND a.owner_id = u.id
        AND a.kind = 'avatar'
        AND u.image = CONCAT('/api/avatars/', a.id)
      SET u.image = a.id
    `);
    }

    public async down(
        queryRunner: QueryRunner,
    ): Promise<void> {
        await queryRunner.query(`
      UPDATE users u
      INNER JOIN attachments a
        ON a.owner_type = 'user'
        AND a.owner_id = u.id
        AND a.kind = 'avatar'
        AND u.image = a.id
      SET u.image = CONCAT('/api/avatars/', a.id)
    `);
    }
}
