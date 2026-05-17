import { CreateUserDto } from "./dto/create-user.dto";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Inject } from "@nestjs/common";
import { DRIZZLE } from "../../core/database/database.module";
import * as schema from "./users.schema";

export class UserRepository {
    constructor(@Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>) {}

    async createUserProfile(createUserDto: CreateUserDto) {
        // todo: insert new user to bd
        const newUser = {
            firstName: createUserDto.firstName,
            lastName: createUserDto.lastName,
            email: createUserDto.email,
            phoneNumber: String(createUserDto.phone),
            role: createUserDto.role,
            salary: String(createUserDto.salary),
            passwordHash: "temp_password",
            isActive: true
        }

        const [insertedUser] = await this.db
            .insert(schema.users)
            .values(newUser)
            .returning();
        
        return insertedUser;
    }
}