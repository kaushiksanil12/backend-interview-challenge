import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { SyncService } from '../services/syncService';
import { Database } from '../db/database';

export function createTaskRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const tasks = await taskService.getAllTasks();
      return res.json(tasks);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const task = await taskService.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      return res.json(task);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch task' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { title, description } = req.body;
      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'Title is required and must be a string' });
      }
      const newTask = await taskService.createTask({ title, description });
      await syncService.addToSyncQueue(newTask.id, 'create', newTask);
      return res.status(201).json(newTask);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create task' });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const { title, description, completed } = req.body;
      if (title !== undefined && typeof title !== 'string') {
        return res.status(400).json({ error: 'Title must be a string' });
      }
      if (description !== undefined && typeof description !== 'string') {
        return res.status(400).json({ error: 'Description must be a string' });
      }
      if (completed !== undefined && typeof completed !== 'boolean') {
        return res.status(400).json({ error: 'Completed must be a boolean' });
      }
      const updatedTask = await taskService.updateTask(req.params.id, { title, description, completed });
      if (!updatedTask) {
        return res.status(404).json({ error: 'Task not found' });
      }
      await syncService.addToSyncQueue(updatedTask.id, 'update', updatedTask);
      return res.json(updatedTask);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update task' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const success = await taskService.deleteTask(req.params.id);
      if (!success) {
        return res.status(404).json({ error: 'Task not found' });
      }
      await syncService.addToSyncQueue(req.params.id, 'delete', {});
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  return router;
}
