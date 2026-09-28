import { AppError, type ErrorResponse } from "@belk/shared";
import * as Sentry from "@sentry/node";
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

/** One error envelope for every failure: { error: { code, message, request_id, details? } }. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((rawErr, req, reply) => {
    // Fastify types the thrown value as unknown; narrow once here.
    const err = rawErr as FastifyError;
    let body: ErrorResponse;
    let status: number;

    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, request_id: req.id, details: err.details } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: { code: "invalid_request", message: "Request validation failed", request_id: req.id, details: err.issues },
      };
    } else if (err.validation) {
      status = 400;
      body = {
        error: {
          code: "invalid_request",
          message: err.message,
          request_id: req.id,
          details: err.validation,
        },
      };
    } else if (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
      // Framework 4xx (payload too large, malformed JSON, ...): safe to surface the message.
      status = err.statusCode;
      body = { error: { code: status === 429 ? "rate_limited" : "invalid_request", message: err.message, request_id: req.id } };
    } else {
      status = 500;
      req.log.error({ err }, "unhandled error");
      Sentry.captureException(err, { tags: { request_id: req.id } });
      // Never leak internals to the client.
      body = { error: { code: "internal_error", message: "Internal server error", request_id: req.id } };
    }

    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ErrorResponse = {
      error: { code: "not_found", message: `Route ${req.method} ${req.url.split("?")[0]} not found`, request_id: req.id },
    };
    return reply.status(404).send(body);
  });
}
