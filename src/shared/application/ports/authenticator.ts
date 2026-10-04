import type { Actor } from '../actor.js';

export interface Authenticator {
  authenticate(accessToken: string): Promise<Actor>;
}
