const { execSync } = require("node:child_process");

const port = Number(process.env.PORT || 3000);
const platform = process.platform;

if (Number.isNaN(port)) {
  process.exit(0);
}

if (platform !== "darwin" && platform !== "linux") {
  process.exit(0);
}

try {
  const output = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
  if (!output) {
    process.exit(0);
  }
  const pids = output
    .split("\n")
    .map((pid) => pid.trim())
    .filter(Boolean);
  if (!pids.length) {
    process.exit(0);
  }
  execSync(`kill -9 ${pids.join(" ")}`, { stdio: "ignore" });
} catch {
  process.exit(0);
}
