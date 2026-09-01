import "reflect-metadata";
import { NextRequest } from "next/server";
import { plainToInstance } from "class-transformer";
import { validate, type ValidationError } from "class-validator";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { verifyAccessToken } from "./auth";
import { BadRequestError, ForbiddenError, HttpError, UnauthorizedError } from "./errors";
import { recordAuditLog } from "./audit";

// Replaces Nest's global JwtAuthGuard + RolesGuard + @RequiresModule +
// ValidationPipe + AuditInterceptor stack (4 separate primitives) with one
// function called at the top of every Route Handler. See the migration
// plan's "Route Handlers replace Nest's controller+guard+interceptor stack"
// section for the rationale — this is a mechanical port of behavior, not a
// redesign.

export interface RouteUser {
  userId: string;
  role: Role;
}

type DtoClass<T> = new () => T;

interface WithRouteOptions<TDto, TQuery> {
  /** Skip authentication entirely — mirrors Nest's @Public(). */
  public?: boolean;
  /** Mirrors @Roles(...) — omit to allow any authenticated user. */
  roles?: Role[];
  /** Mirrors @RequiresModule(x) — an employee without one of `roles` can
   *  still pass if they hold a ModuleAccessGrant for this module. */
  module?: string;
  /** class-validator DTO class to parse+validate the JSON body against. */
  dto?: DtoClass<TDto>;
  /** class-validator DTO class to parse+validate `?query=string` params against
   *  — mirrors Nest's `@Query() dto: SomeQueryDto`. */
  query?: DtoClass<TQuery>;
  /** Skip JSON body parsing entirely (e.g. multipart file uploads) — the
   *  handler reads `req.formData()`/`req.arrayBuffer()` itself. Mirrors a
   *  route using Nest's `@UseInterceptors(FileInterceptor(...))` instead of
   *  a JSON DTO body. */
  rawBody?: boolean;
}

type HandlerArgs<TDto, TQuery> = {
  req: NextRequest;
  user: RouteUser | null;
  body: TDto;
  query: TQuery;
  params: Record<string, string>;
};

type RouteContext = { params: Promise<Record<string, string>> };

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

function flattenValidationErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((err) => {
    const messages = err.constraints ? Object.values(err.constraints) : [];
    const nested = err.children?.length ? flattenValidationErrors(err.children) : [];
    return [...messages, ...nested];
  });
}

async function validateAgainstDto<T>(raw: unknown, dto?: DtoClass<T>): Promise<T> {
  if (!dto) return raw as T;
  // Mirrors Nest's global `ValidationPipe({ whitelist: true, transform: true })`.
  const instance = plainToInstance(dto, raw);
  const errors = await validate(instance as object, { whitelist: true });
  if (errors.length > 0) {
    throw new BadRequestError(flattenValidationErrors(errors).join("; "));
  }
  return instance;
}

async function parseBody<TDto>(req: NextRequest, dto?: DtoClass<TDto>, rawBody?: boolean): Promise<TDto> {
  if (rawBody || METHODS_WITHOUT_BODY.has(req.method)) return undefined as unknown as TDto;

  let raw: unknown = {};
  const text = await req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadRequestError("Request body must be valid JSON");
    }
  }
  return validateAgainstDto(raw, dto);
}

function parseQuery<TQuery>(req: NextRequest, dto?: DtoClass<TQuery>): Promise<TQuery> {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  return validateAgainstDto(raw, dto);
}

async function checkAuthorization<TDto, TQuery>(
  req: NextRequest,
  options: WithRouteOptions<TDto, TQuery>,
): Promise<RouteUser | null> {
  if (options.public) return null;

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new UnauthorizedError();
  const decoded = verifyAccessToken(token);
  if (!decoded) throw new UnauthorizedError();
  const user: RouteUser = { userId: decoded.userId, role: decoded.role as Role };

  if (options.roles && options.roles.length > 0 && !options.roles.includes(user.role)) {
    let allowedViaModuleGrant = false;
    if (options.module) {
      const grant = await prisma.moduleAccessGrant.findUnique({
        where: { employeeId_module: { employeeId: user.userId, module: options.module } },
      });
      allowedViaModuleGrant = !!grant;
    }
    if (!allowedViaModuleGrant) throw new ForbiddenError();
  }

  return user;
}

/** Reads a Response's body for audit logging without consuming the one returned to the client. */
async function readResponseBodyForAudit(response: Response): Promise<{ body: unknown; isFile: boolean }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { body: undefined, isFile: true };
  }
  try {
    return { body: await response.clone().json(), isFile: false };
  } catch {
    return { body: undefined, isFile: true };
  }
}

export function withRoute<TDto = unknown, TQuery = unknown>(
  options: WithRouteOptions<TDto, TQuery>,
  handler: (args: HandlerArgs<TDto, TQuery>) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext): Promise<Response> => {
    const params = (await ctx.params) ?? {};
    const path = req.nextUrl.pathname;
    const method = req.method;
    const shouldAudit = STATE_CHANGING_METHODS.has(method);

    let user: RouteUser | null = null;
    let requestBody: unknown;

    try {
      user = await checkAuthorization(req, options);
      const body = await parseBody(req, options.dto, options.rawBody);
      const query = await parseQuery(req, options.query);
      requestBody = options.rawBody ? "[raw body — not logged]" : body;

      const response = await handler({ req, user, body, query, params });

      if (shouldAudit) {
        const { body: responseBody, isFile } = await readResponseBodyForAudit(response);
        await recordAuditLog(prisma, {
          actorId: user?.userId,
          actorRole: user?.role,
          method,
          path,
          statusCode: response.status,
          requestBody,
          responseBody,
          isFileDownload: isFile,
        });
      }

      return response;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Internal server error";
      if (!(error instanceof HttpError)) {
        console.error(`Unhandled error in ${method} ${path}:`, error);
      }

      if (shouldAudit) {
        await recordAuditLog(prisma, {
          actorId: user?.userId,
          actorRole: user?.role,
          method,
          path,
          statusCode: status,
          requestBody,
          responseBody: { error: message },
        });
      }

      return Response.json({ message }, { status });
    }
  };
}
