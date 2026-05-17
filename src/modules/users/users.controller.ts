import { Controller, Get, Post, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
//import { CreateUserDto } from './dto/create-user.dto';
//import { UpdateUserDto } from './dto/update-user.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('admin')
  @ApiOperation({summary: 'Admin-only user creation'})
  create() {
    return this.usersService.create();
  }

  @Get()
  @Roles('admin')
  @ApiOperation({summary: 'Admin-only user display all'})
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({summary: 'Admin-only user display one'})
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({summary: 'Admin-only user updation'})
  update(@Param('id') id: string) {
    return this.usersService.update(+id);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({summary: 'Admin-only user deletion'})
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
