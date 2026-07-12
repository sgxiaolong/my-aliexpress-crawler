export class HttpError extends Error {
  constructor(status, errorCode, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.errorCode = errorCode;
    this.extra = extra;
  }
}

export const sendError = (res, error) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      success: false,
      error_code: error.errorCode,
      message: error.message,
      ...error.extra,
    });
  }

  return res.status(500).json({
    success: false,
    error_code: "INTERNAL_ERROR",
    message: error.message || "服务内部异常",
  });
};
