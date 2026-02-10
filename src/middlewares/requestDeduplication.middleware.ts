import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Request deduplication middleware
 * Prevents duplicate submissions by tracking in-flight requests
 *
 * How it works:
 * 1. Generates a unique key from userId + method + path + body hash
 * 2. If a request with the same key is already in-flight, returns cached response
 * 3. Otherwise, processes the request and caches the response
 * 4. Cleans up after the request completes or times out
 */

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
  response?: {
    status: number;
    data: any;
  };
}

// In-memory store for pending requests
// Key: request hash, Value: pending request info
const pendingRequests = new Map<string, PendingRequest>();

// Cleanup interval: remove stale entries older than 5 seconds
const CLEANUP_INTERVAL = 5000; // 5 seconds
const REQUEST_TIMEOUT = 3000; // 3 seconds - max time to wait for duplicate

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, pending] of pendingRequests.entries()) {
    // Remove entries older than 5 seconds
    if (now - pending.timestamp > CLEANUP_INTERVAL) {
      pendingRequests.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Generate a unique key for the request
 * Uses: userId + method + path + body hash
 */
function generateRequestKey(req: Request): string {
  const userId = (req.user as any)?.id || "anonymous";
  const method = req.method;
  const path = req.path;

  // Create a hash of the request body
  // Sort keys to ensure consistent hashing regardless of key order
  const bodyStr = JSON.stringify(req.body || {}, Object.keys(req.body || {}).sort());
  const bodyHash = crypto.createHash("md5").update(bodyStr).digest("hex");

  // Include URL params for PUT/DELETE requests
  const paramsStr = JSON.stringify(req.params || {}, Object.keys(req.params || {}).sort());
  const paramsHash = crypto.createHash("md5").update(paramsStr).digest("hex");

  return `${userId}:${method}:${path}:${bodyHash}:${paramsHash}`;
}

/**
 * Request deduplication middleware
 * Must be used AFTER requireAuth middleware (needs req.user)
 */
export const preventDuplicateRequests = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Only apply to write operations (POST, PUT, PATCH, DELETE)
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const requestKey = generateRequestKey(req);
  const existingRequest = pendingRequests.get(requestKey);

  // If there's an existing in-flight request with the same key
  if (existingRequest) {
    const elapsed = Date.now() - existingRequest.timestamp;

    // If the existing request is very recent (within timeout window)
    if (elapsed < REQUEST_TIMEOUT) {
      // Wait for the existing request to complete and return its response
      existingRequest.promise
        .then((response) => {
          // Return the cached response
          return res.status(response.status || 200).json(response.data || response);
        })
        .catch((error) => {
          // If the original request failed, let this one proceed
          // Remove from cache and continue
          pendingRequests.delete(requestKey);
          next();
        });
      return; // Don't call next() - we're handling the response
    } else {
      // Existing request is stale, remove it
      pendingRequests.delete(requestKey);
    }
  }

  // Create a promise that will be resolved when the request completes
  let resolvePromise: ((value: any) => void) | null = null;
  let rejectPromise: ((error: any) => void) | null = null;

  const requestPromise = new Promise<any>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  // Store the pending request
  pendingRequests.set(requestKey, {
    promise: requestPromise,
    timestamp: Date.now(),
  });

  // Track if response has been sent
  let responseSent = false;

  // Override res.json to capture the response
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);
  const originalStatus = res.status.bind(res);

  // Override status to track status code
  res.status = function (code: number) {
    res.statusCode = code;
    return res;
  };

  // Override json to capture response
  res.json = function (body?: any) {
    if (!responseSent) {
      responseSent = true;
      const response = {
        status: res.statusCode || 200,
        data: body,
      };

      // Resolve the promise with the response
      if (resolvePromise) {
        resolvePromise(response);
      }

      // Clean up after a short delay (allow other duplicates to use this response)
      setTimeout(() => {
        pendingRequests.delete(requestKey);
      }, REQUEST_TIMEOUT);
    }

    return originalJson(body);
  };

  // Override send to capture response
  res.send = function (body?: any) {
    if (!responseSent) {
      responseSent = true;
      const response = {
        status: res.statusCode || 200,
        data: body,
      };

      if (resolvePromise) {
        resolvePromise(response);
      }

      setTimeout(() => {
        pendingRequests.delete(requestKey);
      }, REQUEST_TIMEOUT);
    }

    return originalSend(body);
  };

  // Override end to capture response
  res.end = function (chunk?: any, encoding?: any) {
    if (!responseSent) {
      responseSent = true;
      const response = {
        status: res.statusCode || 200,
        data: chunk,
      };

      if (resolvePromise) {
        resolvePromise(response);
      }

      setTimeout(() => {
        pendingRequests.delete(requestKey);
      }, REQUEST_TIMEOUT);
    }

    return originalEnd(chunk, encoding);
  };

  // Handle errors in the response
  res.on("finish", () => {
    if (!responseSent && resolvePromise) {
      responseSent = true;
      const response = {
        status: res.statusCode || 200,
        data: null,
      };
      resolvePromise(response);
      setTimeout(() => {
        pendingRequests.delete(requestKey);
      }, REQUEST_TIMEOUT);
    }
  });

  // Handle response errors
  res.on("error", (error: Error) => {
    if (rejectPromise) {
      rejectPromise(error);
    }
    setTimeout(() => {
      pendingRequests.delete(requestKey);
    }, 100);
  });

  // Continue to the next middleware/controller
  next();
};
