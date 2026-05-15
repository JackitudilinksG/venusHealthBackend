import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as authSchema from '../../modules/auth/auth.schema';
import { drizzle } from 'drizzle-orm/node-postgres';

export const DRIZZLE = 'DRIZZLE';

@Global()
@Module({
    providers: [{
        provide: DRIZZLE,
        inject: [ConfigService],
        useFactory: async (configService: ConfigService) => {
            const pool = new Pool({
                connectionString: configService.getOrThrow('DATABASE_URL')
            })

            pool.on('error', (err) => {
                const logger = new Logger(DatabaseModule.name);
                logger.log('Error while connecting to DB:', err);
                process.exit(-1);
            });

            return drizzle(pool, {schema: {...authSchema}});
        }
    }],
    exports: [DRIZZLE]
})
export class DatabaseModule {}
