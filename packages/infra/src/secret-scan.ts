import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const allowMarker = "secret-scan: allow";
const placeholderPattern =
  /example|placeholder|replace[-_ ]?me|replace[-_ ]?with|development|dummy|not.?use|not[-_ ]?a[-_ ]?secret|your-super-secret|insecure|test[-_ ]?password|smoke[-_ ]?test/i;

const rules = [
  {
    name: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "github-token", pattern: /gh[pousr]_[0-9A-Za-z]{30,}/ },
  { name: "slack-token", pattern: /xox[baprs]-[0-9A-Za-z-]{20,}/ },
  {
    name: "credential-assignment",
    pattern:
      /(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?([0-9A-Za-z+/_=-]{20,})/i
  }
] as const;

export type SecretFinding = {
  file: string;
  line: number;
  rule: (typeof rules)[number]["name"];
};

export function findPotentialSecrets(
  file: string,
  content: string
): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (line.includes(allowMarker) || placeholderPattern.test(line)) {
      continue;
    }

    for (const rule of rules) {
      const match = rule.pattern.exec(line);
      const assignedValue = match?.[1];
      const isCodeIdentifier =
        rule.name === "credential-assignment" &&
        assignedValue !== undefined &&
        /^[a-z]+(?:_[a-z]+)+$/u.test(assignedValue);

      if (match && !isCodeIdentifier) {
        findings.push({ file, line: index + 1, rule: rule.name });
      }
    }
  }

  return findings;
}

async function trackedAndUnignoredFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard"
  ]);

  return stdout.split(/\r?\n/u).filter(Boolean);
}

export async function scanFiles(files: string[]): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];

  for (const file of files) {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > 2_000_000) {
      continue;
    }

    const buffer = await readFile(file);
    if (buffer.includes(0)) {
      continue;
    }

    findings.push(...findPotentialSecrets(file, buffer.toString("utf8")));
  }

  return findings;
}

async function main(): Promise<void> {
  const requestedFiles = process.argv
    .slice(2)
    .filter((value) => value !== "--");
  const files =
    requestedFiles.length > 0
      ? requestedFiles
      : await trackedAndUnignoredFiles();
  const findings = await scanFiles(files);

  if (findings.length > 0) {
    console.error("Potential secrets detected:");
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Secret scan passed (${files.length} files checked).`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
