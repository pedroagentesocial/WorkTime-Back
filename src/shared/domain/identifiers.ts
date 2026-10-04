// Sin I, L, O, U ni 0 y 1 para poder dictar los codigos por telefono o correo
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const PREFIX_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ';

export type RandomInt = (maxExclusive: number) => number;

const pick = (alphabet: string, randomInt: RandomInt, length: number): string =>
  Array.from({ length }, () => alphabet.charAt(randomInt(alphabet.length))).join('');

export const IDENTIFIER_PATTERNS = {
  companyCode: /^[A-Z2-9]{4}-[A-Z2-9]{4}$/,
  employeePrefix: /^[A-Z]{3}$/,
  employeeCode: /^[A-Z]{3}-[0-9]{4,}$/,
} as const;

export const Identifiers = {
  // Identifica a la empresa en soporte. No es un secreto ni sirve para autenticar
  companyCode(randomInt: RandomInt): string {
    return `${pick(CODE_ALPHABET, randomInt, 4)}-${pick(CODE_ALPHABET, randomInt, 4)}`;
  },

  employeePrefix(randomInt: RandomInt): string {
    return pick(PREFIX_ALPHABET, randomInt, 3);
  },

  employeeCode(prefix: string, sequence: number): string {
    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  },
} as const;
