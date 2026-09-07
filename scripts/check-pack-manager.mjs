// npm ignores .pnpmfile.cjs, so packing or publishing with npm would include Eve.
// Installation of an already packed release works with any package manager.
const agent = process.env.npm_config_user_agent ?? "";
const match = /^pnpm\/(\d+)\.(\d+)\./.exec(agent);
if (!match || Number(match[1]) < 10 || (Number(match[1]) === 10 && Number(match[2]) < 28)) {
  throw new Error(
    "Use the pinned pnpm to pack or publish diff0 (corepack enable, then pnpm pack or pnpm publish). Its packaging hook excludes Eve from the CLI release.",
  );
}
