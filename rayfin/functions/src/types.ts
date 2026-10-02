/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  ping: {
    input: Record<string, never>;
    output: { status: 'ok'; service: 'fabric-atlas'; contractVersion: 1 };
  };
  workspaceDiscover: {
    input: Record<string, never>;
    output: { contractVersion: 1; workspaces: { id: string; displayName: string; workspaceType?: undefined | string; capacityId?: undefined | string }[]; truncated: boolean };
  };
  syncStart: {
    input: { protocolVersion: 1; workspaceId: string; requestId: string };
    output: { ok: true; protocolVersion: 1; outcomeCode: 'STATUS' | 'JOB_CREATED' | 'JOB_ATTACHED' | 'PROBE_COMPLETED' | 'PROBE_FINALIZED' | 'JOB_CANCELLED' | 'ALREADY_TERMINAL'; job: null | { id: string; workspaceId: string; snapshotId: string; protocolVersion: 1; scope: 'persistence-probe'; state: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'; phase: 'probe'; revision: number; completedTasks: number; totalTasks: number; createdAt: string; updatedAt: string; finishedAt: null | string; failure: null | { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean }; nextAction: 'syncContinue' | 'none'; anotherAuthorizedInvocationRequired: boolean; backgroundExecution: false; snapshotPublished: false; message: string } } | { ok: false; protocolVersion: 1; error: { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean } };
  };
  syncContinue: {
    input: { protocolVersion: 1; workspaceId: string; jobId: string; requestId: string };
    output: { ok: true; protocolVersion: 1; outcomeCode: 'STATUS' | 'JOB_CREATED' | 'JOB_ATTACHED' | 'PROBE_COMPLETED' | 'PROBE_FINALIZED' | 'JOB_CANCELLED' | 'ALREADY_TERMINAL'; job: null | { id: string; workspaceId: string; snapshotId: string; protocolVersion: 1; scope: 'persistence-probe'; state: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'; phase: 'probe'; revision: number; completedTasks: number; totalTasks: number; createdAt: string; updatedAt: string; finishedAt: null | string; failure: null | { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean }; nextAction: 'syncContinue' | 'none'; anotherAuthorizedInvocationRequired: boolean; backgroundExecution: false; snapshotPublished: false; message: string } } | { ok: false; protocolVersion: 1; error: { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean } };
  };
  syncStatus: {
    input: { protocolVersion: 1; workspaceId: string; jobId: undefined | string };
    output: { ok: true; protocolVersion: 1; outcomeCode: 'STATUS' | 'JOB_CREATED' | 'JOB_ATTACHED' | 'PROBE_COMPLETED' | 'PROBE_FINALIZED' | 'JOB_CANCELLED' | 'ALREADY_TERMINAL'; job: null | { id: string; workspaceId: string; snapshotId: string; protocolVersion: 1; scope: 'persistence-probe'; state: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'; phase: 'probe'; revision: number; completedTasks: number; totalTasks: number; createdAt: string; updatedAt: string; finishedAt: null | string; failure: null | { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean }; nextAction: 'syncContinue' | 'none'; anotherAuthorizedInvocationRequired: boolean; backgroundExecution: false; snapshotPublished: false; message: string } } | { ok: false; protocolVersion: 1; error: { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean } };
  };
  syncCancel: {
    input: { protocolVersion: 1; workspaceId: string; jobId: string; requestId: string };
    output: { ok: true; protocolVersion: 1; outcomeCode: 'STATUS' | 'JOB_CREATED' | 'JOB_ATTACHED' | 'PROBE_COMPLETED' | 'PROBE_FINALIZED' | 'JOB_CANCELLED' | 'ALREADY_TERMINAL'; job: null | { id: string; workspaceId: string; snapshotId: string; protocolVersion: 1; scope: 'persistence-probe'; state: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'; phase: 'probe'; revision: number; completedTasks: number; totalTasks: number; createdAt: string; updatedAt: string; finishedAt: null | string; failure: null | { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean }; nextAction: 'syncContinue' | 'none'; anotherAuthorizedInvocationRequired: boolean; backgroundExecution: false; snapshotPublished: false; message: string } } | { ok: false; protocolVersion: 1; error: { code: 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'PERSISTENCE_UNAVAILABLE' | 'CONCURRENCY_UNSUPPORTED' | 'TASK_CLAIMED' | 'CHECKPOINT_INVALID' | 'COMMAND_FAILED' | 'PROBE_FAILED'; message: string; retryable: boolean } };
  };
};
