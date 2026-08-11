import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const worker = fileURLToPath(new URL("./check-browser.js", import.meta.url));

try {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", worker], {
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  if (typeof error?.stdout === "string") process.stdout.write(error.stdout);
  if (typeof error?.stderr === "string") process.stderr.write(error.stderr);
  if (error?.killed && error.signal === "SIGKILL") {
    process.stderr.write("The real-browser release gate exceeded its 60-second absolute deadline.\n");
    process.exitCode = 1;
  } else {
    if (!error?.stderr && error instanceof Error) process.stderr.write(`${error.message}\n`);
    process.exitCode = typeof error?.code === "number" ? error.code : 1;
  }
}
