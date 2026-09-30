"use client";

import { useState, type ComponentProps } from "react";
import { ImportDialog } from "@/components/import/import-dialog";

/** Dev preview only: the import dialog opened on its preview step. */
export function ImportPreviewDemo(props: Omit<ComponentProps<typeof ImportDialog>, "open" | "onOpenChange">) {
  const [open, setOpen] = useState(true);
  return <ImportDialog {...props} open={open} onOpenChange={setOpen} />;
}
