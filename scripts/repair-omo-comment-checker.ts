import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const packageSpec = "@code-yeongyu/comment-checker@0.8.0";
const bun = Bun.which("bun");

if (bun === null) {
  throw new Error("Bun is required to repair OMO's comment-checker dependency");
}

const install = Bun.spawn([bun, "add", "--global", packageSpec], {
  stdout: "inherit",
  stderr: "inherit",
});

if ((await install.exited) !== 0) {
  throw new Error(`Failed to install ${packageSpec} globally`);
}

const bunInstall = process.env.BUN_INSTALL ?? join(homedir(), ".bun");
const omoExtension = join(
  bunInstall,
  "install",
  "global",
  "node_modules",
  "omo-ai",
  "plugin",
  "extensions",
  "omo.js",
);

if (!existsSync(omoExtension)) {
  throw new Error(`Cannot find OMO extension at ${omoExtension}`);
}

const checker = createRequire(omoExtension)(
  "@code-yeongyu/comment-checker",
) as {
  getBinaryPath?: () => string;
};
const binaryPath = checker.getBinaryPath?.();

if (typeof binaryPath !== "string" || !existsSync(binaryPath)) {
  throw new Error("OMO cannot resolve a usable comment-checker binary");
}

console.log(
  `Installed ${packageSpec}; OMO resolves ${binaryPath}. Restart OMO.`,
);
