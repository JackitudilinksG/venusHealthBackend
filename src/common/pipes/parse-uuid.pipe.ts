import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { validate as validateUuid } from 'uuid';

@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!validateUuid(value)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }

    return value;
  }
}
