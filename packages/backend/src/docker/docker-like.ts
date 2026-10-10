import type { Readable } from 'stream';

export interface ContainerInspect {
  Id: string;
  Name: string;
  Config: { Tty: boolean; Image: string; Labels?: Record<string, string>; Env?: string[] };
  State: { Status: string; Running: boolean; StartedAt: string; Health?: { Status: 'starting' | 'healthy' | 'unhealthy' | 'none' } };
}

export interface DockerStatsSample {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
  memory_stats: { usage: number; limit: number; stats?: { cache?: number; inactive_file?: number } };
}

export interface DockerEvent { Type: string; Action: string; Actor: { ID: string; Attributes: Record<string, string> }; time: number }

export interface ContainerLike {
  inspect(): Promise<ContainerInspect>;
  start(): Promise<void>;
  stop(opts: { t: number }): Promise<void>;
  restart(opts: { t: number }): Promise<void>;
  stats(opts: { stream: false }): Promise<DockerStatsSample>;
  logs(opts: { follow: true; stdout: true; stderr: true; tail: number; timestamps: boolean }): Promise<Readable>;
  exec(opts: { Cmd: string[]; AttachStdout: true; AttachStderr: true }): Promise<{ start(opts: object): Promise<Readable>; inspect(): Promise<{ ExitCode: number | null; Running: boolean }> }>;
}

export interface DockerLike {
  /** Résout un conteneur par nom exact ; null s'il n'existe pas. */
  findByName(name: string): Promise<ContainerLike | null>;
  /** Flux d'événements filtré sur les noms donnés. */
  events(names: string[]): Promise<Readable>;
  /** Démultiplexe un flux non-TTY (en-têtes de 8 octets) en stdout/stderr. */
  demux(stream: Readable, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): void;
}
