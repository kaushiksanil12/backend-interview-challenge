import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types';
import { Database } from '../db/database';

export class TaskService {
  constructor(private db: Database) {}

  async createTask(taskData: Partial<Task>): Promise<Task> {
    const taskId = uuidv4();
    const now = new Date().toISOString();
    const task: Task = {
      id: taskId,
      title: taskData.title || '',
      description: taskData.description || '',
      completed: false,
      is_deleted: false,
      sync_status: 'pending',
      created_at: now,
      updated_at: now,
      last_synced_at: null,
      server_id: null
    };

    await this.db.run(
      `INSERT INTO tasks (
        id, title, description, completed, is_deleted, 
        sync_status, created_at, updated_at, last_synced_at, server_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.title,
        task.description,
        task.completed ? 1 : 0,
        task.is_deleted ? 1 : 0,
        task.sync_status,
        task.created_at,
        task.updated_at,
        task.last_synced_at,
        task.server_id
      ]
    );

    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const existingTask = await this.getTask(id);
    if (!existingTask) return null;

    const now = new Date().toISOString();

    const updateFields: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      updateFields.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      params.push(updates.description);
    }
    if (updates.completed !== undefined) {
      updateFields.push('completed = ?');
      params.push(updates.completed ? 1 : 0);
    }
    updateFields.push('updated_at = ?');
    params.push(now);
    updateFields.push('sync_status = ?');
    params.push('pending');
    params.push(id);

    await this.db.run(
      `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`, params
    );

    return await this.getTask(id);
  }

  async deleteTask(id: string): Promise<boolean> {
    const existingTask = await this.getTask(id);
    if (!existingTask) return false;

    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE tasks
       SET is_deleted = 1,
           updated_at = ?,
           sync_status = ?
       WHERE id = ?`,
      [now, 'pending', id]
    );
    return true;
  }

  async getTask(id: string): Promise<Task | null> {
    const row = await this.db.get(
      'SELECT * FROM tasks WHERE id = ? AND is_deleted = 0',
      [id]
    );
    if (!row) return null;
    return this.mapRowToTask(row);
  }

  async getAllTasks(): Promise<Task[]> {
    const rows = await this.db.all(
      'SELECT * FROM tasks WHERE is_deleted = 0 ORDER BY created_at DESC'
    );
    return rows.map(row => this.mapRowToTask(row));
  }

  async getTasksNeedingSync(): Promise<Task[]> {
    const rows = await this.db.all(
      "SELECT * FROM tasks WHERE sync_status IN ('pending', 'error') AND is_deleted = 0 ORDER BY updated_at ASC"
    );
    return rows.map(row => this.mapRowToTask(row));
  }

  private mapRowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      completed: Boolean(row.completed),
      is_deleted: Boolean(row.is_deleted),
      sync_status: row.sync_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_synced_at: row.last_synced_at,
      server_id: row.server_id
    };
  }
}
