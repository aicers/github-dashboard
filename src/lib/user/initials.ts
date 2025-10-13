export function buildUserInitials({
  name,
  login,
  fallback,
}: {
  name?: string | null;
  login?: string | null;
  fallback?: string | null;
}) {
  const source = [name, login, fallback]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.length > 0);

  if (!source) {
    return "JD";
  }

  const parts = source
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return source.slice(0, 2).toUpperCase() || "JD";
  }

  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase();
}
