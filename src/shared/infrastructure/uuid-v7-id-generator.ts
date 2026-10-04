import { v7 as uuidv7 } from 'uuid';
import type { IdGenerator } from '#shared/application/ports/id-generator.js';

export class UuidV7IdGenerator implements IdGenerator {
  generate(): string {
    return uuidv7();
  }
}
