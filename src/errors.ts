/** Stable failure categories; human-facing wording is not part of exit policy. */
export class ConfigurationError extends Error {
  readonly code = "CONFIGURATION";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}

export class RefError extends ConfigurationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RefError";
  }
}

export class CommandTimeoutError extends Error {
  readonly code = "COMMAND_TIMEOUT";
  constructor(
    bin: string,
    args: string[],
    readonly timeoutMs: number,
  ) {
    super(`${bin} ${args.join(" ")} timed out after ${timeoutMs}ms`);
    this.name = "CommandTimeoutError";
  }
}
