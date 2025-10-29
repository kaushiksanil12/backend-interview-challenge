import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { SyncService } from '../services/syncService';
import { Database } from '../db/database';

export function createTaskRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  // Get all tasks
  router.get('/', async (req: Request, res: Response) => {
    try {
      const tasks = await taskService.getAllTasks();
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  // Get single task
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const task = await taskService.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch task' });
    }
  });

  // Create task
  router.post('/', async (req: Request, res: Response) => {
    try {
      // 1. Validate request body
      const { title, description } = req.body;
      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'Title is required and must be a string' });
      }

      // 2. Call taskService.createTask()
      const newTask = await taskService.createTask({ title, description });

      // 3. Add to sync queue
      await syncService.addToSyncQueue(newTask.id, 'create', newTask);

      // 4. Return created task
      res.status(201).json(newTask);
    } catch (error) {
      console.error('Create Task error:', error);
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // Update task
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      // 1. Validate request body
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

      // 2. Call taskService.updateTask()
      const updatedTask = await taskService.updateTask(req.params.id, { title, description, completed });

      // 3. Handle not found case
      if (!updatedTask) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // 4. Add to sync queue
      await syncService.addToSyncQueue(updatedTask.id, 'update', updatedTask);

      // 5. Return updated task
      res.json(updatedTask);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update task' });
    }
  });

  // Delete task
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      // 1. Call taskService.deleteTask()
      const success = await taskService.deleteTask(req.params.id);

      // 2. Handle not found case
      if (!success) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // 3. Add to sync queue
      await syncService.addToSyncQueue(req.params.id, 'delete', {});

      // 4. Return success response
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  return router;
}
