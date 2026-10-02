import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { useAtlas } from "../store";
import { cn } from "../ui";

export function WorkspaceSelector({
  className,
  hideWhenSingle = false,
}: {
  className?: string;
  hideWhenSingle?: boolean;
}) {
  const {
    workspaceScopes,
    workspaceScopesLoading,
    workspaceScopesError,
    activeWorkspaceId,
    selectWorkspace,
    syncing,
  } = useAtlas();
  const selectId = useId();
  const hintId = useId();
  const single = workspaceScopes.length < 2;
  if (hideWhenSingle && single && !workspaceScopesError) return null;

  const hint = syncing
    ? "Cancel the active synchronization before changing workspace."
    : workspaceScopesLoading
      ? "Loading the shared workspace scope."
      : single
        ? "Only one workspace is in the shared Atlas scope."
        : `${workspaceScopes.length} workspaces are in the shared Atlas scope.`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-xs", className)}>
      <label htmlFor={selectId} className="text-200 font-semibold text-foreground">
        Active workspace
      </label>
      <select
        id={selectId}
        value={activeWorkspaceId}
        aria-describedby={hintId}
        disabled={syncing || workspaceScopesLoading || single}
        onChange={(event) => selectWorkspace(event.target.value)}
        className="min-h-[var(--atlas-touch-target)] w-full min-w-0 rounded-md border border-input bg-card px-m text-300 text-foreground disabled:opacity-70 sm:min-h-[var(--atlas-control-height)]"
      >
        {!workspaceScopes.some((scope) => scope.id === activeWorkspaceId) && (
          <option value={activeWorkspaceId} disabled>
            Select a workspace
          </option>
        )}
        {workspaceScopes.map((scope) => (
          <option key={scope.id} value={scope.id}>
            {scope.displayName}
          </option>
        ))}
      </select>
      <p id={hintId} className="text-200 leading-200 text-muted-foreground">
        {hint}
      </p>
      {workspaceScopesError && (
        <p
          role="alert"
          className="flex items-start gap-xs text-200 leading-200 text-foreground"
        >
          <AlertTriangle
            className="mt-xxs icon-size-100 shrink-0 text-destructive"
            aria-hidden="true"
          />
          {workspaceScopesError}
        </p>
      )}
    </div>
  );
}
