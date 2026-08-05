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
import { arrayOf, defineContract, enumOf, inspect, literal, nullable, object, refine, } from "../schema/core.js";
import { id, instant, memberId } from "../common/primitives.js";
import { findCalendarContent } from "../guards/calendar-boundary.js";
export const CALENDAR_PROJECTION_VERSION = 1;
/**
 * A busy interval. Two timestamps. That is the entire vocabulary of what Cedrus
 * knows about a member's calendar.
 */
export const busyIntervalValidator = refine(object({
    starts_at: instant('Busy from, UTC.'),
    ends_at: instant('Busy until, UTC.'),
}), {
    code: 'window/ends_before_starts',
    message: 'ends_at must be after starts_at',
    expressedInJsonSchema: false,
    predicate: (w) => Date.parse(w.ends_at) > Date.parse(w.starts_at),
});
/**
 * Projection freshness. `stale` and `disconnected` are distinct from `live`
 * because Lesson 7 is exactly this shape: a guard that cannot tell "checked and
 * fine" from "did not run". Today reads this field to decide whether it may
 * speak in known statements at all.
 */
export const PROJECTION_FRESHNESS = ['live', 'stale', 'disconnected'];
export const calendarFreeBusyProjectionValidator = inspect(object({
    schema_version: literal(CALENDAR_PROJECTION_VERSION),
    member_id: memberId(),
    connection_ref: nullable(id('The authorization this projection came from.')),
    provider: literal('google_calendar'),
    /** A bounded forward window. Not the whole calendar, not the past. */
    window: refine(object({
        starts_at: instant('Projection window start.'),
        ends_at: instant('Projection window end.'),
    }), {
        code: 'window/ends_before_starts',
        message: 'ends_at must be after starts_at',
        expressedInJsonSchema: false,
        predicate: (w) => Date.parse(w.ends_at) > Date.parse(w.starts_at),
    }),
    busy: arrayOf(busyIntervalValidator, {
        maxItems: 500,
        description: 'Busy intervals only. No titles, descriptions, locations, or attendees exist in this shape.',
    }),
    freshness: enumOf(PROJECTION_FRESHNESS),
    synced_at: nullable(instant('Last successful read. Null when the projection has never run.')),
}), {
    /**
     * Belt and braces. The object is already closed, so this can only fire if
     * someone widens the shape. That is precisely when it needs to fire, and
     * the mutation control proves it can.
     */
    expressedInJsonSchema: false,
    run: (projection, path) => findCalendarContent(projection, path),
});
export const calendarFreeBusyProjectionContract = defineContract({
    name: 'cedrus.calendar_freebusy_projection',
    version: CALENDAR_PROJECTION_VERSION,
    title: 'Calendar free/busy projection',
    description: 'Busy intervals for a bounded forward window. Titles, descriptions, locations and attendees have no representation in this contract.',
    sources: ['CEDRUS.md I.7.9', 'reboot plan §12', 'reboot plan §16 reading pattern', 'reboot plan §17'],
}, calendarFreeBusyProjectionValidator);
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
export const AVAILABILITY_BASES = ['stated', 'calendar'];
export const AVAILABILITY_VERSION = 1;
export const availabilityValidator = refine(object({
    schema_version: literal(AVAILABILITY_VERSION),
    member_id: memberId(),
    date: instant('The day this availability describes, at local midnight in UTC.'),
    basis: enumOf(AVAILABILITY_BASES),
    /** Windows the member could use. Derived, and labelled with its basis. */
    open_windows: arrayOf(refine(object({ starts_at: instant('Open from.'), ends_at: instant('Open until.') }), {
        code: 'window/ends_before_starts',
        message: 'ends_at must be after starts_at',
        expressedInJsonSchema: false,
        predicate: (w) => Date.parse(w.ends_at) > Date.parse(w.starts_at),
    }), { maxItems: 24 }),
    /**
     * Required when the basis is `stated`, and required to be null when the
     * basis is `calendar`. Saying which one it is, always, is the product rule
     * (reboot plan §10 Today zone 1: "Always says which one it is").
     */
    fallback_notice: nullable(enumOf(['using_your_usual_windows', 'calendar_disconnected', 'calendar_stale'])),
    computed_at: instant('When this was computed.'),
}), {
    code: 'availability/basis_notice_mismatch',
    message: 'availability based on stated windows must carry a fallback notice, and calendar-based availability must not',
    expressedInJsonSchema: false,
    predicate: (a) => (a.basis === 'stated' ? a.fallback_notice !== null : a.fallback_notice === null),
});
export const availabilityContract = defineContract({
    name: 'cedrus.availability',
    version: AVAILABILITY_VERSION,
    title: 'Availability',
    description: 'Open windows for one day, labelled with whether they came from stated usual windows or from a live calendar projection.',
    sources: ['reboot plan §11', 'reboot plan §12', 'CEDRUS.md II.4 lesson 7'],
}, availabilityValidator);
