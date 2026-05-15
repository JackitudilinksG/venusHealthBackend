import { Inject } from "@nestjs/common";
import { DRIZZLE } from "../../core/database/database.module";
import * as schema from './auth.schema'; 
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

export class AuthRerpository {
    constructor(@Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>) {}

    async findUserByEmail(email: string) {
        const result = await this.db
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, email))
            .limit(1);

        return result[0];
    }
}