"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { EyeOffIcon, MoreHorizontalIcon, ReceiptTextIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { dismissPriceIncrease, hideSubscription } from "@/actions/subscriptions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function SubscriptionMenu({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${name}`} disabled={pending} />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/transactions?q=${encodeURIComponent(name)}`)}>
          <ReceiptTextIcon /> See charges
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            startTransition(async () => {
              await hideSubscription(id);
              toast.success(`${name} hidden`, { description: "It won't be detected as a subscription again." });
            })
          }
        >
          <EyeOffIcon /> Not a subscription
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DismissPriceIncrease({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Dismiss price change for ${name}`}
      disabled={pending}
      onClick={() => startTransition(() => dismissPriceIncrease(id))}
    >
      <XIcon />
    </Button>
  );
}
