import { Request, Response, NextFunction } from 'express';

// Remove 'req' if unused, or prefix with _
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  res.status(500).json({ error: err.message || 'Internal Server Error' });
}
