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
import { issue, walk } from "../schema/core.js";
/**
 * Field names that may not appear anywhere in a calendar-derived payload, in any
 * casing or separator style. Matching is normalised: `eventTitle`, `event_title`
 * and `EVENT-TITLE` all collapse to `eventtitle`.
 */
export const FORBIDDEN_CALENDAR_FIELDS = [
    'title',
    'summary',
    'description',
    'location',
    'attendee',
    'attendees',
    'guest',
    'guests',
    'organizer',
    'creator',
    'conferencedata',
    'hangoutlink',
    'meetinglink',
    'recurrence',
    'recurringeventid',
    'color',
    'colorid',
    'calendarname',
    'calendarsummary',
    'notes',
    'agenda',
    'eventid',
    'icaluid',
    'htmllink',
    'attachments',
    'visibility',
    'transparency',
    'extendedproperties',
];
/**
 * Prefixes a provider adds to the same field. `eventTitle`, `event_title` and
 * `calendarSummary` are the same disclosure as `title` and `summary`, so they
 * are stripped before the lookup.
 *
 * Stripping a known prefix is used rather than substring matching on purpose:
 * `allocation` contains `location` and `subtitle` contains `title`, and a guard
 * that fires on those becomes noise, and a noisy guard gets turned off.
 */
const PROVIDER_PREFIXES = ['event', 'calendar', 'cal', 'gcal', 'meeting', 'appointment', 'item'];
const normaliseKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const FORBIDDEN_SET = new Set(FORBIDDEN_CALENDAR_FIELDS);
const isForbiddenKey = (key) => {
    const normalised = normaliseKey(key);
    if (FORBIDDEN_SET.has(normalised))
        return true;
    for (const prefix of PROVIDER_PREFIXES) {
        if (normalised.startsWith(prefix) && normalised.length > prefix.length) {
            if (FORBIDDEN_SET.has(normalised.slice(prefix.length)))
                return true;
        }
    }
    return false;
};
/**
 * Walks a payload and reports every forbidden calendar field found. Depth is
 * unbounded: nesting is not an escape hatch.
 */
export const findCalendarContent = (payload, path = '') => {
    const issues = [];
    walk(payload, path, (node) => {
        if (node.key === null)
            return;
        if (isForbiddenKey(node.key)) {
            issues.push(issue(node.path, 'calendar/forbidden_field', `"${node.key}" is calendar content; Cedrus reads busy intervals only (reboot plan §17)`));
        }
    });
    return issues;
};
/**
 * The fetch-boundary assertion. Call this on the raw provider response before
 * it is stored, cached, logged, or handed to anything else.
 *
 * Throws rather than returning a result, because the caller of a boundary
 * assertion is a sync job, and a sync job that continues past this point has
 * already put a title in a log line.
 */
export class CalendarBoundaryViolation extends Error {
    issues;
    constructor(issues) {
        super(`calendar boundary violated: ${issues.map((i) => i.path).join(', ')}`);
        this.name = 'CalendarBoundaryViolation';
        this.issues = issues;
    }
}
export const assertNoCalendarContent = (payload, path = '') => {
    const issues = findCalendarContent(payload, path);
    if (issues.length > 0)
        throw new CalendarBoundaryViolation(issues);
};
/**
 * JSON Schema fragment: no property whose name normalises to a forbidden field.
 * `propertyNames` with a `not`/`enum` gives an independent JSON Schema
 * implementation the same rule, one level at a time. Deep enforcement stays in
 * the TypeScript guard, and the agreement test records that difference.
 */
export const forbiddenCalendarPropertyNamesSchema = () => ({
    propertyNames: {
        not: {
            enum: [...FORBIDDEN_CALENDAR_FIELDS],
        },
    },
});
