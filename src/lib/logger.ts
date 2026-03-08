type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = import.meta.env.DEV ? "debug" : "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function formatMessage(level: LogLevel, context: string, message: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] [${context}] ${message}`;
}

export const logger = {
  debug(context: string, message: string, data?: unknown) {
    if (shouldLog("debug")) console.debug(formatMessage("debug", context, message), data ?? "");
  },
  info(context: string, message: string, data?: unknown) {
    if (shouldLog("info")) console.info(formatMessage("info", context, message), data ?? "");
  },
  warn(context: string, message: string, data?: unknown) {
    if (shouldLog("warn")) console.warn(formatMessage("warn", context, message), data ?? "");
  },
  error(context: string, message: string, error?: unknown) {
    if (shouldLog("error")) console.error(formatMessage("error", context, message), error ?? "");
  },
};
