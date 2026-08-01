export class HttpError extends Error {
  statusCode: number;
  code: string;

  // Node's default type-stripping (no --experimental-transform-types flag,
  // which this repo's npm scripts don't set) only supports erasable-only
  // TypeScript syntax -- constructor parameter properties are not erasable,
  // so fields are declared and assigned explicitly instead.
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
