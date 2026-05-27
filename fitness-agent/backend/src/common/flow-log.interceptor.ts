import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { catchError, tap } from "rxjs";
import { writeFlowLog } from "./flow-log";

@Injectable()
export class FlowLogInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const started = Date.now();
    const method = request.method;
    const url = request.originalUrl ?? request.url;
    const userId = request.auth?.sub ?? request.user?.sub ?? request.user?.id;

    if (url === "/healthz") {
      return next.handle();
    }

    writeFlowLog("backend", "request.received", {
      method,
      url,
      query: request.query,
      body: request.body,
      headers: {
        authorization: request.headers?.authorization,
        contentType: request.headers?.["content-type"],
        userAgent: request.headers?.["user-agent"]
      },
      userId
    });

    return next.handle().pipe(
      tap((data) => {
        writeFlowLog("backend", "response.sent", {
          method,
          url,
          statusCode: response.statusCode,
          durationMs: Date.now() - started,
          userId,
          response: data
        });
      }),
      catchError((error) => {
        writeFlowLog("backend", "response.error", {
          method,
          url,
          statusCode: error?.status ?? response.statusCode,
          durationMs: Date.now() - started,
          userId,
          error: {
            name: error?.name,
            message: error?.message
          }
        });
        throw error;
      })
    );
  }
}
