import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ApiError) {
    void reply
      .status(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error.validation) {
    void reply
      .status(400)
      .send({ error: { code: "validation_error", message: error.message } });
    return;
  }
  if (error.statusCode === 429) {
    void reply.status(429).send({
      error: { code: "rate_limited", message: "Rate limit exceeded" },
    });
    return;
  }
  request.log.error(error);
  void reply.status(500).send({
    error: { code: "internal_error", message: "Internal server error" },
  });
}
