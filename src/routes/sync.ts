import { Router, Request, Response } from 'express';
import { SyncService } from '../services/syncService';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';

export function createSyncRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  // Trigger manual sync
  router.post('/sync', async (req: Request, res: Response) => {
    try {
      const hasConnectivity = await syncService.checkConnectivity();
      if (!hasConnectivity) {
        return res.status(503).json({ error: 'Server is unreachable for sync' });
      }
      const result = await syncService.sync();
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Check sync status
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const tasksNeedingSync = await taskService.getTasksNeedingSync();
      const pendingSyncCount = tasksNeedingSync.length;
      const allTasks = await taskService.getAllTasks();
      const lastSyncedAt = allTasks
        .filter(t => t.last_synced_at)
        .map(t => t.last_synced_at)
        .sort()
        .reverse()[0] || null;
      const isConnected = await syncService.checkConnectivity();
      res.json({
        pendingSyncCount,
        lastSyncedAt,
        isConnected
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Batch sync endpoint (for server-side use)
  router.post('/batch', async (req: Request, res: Response) => {
    try {
      const items = req.body.operations;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Invalid batch request format' });
      }
      const response = await syncService.processBatch(items);
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Health check endpoint
  router.get('/health', async (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  return router;
}
