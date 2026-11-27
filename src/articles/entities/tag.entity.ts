
import {
    Column,
    Entity,
    Index,
    PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'tags' })
@Index('uq_tags_name', ['name'], {
    unique: true,
})
export class Tag {
    @PrimaryColumn({
        type: 'varchar',
        length: 36,
    })
    id!: string;

    @Column({
        type: 'varchar',
        length: 100,
    })
    name!: string;
}
