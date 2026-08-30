# V7.1 research notes

## Motion scheduling model

Motion’s published auto-scheduling documentation says placement considers calendar availability, task duration, earliest/start date, deadline, priority, chunking, schedules or working hours, and existing events. It describes dynamic replanning when task or calendar facts change, distinguishes hard and soft deadlines, and treats auto-scheduling as separate from workflow status.

Cedrus uses those published inputs as a parity floor, without claiming Motion’s private algorithm or inventing its weights. V7.1 adds a visible Cedrus placement score whose nine weights total 100, while calendar conflicts, earliest start, hard deadline, dependencies, allowed schedule, working hours, minimum chunk, location, and locked blocks remain non-negotiable constraints.

Primary references:

- https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling
- https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers
- https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes
- https://www.usemotion.com/help/time-management/auto-scheduling/auto-scheduling-how-to-guide
- https://www.usemotion.com/blog/understanding-auto-scheduled-updates

## HabibiFit reference inspection

The Lovable prototype was inspected end-to-end across Today, Train, Calendar, Progress, and Thesis. The strongest useful product patterns were:

- Today shows the current rotation day and a direct workout start.
- Train exposes the whole exercise lineup, sets, reps, prior-session context, and alternate day choices.
- Calendar shows gym/yoga patterns and the next programmed sessions.
- Progress includes weight check-ins, monthly sessions, exercise history, and personal records by training day.
- Thesis separates research, recipes, supplements, and grocery material.

Public listings also describe personalized workouts, nutrition or meal planning, progress tracking, and reminders. Cedrus does not clone the app. It uses the evidence to make Fitness a real module with owned program data, metrics, goals, sources, and a scheduler hook.

Public references:

- https://habibifit.lovable.app/
- https://apps.apple.com/us/app/habibifit/id6751820843
- https://play.google.com/store/apps/details?id=hu.smartdirekthungaria.habibifit
- https://www.hbbfitness.com/
