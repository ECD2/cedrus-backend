-- ███ STATUS: APPLIED TO PROD 2026-07-27 via ~/.config/cedrus/migrate/apply-days-since.mjs ███
-- Pre-check: 4 people, 2 with last_contact_at, 0 with a days_since value.
-- Post-check: both Lucas -> days_since_contact = 2 (hand-verified against
-- last_contact_at); Emil/Me still NULL (no last_contact_at); every row's
-- relationship_health_score UNCHANGED (the control); 35-column list identical;
-- dependent v_agent_person_context survived CREATE OR REPLACE and sees the fix.
-- Rollback: psql -f docs/DAYS_SINCE_CONTACT.rollback.sql (verbatim prior definition).
--
-- Safety spec / person panel — days_since_contact was NULL for every person.
--
-- v_people_for_agent gated days_since_contact on contact_frequency_days:
--     WHEN p.last_contact_at IS NULL OR p.contact_frequency_days IS NULL THEN NULL
-- Days-since needs no cadence to compute. Nothing writes contact_frequency_days
-- (0 of 4 prod rows, no writer in either repo, no column default), so the column
-- was NULL for every person of every user and "Last touch" read "no record yet"
-- even with contact_events logged and people.last_contact_at correctly set.
--
-- THE ONLY CHANGE is removing `OR p.contact_frequency_days IS NULL` from the
-- days_since_contact branch. The IDENTICAL guard on relationship_health_score is
-- CORRECT and is deliberately left alone — contact_frequency_days is that
-- score's denominator (NULLIF(p.contact_frequency_days * 2, 0)).
--
-- Generated from the live definition by one targeted replacement; see
-- docs/DAYS_SINCE_CONTACT.rollback.sql for the verbatim pre-change definition
-- and the rollback path.
--
-- CREATE OR REPLACE (not DROP/CREATE): v_agent_person_context depends on this
-- view, and the output column list — 35 columns, same names, types and order —
-- is unchanged, which is what lets REPLACE keep the dependent intact.

CREATE OR REPLACE VIEW public.v_people_for_agent AS
 SELECT p.id,
    p.user_id,
    p.name,
    p.aliases,
    p.relationship,
    p.birthday_month,
    p.birthday_day,
    p.birthday_year,
    p.is_self,
    p.is_archived,
    p.archived_at,
    p.archived_reason,
    p.is_core_five,
    p.core_five_source,
    p.core_five_locked,
    p.core_five_score,
    p.last_core_evaluated_at,
    p.contact_frequency_days,
    p.last_contact_at,
    p.last_contact_source,
    p.last_nudged_at,
    p.created_at,
    p.updated_at,
    p.dunbar_tier,
    p.dunbar_tier_source,
    p.dunbar_tier_locked,
    p.dunbar_tier_score,
    p.last_tier_evaluated_at,
    u.plan,
    u.billing_status,
    u.trial_ends_at,
    u.opted_out,
        CASE
            WHEN u.opted_out THEN false
            WHEN u.plan = 'pro'::user_plan AND u.billing_status = 'active'::billing_status THEN true
            WHEN u.plan = 'trialing'::user_plan AND u.trial_ends_at > now() THEN true
            WHEN p.is_core_five THEN true
            WHEN p.is_self THEN true
            ELSE false
        END AS proactive_enabled,
        CASE
            WHEN p.last_contact_at IS NULL THEN NULL::integer
            ELSE floor(EXTRACT(epoch FROM now() - p.last_contact_at) / 86400::numeric)::integer
        END AS days_since_contact,
        CASE
            WHEN p.last_contact_at IS NULL OR p.contact_frequency_days IS NULL THEN NULL::integer
            ELSE GREATEST(0::numeric, LEAST(100::numeric, round(100::numeric - floor(EXTRACT(epoch FROM now() - p.last_contact_at) / 86400::numeric) / NULLIF(p.contact_frequency_days * 2, 0)::numeric * 100::numeric)))::integer
        END AS relationship_health_score
   FROM people p
     JOIN app_users u ON u.id = p.user_id
  WHERE p.is_archived = false;
