/**
 * Calendar free/busy projection.
 *
 * Canon: CEDRUS.md Part I §7 item 9, reboot plan §17.
 *
 * "Store: busy intervals (start, end) for a short forward window, per member. A
 * last-synced timestamp. Connection status."
 *
 * "Never store, never request, never log: event titles, descriptions, locations,
 * attendees, organizers, conference links, recurrence rules, colors, calendar
 * names, or free-text of any kind."
 *
 * Two layers of enforcement, because one is a policy and two is a guarantee:
 *
 *   1. The busy interval object is closed and holds two timestamps. Anything
 *      else is an unknown key and is rejected. This is the *shape* layer, and
 *      an independent JSON Schema implementation enforces it too.
 *   2. `assertNoCalendarContent` walks an arbitrary payload at any depth and
 *      rejects forbidden field names by normalised name. This is the *fetch*
 *      layer, and it is what a sync job calls on the raw provider response
 *      before anything else touches it. Reboot plan §17: "The enforcement point
 *      is the fetch, not the render."
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const CALENDAR_PROJECTION_VERSION = 1;
/**
 * A busy interval. Two timestamps. That is the entire vocabulary of what Cedrus
 * knows about a member's calendar.
 */
export declare const busyIntervalValidator: import("../schema/core.ts").Validator<{
    starts_at: string;
    ends_at: string;
}>;
export type BusyInterval = Infer<typeof busyIntervalValidator>;
/**
 * Projection freshness. `stale` and `disconnected` are distinct from `live`
 * because Lesson 7 is exactly this shape: a guard that cannot tell "checked and
 * fine" from "did not run". Today reads this field to decide whether it may
 * speak in known statements at all.
 */
export declare const PROJECTION_FRESHNESS: readonly ["live", "stale", "disconnected"];
export declare const calendarFreeBusyProjectionValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    member_id: string;
    connection_ref: string | null;
    provider: "google_calendar";
    window: {
        starts_at: string;
        ends_at: string;
    };
    busy: readonly {
        starts_at: string;
        ends_at: string;
    }[];
    freshness: "disconnected" | "live" | "stale";
    synced_at: string | null;
}>;
export type CalendarFreeBusyProjection = Infer<typeof calendarFreeBusyProjectionValidator>;
export declare const calendarFreeBusyProjectionContract: Contract<CalendarFreeBusyProjection>;
/**
 * Availability, the member-facing view. Two sources, never mixed silently:
 * `stated` windows come from onboarding and are user-reported; `calendar`
 * windows come from the projection above and are known.
 *
 * When the projection is not live, availability must say so. Reboot plan §12:
 * "if the connection breaks, expires, or is revoked, Today falls back to the
 * pre-Calendar behaviour and says so. It does not silently start guessing while
 * looking certain."
 */
export declare const AVAILABILITY_BASES: readonly ["stated", "calendar"];
export declare const AVAILABILITY_VERSION = 1;
export declare const availabilityValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    member_id: string;
    date: string;
    basis: "calendar" | "stated";
    open_windows: readonly {
        starts_at: string;
        ends_at: string;
    }[];
    fallback_notice: "using_your_usual_windows" | "calendar_disconnected" | "calendar_stale" | null;
    computed_at: string;
}>;
export type Availability = Infer<typeof availabilityValidator>;
export declare const availabilityContract: Contract<Availability>;
