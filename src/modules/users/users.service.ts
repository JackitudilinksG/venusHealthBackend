// import { Injectable, Logger } from '@nestjs/common';
// import { CreateUserDto } from './dto/create-user.dto';
// import { UpdateUserDto } from './dto/update-user.dto';
// import { AuthRerpository } from '../auth/auth.repository';

// @Injectable()
export class UsersService {
  // private readonly logger = new Logger(UsersService.name);
  // constructor(private readonly authRepository: AuthRerpository) {}

  create() {
    return 'This action adds a new user';
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
