/**
 * Docker'a ince bir sarmalayıcı.
 *
 * HTTP API yerine CLI kullanılıyor: bağımlılık yok, çıktısı okunabilir,
 * kullanıcının zaten bildiği arayüz, ve Docker Desktop / Colima / Podman
 * arasında taşınabilir. Bu ölçekte (bir makinede birkaç düzine bot) süreç
 * başlatma maliyeti önemsiz.
 *
 * Sırlar KOMUT SATIRINA yazılmaz. `docker run -e KEY=VALUE` değeri argv'ye
 * koyar ve aynı makinedeki başka kullanıcılar bunu `ps` ile görebilir. Bunun
 * yerine değersiz `-e KEY` biçimi kullanılır; Docker CLI değeri kendi
 * ortamından alır, biz de onu alt sürecin ortamına koyarız.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Mount = {
  host: string;
  container: string;
  readonly?: boolean;
};

export type PortPublish = {
  /** Varsayılan 127.0.0.1 — bot API'si makine dışına açılmamalı. */
  hostIp?: string;
  hostPort: number;
  containerPort: number;
};

export type RunOptions = {
  name: string;
  image: string;
  command: string[];
  mounts?: Mount[];
  /** Değerler argv'ye değil, alt sürecin ortamına konur. */
  env?: Record<string, string>;
  publish?: PortPublish[];
  labels?: Record<string, string>;
  /** Varsayılan "unless-stopped": bot makine yeniden başlasa da geri gelsin. */
  restart?: "no" | "unless-stopped" | "on-failure";
};

export type ContainerState = {
  id: string;
  running: boolean;
  status: string;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export class DockerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerError";
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

export async function runContainer(options: RunOptions): Promise<string> {
  const {
    name,
    image,
    command,
    mounts = [],
    env = {},
    publish = [],
    labels = {},
    restart = "unless-stopped",
  } = options;

  const args = ["run", "--detach", "--name", name, "--restart", restart];

  for (const mount of mounts) {
    args.push("--volume", `${mount.host}:${mount.container}${mount.readonly ? ":ro" : ""}`);
  }

  for (const port of publish) {
    args.push("--publish", `${port.hostIp ?? "127.0.0.1"}:${port.hostPort}:${port.containerPort}`);
  }

  // Yalnızca anahtar adı; değer alt sürecin ortamından okunur.
  for (const key of Object.keys(env)) args.push("--env", key);

  for (const [key, value] of Object.entries(labels)) args.push("--label", `${key}=${value}`);

  args.push(image, ...command);

  try {
    const { stdout } = await run("docker", args, { env: { ...process.env, ...env } });
    return stdout.trim();
  } catch (error) {
    throw new DockerError(`failed to start container ${name}: ${describeError(error)}`);
  }
}

export async function inspectContainer(name: string): Promise<ContainerState | null> {
  try {
    const { stdout } = await run("docker", [
      "inspect",
      "--format",
      "{{.Id}}\t{{.State.Running}}\t{{.State.Status}}\t{{.State.ExitCode}}\t{{.State.StartedAt}}\t{{.State.FinishedAt}}",
      name,
    ]);

    const [id, running, status, exitCode, startedAt, finishedAt] = stdout.trim().split("\t");

    return {
      id: id ?? "",
      running: running === "true",
      status: status ?? "unknown",
      exitCode: exitCode === undefined ? null : Number(exitCode),
      startedAt: startedAt ?? null,
      finishedAt: finishedAt ?? null,
    };
  } catch {
    // Olmayan container için docker sıfırdan farklı çıkar — bu bir hata değil.
    return null;
  }
}

export async function stopContainer(name: string, timeoutSeconds = 30): Promise<void> {
  try {
    await run("docker", ["stop", "--time", String(timeoutSeconds), name]);
  } catch (error) {
    if (await inspectContainer(name)) {
      throw new DockerError(`failed to stop container ${name}: ${describeError(error)}`);
    }
    // Container zaten yok — istenen sonuç bu.
  }
}

export async function removeContainer(name: string): Promise<void> {
  try {
    await run("docker", ["rm", "--force", name]);
  } catch (error) {
    if (await inspectContainer(name)) {
      throw new DockerError(`failed to remove container ${name}: ${describeError(error)}`);
    }
  }
}

export async function containerLogs(name: string, tail = 50): Promise<string> {
  try {
    const { stdout, stderr } = await run("docker", ["logs", "--tail", String(tail), name]);
    // Freqtrade stderr'e loglar; ikisini de döndürüyoruz.
    return [stderr, stdout].filter(Boolean).join("\n").trim();
  } catch {
    return "";
  }
}

/** Bir etikete sahip container adlarını listeler — yetim container bulmak için. */
export async function listContainers(label: string): Promise<string[]> {
  try {
    const { stdout } = await run("docker", [
      "ps", "--all", "--filter", `label=${label}`, "--format", "{{.Names}}",
    ]);
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr: unknown }).stderr).trim();
    if (stderr) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}
