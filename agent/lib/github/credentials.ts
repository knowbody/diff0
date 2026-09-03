import { connectGitHubCredentials } from "@vercel/connect/eve";

/**
 * Vercel Connect connector UID for the factory's GitHub App installation.
 *
 * @remarks
 * One connector serves every GitHub surface: the channel (webhooks, replies),
 * the `github` extension's tools, trusted branch publication, and the
 * read-only credential station sandboxes clone and fetch with. The checked-in fallback belongs to
 * the diff0 deployment; forks set `GITHUB_CONNECTOR` to their own connector.
 */
if (process.env.VERCEL === "1" && !process.env.GITHUB_CONNECTOR) {
  throw new Error("GITHUB_CONNECTOR must be set for a Vercel deployment.");
}
export const GITHUB_CONNECTOR = process.env.GITHUB_CONNECTOR ?? "github/diff0-eve";

/**
 * Connect-managed GitHub App credentials shared by the channel and the git
 * helpers.
 *
 * @remarks
 * Tokens are resolved lazily per use and never exposed to the model; the git
 * read helpers inject them at the sandbox firewall only for upload-pack. Write
 * operations use the token in trusted app runtime and never expose it to the sandbox.
 */
export const githubCredentials = connectGitHubCredentials(GITHUB_CONNECTOR);
