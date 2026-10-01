"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { allow } from "@/lib/guard";
import { RateLimitError } from "@/lib/rate-limit";
import { addToTrip, createTrip, deleteTrip, dismissSuggestion, removeFromTrip, updateTrip } from "@/lib/trips";
import { loadUserContext } from "@/lib/user";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const isoDate = z.iso.date({ error: "Use a valid date" });
const TripInput = z
  .object({ name: z.string().trim().min(1, "Give the trip a name").max(80), startsOn: isoDate, endsOn: isoDate })
  .refine((v) => v.endsOn >= v.startsOn, { message: "The trip must end on or after it starts", path: ["endsOn"] });

function refresh(id?: string) {
  revalidatePath("/trips");
  if (id) revalidatePath(`/trips/${id}`);
  revalidatePath("/dashboard");
}

/** Signed in and under the rate limit; the limit comes back as an error to show, not a throw. */
async function guarded<T>(fn: (userId: string) => Promise<Result<T>>): Promise<Result<T>> {
  const userId = await requireUser();
  if (!(await allow(userId, "trip.save"))) return { ok: false, error: new RateLimitError().message };
  return fn(userId);
}

export async function createTripAction(
  input: z.input<typeof TripInput> & { transactionIds?: string[] },
): Promise<Result<string>> {
  return guarded(async (userId) => {
    const parsed = TripInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form" };
    const ids = input.transactionIds ? z.array(z.uuid()).max(1000).parse(input.transactionIds) : undefined;
    const id = await withUser(userId, async (tx) => {
      const { crypto } = await loadUserContext(tx, userId);
      return createTrip(tx, crypto, { ...parsed.data, transactionIds: ids });
    });
    refresh(id);
    return { ok: true, data: id };
  });
}

export async function updateTripAction(id: string, input: z.input<typeof TripInput>): Promise<Result> {
  return guarded(async (userId) => {
    const parsed = TripInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form" };
    const ok = await withUser(userId, async (tx) =>
      updateTrip(tx, (await loadUserContext(tx, userId)).crypto, z.uuid().parse(id), parsed.data),
    );
    if (!ok) return { ok: false, error: "Trip not found" };
    refresh(id);
    return { ok: true, data: undefined };
  });
}

export async function deleteTripAction(id: string): Promise<Result> {
  return guarded(async (userId) => {
    await withUser(userId, (tx) => deleteTrip(tx, z.uuid().parse(id)));
    refresh();
    return { ok: true, data: undefined };
  });
}

export async function addToTripAction(tripId: string, transactionIds: string[]): Promise<Result<number>> {
  return guarded(async (userId) => {
    const ids = z.array(z.uuid()).max(500).parse(transactionIds);
    const added = await withUser(userId, (tx) => addToTrip(tx, userId, z.uuid().parse(tripId), ids));
    refresh(tripId);
    return { ok: true, data: added };
  });
}

export async function removeFromTripAction(tripId: string, transactionId: string): Promise<Result> {
  return guarded(async (userId) => {
    await withUser(userId, (tx) => removeFromTrip(tx, z.uuid().parse(tripId), z.uuid().parse(transactionId)));
    refresh(tripId);
    return { ok: true, data: undefined };
  });
}

export async function dismissSuggestionAction(key: string, startsOn: string): Promise<Result> {
  return guarded(async (userId) => {
    const k = z.string().max(200).parse(key);
    await withUser(userId, async (tx) =>
      dismissSuggestion(tx, (await loadUserContext(tx, userId)).crypto, k, isoDate.parse(startsOn)),
    );
    refresh();
    return { ok: true, data: undefined };
  });
}
