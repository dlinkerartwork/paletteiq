import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
const managedLinux = readExecutionProfile() === "managed-linux";

// Optional local-only diagnostic. Leave disabled by default so normal API
// payloads and external responses are never inspected during routine use.
if (command === "dev" && process.env.PALETTEIQ_TRACE_INVALID_JSON === "1") {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const json = response.json.bind(response);
    response.json = async () => {
      let copy;
      try { copy = response.clone(); } catch { /* already consumed */ }
      try {
        return await json();
      } catch (error) {
        if (error instanceof SyntaxError) {
          let prefix = "";
          try {
            const raw = copy ? await copy.text() : "";
            prefix = raw.slice(0, 160)
              .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
              .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
              .replace(/https?:\\/\\/[^\\s"'<>]+/g, "[REDACTED_URL]");
          } catch { /* preserve the original parse error */ }
          let pathname = "<unavailable>";
          try { pathname = new URL(response.url).pathname; } catch {}
          process.stderr.write("[PaletteIQ invalid JSON] HTTP " + response.status +
            " path=" + pathname + " content-type=" +
            (response.headers.get("content-type") || "missing") +
            " body-prefix=" + JSON.stringify(prefix) + "\\n");
        }
        throw error;
      }
    };
    return response;
  };
}


if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
