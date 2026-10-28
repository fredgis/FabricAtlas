import type { ItemOneLakeRoles } from "../governance-evidence";

function Badge({ label, title }: { label: string; title: string }) {
  return (
    <span
      title={title}
      className="rounded-md border border-primary/30 bg-primary/10 px-xs text-100 font-semibold text-brand-foreground"
    >
      {label}
    </span>
  );
}

export function OneLakeRolesList({ value }: { value: ItemOneLakeRoles }) {
  if (!value.known) {
    return (
      <p className="text-200 text-muted-foreground">
        OneLake data access roles: Unknown — the roles API was not available to the synchronizer.
      </p>
    );
  }
  if (value.roles.length === 0) {
    return <p className="text-200 text-muted-foreground">No OneLake data access role recorded for this item.</p>;
  }
  return (
    <ul className="grid gap-s" aria-label="OneLake data access roles">
      {value.roles.map((role) => (
        <li key={role.roleName} className="rounded-lg border border-border p-s text-200">
          <div className="flex flex-wrap items-center gap-xs">
            <span className="font-semibold">{role.roleName}</span>
            {role.rowSecurity && <Badge label="RLS" title="Row-level security constraint" />}
            {role.columnSecurity && <Badge label="CLS" title="Column-level security constraint" />}
          </div>
          <p className="mt-xxs text-muted-foreground">
            {role.permissions.join(", ") || "No permission"} · {role.paths.join(", ") || "No path"}
          </p>
          <p className="text-muted-foreground">
            {role.memberIds.length} member{role.memberIds.length === 1 ? "" : "s"}
            {role.itemMemberCount > 0 && ` · ${role.itemMemberCount} item-permission rule${role.itemMemberCount === 1 ? "" : "s"}`}
          </p>
        </li>
      ))}
    </ul>
  );
}