/**
 * Guard: calendar content never enters the system.
 *
 * Canon:
 *   - CEDRUS.md Part I §7 item 9: "Exact calendars stay private. Only relevant
 *     availability may be used."
 *   - Reboot plan §17: "Never store, never request, never log: event titles,
 *     descriptions, locations, attendees, organizers, conference links,
 *     recurrence rules, colors, calendar names, or free-text of any kind."
 *   - Reboot plan §17: "The enforcement point is the fetch, not the render. If
 *     titles are fetched and then not displayed, they are in the logs, in the
 *     response cache, and in the error reports."
 *
 * So this guard is exported as a standalone assertion, not only as part of a
 * validator. A sync job calls `assertNoCalendarContent` on the raw provider
 * response before anything else touches it. It walks the whole payload, at any
 * depth, because a title smuggled three levels down is still a title.
 */
import { type Issue } from '../schema/core.ts';
/**
 * Field names that may not appear anywhere in a calendar-derived payload, in any
 * casing or separator style. Matching is normalised: `eventTitle`, `event_title`
 * and `EVENT-TITLE` all collapse to `eventtitle`.
 */
export declare const FORBIDDEN_CALENDAR_FIELDS: readonly ["title", "summary", "description", "location", "attendee", "attendees", "guest", "guests", "organizer", "creator", "conferencedata", "hangoutlink", "meetinglink", "recurrence", "recurringeventid", "color", "colorid", "calendarname", "calendarsummary", "notes", "agenda", "eventid", "icaluid", "htmllink", "attachments", "visibility", "transparency", "extendedproperties"];
/**
 * Walks a payload and reports every forbidden calendar field found. Depth is
 * unbounded: nesting is not an escape hatch.
 */
export declare const findCalendarContent: (payload: unknown, path?: string) => readonly Issue[];
/**
 * The fetch-boundary assertion. Call this on the raw provider response before
 * it is stored, cached, logged, or handed to anything else.
 *
 * Throws rather than returning a result, because the caller of a boundary
 * assertion is a sync job, and a sync job that continues past this point has
 * already put a title in a log line.
 */
export declare class CalendarBoundaryViolation extends Error {
    readonly issues: readonly Issue[];
    constructor(issues: readonly Issue[]);
}
export declare const assertNoCalendarContent: (payload: unknown, path?: string) => void;
/**
 * JSON Schema fragment: no property whose name normalises to a forbidden field.
 * `propertyNames` with a `not`/`enum` gives an independent JSON Schema
 * implementation the same rule, one level at a time. Deep enforcement stays in
 * the TypeScript guard, and the agreement test records that difference.
 */
export declare const forbiddenCalendarPropertyNamesSchema: () => {
    [key: string]: unknown;
};
