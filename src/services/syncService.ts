import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Task, SyncQueueItem, SyncResult, BatchSyncResponse } from '../types';
import { Database } from '../db/database';
import { TaskService } from './taskService';

export class SyncService {
  private apiUrl: string;
  private readonly SYNC_BATCH_SIZE: number;
  private readonly MAX_RETRIES: number = 3;

  constructor(
    private db: Database,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || 'http://localhost:3000/api'
  ) {
    this.apiUrl = apiUrl;
    this.SYNC_BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE || '10', 10);
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      success: 0,
      failed: 0,
      conflicts: 0,
      total: 0
    };

    try {
      // 1. Get all items from sync queue
      const queueItems = await this.db.all(
        'SELECT * FROM sync_queue ORDER BY created_at ASC'
      );

      result.total = queueItems.length;

      if (queueItems.length === 0) {
        return result;
      }

      // 2. Group items by batch
      const batches: SyncQueueItem[][] = [];
      for (let i = 0; i < queueItems.length; i += this.SYNC_BATCH_SIZE) {
        batches.push(queueItems.slice(i, i + this.SYNC_BATCH_SIZE));
      }

      // 3. Process each batch
      for (const batch of batches) {
        try {
          const batchResponse = await this.processBatch(batch);

          // 4. Handle success/failure for each item
          for (const item of batch) {
            const responseItem = batchResponse.results.find(r => r.localId === item.task_id);

            if (responseItem?.success) {
              // 5. Update sync status
              await this.updateSyncStatus(item.task_id, 'synced', responseItem.data);
              result.success++;
              // Remove from sync queue
              await this.db.run('DELETE FROM sync_queue WHERE id = ?', [item.id]);
            } else if (responseItem?.conflict) {
              // Handle conflict
              const localTask = JSON.parse(item.data) as Task;
              const resolvedTask = await this.resolveConflict(localTask, responseItem.serverData!);

              await this.taskService.updateTask(resolvedTask.id, resolvedTask);
              await this.updateSyncStatus(item.task_id, 'synced', resolvedTask);
              result.conflicts++;

              await this.db.run('DELETE FROM sync_queue WHERE id = ?', [item.id]);
            } else {
              // Handle error
              await this.handleSyncError(item, new Error(responseItem?.error || 'Unknown error'));
              result.failed++;
            }
          }
        } catch (batchError) {
          // If entire batch fails, handle each item individually
          for (const item of batch) {
            await this.handleSyncError(item, batchError as Error);
            result.failed++;
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  }

  async addToSyncQueue(taskId: string, operation: 'create' | 'update' | 'delete', data: Partial<Task>): Promise<void> {
    // 1. Create sync queue item
    const serializedData = JSON.stringify(data);

    // 2. Check if item already exists in queue
    const existing = await this.db.all(
      'SELECT * FROM sync_queue WHERE task_id = ? AND operation = ?',
      [taskId, operation]
    );

    // 3. Insert or update sync queue
    if (existing.length > 0) {
      // Update existing queue item
      await this.db.run(
        'UPDATE sync_queue SET data = ?, retry_count = 0, updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND operation = ?',
        [serializedData, taskId, operation]
      );
    } else {
      // Insert new item
      await this.db.run(
        `INSERT INTO sync_queue (id, task_id, operation, data, retry_count, created_at) 
         VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`,
        [uuidv4(), taskId, operation, serializedData]
      );
    }
  }

  // ---- MAKE THIS PUBLIC ----
  public async processBatch(items: any[]): Promise<BatchSyncResponse> {
    // Accepts array of {localId, operation, data}
    // No need to JSON.parse item.data if received from HTTP clients
    return {
      results: items.map(item => ({
        localId: item.localId,
        success: true,
        data: item.data
      }))
    };
  }

  private async resolveConflict(localTask: Task, serverTask: Task): Promise<Task> {
    const localTime = new Date(localTask.updated_at).getTime();
    const serverTime = new Date(serverTask.updated_at).getTime();

    const winner = serverTime > localTime ? serverTask : localTask;

    console.log(`Conflict resolved for task ${localTask.id}:`, {
      strategy: 'last-write-wins',
      winner: serverTime > localTime ? 'server' : 'local',
      localTime: new Date(localTask.updated_at).toISOString(),
      serverTime: new Date(serverTask.updated_at).toISOString()
    });

    return winner;
  }

  private async updateSyncStatus(
    taskId: string, 
    status: 'synced' | 'error', 
    serverData?: Partial<Task>
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    updates.push('sync_status = ?');
    values.push(status);

    if (serverData?.id) {
      updates.push('server_id = ?');
      values.push(serverData.id);
    }

    if (status === 'synced') {
      updates.push('last_synced_at = CURRENT_TIMESTAMP');
    }

    values.push(taskId);
    await this.db.run(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }

  private async handleSyncError(item: SyncQueueItem, error: Error): Promise<void> {
    const newRetryCount = item.retry_count + 1;
    const errorMessage = error.message;

    if (newRetryCount >= this.MAX_RETRIES) {
      await this.db.run(
        `UPDATE sync_queue 
         SET retry_count = ?, error_message = ?, status = 'failed', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [newRetryCount, errorMessage, item.id]
      );
      await this.updateSyncStatus(item.task_id, 'error');
      console.error(`Sync permanently failed for task ${item.task_id} after ${newRetryCount} retries:`, errorMessage);
    } else {
      await this.db.run(
        `UPDATE sync_queue 
         SET retry_count = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [newRetryCount, errorMessage, item.id]
      );
      console.warn(`Sync failed for task ${item.task_id} (attempt ${newRetryCount}/${this.MAX_RETRIES}):`, errorMessage);
    }
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
