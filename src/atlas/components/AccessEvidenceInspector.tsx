import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function AccessEvidenceInspector({
  desktop,
  onClose,
  onReturnFocus,
  children,
}: {
  desktop: boolean;
  onClose: () => void;
  onReturnFocus: () => void;
  children: ReactNode;
}) {
  if (desktop) {
    return (
      <aside aria-label="Selected access evidence" className="min-w-0 xl:sticky xl:top-l">
        {children}
      </aside>
    );
  }
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--atlas-evidence-overlay-z)] bg-background/80" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-[var(--atlas-evidence-panel-z)] w-full max-w-xl overflow-y-auto overscroll-contain bg-card shadow-fabric-16"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("access-evidence-close")?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
        >
          <Dialog.Title className="sr-only">Access evidence</Dialog.Title>
          <Dialog.Description className="sr-only">
            Recorded grant paths, unknown restriction layers and snapshot coverage.
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
