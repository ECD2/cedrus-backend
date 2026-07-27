-- Captured live from prod 2026-07-27
-- Rollback artifact for docs/DAYS_SINCE_CONTACT.proposed.sql
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
            WHEN p.last_contact_at IS NULL OR p.contact_frequency_days IS NULL THEN NULL::integer
            ELSE floor(EXTRACT(epoch FROM now() - p.last_contact_at) / 86400::numeric)::integer
        END AS days_since_contact,
        CASE
            WHEN p.last_contact_at IS NULL OR p.contact_frequency_days IS NULL THEN NULL::integer
            ELSE GREATEST(0::numeric, LEAST(100::numeric, round(100::numeric - floor(EXTRACT(epoch FROM now() - p.last_contact_at) / 86400::numeric) / NULLIF(p.contact_frequency_days * 2, 0)::numeric * 100::numeric)))::integer
        END AS relationship_health_score
   FROM people p
     JOIN app_users u ON u.id = p.user_id
  WHERE p.is_archived = false;
