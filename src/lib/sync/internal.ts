export function coerceIso(value: unknown) {
  if (!value) {
    return null;
  }

  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
