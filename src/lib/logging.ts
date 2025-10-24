/**
 * Augment Node.js console output with UTC timestamps so every stdout/stderr line
 * is prefixed consistently (for example "[2024-05-01T12:34:56.789Z] message").
 * The patch runs only on the server; browser consoles remain unchanged.
 */
const isServerEnvironment = typeof window === "undefined";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

function formatWithTimestamp(args: unknown[]): unknown[] {
  const timestamp = new Date().toISOString();
  if (args.length === 0) {
    return [`[${timestamp}]`];
  }

  const [first, ...rest] = args;
  if (typeof first === "string") {
    return [`[${timestamp}] ${first}`, ...rest];
  }

  return [`[${timestamp}]`, first, ...rest];
}

const marker = "__githubDashboardConsolePatched";

if (
  isServerEnvironment &&
  !(console as typeof console & Record<string, boolean>)[marker]
) {
  const methods: ConsoleMethod[] = ["log", "info", "warn", "error", "debug"];
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...formatWithTimestamp(args));
    };
  }
  (console as typeof console & Record<string, boolean>)[marker] = true;
}
