import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function checkRelease({ version, tag }) {
  const problems = [];
  if (tag === null || tag === undefined || tag === "") {
    problems.push("HEAD 无 tag（git describe --exact-match HEAD 失败）——release 未完成");
  } else if (tag !== `v${version}` && tag !== version) {
    problems.push(`tag「${tag}」与 package.json version「${version}」不一致`);
  }
  return problems;
}

export function readCurrentTag({ exec = execSync, root = process.cwd() } = {}) {
  try {
    return exec("git describe --exact-match HEAD", { encoding: "utf8", cwd: root }).trim();
  } catch {
    return null;
  }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const tag = readCurrentTag({ root: ROOT });
  const problems = checkRelease({ version: pkg.version, tag });
  if (problems.length) {
    console.error(`Release check FAILED:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Release check passed: tag=${tag} == version=${pkg.version}`);
}
