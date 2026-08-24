// HTTP-aware error for upload parsing/validation failures.
export class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}
