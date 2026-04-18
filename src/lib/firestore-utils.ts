import { FieldValue } from "firebase/firestore";

/**
 * Recursively removes undefined values from an object, which Firestore doesn't support.
 * It preserves nulls and Firestore special values like FieldValue.
 */
export function sanitizeData(data: any): any {
  if (data === undefined) return null; // Or return nothing/skip in object loop
  if (data === null) return null;
  
  // Handle Firestore FieldValue and other special objects (Date, etc.)
  if (data instanceof FieldValue || data instanceof Date) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(v => sanitizeData(v));
  }

  if (typeof data === 'object' && data.constructor === Object) {
    const sanitized: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const value = data[key];
        if (value !== undefined) {
          sanitized[key] = sanitizeData(value);
        }
      }
    }
    return sanitized;
  }

  return data;
}
