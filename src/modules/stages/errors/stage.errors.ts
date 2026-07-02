export class StageError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StageError";
    this.status = status;
  }
}
