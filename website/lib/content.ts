import { readFileSync } from "node:fs";
import { join } from "node:path";

const contentDir = join(process.cwd(), "content");

export function readContent(name: string): string {
  return readFileSync(join(contentDir, name), "utf8");
}
