import { ValidationError } from './errors.js';

// Por hora: el monto es lo que se paga por hora. Sueldo fijo: lo que se paga en cada periodo de 14 dias
export type PayKind = 'hourly' | 'salary';

export const PAY_KINDS: readonly PayKind[] = ['hourly', 'salary'];

// En centavos; el tope repite el CHECK de la base de datos
export const PAY_LIMITS = Object.freeze({ maxAmountCents: 1_000_000_000 });

export const PayRules = {
  assertAmount(amountCents: number): void {
    if (
      !Number.isInteger(amountCents) ||
      amountCents < 0 ||
      amountCents > PAY_LIMITS.maxAmountCents
    ) {
      throw new ValidationError(
        'INVALID_PAY_AMOUNT',
        'El monto debe estar en centavos, ser un número entero y no ser negativo',
      );
    }
  },

  // Codigo de moneda ISO 4217 que el motor de la plataforma reconoce, como USD o MXN
  assertCurrency(currency: string): void {
    if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf('currency').includes(currency)) {
      throw new ValidationError(
        'INVALID_CURRENCY',
        `"${currency}" no es una moneda válida (usa el código de 3 letras, p. ej. USD o MXN)`,
      );
    }
  },
};
