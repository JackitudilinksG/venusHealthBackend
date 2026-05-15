import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRerpository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRerpository]
})
export class AuthModule {}
