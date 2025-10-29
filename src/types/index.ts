export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  is_deleted: boolean;
  sync_status: string;
  created_at: string;           // ISO string
  updated_at: string;           // ISO string
  last_synced_at?: string | null;
  server_id?: string | null;
}

export interface SyncQueueItem {
  id: string;
  task_id: string;
  operation: string;
  data: string;
  created_at: string;
  retry_count: number;
  error_message?: string;
}

export interface SyncResult {
  success: number;
  failed: number;
  conflicts: number;
  total: number;
}

export interface BatchSyncResponse {
  results: Array<{
    localId: string;
    success?: boolean;
    conflict?: boolean;
    error?: string;
    data?: Task | object;
    serverData?: Task;
  }>;
}
