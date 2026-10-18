// Type boundary for the shared transcript redactor; readers never return raw credential-looking text.
export function mask(text: string): string;
