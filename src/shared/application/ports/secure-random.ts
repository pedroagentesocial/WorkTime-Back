export interface SecureRandom {
  token(bytes?: number): string;
  int(maxExclusive: number): number;
  password(length: number): string;
  sha256(value: string): string;
}
