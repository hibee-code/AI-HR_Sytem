import { registerDecorator, ValidationOptions } from 'class-validator';

/** Number must be a multiple of 0.5 (leave is tracked in half days). */
export function IsHalfStep(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isHalfStep',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'must be a multiple of 0.5', ...options },
      validator: {
        validate: (v: unknown) =>
          typeof v === 'number' &&
          Number.isFinite(v) &&
          Math.round(v * 2) === v * 2,
      },
    });
  };
}
