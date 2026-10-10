export interface RconConnection {
  send(cmd: string): Promise<string>;
  end(): Promise<void> | void;
  on(event: 'end' | 'error', cb: (err?: Error) => void): void;
}
export interface RconLike { connect(opts: { host: string; port: number; password: string; timeout: number }): Promise<RconConnection> }
