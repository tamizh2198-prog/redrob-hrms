// Mirrors Nest's HttpException subclasses used throughout the ported
// services (BadRequestException, UnauthorizedException, etc.) — withRoute()
// catches these and turns them into the same `{ message }` JSON shape the
// frontend's ApiError already expects.
export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(message, 400);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(message, 409);
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message = "Too many requests — please wait before trying again.") {
    super(message, 429);
  }
}
