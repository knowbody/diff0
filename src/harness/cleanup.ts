/** Cleanup diagnostics must never replace the operation's primary failure. */
export async function cleanupResources(
  resources: ReadonlyArray<{ cleanup(): Promise<void> }>,
  progress: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<void> {
  for (const resource of resources) {
    try {
      await resource.cleanup();
    } catch (error) {
      try {
        progress(
          `warning: cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch {
        // Observability must not interrupt cleanup of other owned resources.
      }
    }
  }
}
